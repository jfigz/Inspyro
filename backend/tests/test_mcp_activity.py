from __future__ import annotations

import os

import pytest
import pytest_asyncio

from app.routers import mcp_manager
from app.services.mcp_activity import McpActivityStore
from mcp_server import activity as mcp_activity
from mcp_server.session_state import McpSessionState


class FakeReporter:
    def __init__(self) -> None:
        self.events: list[dict] = []

    async def report(self, event: dict) -> None:
        self.events.append(event)


def _normalize_path(value: str) -> str:
    return os.path.normcase(os.path.abspath(value))


@pytest_asyncio.fixture(autouse=True)
async def _reset_global_activity_store():
    await mcp_manager.mcp_activity_store.clear()
    McpSessionState.get().clear()
    yield
    await mcp_manager.mcp_activity_store.clear()
    McpSessionState.get().clear()


@pytest.mark.asyncio
async def test_mcp_activity_store_tracks_history_and_active_runs():
    store = McpActivityStore(max_events=2)

    started_event, active_count = await store.record_event(
        {
            "run_id": "run-1",
            "phase": "started",
            "tool_name": "write_file",
            "tool_group": "files",
            "summary": "Writing demo.py",
            "resource": {"path": "C:/demo.py"},
        }
    )
    completed_event, active_count_after = await store.record_event(
        {
            "run_id": "run-1",
            "phase": "completed",
            "tool_name": "write_file",
            "tool_group": "files",
            "summary": "Writing demo.py",
            "duration_ms": 12,
        }
    )
    await store.record_event(
        {
            "run_id": "run-2",
            "phase": "started",
            "tool_name": "execute_cell",
            "tool_group": "notebook",
            "summary": "Executing cell",
        }
    )

    snapshot = await store.snapshot(limit=5)

    assert started_event["status"] == "running"
    assert active_count == 1
    assert completed_event["status"] == "success"
    assert active_count_after == 0
    assert snapshot["active_count"] == 1
    assert snapshot["active_runs"][0]["run_id"] == "run-2"
    assert [event["run_id"] for event in snapshot["events"]] == ["run-2", "run-1"]


@pytest.mark.asyncio
async def test_mcp_activity_events_endpoint_broadcasts_structured_ws_payload(monkeypatch):
    broadcast_messages: list[dict] = []

    async def fake_broadcast(payload: dict) -> int:
        broadcast_messages.append(payload)
        return 1

    monkeypatch.setattr(mcp_manager.websocket_manager, "broadcast", fake_broadcast)

    response = await mcp_manager.mcp_activity_events(
        {
            "run_id": "run-endpoint",
            "phase": "started",
            "tool_name": "execute_cell",
            "tool_group": "notebook",
            "summary": "Executing cell a1",
            "resource": {"notebook_path": "C:/demo.ipynb"},
            "ui_hints": {"show_agent_execution": True},
        }
    )

    assert response["status"] == "accepted"
    assert response["active_count"] == 1
    assert broadcast_messages[0]["type"] == "mcp_activity_event"
    assert broadcast_messages[0]["run_id"] == "run-endpoint"
    assert broadcast_messages[0]["ui_hints"]["show_agent_execution"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tool_name", "group", "call_kwargs", "result", "expected_hints"),
    [
        (
            "write_file",
            "files",
            {"path": "C:/workspace/demo.py", "content": "print(1)"},
            {"status": "ok", "path": "C:/workspace/demo.py"},
            {"refresh_workspace": True, "reload_path": "C:/workspace/demo.py"},
        ),
        (
            "add_cell",
            "notebook",
            {"notebook_path": "C:/workspace/demo.ipynb", "source": "x = 1"},
            {"status": "added", "path": "C:/workspace/demo.ipynb"},
            {"show_agent_execution": True, "reload_path": "C:/workspace/demo.ipynb"},
        ),
        (
            "execute_cell",
            "notebook",
            {"kernel_id": "kernel-1", "cell_id": "cell-1", "source": "x = 1"},
            {
                "status": "executed",
                "path": "C:/workspace/demo.ipynb",
                "raw": {"pdf_ref": "/api/pdf/download?token=pdf-123"},
            },
            {"show_agent_execution": True, "reload_path": "C:/workspace/demo.ipynb", "refresh_preview": True},
        ),
        (
            "upload_template",
            "templates",
            {"kernel_id": "kernel-1", "file_path": "C:/workspace/template.docx"},
            {"status": "attached", "kernel_id": "kernel-1"},
            {"refresh_preview": True, "reload_path": "C:/workspace/demo.ipynb"},
        ),
    ],
)
async def test_mcp_activity_tool_emits_started_and_completed_with_ui_hints(
    monkeypatch,
    tool_name,
    group,
    call_kwargs,
    result,
    expected_hints,
):
    fake_reporter = FakeReporter()

    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_reporter))
    monkeypatch.setattr(mcp_activity.mcp, "tool", lambda *args, **kwargs: (lambda fn: fn))

    state = McpSessionState.get()
    state.register_notebook("kernel-1", "C:/workspace/demo.ipynb")

    async def _tool_impl(**kwargs):
        return result

    _tool_impl.__name__ = tool_name
    instrumented = mcp_activity.mcp_activity_tool(group)(_tool_impl)

    returned = await instrumented(**call_kwargs)

    assert returned == result
    assert [event["phase"] for event in fake_reporter.events] == ["started", "completed"]
    assert fake_reporter.events[0]["run_id"] == fake_reporter.events[1]["run_id"]
    assert fake_reporter.events[0]["client_id"] == "__global__"
    assert fake_reporter.events[0]["transport"] == "streamable-http"
    assert fake_reporter.events[1]["client_id"] == "__global__"
    assert fake_reporter.events[1]["transport"] == "streamable-http"
    for hint_key, expected_value in expected_hints.items():
        actual_value = fake_reporter.events[1]["ui_hints"][hint_key]
        if hint_key == "reload_path":
            assert _normalize_path(actual_value) == _normalize_path(expected_value)
        else:
            assert actual_value == expected_value


