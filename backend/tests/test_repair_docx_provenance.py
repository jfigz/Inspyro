import base64
import io
import os
import sys
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(BACKEND_ROOT)

for candidate in (BACKEND_ROOT, REPO_ROOT):
    if candidate not in sys.path:
        sys.path.append(candidate)

from librerias_propias.docx_builder.api import build_doc
from librerias_propias.docx_builder.session import get_session, reset_session_cache
from tools.repair_docx_provenance import default_output_path, main, repair_docx_file


PROVENANCE_MARKER = "/api/docx/provenance/open"


def _package_contains(docx_bytes: bytes, marker: str) -> bool:
    needle = marker.encode("utf-8")
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as zf:
        return any(needle in zf.read(name) for name in zf.namelist())


def _build_raw_docx_with_provenance() -> bytes:
    namespace = {}
    with build_doc(order=1, namespace=namespace, block_id="cell-provenance") as builder:
        builder.text("Texto con procedencia")
    return base64.b64decode(get_session(namespace).export_docx_base64())


class TestRepairDocxProvenance(unittest.TestCase):
    def setUp(self):
        reset_session_cache()

    def tearDown(self):
        reset_session_cache()

    def test_repair_tool_writes_clean_copy_without_mutating_original(self):
        original_docx = _build_raw_docx_with_provenance()

        with TemporaryDirectory() as tmp_dir:
            source = Path(tmp_dir) / "source.docx"
            source.write_bytes(original_docx)

            repaired = repair_docx_file(source)
            clean_path = default_output_path(source)

            self.assertEqual(repaired.output_path, clean_path)
            self.assertTrue(clean_path.exists())
            self.assertTrue(_package_contains(source.read_bytes(), PROVENANCE_MARKER))
            self.assertFalse(_package_contains(clean_path.read_bytes(), PROVENANCE_MARKER))
            self.assertGreaterEqual(repaired.sanitization.hyperlink_nodes_removed, 1)

    def test_cli_prints_summary_for_each_file(self):
        original_docx = _build_raw_docx_with_provenance()

        with TemporaryDirectory() as tmp_dir:
            source = Path(tmp_dir) / "source.docx"
            source.write_bytes(original_docx)

            buffer = io.StringIO()
            with redirect_stdout(buffer):
                exit_code = main([str(source)])

            output = buffer.getvalue()
            self.assertEqual(exit_code, 0)
            self.assertIn("hyperlinks_removed=", output)
            self.assertIn("field_codes_removed=", output)
            self.assertTrue(default_output_path(source).exists())


if __name__ == "__main__":
    unittest.main()
