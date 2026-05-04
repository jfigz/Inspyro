"""Manual diagnostic for threaded PDF conversion path."""

import asyncio
import base64
import io
import os

import pytest
from docx import Document


pytestmark = [pytest.mark.manual, pytest.mark.windows_com]


def _make_docx_b64() -> str:
    doc = Document()
    doc.add_paragraph("Hello World - Test Document from Threaded Execution")
    buffer = io.BytesIO()
    doc.save(buffer)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _run_conversion_in_thread(docx_b64: str):
    from app.services.pdf_converter import convert_docx_with_diagnostics
    return convert_docx_with_diagnostics(docx_b64)


async def _run_threaded_diagnostic():
    loop = asyncio.get_running_loop()
    docx_b64 = _make_docx_b64()
    return await loop.run_in_executor(None, _run_conversion_in_thread, docx_b64)


@pytest.mark.asyncio
async def test_word_threaded_manual() -> None:
    if os.getenv("INSPYRO_RUN_MANUAL_WORD_TESTS") != "1":
        pytest.skip("Manual diagnostic. Set INSPYRO_RUN_MANUAL_WORD_TESTS=1 to run.")
    if os.name != "nt":
        pytest.skip("Windows-only manual COM diagnostic.")
    result = await _run_threaded_diagnostic()
    assert "converter_used" in result
    assert "word_error" in result


if __name__ == "__main__":
    print(asyncio.run(_run_threaded_diagnostic()))
