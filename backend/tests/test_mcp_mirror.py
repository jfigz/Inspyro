from __future__ import annotations

import asyncio
import inspect
import os

import pytest
import pytest_asyncio

from app.routers import mcp_manager
from mcp_server import activity as mcp_activity
from mcp_server import mirror as mcp_mirror
from mcp_server.session_state import McpSessionState
from mcp_server.tools import documents, files, notebook, templates


class FakeReporter:
    def __init__(self) -> None:
        self.events: list[dict] = []

    async def report(self, event: dict) -> None:
        self.events.append(event)


def _normalize_path(value: str) -> str:
    return os.path.normcase(os.path.abspath(value))


class MirrorBridge:
    def __init__(
        self,
        *,
        notebook_payload: dict | None = None,
        ws_multi_response: list[dict] | None = None,
        ws_multi_responses: list[list[dict]] | None = None,
        late_ws_messages: list[dict] | None = None,
        ws_response: dict | None = None,
        system_info_payload: dict | None = None,
    ) -> None:
        self.notebook_payload = notebook_payload or {}
        self.ws_multi_response = ws_multi_response or []
        self.ws_multi_responses = [list(response) for response in (ws_multi_responses or [])]
        self.late_ws_messages = late_ws_messages or []
        self.ws_response = ws_response or {}
        self.system_info_payload = system_info_payload or {"active_workspace": os.path.abspath("C:/workspace")}
        self.rest_post_calls: list[tuple[str, dict]] = []
        self.rest_delete_calls: list[tuple[str, dict]] = []
        self.ws_multi_calls: list[tuple[str, dict, dict]] = []
        self.execution_observers: dict[str, list[asyncio.Queue]] = {}

    async def rest_get(self, path: str, *, params: dict | None = None) -> dict:
        if path == "/api/system/info":
            return dict(self.system_info_payload)
        return {"content": self.notebook_payload}

    async def rest_post(self, path: str, *, json_data: dict | None = None) -> dict:
        self.rest_post_calls.append((path, json_data or {}))
        return {"status": "ok"}

    async def rest_delete(self, path: str, *, params: dict | None = None) -> dict:
        self.rest_delete_calls.append((path, params or {}))
        return {"status": "ok"}

    async def rest_post_files(self, path: str, *, files: dict) -> dict:
        return {"template_token": "template-123"}

    async def rest_get_bytes(self, path: str, *, params: dict | None = None) -> bytes:
        return b"artifact-bytes"

    async def ws_request(self, msg_type: str, data: dict, **kwargs) -> dict:
        return self.ws_response

    def register_execution_observer(self, execution_id: str):
        queue: asyncio.Queue = asyncio.Queue()
        self.execution_observers.setdefault(execution_id, []).append(queue)

        def unregister() -> None:
            queues = self.execution_observers.get(execution_id)
            if queues is None:
                return
            try:
                queues.remove(queue)
            except ValueError:
                return
            if not queues:
                self.execution_observers.pop(execution_id, None)

        return queue, unregister

    async def ws_request_multi(self, msg_type: str, data: dict, **kwargs) -> list[dict]:
        self.ws_multi_calls.append((msg_type, data, kwargs))
        callback = kwargs.get("on_message")
        messages = self.ws_multi_responses.pop(0) if self.ws_multi_responses else list(self.ws_multi_response)
        execution_id = data.get("execution_id")
        observer_queues = list(self.execution_observers.get(execution_id, [])) if execution_id else []
        for message in messages:
            for queue in observer_queues:
                queue.put_nowait(message)
            if callback:
                result = callback(message)
                if inspect.isawaitable(result):
                    await result
        for message in self.late_ws_messages:
            for queue in observer_queues:
                queue.put_nowait(message)
        return list(messages)


@pytest_asyncio.fixture(autouse=True)
async def _reset_mirror_state():
    McpSessionState.get().clear()
    yield
    McpSessionState.get().clear()


@pytest.mark.asyncio
async def test_mcp_mirror_events_endpoint_broadcasts_payload(monkeypatch):
    broadcast_messages: list[dict] = []

    async def fake_broadcast(payload: dict) -> int:
        broadcast_messages.append(payload)
        return 1

    monkeypatch.setattr(mcp_manager.websocket_manager, "broadcast", fake_broadcast)

    response = await mcp_manager.mcp_mirror_events(
        {
            "run_id": "run-1",
            "tool_name": "execute_cell",
            "tool_group": "notebook",
            "action": "open_resource",
            "resource": {"path": "C:/workspace/demo.ipynb"},
            "payload": {"path": "C:/workspace/demo.ipynb", "focus_view": "notebook"},
        }
    )

    assert response["status"] == "accepted"
    assert broadcast_messages[0]["type"] == "mcp_mirror_event"
    assert broadcast_messages[0]["action"] == "open_resource"
    assert broadcast_messages[0]["payload"]["focus_view"] == "notebook"