@pytest.mark.asyncio
async def test_mcp_activity_tool_emits_failed_event(monkeypatch):
    fake_reporter = FakeReporter()

    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_reporter))
    monkeypatch.setattr(mcp_activity.mcp, "tool", lambda *args, **kwargs: (lambda fn: fn))

    async def _failing_tool(path: str):
        raise RuntimeError("boom")

    _failing_tool.__name__ = "write_file"
    instrumented = mcp_activity.mcp_activity_tool("files")(_failing_tool)

    with pytest.raises(RuntimeError, match="boom"):
        await instrumented(path="C:/workspace/demo.py")

    assert [event["phase"] for event in fake_reporter.events] == ["started", "failed"]
    assert fake_reporter.events[-1]["status"] == "error"
    assert fake_reporter.events[-1]["error"] == "boom"
    assert fake_reporter.events[-1]["client_id"] == "__global__"
    assert fake_reporter.events[-1]["transport"] == "streamable-http"


@pytest.mark.asyncio
async def test_mcp_activity_tool_extracts_artifact_from_batch_outputs(monkeypatch):
    fake_reporter = FakeReporter()

    monkeypatch.setattr(mcp_activity.McpActivityReporter, "get", classmethod(lambda cls: fake_reporter))
    monkeypatch.setattr(mcp_activity.mcp, "tool", lambda *args, **kwargs: (lambda fn: fn))

    state = McpSessionState.get()
    state.register_notebook("kernel-1", "C:/workspace/demo.ipynb")

    async def _tool_impl(**kwargs):
        return {
            "status": "completed",
            "path": "C:/workspace/demo.ipynb",
            "outputs": {
                "cell-1": {
                    "artifacts": [
                        {
                            "kind": "docx",
                            "docx_ref": "/api/docx/download?token=docx-123",
                            "docx_hash": "docx-hash-123",
                        }
                    ]
                }
            },
        }

    _tool_impl.__name__ = "execute_all_cells"
    instrumented = mcp_activity.mcp_activity_tool("notebook")(_tool_impl)

    returned = await instrumented(kernel_id="kernel-1", notebook_path="C:/workspace/demo.ipynb")

    assert returned["status"] == "completed"
    assert fake_reporter.events[-1]["ui_hints"]["refresh_preview"] is True
    assert fake_reporter.events[-1]["ui_hints"]["artifact"]["kind"] == "docx"
    assert fake_reporter.events[-1]["ui_hints"]["artifact"]["docx_ref"] == "/api/docx/download?token=docx-123"
