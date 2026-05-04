"""Manual diagnostic for build_pdf_context converter metadata."""

import base64
import io
import os

import pytest
from docx import Document

from app.services.pdf_converter import build_pdf_context


pytestmark = [pytest.mark.manual]


def _make_docx_b64() -> str:
    doc = Document()
    doc.add_paragraph("Test")
    buffer = io.BytesIO()
    doc.save(buffer)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _run_converter_diagnostic():
    docx_b64 = _make_docx_b64()
    pdf_diag, pdf_b64, _, _ = build_pdf_context(docx_b64, "test_hash", True, False, None)
    return pdf_diag, pdf_b64


def test_converter_metadata_manual() -> None:
    if os.getenv("INSPYRO_RUN_MANUAL_PDF_TESTS") != "1":
        pytest.skip("Manual diagnostic. Set INSPYRO_RUN_MANUAL_PDF_TESTS=1 to run.")
    pdf_diag, pdf_b64 = _run_converter_diagnostic()
    assert "converter_used" in pdf_diag
    assert "word_error" in pdf_diag
    assert isinstance(bool(pdf_b64), bool)


if __name__ == "__main__":
    diag, pdf = _run_converter_diagnostic()
    print("converter_used:", diag.get("converter_used"))
    print("word_error:", diag.get("word_error"))
    print("has_pdf:", bool(pdf))
    print("pdf_diag keys:", list(diag.keys()))