@pytest.mark.asyncio
async def test_execute_cell_emits_mirror_sequence(monkeypatch):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    bridge = MirrorBridge(
        notebook_payload={
            "cells": [{"id": "cell-1", "cell_type": "code", "source": "print(1)", "outputs": []}],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        },
        ws_multi_response=[
            {
                "type": "notebook_stream",
                "kernel_id": "kernel-1",
                "cell_id": "cell-1",
                "content": {"name": "stdout", "text": "hello"},
            },
            {
                "type": "notebook_cell_executed",
                "kernel_id": "kernel-1",
                "cell_id": "cell-1",
                "execution_id": "exec-1",
                "execution_count": 1,
                "outputs": [],
                "docx_ref": "/api/docx/download?token=docx-123",
                "pdf_ref": "/api/pdf/download?token=pdf-123",
            },
        ],
    )

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await notebook.execute_cell("kernel-1", "cell-1", "print(1)")

    assert result["status"] == "executed"
    assert [event["action"] for event in fake_mirror_reporter.events][:3] == [
        "open_resource",
        "notebook_runtime_message",
        "notebook_runtime_message",
    ]
    assert [event["payload"]["kind"] for event in fake_mirror_reporter.events[-2:]] == ["docx", "pdf"]
    assert len({event["run_id"] for event in fake_mirror_reporter.events}) == 1


@pytest.mark.asyncio
async def test_execute_cell_relays_late_pdf_messages_to_mirror(monkeypatch):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    bridge = MirrorBridge(
        notebook_payload={
            "cells": [{"id": "cell-1", "cell_type": "code", "source": "print(1)", "outputs": []}],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        },
        ws_multi_response=[
            {
                "type": "notebook_stream",
                "kernel_id": "kernel-1",
                "cell_id": "cell-1",
                "execution_id": "mcp_exec_test",
                "content": {"name": "stdout", "text": "hello"},
            },
            {
                "type": "notebook_cell_executed",
                "kernel_id": "kernel-1",
                "cell_id": "cell-1",
                "execution_id": "mcp_exec_test",
                "execution_count": 1,
                "outputs": [],
                "docx_ref": "/api/docx/download?token=docx-123",
                "pdf_converting": True,
            },
        ],
        late_ws_messages=[
            {
                "type": "notebook_progress_update",
                "kernel_id": "kernel-1",
                "execution_id": "mcp_exec_test",
                "message": "Convirtiendo a PDF...",
            },
            {
                "type": "notebook_pdf_ready",
                "kernel_id": "kernel-1",
                "execution_id": "mcp_exec_test",
                "pdf_ref": "/api/pdf/download?token=pdf-123",
                "pdf_hash": "pdf-hash-123",
            },
        ],
    )

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    original_uuid4 = notebook.uuid.uuid4
    monkeypatch.setattr(notebook.uuid, "uuid4", lambda: type("Uuid", (), {"hex": "test"})())
    try:
        result = await notebook.execute_cell("kernel-1", "cell-1", "with build_doc(order=1) as doc:\n    doc.text('x')")
    finally:
        monkeypatch.setattr(notebook.uuid, "uuid4", original_uuid4)

    await asyncio.sleep(0)

    assert result["status"] == "executed"
    runtime_payload_types = [
        event["payload"].get("type")
        for event in fake_mirror_reporter.events
        if event["action"] == "notebook_runtime_message"
    ]
    assert "notebook_progress_update" in runtime_payload_types
    assert "notebook_pdf_ready" in runtime_payload_types
    assert fake_mirror_reporter.events[-1]["action"] == "artifact_update"
    assert fake_mirror_reporter.events[-1]["payload"]["kind"] == "pdf"


