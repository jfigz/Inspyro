from __future__ import annotations

import asyncio
import base64
import importlib
import json
import os
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import template_logic, template_service, template_tokens
from template_editor_bank_utils import (
    DOCX_NS,
    TemplateBankReport,
    _qn,
    build_corrupt_docx_bytes,
    inspect_docx_ooxml,
    write_fixture_corpus,
)


pytest.importorskip("docx")


class _FakeUploadFile:
    def __init__(self, filename: str, payload: bytes) -> None:
        self.filename = filename
        self._payload = payload

    async def read(self) -> bytes:
        return self._payload


def _try_import_templates_router():
    try:
        return importlib.import_module("app.routers.templates")
    except RuntimeError as exc:
        if "python-multipart" in str(exc):
            return None
        raise


def _export_template_portable(kernel_id: str) -> dict:
    templates_router = _try_import_templates_router()
    if templates_router is not None:
        return asyncio.run(templates_router.export_template(kernel_id=kernel_id))

    template = template_service.get_template(kernel_id)
    assert template is not None
    docx_path = template_service.get_template_docx_path(kernel_id)
    assert docx_path
    payload = Path(docx_path).read_bytes()
    return {
        "schema_version": "1.1",
        "kernel_id": kernel_id,
        "template": template,
        "docx_base64": base64.b64encode(payload).decode("ascii"),
        "file_name": Path(docx_path).name,
    }


def _upload_template_token(file_name: str, payload: bytes) -> tuple[dict, str]:
    templates_router = _try_import_templates_router()
    if templates_router is None:
        return template_tokens.store_template_bytes(payload, filename=file_name), "token-store-fallback"
    return asyncio.run(templates_router.upload_template(_FakeUploadFile(file_name, payload))), "rest-router"


def _report_root() -> Path:
    return Path(os.getenv("INSPYRO_TEMPLATE_BANK_OUTPUT", "output/template-editor-bank"))


@pytest.fixture()
def isolated_template_storage(monkeypatch, tmp_path: Path):
    template_dir = tmp_path / "templates"
    token_dir = tmp_path / "tokens"
    template_dir.mkdir(parents=True, exist_ok=True)
    token_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(template_service, "TEMPLATE_DIR", template_dir)
    monkeypatch.setattr(template_tokens, "TEMPLATE_TOKEN_DIR", token_dir)
    template_tokens._TOKEN_CACHE.clear()
    yield {"template_dir": template_dir, "token_dir": token_dir}
    template_tokens._TOKEN_CACHE.clear()


def _fixtures(tmp_path: Path) -> list[dict]:
    manifest = write_fixture_corpus(tmp_path / "fixtures")
    return list(manifest["fixtures"])


def _load_fixture(fixtures: list[dict], fixture_id: str) -> dict:
    return next(item for item in fixtures if item["id"] == fixture_id)


def _style_by_id(template: dict, style_id: str) -> dict | None:
    return next((style for style in template.get("styles", []) if style.get("style_id") == style_id), None)


def _read_styles_root(docx_path: Path) -> ET.Element:
    with zipfile.ZipFile(docx_path, "r") as archive:
        return ET.fromstring(archive.read("word/styles.xml"))


def _assert_word_complete_ooxml(docx_path: Path) -> None:
    root = _read_styles_root(docx_path)
    style = root.find("w:style[@w:styleId='BankWordComplete']", DOCX_NS)
    assert style is not None
    assert style.find("w:uiPriority", DOCX_NS).get(_qn("val")) == "5"
    assert style.find("w:qFormat", DOCX_NS) is None
    assert style.find("w:semiHidden", DOCX_NS) is not None
    r_fonts = style.find("w:rPr/w:rFonts", DOCX_NS)
    assert r_fonts is not None
    assert r_fonts.get(_qn("cs")) == "Aptos"
    assert style.find("w:rPr/w:lang", DOCX_NS).get(_qn("val")) == "es-CL"
    assert style.find("w:rPr/w:kern", DOCX_NS).get(_qn("val")) == "20"
    assert style.find("w:rPr/w:spacing", DOCX_NS).get(_qn("val")) == "24"
    assert style.find("w:rPr/w:position", DOCX_NS).get(_qn("val")) == "4"
    tab = style.find("w:pPr/w:tabs/w:tab", DOCX_NS)
    assert tab is not None
    assert tab.get(_qn("val")) == "right"
    assert tab.get(_qn("leader")) == "dot"
    assert tab.get(_qn("pos")) == "4320"
    assert style.find("w:pPr/w:contextualSpacing", DOCX_NS) is not None
    assert style.find("w:pPr/w:shd", DOCX_NS).get(_qn("fill")) == "F2F2F2"
    assert style.find("w:pPr/w:pBdr/w:bottom", DOCX_NS).get(_qn("color")) == "1B4965"


