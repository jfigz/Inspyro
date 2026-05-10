"""Manual Windows COM diagnostic for direct Word PDF export."""

import base64
import io
import os

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
    from app.services.pdf_converter import convert_docx_with_diagnostics

    docx_b64 = _make_docx_b64()
    result = {
        "skipped": False,
        "pdf_created": False,
        "user_word_survived": False,
        "converter_used": None,
        "word_error": None,
        "error": None,
    }

    pythoncom.CoInitialize()
    user_word_app = None
    user_doc = None
    try:
        user_word_app = win32com.client.DispatchEx("Word.Application")
        user_word_app.Visible = False
        user_word_app.DisplayAlerts = 0
        user_doc = user_word_app.Documents.Add()
        user_doc.Content.Text = "Controlled user Word document that Inspyro must not close."
        user_doc.Saved = False
        conversion = convert_docx_with_diagnostics(docx_b64, timeout_s=60)
        result["pdf_created"] = bool(conversion.get("pdf_b64"))
        result["converter_used"] = conversion.get("converter_used")
        result["word_error"] = conversion.get("word_error")

        try:
            result["user_word_survived"] = bool(user_word_app.Documents.Count >= 1)
        except Exception as exc:
            result["error"] = f"user_word_closed_or_unreachable:{exc}"
    except Exception as exc:
        result["error"] = str(exc)
    finally:
        if user_doc is not None:
            try:
                user_doc.Close(SaveChanges=0)
            except Exception:
                pass
        if user_word_app is not None:
            try:
                user_word_app.Quit(SaveChanges=0)
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
    assert result.get("user_word_survived") is True


if __name__ == "__main__":
    print(_run_word_com_diagnostic())