@pytest.mark.asyncio
async def test_execute_cell_emits_inline_docx_artifact_for_mirror(monkeypatch):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    bridge = MirrorBridge(
        notebook_payload={
            "cells": [{"id": "cell-1", "cell_type": "code", "source": "print(1)", "outputs": []}],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        },
        ws_multi_response=[
            {
                "type": "notebook_cell_executed",
                "kernel_id": "kernel-1",
                "cell_id": "cell-1",
                "execution_id": "exec-inline-docx",
                "execution_count": 1,
                "outputs": [],
                "docx_file_b64": "ZG9jeA==",
                "docx_hash": "docx-hash-123",
                "docx_file_name": "probe.docx",
                "docx_size_bytes": 4,
            },
        ],
    )

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await notebook.execute_cell("kernel-1", "cell-1", "with build_doc(order=1) as doc:\n    doc.text('x')")

    assert result["status"] == "executed"
    artifact_events = [event for event in fake_mirror_reporter.events if event["action"] == "artifact_update"]
    assert artifact_events[-1]["payload"]["kind"] == "docx"
    assert artifact_events[-1]["payload"]["docx_file_b64"] == "ZG9jeA=="
    assert artifact_events[-1]["payload"]["docx_file_name"] == "probe.docx"
    assert artifact_events[-1]["payload"]["docx_size_bytes"] == 4


@pytest.mark.asyncio
async def test_execute_all_cells_uses_batch_docx_strategy_and_only_final_pdf(monkeypatch):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    bridge = MirrorBridge(
        notebook_payload={
            "cells": [
                {"id": "cell-1", "cell_type": "code", "source": "with build_doc(order=1) as doc:\n    doc.text('A')", "outputs": []},
                {"id": "cell-2", "cell_type": "code", "source": "print('done')", "outputs": []},
                {"id": "cell-3", "cell_type": "code", "source": "   ", "outputs": []},
            ],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        },
        ws_multi_responses=[
            [
                {
                    "type": "notebook_cell_executed",
                    "kernel_id": "kernel-1",
                    "cell_id": "cell-1",
                    "execution_id": "exec-1",
                    "execution_count": 1,
                    "outputs": [],
                },
            ],
            [
                {
                    "type": "notebook_cell_executed",
                    "kernel_id": "kernel-1",
                    "cell_id": "cell-2",
                    "execution_id": "exec-2",
                    "execution_count": 2,
                    "outputs": [],
                    "docx_ref": "/api/docx/download?token=docx-final",
                    "docx_file_token": "docx-final",
                },
            ],
        ],
    )

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await notebook.execute_all_cells("kernel-1", notebook_path)

    assert result["status"] == "completed"
    assert result["executed"] == 2
    assert len(bridge.ws_multi_calls) == 2
    first_payload = bridge.ws_multi_calls[0][1]
    second_payload = bridge.ws_multi_calls[1][1]
    assert first_payload["cell_type"] == "docx"
    assert second_payload["cell_type"] == "code"
    assert first_payload["emit_docx"] is True
    assert second_payload["emit_docx"] is True
    assert first_payload["skip_pdf"] is True
    assert second_payload["skip_pdf"] is False


@pytest.mark.asyncio
async def test_execute_all_cells_can_skip_docx_cells(monkeypatch):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    bridge = MirrorBridge(
        notebook_payload={
            "cells": [
                {"id": "cell-docx", "cell_type": "docx", "source": "with build_doc() as doc:\n    doc.text('A')", "outputs": []},
                {"id": "cell-code", "cell_type": "code", "source": "print('done')", "outputs": []},
            ],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        },
        ws_multi_responses=[
            [
                {
                    "type": "notebook_cell_executed",
                    "kernel_id": "kernel-1",
                    "cell_id": "cell-code",
                    "execution_id": "exec-code",
                    "execution_count": 1,
                    "outputs": [],
                },
            ],
        ],
    )

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await notebook.execute_all_cells("kernel-1", notebook_path, include_docx=False)

    assert result["status"] == "completed"
    assert result["executed"] == 1
    assert result["skipped_docx_cell_ids"] == ["cell-docx"]
    assert len(bridge.ws_multi_calls) == 1
    payload = bridge.ws_multi_calls[0][1]
    assert payload["cell_id"] == "cell-code"
    assert payload["cell_type"] == "code"
    assert payload["emit_docx"] is False


@pytest.mark.asyncio
async def test_execute_cell_skips_docx_when_disabled(monkeypatch):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    bridge = MirrorBridge(
        notebook_payload={
            "cells": [
                {"id": "cell-docx", "cell_type": "docx", "source": "with build_doc() as doc:\n    doc.text('A')", "outputs": []},
            ],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        },
    )

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await notebook.execute_cell("kernel-1", "cell-docx", include_docx=False)

    assert result["status"] == "skipped"
    assert result["skipped_docx_cell_ids"] == ["cell-docx"]
    assert result["cell"]["cell_type"] == "docx"
    assert result["cell"]["skipped_reason"] == "docx_disabled"
    assert bridge.ws_multi_calls == []


