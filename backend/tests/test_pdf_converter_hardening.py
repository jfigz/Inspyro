import asyncio
import base64
import io
import os
import pathlib
import sys
import threading
import time
import unittest
import xml.etree.ElementTree as ET
import zipfile
from unittest import mock

from docx import Document

BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services import pdf_converter


class PdfConverterHardeningTests(unittest.TestCase):
    def setUp(self) -> None:
        with pdf_converter._pdf_cache_lock:
            pdf_converter._docx_validation_cache.clear()

    def _make_docx_bytes(self) -> bytes:
        doc = Document()
        doc.add_paragraph("DOCX validation hardening")
        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()

    def _rewrite_docx_part(self, docx_bytes: bytes, updates: dict[str, bytes]) -> bytes:
        src = io.BytesIO(docx_bytes)
        dst = io.BytesIO()
        with zipfile.ZipFile(src, "r") as zin:
            with zipfile.ZipFile(dst, "w", compression=zipfile.ZIP_DEFLATED) as zout:
                written = set()
                for item in zin.infolist():
                    if item.filename in updates:
                        zout.writestr(item.filename, updates[item.filename])
                        written.add(item.filename)
                    else:
                        zout.writestr(item.filename, zin.read(item.filename))
                for name, payload in updates.items():
                    if name not in written:
                        zout.writestr(name, payload)
        return dst.getvalue()

    def _to_b64(self, payload: bytes) -> str:
        return base64.b64encode(payload).decode("utf-8")

    def _make_large_docx_bytes(self, extra_size: int = 9 * 1024 * 1024) -> bytes:
        raw = self._make_docx_bytes()
        return self._rewrite_docx_part(raw, {"word/media/filler.bin": os.urandom(extra_size)})

    def test_validate_docx_structure_accepts_valid_docx(self):
        docx_b64 = self._to_b64(self._make_docx_bytes())
        ok, error = pdf_converter.validate_docx_structure(docx_b64)
        self.assertTrue(ok)
        self.assertIsNone(error)

    def test_validate_docx_structure_rejects_malformed_styles_xml(self):
        raw = self._make_docx_bytes()
        bad_styles = b'<?xml version="1.0" encoding="UTF-8"?><w:styles><w:style></w:styles>'
        mutated = self._rewrite_docx_part(raw, {"word/styles.xml": bad_styles})
        ok, error = pdf_converter.validate_docx_structure(self._to_b64(mutated))
        self.assertFalse(ok)
        self.assertIn("word/styles.xml", error or "")

    def test_validate_docx_structure_rejects_broken_relationship_target(self):
        raw = self._make_docx_bytes()
        with zipfile.ZipFile(io.BytesIO(raw), "r") as zf:
            rel_xml = zf.read("word/_rels/document.xml.rels")

        rel_root = ET.fromstring(rel_xml)
        rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
        rel_tag = f"{{{rel_ns}}}Relationship"
        injected = ET.SubElement(rel_root, rel_tag)
        injected.set("Id", "rIdBroken")
        injected.set("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image")
        injected.set("Target", "media/does-not-exist.png")
        updated_rels = ET.tostring(rel_root, encoding="utf-8", xml_declaration=True)

        mutated = self._rewrite_docx_part(raw, {"word/_rels/document.xml.rels": updated_rels})
        ok, error = pdf_converter.validate_docx_structure(self._to_b64(mutated))
        self.assertFalse(ok)
        self.assertIn("Relación rota", error or "")

    def test_word_corruption_error_detection(self):
        self.assertTrue(
            pdf_converter._looks_like_word_corruption_error(
                "(-2146822496) El archivo parece estar corrompido."
            )
        )
        self.assertFalse(pdf_converter._looks_like_word_corruption_error("timeout"))

    def test_convert_docx_with_disabled_max_bytes_allows_large_docx(self):
        docx_bytes = self._make_large_docx_bytes()
        docx_b64 = self._to_b64(docx_bytes)
        original_limit = pdf_converter.DOCX_MAX_BYTES
        original_word_available = pdf_converter.MS_WORD_AVAILABLE

        def _fake_word_convert(_docx_path: str, pdf_path: str, _timeout_s: int) -> dict:
            pathlib.Path(pdf_path).write_bytes(b"%PDF-1.4\n%fake\n%%EOF\n")
            return {"success": True}

        try:
            pdf_converter.DOCX_MAX_BYTES = 0
            pdf_converter.MS_WORD_AVAILABLE = True
            with mock.patch.object(
                pdf_converter,
                "_convert_to_pdf_word_with_timeout",
                side_effect=_fake_word_convert,
            ) as convert_mock:
                result = pdf_converter.convert_docx_with_diagnostics(docx_b64, timeout_s=7)
        finally:
            pdf_converter.DOCX_MAX_BYTES = original_limit
            pdf_converter.MS_WORD_AVAILABLE = original_word_available

        self.assertEqual(result.get("error"), None)
        self.assertEqual(result.get("error_kind"), None)
        self.assertEqual(result.get("converter_used"), "word")
        self.assertIsNotNone(result.get("pdf_b64"))
        self.assertEqual(result.get("docx_size_bytes"), len(docx_bytes))
        self.assertEqual(result.get("max_docx_bytes"), 0)
        self.assertIn("pdf_validation_ms", result.get("stage_timings_ms") or {})
        self.assertIn("pdf_convert_ms", result.get("stage_timings_ms") or {})
        convert_mock.assert_called_once()

    def test_convert_docx_with_configured_max_bytes_rejects_large_docx(self):
        docx_bytes = self._make_large_docx_bytes()
        docx_b64 = self._to_b64(docx_bytes)
        original_limit = pdf_converter.DOCX_MAX_BYTES

        try:
            pdf_converter.DOCX_MAX_BYTES = 1024
            result = pdf_converter.convert_docx_with_diagnostics(docx_b64, timeout_s=7)
        finally:
            pdf_converter.DOCX_MAX_BYTES = original_limit

        self.assertEqual(result.get("error"), "too_large")
        self.assertEqual(result.get("error_kind"), "input")
        self.assertEqual(result.get("docx_size_bytes"), len(docx_bytes))
        self.assertEqual(result.get("max_docx_bytes"), 1024)
        self.assertIn("configured max 1024 bytes", result.get("stderr") or "")

    def test_validate_docx_structure_reuses_cached_validation(self):
        docx_b64 = self._to_b64(self._make_docx_bytes())

        with mock.patch.object(
            pdf_converter,
            "_validate_docx_structure_bytes_uncached",
            wraps=pdf_converter._validate_docx_structure_bytes_uncached,
        ) as validate_mock:
            first_ok, first_error = pdf_converter.validate_docx_structure(docx_b64)
            second_ok, second_error = pdf_converter.validate_docx_structure(docx_b64)

        self.assertTrue(first_ok)
        self.assertTrue(second_ok)
        self.assertIsNone(first_error)
        self.assertIsNone(second_error)
        self.assertEqual(validate_mock.call_count, 1)

    def test_build_pdf_context_async_serializes_word_capable_requests(self):
        original_word_available = pdf_converter.MS_WORD_AVAILABLE
        active = 0
        max_active = 0
        state_lock = threading.Lock()

        def _slow_build_pdf_context(*_args, **_kwargs):
            nonlocal active, max_active
            with state_lock:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.05)
            with state_lock:
                active -= 1
            return (
                {
                    "attempted": True,
                    "stage_timings_ms": {},
                    "converter_used": "word",
                    "word_error": None,
                },
                None,
                None,
                False,
            )

        async def _run_test():
            with mock.patch.object(pdf_converter, "build_pdf_context", side_effect=_slow_build_pdf_context):
                return await asyncio.gather(
                    pdf_converter.build_pdf_context_async("ZG9jeA==", "hash-1", True),
                    pdf_converter.build_pdf_context_async("ZG9jeA==", "hash-2", True),
                )

        try:
            pdf_converter.MS_WORD_AVAILABLE = True
            results = asyncio.run(_run_test())
        finally:
            pdf_converter.MS_WORD_AVAILABLE = original_word_available

        self.assertEqual(max_active, 1)
        queue_waits = [
            (result[0].get("stage_timings_ms") or {}).get("pdf_queue_wait_ms")
            for result in results
        ]
        self.assertTrue(any((wait or 0) > 0 for wait in queue_waits))

    def test_build_pdf_context_async_allows_parallel_when_word_unavailable(self):
        original_word_available = pdf_converter.MS_WORD_AVAILABLE
        active = 0
        max_active = 0
        state_lock = threading.Lock()

        def _slow_build_pdf_context(*_args, **_kwargs):
            nonlocal active, max_active
            with state_lock:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.05)
            with state_lock:
                active -= 1
            return (
                {
                    "attempted": True,
                    "stage_timings_ms": {},
                    "converter_used": "libreoffice",
                    "word_error": None,
                },
                None,
                None,
                False,
            )

        async def _run_test():
            with mock.patch.object(pdf_converter, "build_pdf_context", side_effect=_slow_build_pdf_context):
                return await asyncio.gather(
                    pdf_converter.build_pdf_context_async("ZG9jeA==", "hash-3", True),
                    pdf_converter.build_pdf_context_async("ZG9jeA==", "hash-4", True),
                )

        try:
            pdf_converter.MS_WORD_AVAILABLE = False
            asyncio.run(_run_test())
        finally:
            pdf_converter.MS_WORD_AVAILABLE = original_word_available

        self.assertGreaterEqual(max_active, 2)


if __name__ == "__main__":
    unittest.main()
