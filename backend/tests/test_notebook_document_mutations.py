import asyncio
from unittest.mock import AsyncMock

import pytest

from app.routers import notebook_execution


class _FakeManager:
    def __init__(self) -> None:
        self.messages = []

    async def send_personal_message(self, message, _websocket):
        self.messages.append(message)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("handler_name", "message", "expected_type", "expected_reason", "expected_snippet"),
    [
        (
            "handle_notebook_delete_cell",
            {"kernel_id": "kernel-1", "cell_id": "cell-a", "request_id": "req-delete"},
            "notebook_cell_deleted",
            "delete_cell",
            "doc_clear_cell",
        ),
        (
            "handle_notebook_set_order",
            {"kernel_id": "kernel-1", "order": ["cell-a", "cell-b"], "request_id": "req-order"},
            "notebook_order_set",
            "set_order",
            "doc_reorder",
        ),
        (
            "handle_notebook_move_cell",
            {"kernel_id": "kernel-1", "cell_id": "cell-a", "direction": "down", "request_id": "req-move"},
            "notebook_cell_moved",
            "move_cell",
            "doc_move_cell",
        ),
    ],
)
async def test_document_mutation_handlers_queue_document_pipeline(
    monkeypatch,
    handler_name,
    message,
    expected_type,
    expected_reason,
    expected_snippet,
):
    fake_manager = _FakeManager()
    execute_cell_mock = AsyncMock()
    export_mock = AsyncMock(side_effect=AssertionError("mutation handlers should not export inline"))
    queue_calls = []
    lock = asyncio.Lock()

    async def _record_queue(request, *, websocket, timeout_s=None):
        queue_calls.append((request, websocket, timeout_s))

    monkeypatch.setattr(notebook_execution, "manager", fake_manager)
    monkeypatch.setattr(notebook_execution, "_get_kernel_lock", lambda _kernel_id: lock)
    monkeypatch.setattr(notebook_execution, "queue_document_pipeline_job", _record_queue)
    monkeypatch.setattr(notebook_execution, "_execute_docx_export", export_mock)
    monkeypatch.setattr(
        notebook_execution,
        "get_kernel_docx_source",
        lambda _kernel_id: {
            "source_path": "C:/workspace/demo.ipynb",
            "source_kind": "notebook",
        },
    )
    monkeypatch.setattr(notebook_execution, "NOTEBOOK_PDF_TIMEOUT_S", 321)
    monkeypatch.setattr(notebook_execution.jupyter_kernel_manager, "execute_cell", execute_cell_mock)

    handler = getattr(notebook_execution, handler_name)
    websocket = object()
    await handler(message, websocket)

    execute_cell_mock.assert_awaited_once()
    assert expected_snippet in execute_cell_mock.await_args.args[1]
    export_mock.assert_not_awaited()

    assert len(queue_calls) == 1
    request, queued_websocket, timeout_s = queue_calls[0]
    assert request.kernel_id == "kernel-1"
    assert request.reason == expected_reason
    assert request.needs_pdf is True
    assert request.execution_id.startswith("docmut_")
    assert request.queued_at_monotonic is not None
    assert request.source_path == "C:/workspace/demo.ipynb"
    assert request.source_kind == "notebook"
    assert queued_websocket is websocket
    assert timeout_s == 321

    payload = fake_manager.messages[-1]
    assert payload["type"] == expected_type
    assert payload["kernel_id"] == "kernel-1"
    assert payload["execution_id"] == request.execution_id
    assert payload["source_path"] == "C:/workspace/demo.ipynb"
    assert payload["source_kind"] == "notebook"
    assert payload["request_id"] == message.get("request_id")
