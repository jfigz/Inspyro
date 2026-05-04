import base64
import pathlib
import sys

import pytest

BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.routers import notebook_execution
from app.services import notebook_service


class _FakeManager:
    def __init__(self) -> None:
        self.messages = []

    async def send_personal_message(self, message, _websocket):
        self.messages.append(message)


@pytest.mark.asyncio
async def test_convert_pdf_background_uses_notebook_timeout(monkeypatch):
    fake_manager = _FakeManager()
    observed = {}
    pdf_b64 = base64.b64encode(b"%PDF-1.4\n%fake\n%%EOF\n").decode("ascii")

    async def _fake_build_pdf_context_async(*args, **_kwargs):
        observed["timeout_s"] = args[5]
        return (
            {
                "attempted": True,
                "duration_ms": 12,
                "converter_used": "word",
                "word_error": None,
                "pdf_size_bytes": len(base64.b64decode(pdf_b64)),
            },
            pdf_b64,
            "pdf-hash-1",
            False,
        )

    monkeypatch.setattr(notebook_service, "manager", fake_manager)
    monkeypatch.setattr(notebook_service, "build_pdf_context_async", _fake_build_pdf_context_async)
    monkeypatch.setattr(notebook_service, "NOTEBOOK_PDF_TIMEOUT_S", 123)

    await notebook_service._convert_pdf_background(
        kernel_id="kernel-1",
        docx_b64="ZG9jeA==",
        docx_hash="docx-hash-1",
        websocket=object(),
        execution_id="exec-1",
    )

    assert observed["timeout_s"] == 123
    assert fake_manager.messages[0]["type"] == "notebook_progress_update"
    assert fake_manager.messages[-1]["type"] == "notebook_pdf_ready"
    assert fake_manager.messages[-1]["pdf_hash"] == "pdf-hash-1"


@pytest.mark.asyncio
async def test_handle_force_reconvert_pdf_uses_notebook_timeout_and_large_pdf_ref(monkeypatch):
    fake_manager = _FakeManager()
    observed = {}
    large_pdf_b64 = base64.b64encode(b"%PDF-1.4\n" + (b"x" * (4 * 1024 * 1024))).decode("ascii")

    async def _fake_build_pdf_context_async(*args, **_kwargs):
        observed["timeout_s"] = args[5]
        return (
            {
                "attempted": True,
                "duration_ms": 15,
                "converter_used": "word",
                "word_error": None,
                "docx_size_bytes": 1024,
                "pdf_size_bytes": len(base64.b64decode(large_pdf_b64)),
            },
            large_pdf_b64,
            "pdf-hash-large",
            False,
        )

    monkeypatch.setattr(notebook_execution, "manager", fake_manager)
    monkeypatch.setattr(notebook_execution, "build_pdf_context_async", _fake_build_pdf_context_async)
    monkeypatch.setattr(notebook_execution, "_pdf_cache_set", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(notebook_execution, "NOTEBOOK_PDF_TIMEOUT_S", 321)

    notebook_execution.notebook_last_docx_b64["kernel-1"] = "ZG9jeA=="
    notebook_execution.notebook_docx_hash["kernel-1"] = "docx-hash-large"
    try:
        await notebook_execution.handle_force_reconvert_pdf(
            {"request_id": "req-large-pdf", "kernel_id": "kernel-1"},
            object(),
        )
    finally:
        notebook_execution.notebook_last_docx_b64.pop("kernel-1", None)
        notebook_execution.notebook_docx_hash.pop("kernel-1", None)

    payload = fake_manager.messages[-1]
    assert observed["timeout_s"] == 321
    assert payload["type"] == "pdf_reconverted"
    assert payload["status"] == "ok"
    assert payload["pdf_file_b64"] is None
    assert payload["pdf_inline"] is False
    assert payload["pdf_file_token"]
    assert payload["pdf_ref"]
