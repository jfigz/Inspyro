"""Manual diagnostic for PDF conversion inside run_in_executor."""

import asyncio
import base64
import io
import os

import pytest
from docx import Document


pytestmark = [pytest.mark.manual]


def _make_docx_b64() -> str:
    doc = Document()
    doc.add_paragraph("Test in ThreadPoolExecutor")
    buffer = io.BytesIO()
    doc.save(buffer)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _run_in_thread(docx_b64: str):
    from app.services.pdf_converter import build_pdf_context
    return build_pdf_context(docx_b64, "test_hash_2", True, False, None)


async def _run_executor_diagnostic():
    loop = asyncio.get_running_loop()
    docx_b64 = _make_docx_b64()
    return await loop.run_in_executor(None, _run_in_thread, docx_b64)


@pytest.mark.asyncio
async def test_executor_conversion_manual() -> None:
    if os.getenv("INSPYRO_RUN_MANUAL_PDF_TESTS") != "1":
        pytest.skip("Manual diagnostic. Set INSPYRO_RUN_MANUAL_PDF_TESTS=1 to run.")
    pdf_diag, pdf_b64, _, _ = await _run_executor_diagnostic()
    assert "converter_used" in pdf_diag
    assert "word_error" in pdf_diag
    assert isinstance(bool(pdf_b64), bool)


if __name__ == "__main__":
    diag, pdf, _, from_cache = asyncio.run(_run_executor_diagnostic())
    print("converter_used:", diag.get("converter_used"))
    print("word_error:", diag.get("word_error"))
    print("has_pdf:", bool(pdf))
    print("from_cache:", from_cache)
