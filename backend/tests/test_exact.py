"""Manual diagnostic for positional callback in run_in_executor."""

import asyncio
import base64
import io
import os

import pytest
from docx import Document


pytestmark = [pytest.mark.manual]


def _make_docx_b64() -> str:
    doc = Document()
    doc.add_paragraph("Test passing callback directly to executor")
    buffer = io.BytesIO()
    doc.save(buffer)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


async def _run_exact_executor_call():
    from app.services.pdf_converter import build_pdf_context

    docx_b64 = _make_docx_b64()
    loop = asyncio.get_running_loop()

    def _sync_progress(_msg: str):
        return None

    return await loop.run_in_executor(
        None,
        build_pdf_context,
        docx_b64,
        "test_hash_3",
        True,
        False,
        _sync_progress,
    )


@pytest.mark.asyncio
async def test_exact_executor_signature_manual() -> None:
    if os.getenv("INSPYRO_RUN_MANUAL_PDF_TESTS") != "1":
        pytest.skip("Manual diagnostic. Set INSPYRO_RUN_MANUAL_PDF_TESTS=1 to run.")
    pdf_diag, pdf_b64, _, _ = await _run_exact_executor_call()
    assert "converter_used" in pdf_diag
    assert "word_error" in pdf_diag
    assert isinstance(bool(pdf_b64), bool)


if __name__ == "__main__":
    diag, pdf, _, _ = asyncio.run(_run_exact_executor_call())
    print("converter_used:", diag.get("converter_used"))
    print("word_error:", diag.get("word_error"))
    print("has_pdf:", bool(pdf))