@pytest.mark.asyncio
async def test_notebook_sync_cells_accepts_docx_cell_type(monkeypatch):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")

    bridge = MirrorBridge(
        notebook_payload={
            "cells": [],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        },
    )

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await notebook.notebook_sync_cells(
        notebook_path,
        [
            {
                "cell_id": "cell-docx",
                "cell_type": "docx",
                "source": "with build_doc() as doc:\n    doc.text('A')",
            }
        ],
    )

    assert result["status"] == "synced"
    assert result["cells"][0]["type"] == "docx"
    assert result["created_cell_ids"] == ["cell-docx"]
    written_payload = bridge.rest_post_calls[-1][1]
    assert written_payload["content"]["cells"][0]["cell_type"] == "docx"


@pytest.mark.asyncio
async def test_execute_cells_emits_open_resource_before_runtime_messages(monkeypatch):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")

    bridge = MirrorBridge(
        notebook_payload={
            "cells": [
                {"id": "cell-1", "cell_type": "code", "source": "print(1)", "outputs": []},
            ],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        },
        ws_multi_response=[
            {
                "type": "notebook_stream",
                "kernel_id": "kernel-1",
                "cell_id": "cell-1",
                "execution_id": "exec-cells-1",
                "content": {"name": "stdout", "text": "hello"},
            },
            {
                "type": "notebook_cell_executed",
                "kernel_id": "kernel-1",
                "cell_id": "cell-1",
                "execution_id": "exec-cells-1",
                "execution_count": 1,
                "outputs": [],
            },
        ],
    )

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await notebook.execute_cells("kernel-1", notebook_path, ["cell-1"])

    assert result["status"] == "completed"
    assert fake_mirror_reporter.events[0]["action"] == "open_resource"
    assert fake_mirror_reporter.events[1]["action"] == "notebook_runtime_message"


@pytest.mark.asyncio
async def test_execute_until_emits_open_resource_before_runtime_messages(monkeypatch):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")

    bridge = MirrorBridge(
        notebook_payload={
            "cells": [
                {"id": "cell-1", "cell_type": "code", "source": "print(1)", "outputs": []},
            ],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        },
        ws_multi_response=[
            {
                "type": "notebook_stream",
                "kernel_id": "kernel-1",
                "cell_id": "cell-1",
                "execution_id": "exec-until-1",
                "content": {"name": "stdout", "text": "hello"},
            },
            {
                "type": "notebook_cell_executed",
                "kernel_id": "kernel-1",
                "cell_id": "cell-1",
                "execution_id": "exec-until-1",
                "execution_count": 1,
                "outputs": [],
            },
        ],
    )

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await notebook.execute_until("kernel-1", notebook_path, "cell-1")

    assert result["status"] == "completed"
    assert fake_mirror_reporter.events[0]["action"] == "open_resource"
    assert fake_mirror_reporter.events[1]["action"] == "notebook_runtime_message"