def test_template_editor_bank_backend_roundtrip(isolated_template_storage, tmp_path: Path) -> None:
    report = TemplateBankReport(_report_root(), run_id="backend-roundtrip", title="Template Editor Backend Bank")
    fixtures = _fixtures(tmp_path)

    try:
        for fixture in fixtures:
            if not fixture["expected"]["must_load"]:
                report.add("fixture skipped by design", "skipped", fixture=fixture["id"], details={"reason": "corrupt corpus entry"})
                continue

            kernel_id = f"bank-{fixture['id']}"
            docx_bytes = Path(fixture["path"]).read_bytes()
            extracted = template_service.extract_styles_from_docx(docx_bytes)

            assert extracted.get("styles"), fixture["id"]
            assert extracted.get("style_browser", {}).get("categories"), fixture["id"]
            assert extracted.get("style_coverage", {}).get("summary"), fixture["id"]
            assert extracted.get("document_defaults", {}).get("font"), fixture["id"]
            if fixture["expected"]["has_hidden_styles"]:
                hidden = _style_by_id(extracted, "BankHiddenInternal")
                assert hidden is not None
                assert hidden.get("hidden") is True
                assert hidden.get("style_visibility", {}).get("semi_hidden") is True
            if fixture["expected"]["has_duplicate_styles"]:
                assert extracted.get("has_duplicate_styles") or inspect_docx_ooxml(docx_bytes)["has_duplicate_style_names"]
            if fixture["expected"]["has_sdt"]:
                controls = extracted.get("content_controls") or {}
                assert controls.get("control_count", 0) >= 1
                assert controls.get("unwrapped_placeholder_count", 0) == 0
            if fixture["expected"]["has_word_complete_style"]:
                word_complete = _style_by_id(extracted, "BankWordComplete")
                assert word_complete is not None
                assert word_complete.get("word_style", {}).get("paragraph", {}).get("tabs")
                assert word_complete.get("word_style", {}).get("paragraph", {}).get("shading", {}).get("fill") == "F2F2F2"
                assert word_complete.get("word_style", {}).get("paragraph", {}).get("borders", {}).get("bottom")
                assert extracted.get("word_capabilities", {}).get("font")

            assert template_service.save_template(kernel_id, docx_bytes, extracted)
            saved_path = Path(template_service.get_template_docx_path(kernel_id) or "")
            assert saved_path.exists()

            updated_defaults = template_service.update_template_document_defaults(
                kernel_id,
                {
                    "word_defaults": {
                        "run": {"font_name": "Aptos", "font_size_pt": 10.5, "color_rgb": "243447"},
                        "paragraph": {"space_after_pt": 7, "line_spacing": 1.12, "alignment": "JUSTIFY"},
                    }
                },
            )
            defaults = updated_defaults.get(template_service.DOCUMENT_DEFAULTS_KEY) or {}
            assert defaults.get("font", {}).get("font_name") == "Aptos"
            assert defaults.get("paragraph", {}).get("space_after_pt") == 7

            updated_slots = template_service.update_template_semantic_style_slots(
                kernel_id,
                {
                    "body": {
                        "selection_key": "body|BankBody|Bank Body",
                        "style_id": "BankBody",
                        "style_name": "Bank Body",
                        "style_type": "paragraph",
                    },
                    "table": {
                        "selection_key": "tables|BankTableAccent|Bank Table Accent",
                        "style_id": "BankTableAccent",
                        "style_name": "Bank Table Accent",
                        "style_type": "table",
                    },
                },
            )
            assert updated_slots.get(template_service.SEMANTIC_STYLE_SLOTS_KEY, {}).get("body", {}).get("style_id")

            if fixture["expected"]["has_word_complete_style"]:
                updated = template_service.update_template_style(
                    kernel_id,
                    "Bank Word Complete",
                    {
                        "style_id": "BankWordComplete",
                        "word_style": {
                            "metadata": {"ui_priority": 5},
                            "visibility": {"q_format": False, "semi_hidden": True, "unhide_when_used": True},
                            "font": {
                                "complex_script_font_name": "Aptos",
                                "east_asia_font_name": "Aptos",
                                "language": "es-CL",
                                "kerning_pt": 10,
                                "character_spacing_twips": "24",
                                "position_pt": 2,
                            },
                            "paragraph": {
                                "contextual_spacing": True,
                                "tabs": [{"val": "right", "leader": "dot", "pos_twips": "4320"}],
                                "shading": {"fill": "F2F2F2"},
                                "borders": {"bottom": {"style": "single", "size_pt": 1.0, "color": "1B4965"}},
                            },
                            "raw": {"bankUnsupportedProbe": {"preserve": True}},
                        },
                    },
                )
                style = _style_by_id(updated, "BankWordComplete")
                assert style is not None
                assert style.get("style_visibility", {}).get("semi_hidden") is True
                assert style.get("word_style", {}).get("font", {}).get("character_spacing_twips") == "24"
                _assert_word_complete_ooxml(saved_path)

            if fixture["expected"]["ooxml"].get("has_table_style"):
                applied = template_service.apply_table_format_to_style(
                    kernel_id,
                    0,
                    "Bank Table Accent",
                    target_style_id="BankTableAccent",
                )
                assert applied is not None
                assert _style_by_id(applied, "BankTableAccent") is not None
                created = template_service.create_table_style_from_format(kernel_id, 0, "Bank Table From Direct")
                assert created is not None
                assert any(style.get("name") == "Bank Table From Direct" for style in created.get("styles", []))

            exported = _export_template_portable(kernel_id)
            assert exported["schema_version"] == "1.1"
            exported_docx_path = tmp_path / f"{kernel_id}-export.docx"
            exported_docx_path.write_bytes(base64.b64decode(exported["docx_base64"]))
            assert zipfile.is_zipfile(exported_docx_path)
            assert inspect_docx_ooxml(exported_docx_path.read_bytes())["is_zip"] is True

            assert template_service.delete_template(kernel_id) is True
            assert template_service.get_template(kernel_id) is None
            report.add(
                "extract mutate export delete",
                "passed",
                fixture=fixture["id"],
                details={
                    "styles": len(extracted.get("styles", [])),
                    "tables": len(extracted.get("document_tables") or []),
                    "content_controls": (extracted.get("content_controls") or {}).get("control_count", 0),
                },
                artifacts={"docx_path": str(saved_path)},
            )
    finally:
        report.write()


