import base64
import io
import os
import sys
import zipfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import pdf_converter, template_service


def _minimal_docx_base64() -> str:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            (
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                "<Override PartName=\"/word/document.xml\" "
                "ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>"
                "</Types>"
            ),
        )
        zf.writestr("word/document.xml", "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body/></w:document>")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _write_pdf(pdf_path: str) -> None:
    fitz = __import__("fitz")
    doc = fitz.open()
    try:
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 96), "Template sample preview", fontsize=18)
        doc.save(pdf_path)
    finally:
        doc.close()


def test_sample_preview_render_word_returns_full_png_pages(monkeypatch) -> None:
    __import__("fitz")

    def fake_word_convert(docx_path: str, pdf_path: str, timeout_s: int):
        assert docx_path.endswith(".docx")
        assert timeout_s > 0
        _write_pdf(pdf_path)
        return {"success": True, "converter_used": "word_native"}

    monkeypatch.setattr(pdf_converter, "MS_WORD_AVAILABLE", True)
    monkeypatch.setattr(pdf_converter, "_convert_to_pdf_word_with_timeout", fake_word_convert)

    payload = template_service.render_sample_preview_docx_with_word(
        kernel_id="kernel-template",
        preview_key="sample-docx:test",
        docx_base64=_minimal_docx_base64(),
        force_refresh=True,
    )

    assert payload["preview_key"] == "sample-docx:test"
    assert payload["converter_used"] == "word_native"
    assert payload["warnings"] == []
    assert payload["preview_pages"]
    page = payload["preview_pages"][0]
    assert page["page_index"] == 0
    assert page["width"] > 0
    assert page["height"] > 0
    assert len(base64.b64decode(page["png_base64"])) > 100


def test_sample_preview_render_word_unavailable_is_non_blocking(monkeypatch) -> None:
    monkeypatch.setattr(pdf_converter, "MS_WORD_AVAILABLE", False)

    payload = template_service.render_sample_preview_docx_with_word(
        kernel_id="kernel-template",
        preview_key="sample-docx:test",
        docx_base64=_minimal_docx_base64(),
        force_refresh=True,
    )

    assert payload["preview_pages"] == []
    assert payload["converter_used"] == "word_unavailable"
    assert payload["warnings"]


def test_sample_preview_open_default_saves_valid_docx_and_calls_opener(tmp_path, monkeypatch) -> None:
    opened = []
    monkeypatch.setattr(template_service, "get_app_storage_dir", lambda name: tmp_path / name)
    monkeypatch.setattr(
        template_service,
        "open_path_with_default_application",
        lambda path: opened.append(path) or {"success": True, "path": str(path), "method": "test"},
    )

    saved_path = template_service.save_sample_preview_docx("../preview.docx", _minimal_docx_base64())
    payload = template_service.open_path_with_default_application(saved_path)

    assert payload["success"] is True
    assert opened
    saved_path = opened[0]
    assert saved_path.exists()
    assert saved_path.parent == tmp_path / "template_sample_previews"
    assert saved_path.name.startswith("preview_")
    assert zipfile.is_zipfile(saved_path)


def test_sample_preview_rejects_corrupt_docx_payload() -> None:
    with pytest.raises(ValueError) as exc_info:
        template_service.render_sample_preview_docx_with_word(
            kernel_id="kernel-template",
            preview_key="sample-docx:bad",
            docx_base64=base64.b64encode(b"not a zip").decode("ascii"),
            force_refresh=True,
        )

    assert "ZIP OOXML" in str(exc_info.value)