@pytest.mark.asyncio
async def test_upload_template_emits_template_snapshot(monkeypatch, tmp_path):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    template_path = tmp_path / "demo.docx"
    template_path.write_bytes(b"docx-bytes")
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    bridge = MirrorBridge(
        ws_response={
            "type": "template_uploaded",
            "kernel_id": "kernel-1",
            "template_token": "template-123",
            "template": {"styles": ["Normal"]},
        }
    )

    monkeypatch.setattr(templates.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await templates.upload_template("kernel-1", str(template_path))

    assert result["status"] == "attached"
    assert [event["action"] for event in fake_mirror_reporter.events] == ["open_resource", "template_snapshot"]
    assert fake_mirror_reporter.events[-1]["payload"]["template_token"] == "template-123"


@pytest.mark.asyncio
async def test_edit_cell_snapshot_reuses_registered_kernel_id(monkeypatch):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    bridge = MirrorBridge(
        notebook_payload={
            "cells": [{"id": "cell-1", "cell_type": "code", "source": "print(1)", "outputs": []}],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        },
    )

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await notebook.edit_cell(notebook_path, "cell-1", "print(2)")

    assert result["status"] == "edited"
    assert [event["action"] for event in fake_mirror_reporter.events] == ["open_resource", "notebook_snapshot"]
    assert fake_mirror_reporter.events[0]["resource"]["kernel_id"] == "kernel-1"
    assert fake_mirror_reporter.events[1]["payload"]["kernel_id"] == "kernel-1"


@pytest.mark.asyncio
async def test_notebook_save_emits_snapshot_only_for_save_as(monkeypatch):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    source_path = os.path.abspath("C:/workspace/source.ipynb")
    target_path = os.path.abspath("C:/workspace/copied.ipynb")
    McpSessionState.get().register_notebook("kernel-1", source_path)

    bridge = MirrorBridge(
        notebook_payload={
            "cells": [{"id": "cell-1", "cell_type": "code", "source": "print(1)", "outputs": []}],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        },
    )

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await notebook.notebook_save("kernel-1", target_path)

    assert result["status"] == "saved"
    assert result["path"] == target_path
    assert [event["action"] for event in fake_mirror_reporter.events] == ["open_resource", "notebook_snapshot"]
    assert _normalize_path(McpSessionState.get().get_notebook_path("kernel-1")) == _normalize_path(target_path)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("fn_name", "ws_response", "expected_message_type"),
    [
        ("reset_kernel", {"type": "notebook_kernel_reset"}, "notebook_kernel_reset"),
        ("interrupt_kernel", {"type": "notebook_kernel_interrupted"}, "notebook_kernel_interrupted"),
        ("shutdown_kernel", {"type": "notebook_kernel_shutdown"}, "notebook_kernel_shutdown"),
    ],
)
async def test_kernel_control_tools_emit_runtime_mirror_messages(monkeypatch, fn_name, ws_response, expected_message_type):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")
    state = McpSessionState.get()
    state.register_notebook("kernel-1", notebook_path)
    state.set_kernel_state("kernel-1", "running", notebook_path=notebook_path, execution_id="exec-ctrl-1")

    bridge = MirrorBridge(ws_response=ws_response)

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await getattr(notebook, fn_name)("kernel-1")

    assert result["status"] in {"reset", "interrupted", "shutdown"}
    assert [event["action"] for event in fake_mirror_reporter.events][:2] == [
        "open_resource",
        "notebook_runtime_message",
    ]
    assert fake_mirror_reporter.events[1]["payload"]["type"] == expected_message_type
    assert _normalize_path(fake_mirror_reporter.events[1]["payload"]["notebook_path"]) == _normalize_path(notebook_path)


@pytest.mark.asyncio
async def test_file_tools_emit_granular_file_mutations(monkeypatch, tmp_path):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    source_file = tmp_path / "demo.py"
    source_file.write_text("print(1)\n", encoding="utf-8")
    created_file = tmp_path / "created.txt"
    renamed_file = tmp_path / "demo_renamed.py"

    bridge = MirrorBridge(system_info_payload={"active_workspace": str(tmp_path)})

    monkeypatch.setattr(files.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    await files.create_file(str(created_file))
    await files.write_file(str(source_file), "print(2)\n")
    await files.rename_file(str(source_file), str(renamed_file))
    await files.delete_file(str(source_file))

    mutation_payloads = [event["payload"] for event in fake_mirror_reporter.events if event["action"] == "file_mutation"]
    assert [payload["mutation"] for payload in mutation_payloads] == ["create", "write", "rename", "delete"]
    assert mutation_payloads[0]["file_kind"] == "text"
    assert mutation_payloads[1]["file_kind"] == "code"
    assert mutation_payloads[2]["old_path"] == os.path.abspath(str(source_file))
    assert mutation_payloads[2]["new_path"] == os.path.abspath(str(renamed_file))
    assert mutation_payloads[3]["path"] == os.path.abspath(str(source_file))


@pytest.mark.asyncio
async def test_reconvert_pdf_emits_docx_focus_and_pdf_artifact(monkeypatch):
    fake_activity_reporter = FakeReporter()
    fake_mirror_reporter = FakeReporter()
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    bridge = MirrorBridge(
        ws_response={
            "type": "pdf_reconverted",
            "status": "ok",
            "pdf_file_token": "pdf-token-123",
            "pdf_ref": "/api/pdf/download?token=pdf-token-123",
            "pdf_hash": "pdf-hash-123",
        }
    )

    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: bridge))
    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_activity_reporter))
    monkeypatch.setattr(mcp_mirror.McpMirrorReporter, "get", classmethod(lambda cls: fake_mirror_reporter))

    result = await documents.reconvert_pdf("kernel-1")

    assert result["status"] == "ok"
    assert [event["action"] for event in fake_mirror_reporter.events] == ["open_resource", "artifact_update"]
    assert fake_mirror_reporter.events[0]["payload"]["focus_view"] == "docx"
    assert fake_mirror_reporter.events[1]["payload"]["kind"] == "pdf"
    assert fake_mirror_reporter.events[1]["payload"]["pdf_ref"] == "/api/pdf/download?token=pdf-token-123"