def test_template_editor_bank_upload_attach_and_corrupt_recovery(isolated_template_storage, tmp_path: Path) -> None:
    report = TemplateBankReport(_report_root(), run_id="backend-upload-attach", title="Template Editor Upload Attach Bank")
    fixtures = _fixtures(tmp_path)
    complete = _load_fixture(fixtures, "complete")
    complete_bytes = Path(complete["path"]).read_bytes()
    kernel_id = "bank-upload-attach"

    try:
        token_payload, upload_source = _upload_template_token(complete["file_name"], complete_bytes)
        assert token_payload["sha256"]
        assert token_payload["template_token"]

        attached, echoed_token = asyncio.run(
            template_logic.process_template_attach(kernel_id, token_payload["template_token"])
        )
        assert echoed_token == token_payload["template_token"]
        assert attached.get("styles")
        assert _style_by_id(attached, "BankHiddenInternal") is not None
        assert template_service.get_template(kernel_id) is not None
        report.add(
            "rest upload token attach",
            "passed",
            fixture="complete",
            details={
                "template_token_size": token_payload["size_bytes"],
                "styles": len(attached.get("styles", [])),
                "upload_source": upload_source,
            },
            artifacts={"template_token": token_payload["template_token"]},
        )

        template_dir = template_service._ensure_template_dir("bank-corrupt-recovery")
        corrupt_docx_path = template_service._get_template_docx_path("bank-corrupt-recovery")
        corrupt_json_path = template_service._get_template_json_path("bank-corrupt-recovery")
        corrupt_docx_path.write_bytes(build_corrupt_docx_bytes())
        corrupt_json_path.write_text(
            json.dumps({"styles": [{"name": "Stale Style"}], "semantic_style_slots": {"body": {"style_id": "Stale"}}}),
            encoding="utf-8",
        )
        recovered = template_service._sanitize_persisted_template_if_needed("bank-corrupt-recovery")
        assert recovered is not None
        assert recovered.get("metadata", {}).get("recovered_from_corrupt_docx") is True
        assert recovered.get("styles")
        assert recovered.get("semantic_style_slots", {}).get("body", {}).get("style_id") != "Stale"
        assert inspect_docx_ooxml(corrupt_docx_path.read_bytes())["is_zip"] is True
        quarantined = list(template_dir.glob("template.quarantine_*.docx"))
        assert len(quarantined) == 1
        assert quarantined[0].read_bytes() == build_corrupt_docx_bytes()
        persisted = json.loads(corrupt_json_path.read_text(encoding="utf-8"))
        assert persisted.get("styles") == recovered.get("styles")
        report.add(
            "corrupt persisted template recovery",
            "passed",
            fixture="corrupt",
            details={"quarantine": quarantined[0].name, "styles": len(recovered.get("styles", []))},
            artifacts={"docx_path": str(corrupt_docx_path), "json_path": str(corrupt_json_path)},
        )
    finally:
        report.write()


