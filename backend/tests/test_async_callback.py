"""Manual diagnostic for run_coroutine_threadsafe progress callback path."""

import asyncio
import base64
import io
import os

import pytest
from docx import Document


pytestmark = [pytest.mark.manual]


def _make_docx_b64() -> str:
    doc = Document()
    doc.add_paragraph("Test with async callback")
    buffer = io.BytesIO()
    doc.save(buffer)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


async def _run_async_callback_diagnostic():
    from app.services.pdf_converter import build_pdf_context

    loop = asyncio.get_running_loop()
    docx_b64 = _make_docx_b64()
    kernel_id = "test-kernel"

    async def _safe_send(_msg):
        return None

    def _sync_progress(msg: str):
        if loop:
            try:
                asyncio.run_coroutine_threadsafe(
                    _safe_send(
                        {
                            "type": "notebook_progress_update",
                            "kernel_id": kernel_id,
                            "message": msg,
                        }
                    ),
                    loop,
                )
            except Exception:
                pass

    return await loop.run_in_executor(
        None,
        build_pdf_context,
        docx_b64,
        "test_hash_4",
        True,
        False,
        _sync_progress,
    )


@pytest.mark.asyncio
async def test_async_callback_manual() -> None:
    if os.getenv("INSPYRO_RUN_MANUAL_PDF_TESTS") != "1":
        pytest.skip("Manual diagnostic. Set INSPYRO_RUN_MANUAL_PDF_TESTS=1 to run.")
    pdf_diag, pdf_b64, _, _ = await _run_async_callback_diagnostic()
    assert "converter_used" in pdf_diag
    assert "word_error" in pdf_diag
    assert isinstance(bool(pdf_b64), bool)


if __name__ == "__main__":
    diag, pdf, _, _ = asyncio.run(_run_async_callback_diagnostic())
    print("converter_used:", diag.get("converter_used"))
    print("word_error:", diag.get("word_error"))
    print("has_pdf:", bool(pdf))
