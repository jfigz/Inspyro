"""Manual Windows COM diagnostic for direct Word PDF export."""

import base64
import io
import os
import tempfile

import pytest
from docx import Document


pytestmark = [pytest.mark.manual, pytest.mark.windows_com]


def _make_docx_b64() -> str:
    doc = Document()
    doc.add_paragraph("Hello World - Test Document")
    buffer = io.BytesIO()
    doc.save(buffer)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _run_word_com_diagnostic():
    if os.name != "nt":
        return {"skipped": True, "reason": "not_windows"}

    import pythoncom
    import win32com.client

    docx_b64 = _make_docx_b64()
    result = {"skipped": False, "pdf_created": False, "error": None}

    pythoncom.CoInitialize()
    word_app = None
    try:
        word_app = win32com.client.Dispatch("Word.Application")
        word_app.Visible = False
        word_app.DisplayAlerts = 0
        with tempfile.TemporaryDirectory() as tmp:
            docx_path = os.path.join(tmp, "test.docx")
            pdf_path = os.path.join(tmp, "test.pdf")
            with open(docx_path, "wb") as file_obj:
                file_obj.write(base64.b64decode(docx_b64))

            doc = word_app.Documents.Open(os.path.abspath(docx_path), ReadOnly=True, AddToRecentFiles=False)
            try:
                doc.ExportAsFixedFormat(
                    OutputFileName=os.path.abspath(pdf_path),
                    ExportFormat=17,
                    OpenAfterExport=False,
                    OptimizeFor=0,
                    CreateBookmarks=1,
                    DocStructureTags=True,
                )
                result["pdf_created"] = os.path.exists(pdf_path)
            finally:
                doc.Close(SaveChanges=0)
    except Exception as exc:
        result["error"] = str(exc)
    finally:
        if word_app is not None:
            try:
                word_app.Quit()
            except Exception:
                pass
        pythoncom.CoUninitialize()

    return result


def test_word_com_manual() -> None:
    if os.getenv("INSPYRO_RUN_MANUAL_WORD_TESTS") != "1":
        pytest.skip("Manual diagnostic. Set INSPYRO_RUN_MANUAL_WORD_TESTS=1 to run.")
    if os.name != "nt":
        pytest.skip("Windows-only manual COM diagnostic.")
    result = _run_word_com_diagnostic()
    assert result.get("error") in (None, "")
    assert result.get("pdf_created") is True


if __name__ == "__main__":
    print(_run_word_com_diagnostic())