def test_template_editor_corrupt_attach_returns_recoverable_error(isolated_template_storage) -> None:
    token_payload = template_tokens.store_template_bytes(build_corrupt_docx_bytes(), filename="corrupt.docx")

    with pytest.raises(template_logic.TemplateValidationError) as exc_info:
        asyncio.run(template_logic.process_template_attach("bank-corrupt-attach", token_payload["template_token"]))

    assert exc_info.value.error_code == "invalid_docx"
    assert exc_info.value.extra.get("recoverable") is True
    assert "zip" in str(exc_info.value).lower()
    assert template_service.get_template("bank-corrupt-attach") is None


def test_template_editor_word_native_preview_returns_non_empty_png(monkeypatch, isolated_template_storage) -> None:
    fitz = pytest.importorskip("fitz")
    from app.services import pdf_converter

    def fake_word_convert(docx_path: str, pdf_path: str, timeout_s: int) -> dict:
        doc = fitz.open()
        page = doc.new_page(width=360, height=180)
        page.insert_text((36, 72), "Preview Word nativo", fontsize=18, color=(0, 0, 0))
        page.draw_rect(fitz.Rect(32, 54, 304, 88), color=(0.1, 0.25, 0.45), width=0.8)
        doc.save(pdf_path)
        doc.close()
        return {"success": True, "converter_used": "word"}

    monkeypatch.setattr(pdf_converter, "MS_WORD_AVAILABLE", True)
    monkeypatch.setattr(pdf_converter, "_convert_to_pdf_word_with_timeout", fake_word_convert)

    preview_b64 = template_service.generate_style_preview(
        "bank-word-native-preview",
        "Normal",
        {
            "style_id": "Normal",
            "font_size_pt": 12,
            "_preview_engine": "word_native",
            "native_word_preview": True,
        },
    )

    assert preview_b64
    png_bytes = base64.b64decode(preview_b64)
    assert png_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(png_bytes) > 500
