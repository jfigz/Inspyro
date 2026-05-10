from __future__ import annotations

import asyncio
import base64
import hashlib
import inspect
import json
import os
import sys
import types
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pytest

from app.routers import analysis as analysis_router, mcp_manager, notebook_execution, notebook_kernel_control
from app.services import notebook_service
from mcp_server import config as mcp_config, server as mcp_server_main, start_mcp
from mcp_server.bridge import BridgeError, InspyroBridge
from mcp_server.session_state import McpSessionState
from mcp_server.tools import analysis, documents, files, notebook, system, templates, units


class FakeManager:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def send_personal_message(self, payload: dict, websocket) -> None:
        self.messages.append(payload)


class FakeKernelManager:
    async def start_kernel(self, kernel_name: str, cwd: str | None = None) -> str:
        return "kernel-1"

    async def restart_kernel(self, kernel_id: str) -> None:
        return None

    async def interrupt_kernel(self, kernel_id: str) -> None:
        return None


class FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send(self, payload: str) -> None:
        self.sent.append(json.loads(payload))


class FakeBridge:
    def __init__(
        self,
        *,
        ws_response: dict | None = None,
        ws_multi_response: list[dict] | None = None,
        rest_response: dict | None = None,
    ) -> None:
        self.ws_response = ws_response or {}
        self.ws_multi_response = ws_multi_response or []
        self.rest_response = rest_response or {}
        self.rest_calls: list[tuple[str, dict]] = []
        self.ws_calls: list[tuple[str, dict, dict]] = []
        self.execution_observers: dict[str, list[asyncio.Queue]] = {}

    async def rest_get(self, path: str, *, params: dict | None = None) -> dict:
        self.rest_calls.append((path, params or {}))
        return self.rest_response

    async def rest_delete(self, path: str, *, params: dict) -> dict:
        self.rest_calls.append((path, params))
        return self.rest_response

    async def rest_post_files(self, path: str, *, files: dict) -> dict:
        self.rest_calls.append((path, files))
        return {"template_token": "template-123"}

    async def rest_post(self, path: str, *, json_data: dict) -> dict:
        self.rest_calls.append((path, json_data))
        return self.rest_response

    async def rest_get_bytes(self, path: str, *, params: dict | None = None) -> bytes:
        self.rest_calls.append((path, params or {}))
        if path == "/api/docx/download":
            return base64.b64decode("ZG9jeA==")
        if path == "/api/pdf/download":
            return b"%PDF-1.4\n%fake\n"
        raise AssertionError(f"Unexpected REST GET BYTES path: {path}")

    async def rest_post_bytes(self, path: str, *, json_data: dict | None = None) -> bytes:
        self.rest_calls.append((path, json_data or {}))
        if path == "/api/docx/quality/clean":
            return b"clean-docx"
        raise AssertionError(f"Unexpected REST POST BYTES path: {path}")

    async def ws_request(self, msg_type: str, data: dict, **kwargs) -> dict:
        self.ws_calls.append((msg_type, data, kwargs))
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
        self.ws_calls.append((msg_type, data, kwargs))
        on_message = kwargs.get("on_message")
        if on_message is not None:
            for message in self.ws_multi_response:
                callback_result = on_message(message)
                if asyncio.iscoroutine(callback_result):
                    await callback_result
        execution_id = data.get("execution_id")
        if execution_id:
            for queue in list(self.execution_observers.get(execution_id, [])):
                for message in self.ws_multi_response:
                    queue.put_nowait(message)
        return list(self.ws_multi_response)


def _sample_quality_summary(artifact_id: str = "artifact-1", findings_count: int = 2) -> dict[str, Any]:
    findings = [
        {
            "section": "accessibility",
            "severity": "error" if index == 0 else "warning",
            "message": "Imagen sin texto alternativo" if index == 0 else "Tabla sin primera fila marcada como encabezado",
            "context": {"part": "word/document.xml", "id": index + 1},
        }
        for index in range(findings_count)
    ]
    return {
        "schema_version": 1,
        "artifact_id": artifact_id,
        "status": "warning",
        "score": 72,
        "counts": {"error": 1 if findings else 0, "warning": max(0, findings_count - 1), "info": 0},
        "sections": [
            {
                "id": "accessibility",
                "status": "error" if findings else "ok",
                "findings": findings,
            }
        ],
        "findings": findings,
        "fields": {"PAGE": 1},
        "content_controls": {"control_count": 0, "placeholder_count": 0},
        "pages_rendered": None,
    }


async def _wait_until(predicate, *, timeout: float = 1.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("Timed out waiting for condition")


@pytest.fixture(autouse=True)
def _clear_mcp_state():
    state = McpSessionState.get()
    state.clear()
    InspyroBridge._instance = None
    InspyroBridge._instances = {}
    mcp_config.set_runtime_transport(transport="streamable-http", stateless_http=False)
    yield
    state.clear()
    InspyroBridge._instance = None
    InspyroBridge._instances = {}
    mcp_config.set_runtime_transport(transport="streamable-http", stateless_http=False)


def test_mcp_status_snapshot_exposes_universal_client_configuration(monkeypatch):
    for name in (
        "INSPYRO_BACKEND_URL",
        "INSPYRO_BACKEND_WS_URL",
        "INSPYRO_BACKEND_NOTEBOOK_WS_URL",
        "INSPYRO_BACKEND_HOST",
        "PORT",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("INSPYRO_BACKEND_PORT", "18042")
    monkeypatch.setenv("INSPYRO_MCP_HOST", "127.0.0.1")
    monkeypatch.setenv("INSPYRO_MCP_PORT", "18100")

    snapshot = mcp_manager.get_mcp_server_snapshot()
    configuration = snapshot["configuration"]

    assert configuration["http_endpoint"] == "http://127.0.0.1:18100/mcp"
    assert configuration["default_profile"] == "authoring"
    assert configuration["recommended_mode"] == "stateful-http"
    assert configuration["local_only"] is True
    assert configuration["backend"]["url"] == "http://127.0.0.1:18042"
    assert configuration["backend"]["ws_url"] == "ws://127.0.0.1:18042/ws"
    assert configuration["backend"]["notebook_ws_url"] == "ws://127.0.0.1:18042/ws/notebook"
    assert configuration["stdio"]["args"] == ["-m", "mcp_server", "--stdio"]
    assert "stateless-http" in " ".join(configuration["warnings"])


def test_mcp_subprocess_env_inherits_dynamic_backend_urls(monkeypatch):
    for name in (
        "INSPYRO_BACKEND_URL",
        "INSPYRO_BACKEND_WS_URL",
        "INSPYRO_BACKEND_NOTEBOOK_WS_URL",
        "INSPYRO_BACKEND_HOST",
        "PORT",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("INSPYRO_BACKEND_PORT", "19001")
    monkeypatch.setenv("INSPYRO_MCP_HOST", "127.0.0.1")
    monkeypatch.setenv("INSPYRO_MCP_PORT", "19100")

    env = mcp_manager._mcp_subprocess_env()

    assert env["INSPYRO_BACKEND_URL"] == "http://127.0.0.1:19001"
    assert env["INSPYRO_BACKEND_WS_URL"] == "ws://127.0.0.1:19001/ws"
    assert env["INSPYRO_BACKEND_NOTEBOOK_WS_URL"] == "ws://127.0.0.1:19001/ws/notebook"
    assert env["INSPYRO_MCP_PORT"] == "19100"


def test_session_state_tracks_notebooks_and_artifacts():
    state = McpSessionState.get()
    notebook_path = state.register_notebook("kernel-1", "./tmp/demo.ipynb")

    assert state.get_notebook_path("kernel-1") == notebook_path
    assert state.get_kernel_id(notebook_path) == "kernel-1"

    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-1",
            "docx_artifact_id": "artifact-1",
            "docx_file_token": "docx-123",
            "docx_download_url": "/api/docx/download?artifact_id=artifact-1",
            "pdf_ref": "/api/pdf/download?token=pdf-123",
        }
    )

    latest = state.get_artifacts(kernel_id="kernel-1")
    per_execution = state.get_artifacts(kernel_id="kernel-1", execution_id="exec-1")

    assert latest["docx_file_token"] == "docx-123"
    assert latest["docx_artifact_id"] == "artifact-1"
    assert latest["execution_id"] == "exec-1"
    assert per_execution["pdf_ref"] == "/api/pdf/download?token=pdf-123"

    state.unregister_kernel("kernel-1")
    assert state.get_notebook_path("kernel-1") is None
    assert state.get_artifacts(kernel_id="kernel-1") is None


def test_session_state_isolates_sessions_by_session_id():
    state = McpSessionState.get()
    state.register_notebook("kernel-a", "./tmp/a.ipynb", session_id="session-a")
    state.register_notebook("kernel-b", "./tmp/b.ipynb", session_id="session-b")

    assert state.get_notebook_path("kernel-a", session_id="session-a")
    assert state.get_notebook_path("kernel-a", session_id="session-b") is None
    assert state.get_notebook_path("kernel-b", session_id="session-b")
    assert state.get_notebook_path("kernel-b", session_id="session-a") is None


def test_session_state_lists_notebook_sessions_with_kernel_metadata():
    state = McpSessionState.get()
    notebook_a = state.register_notebook("kernel-a", "./tmp/a.ipynb", session_id="session-a")
    notebook_b = state.register_notebook("kernel-b", "./tmp/b.ipynb", session_id="session-a")
    state.set_kernel_state(
        "kernel-a",
        "running",
        notebook_path=notebook_a,
        execution_id="exec-a",
        session_id="session-a",
    )
    state.set_kernel_state(
        "kernel-b",
        "idle",
        notebook_path=notebook_b,
        execution_id="exec-b",
        session_id="session-a",
    )

    sessions = state.list_notebook_sessions(session_id="session-a")

    assert [session["kernel_id"] for session in sessions] == ["kernel-a", "kernel-b"]
    assert sessions[0]["notebook_path"] == notebook_a
    assert sessions[0]["state"] == "running"
    assert sessions[0]["last_execution_id"] == "exec-a"
    assert sessions[1]["notebook_path"] == notebook_b
    assert sessions[1]["state"] == "idle"


def test_serialize_notebook_cell_source_preserves_ipynb_line_layout():
    assert notebook_execution._serialize_notebook_cell_source(
        ["x = 1\n", "Heading('Titulo')\n"],
    ) == "x = 1\nHeading('Titulo')\n"
    assert notebook_execution._serialize_notebook_cell_source(
        ["x = 1", "Heading('Titulo')"],
    ) == "x = 1\nHeading('Titulo')"


def test_session_state_aliases_batch_artifacts_and_keeps_latest_winner():
    state = McpSessionState.get()
    notebook_path = state.register_notebook("kernel-1", "./tmp/demo.ipynb")
    state.set_kernel_state("kernel-1", "running", notebook_path=notebook_path, execution_id="batch-new")
    state.register_artifact_alias("kernel-1", execution_id="child-new", alias_execution_id="batch-new")
    state.record_artifacts(
        {
            "type": "notebook_docx_update",
            "kernel_id": "kernel-1",
            "execution_id": "child-new",
            "docx_file_token": "docx-new",
            "docx_ref": "/api/docx/download?token=docx-new",
        }
    )

    state.register_artifact_alias("kernel-1", execution_id="child-old", alias_execution_id="batch-old")
    state.record_artifacts(
        {
            "type": "notebook_docx_update",
            "kernel_id": "kernel-1",
            "execution_id": "child-old",
            "docx_file_token": "docx-old",
            "docx_ref": "/api/docx/download?token=docx-old",
        }
    )

    latest = state.get_artifacts(kernel_id="kernel-1")
    batch_artifacts = state.get_artifacts(kernel_id="kernel-1", execution_id="batch-new")
    stale_artifacts = state.get_artifacts(kernel_id="kernel-1", execution_id="batch-old")

    assert latest["docx_file_token"] == "docx-new"
    assert latest["execution_id"] == "batch-new"
    assert batch_artifacts["docx_file_token"] == "docx-new"
    assert stale_artifacts["docx_file_token"] == "docx-old"


def test_session_state_backfills_batch_artifacts_when_alias_arrives_after_child_payload():
    state = McpSessionState.get()
    notebook_path = state.register_notebook("kernel-1", "./tmp/demo.ipynb")
    state.set_kernel_state("kernel-1", "running", notebook_path=notebook_path, execution_id="batch-new")
    state.record_artifacts(
        {
            "type": "notebook_docx_update",
            "kernel_id": "kernel-1",
            "execution_id": "child-new",
            "docx_file_token": "docx-late",
            "docx_ref": "/api/docx/download?token=docx-late",
        }
    )

    state.register_artifact_alias("kernel-1", execution_id="child-new", alias_execution_id="batch-new")

    latest = state.get_artifacts(kernel_id="kernel-1")
    batch_artifacts = state.get_artifacts(kernel_id="kernel-1", execution_id="batch-new")

    assert latest["docx_file_token"] == "docx-late"
    assert latest["execution_id"] == "batch-new"
    assert batch_artifacts["docx_file_token"] == "docx-late"
    assert batch_artifacts["execution_id"] == "batch-new"


def test_unregister_kernel_clears_execution_history():
    state = McpSessionState.get()
    notebook_path = state.register_notebook("kernel-1", "./tmp/demo.ipynb")
    state.upsert_execution("exec-1", {"kernel_id": "kernel-1", "notebook_path": notebook_path, "status": "running"})

    state.unregister_kernel("kernel-1")

    assert state.get_execution("exec-1") is None


def test_bridge_instances_are_scoped_per_session():
    bridge_a = InspyroBridge.get("session-a")
    bridge_b = InspyroBridge.get("session-b")
    bridge_a_notebook = InspyroBridge.get("session-a", websocket_scope="notebook")

    assert bridge_a is not bridge_b
    assert bridge_a is not bridge_a_notebook
    assert bridge_a_notebook.connection_info()["websocket_scope"] == "notebook"


@pytest.mark.asyncio
async def test_bridge_ws_request_routes_by_request_id_and_raises_errors(monkeypatch):
    bridge = InspyroBridge(session_id="req-routing")
    websocket = FakeWebSocket()

    async def fake_ensure_ws():
        return websocket

    monkeypatch.setattr(bridge, "_ensure_ws", fake_ensure_ws)

    task = asyncio.create_task(
        bridge.ws_request(
            "template_get",
            {"kernel_id": "kernel-1", "request_id": "req-1"},
            success_types={"template_info"},
            error_types={"template_error"},
            timeout=1,
        )
    )

    await _wait_until(lambda: "req-1" in bridge._request_queues)
    bridge._request_queues["req-1"].put_nowait(
        {"type": "template_error", "request_id": "req-1", "error": "boom"}
    )

    with pytest.raises(BridgeError, match="boom"):
        await task


@pytest.mark.asyncio
async def test_bridge_ws_request_multi_isolates_execution_streams(monkeypatch):
    bridge = InspyroBridge(session_id="multi-routing")
    websocket = FakeWebSocket()

    async def fake_ensure_ws():
        return websocket

    monkeypatch.setattr(bridge, "_ensure_ws", fake_ensure_ws)

    task_a = asyncio.create_task(
        bridge.ws_request_multi(
            "notebook_execute_cell",
            {"kernel_id": "kernel-1", "execution_id": "exec-a"},
            collect_types=["notebook_stream"],
            terminal_types=["notebook_cell_executed"],
            error_types=["notebook_cell_error"],
            timeout=1,
        )
    )
    task_b = asyncio.create_task(
        bridge.ws_request_multi(
            "notebook_execute_cell",
            {"kernel_id": "kernel-1", "execution_id": "exec-b"},
            collect_types=["notebook_stream"],
            terminal_types=["notebook_cell_executed"],
            error_types=["notebook_cell_error"],
            timeout=1,
        )
    )

    await _wait_until(
        lambda: {
            "exec-a",
            "exec-b",
        }.issubset(bridge._execution_subscribers.keys())
    )

    for queue in bridge._execution_subscribers["exec-a"]:
        queue.put_nowait({"type": "notebook_stream", "execution_id": "exec-a", "content": {"text": "A"}})
    for queue in bridge._execution_subscribers["exec-b"]:
        queue.put_nowait({"type": "notebook_stream", "execution_id": "exec-b", "content": {"text": "B"}})
    for queue in bridge._execution_subscribers["exec-a"]:
        queue.put_nowait({"type": "notebook_cell_executed", "execution_id": "exec-a"})
    for queue in bridge._execution_subscribers["exec-b"]:
        queue.put_nowait({"type": "notebook_cell_executed", "execution_id": "exec-b"})

    result_a, result_b = await asyncio.gather(task_a, task_b)

    assert [msg["execution_id"] for msg in result_a] == ["exec-a", "exec-a"]
    assert [msg["execution_id"] for msg in result_b] == ["exec-b", "exec-b"]


@pytest.mark.asyncio
async def test_bridge_execution_observer_receives_post_terminal_messages(monkeypatch):
    bridge = InspyroBridge(session_id="observer-routing")
    websocket = FakeWebSocket()

    async def fake_ensure_ws():
        return websocket

    monkeypatch.setattr(bridge, "_ensure_ws", fake_ensure_ws)

    observer_queue, unregister = bridge.register_execution_observer("exec-late")
    task = asyncio.create_task(
        bridge.ws_request_multi(
            "notebook_execute_cell",
            {"kernel_id": "kernel-1", "execution_id": "exec-late"},
            collect_types=["notebook_stream"],
            terminal_types=["notebook_cell_executed"],
            error_types=["notebook_cell_error"],
            timeout=1,
        )
    )

    await _wait_until(
        lambda: len(bridge._execution_subscribers.get("exec-late", set())) >= 2
    )
    for queue in bridge._execution_subscribers["exec-late"]:
        queue.put_nowait({"type": "notebook_stream", "execution_id": "exec-late"})
    for queue in bridge._execution_subscribers["exec-late"]:
        queue.put_nowait({"type": "notebook_cell_executed", "execution_id": "exec-late"})

    result = await task

    for queue in bridge._execution_subscribers["exec-late"]:
        queue.put_nowait({"type": "notebook_pdf_ready", "execution_id": "exec-late"})

    late_message = await asyncio.wait_for(observer_queue.get(), timeout=1)
    terminal_message = await asyncio.wait_for(observer_queue.get(), timeout=1)
    post_terminal_message = await asyncio.wait_for(observer_queue.get(), timeout=1)
    unregister()

    assert [msg["type"] for msg in result] == ["notebook_stream", "notebook_cell_executed"]
    assert late_message["type"] == "notebook_stream"
    assert terminal_message["type"] == "notebook_cell_executed"
    assert post_terminal_message["type"] == "notebook_pdf_ready"


@pytest.mark.asyncio
async def test_bridge_disconnect_wakes_pending_waiters(monkeypatch):
    bridge = InspyroBridge(session_id="disconnect-routing")
    websocket = FakeWebSocket()

    async def fake_ensure_ws():
        return websocket

    monkeypatch.setattr(bridge, "_ensure_ws", fake_ensure_ws)

    task = asyncio.create_task(
        bridge.ws_request(
            "template_get",
            {"kernel_id": "kernel-1", "request_id": "req-disconnect"},
            success_types={"template_info"},
            timeout=5,
        )
    )

    await _wait_until(lambda: "req-disconnect" in bridge._request_queues)
    bridge._notify_disconnect("test_disconnect")

    with pytest.raises(ConnectionError, match="WebSocket desconectado"):
        await task


def test_bridge_records_runtime_recovery_evidence():
    bridge = InspyroBridge(session_id="runtime-evidence")

    bridge._record_message_side_effects(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "cell_id": "cell-1",
            "execution_id": "exec-runtime",
            "execution_count": 1,
            "outputs": [],
            "variables": {},
        }
    )

    recovery = McpSessionState.get().get_execution_recovery("exec-runtime", session_id="runtime-evidence")

    assert recovery is not None
    assert recovery["terminal_message"]["type"] == "notebook_cell_executed"
    assert recovery["last_message_type"] == "notebook_cell_executed"


@pytest.mark.asyncio
async def test_forward_iopub_includes_execution_and_source_metadata(monkeypatch):
    fake_manager = FakeManager()
    monkeypatch.setattr(notebook_service, "manager", fake_manager)
    monkeypatch.setattr(
        notebook_service,
        "get_kernel_docx_source",
        lambda kernel_id: {
            "source_path": "C:\\workspace\\report.ipynb",
            "source_kind": "notebook",
        } if kernel_id == "kernel-1" else {"source_path": None, "source_kind": None},
    )

    await notebook_service._forward_iopub(
        "stream",
        {"text": "hello", "name": "stdout"},
        "cell-1",
        object(),
        kernel_id="kernel-1",
        execution_id="exec-123",
    )

    assert fake_manager.messages[-1]["type"] == "notebook_stream"
    assert fake_manager.messages[-1]["kernel_id"] == "kernel-1"
    assert fake_manager.messages[-1]["execution_id"] == "exec-123"
    assert fake_manager.messages[-1]["source_path"] == "C:\\workspace\\report.ipynb"
    assert fake_manager.messages[-1]["source_kind"] == "notebook"


@pytest.mark.asyncio
async def test_process_notebook_cell_execution_includes_kernel_id(monkeypatch):
    observed = {}

    class _FakeExecutionKernelManager:
        async def execute_cell(self, *args, **kwargs):
            observed["capture_docx"] = kwargs.get("capture_docx")
            return [], 1, {}, {"performance_data": {}}

    async def _noop_iopub(*args, **kwargs):
        return None

    monkeypatch.setattr(notebook_service, "jupyter_kernel_manager", _FakeExecutionKernelManager())
    monkeypatch.setattr(notebook_service, "_retrieve_docx_via_stdout", lambda kernel_id: asyncio.sleep(0, result=None))
    monkeypatch.setattr(notebook_service, "compute_docx_semantic_hash", lambda docx_b64: ("docx-hash", "binary-hash"))
    monkeypatch.setattr(notebook_service, "_pdf_cache_get", lambda docx_hash: None)

    notebook_service.notebook_cumulative_variables.clear()
    notebook_service.notebook_cumulative_call_stacks.clear()
    notebook_service.notebook_last_docx_b64.clear()
    notebook_service.notebook_docx_hash.clear()

    result = await notebook_service._process_notebook_cell_execution(
        kernel_id="kernel-1",
        cell_id="cell-1",
        instrumented_code="print('x')",
        source_code="print('x')",
        enable_tracing=False,
        emit_docx=True,
        skip_pdf=False,
        defer_docx_export=True,
        on_iopub=_noop_iopub,
        websocket=None,
        execution_id="exec-1",
    )

    assert result["type"] == "notebook_cell_executed"
    assert result["kernel_id"] == "kernel-1"
    assert result["docx_hash"] is None
    assert result["pdf_converting"] is True
    assert observed["capture_docx"] is None
    document_job = result["_document_job_request"]
    assert isinstance(document_job, notebook_service.DocumentJobRequest)
    assert document_job.execution_id == "exec-1"
    assert document_job.reason == "terminal"
    assert document_job.needs_pdf is True


@pytest.mark.asyncio
async def test_process_notebook_cell_execution_exposes_degraded_variable_snapshot(monkeypatch):
    class _FakeExecutionKernelManager:
        async def execute_cell(self, *args, **kwargs):
            return [], 5, {"x": {"type": "int", "repr": "1"}}, {
                "performance_data": {},
                "execution_diagnostics": {
                    "variables_capture_degraded": True,
                    "variables_capture_error": "timeout",
                },
                "variables_snapshot_degraded": True,
            }

    async def _noop_iopub(*args, **kwargs):
        return None

    monkeypatch.setattr(notebook_service, "jupyter_kernel_manager", _FakeExecutionKernelManager())
    monkeypatch.setattr(notebook_service, "_retrieve_docx_via_stdout", lambda kernel_id: asyncio.sleep(0, result=None))

    notebook_service.notebook_cumulative_variables.clear()
    notebook_service.notebook_cumulative_call_stacks.clear()

    result = await notebook_service._process_notebook_cell_execution(
        kernel_id="kernel-1",
        cell_id="cell-1",
        instrumented_code="x = 1",
        source_code="x = 1",
        enable_tracing=False,
        emit_docx=False,
        skip_pdf=False,
        on_iopub=_noop_iopub,
        websocket=None,
        execution_id="exec-1",
    )

    assert result["type"] == "notebook_cell_executed"
    assert result["variables_snapshot_degraded"] is True
    assert result["execution_diagnostics"]["variables_capture_degraded"] is True
    assert result["execution_diagnostics"]["variables_capture_error"] == "timeout"
    assert result["variables"]["x"]["repr"] == "1"


@pytest.mark.asyncio
async def test_process_notebook_cell_execution_marks_document_job_degraded_after_iopub_degradation(monkeypatch):
    class _FakeExecutionKernelManager:
        async def execute_cell(self, *args, **kwargs):
            return [], 6, {}, {
                "performance_data": {},
                "execution_diagnostics": {"idle_missing": True},
            }

    async def _noop_iopub(*args, **kwargs):
        return None

    retrieve_called = False

    async def _unexpected_retrieve(*args, **kwargs):
        nonlocal retrieve_called
        retrieve_called = True
        return "unexpected"

    monkeypatch.setattr(notebook_service, "jupyter_kernel_manager", _FakeExecutionKernelManager())
    monkeypatch.setattr(notebook_service, "_retrieve_docx_via_stdout", _unexpected_retrieve)

    notebook_service.notebook_cumulative_variables.clear()
    notebook_service.notebook_cumulative_call_stacks.clear()
    notebook_service.notebook_last_docx_b64.clear()
    notebook_service.notebook_docx_hash.clear()

    result = await notebook_service._process_notebook_cell_execution(
        kernel_id="kernel-1",
        cell_id="cell-1",
        instrumented_code="print('x')",
        source_code="print('x')",
        enable_tracing=False,
        emit_docx=True,
        skip_pdf=False,
        on_iopub=_noop_iopub,
        websocket=None,
        execution_id="exec-1",
    )

    assert result["type"] == "notebook_cell_executed"
    assert result["execution_diagnostics"]["idle_missing"] is True
    assert result["pdf_converting"] is True
    document_job = result["_document_job_request"]
    assert isinstance(document_job, notebook_service.DocumentJobRequest)
    assert document_job.reason == "degraded_terminal"
    assert retrieve_called is False


@pytest.mark.asyncio
async def test_recover_docx_and_emit_updates_background_emits_docx_then_pdf(monkeypatch):
    fake_manager = FakeManager()

    async def _fake_execute_docx_export(
        kernel_id,
        websocket,
        pdf_timeout_s=None,
        execution_id=None,
        generation=None,
        queued_at_monotonic=None,
    ):
        return {
            "docx_file_b64": None,
            "docx_file_token": "docx-token",
            "docx_download_url": "/api/docx/download?artifact_id=artifact-1",
            "docx_ref": "/api/docx/download?artifact_id=artifact-1",
            "docx_artifact_id": "artifact-1",
            "docx_file_name": "inspyro_document.docx",
            "docx_provenance_available": True,
            "docx_provenance_ref": "/api/docx/provenance?artifact_id=artifact-1",
            "docx_inline": False,
            "docx_store_error": None,
            "docx_size_bytes": 128,
            "docx_hash": "docx-hash",
            "docx_is_empty": False,
            "docx_warnings": None,
            "docx_error": None,
            "source_path": "C:/workspace/demo.ipynb",
            "source_kind": "notebook",
            "pdf_file_b64": None,
            "pdf_hash": "pdf-hash",
            "pdf_ref": "/api/pdf/download?token=pdf-1",
            "pdf_file_token": "pdf-1",
            "pdf_file_name": "inspyro_document.pdf",
            "pdf_inline": False,
            "pdf_store_error": None,
            "pdf_conversion_error": None,
            "pdf_attempted": True,
            "pdf_conversion_stdout": None,
            "pdf_conversion_stderr": None,
            "pdf_conversion_ms": 42,
            "pdf_size_bytes": 256,
            "converter_used": "cached",
            "word_error": None,
        }

    monkeypatch.setattr(notebook_service, "manager", fake_manager)
    monkeypatch.setattr(notebook_service, "_execute_docx_export", _fake_execute_docx_export)

    await notebook_service._recover_docx_and_emit_updates_background(
        kernel_id="kernel-1",
        websocket=object(),
        execution_id="exec-late",
        timeout_s=30,
    )

    payload_types = [payload["type"] for payload in fake_manager.messages]
    assert payload_types[0] == "notebook_progress_update"
    assert "notebook_docx_update" in payload_types
    assert "notebook_pdf_ready" in payload_types
    assert payload_types.index("notebook_docx_update") < payload_types.index("notebook_pdf_ready")
    progress_payloads = [payload for payload in fake_manager.messages if payload["type"] == "notebook_progress_update"]
    assert [payload.get("progress_stage") for payload in progress_payloads] == ["docx_export", "docx_ready", "pdf_convert"]
    assert all(payload.get("progress_scope") == "document" for payload in progress_payloads)

    docx_payload = next(payload for payload in fake_manager.messages if payload["type"] == "notebook_docx_update")
    pdf_payload = next(payload for payload in fake_manager.messages if payload["type"] == "notebook_pdf_ready")

    assert docx_payload["execution_id"] == "exec-late"
    assert docx_payload["docx_artifact_id"] == "artifact-1"
    assert pdf_payload["execution_id"] == "exec-late"
    assert pdf_payload["pdf_ref"] == "/api/pdf/download?token=pdf-1"


@pytest.mark.asyncio
async def test_process_notebook_cell_execution_forwards_execution_timeout(monkeypatch):
    observed: dict[str, float | None] = {}

    class _FakeExecutionKernelManager:
        async def execute_cell(self, *args, **kwargs):
            observed["execution_timeout"] = kwargs.get("execution_timeout")
            return [], 1, {}, {"performance_data": {}}

    async def _noop_iopub(*args, **kwargs):
        return None

    monkeypatch.setattr(notebook_service, "jupyter_kernel_manager", _FakeExecutionKernelManager())
    monkeypatch.setattr(notebook_service, "_retrieve_docx_via_stdout", lambda kernel_id: asyncio.sleep(0, result=None))

    result = await notebook_service._process_notebook_cell_execution(
        kernel_id="kernel-1",
        cell_id="cell-1",
        instrumented_code="print('x')",
        source_code="print('x')",
        enable_tracing=False,
        emit_docx=False,
        execution_timeout_s=33,
        skip_pdf=False,
        on_iopub=_noop_iopub,
        websocket=None,
        execution_id="exec-1",
    )

    assert result["type"] == "notebook_cell_executed"
    assert observed["execution_timeout"] == 33


@pytest.mark.asyncio
async def test_handle_notebook_execute_cell_applies_lock_timeout_only_to_lock_wait(monkeypatch):
    fake_manager = FakeManager()
    observed: dict[str, float | None] = {}

    async def _noop_async(*args, **kwargs):
        return None

    async def _not_cancelled(*args, **kwargs):
        return False

    async def _fake_process(**kwargs):
        observed["execution_timeout_s"] = kwargs.get("execution_timeout_s")
        await asyncio.sleep(0.05)
        return {
            "type": "notebook_cell_executed",
            "kernel_id": kwargs["kernel_id"],
            "cell_id": kwargs["cell_id"],
            "execution_id": kwargs["execution_id"],
            "execution_count": 1,
            "outputs": [],
            "variables": {},
        }

    monkeypatch.setattr(notebook_execution, "manager", fake_manager)
    monkeypatch.setattr(notebook_execution, "LOCK_TIMEOUT_S", 0.01)
    monkeypatch.setattr(notebook_execution, "_process_notebook_cell_execution", _fake_process)
    monkeypatch.setattr(notebook_execution, "_mark_execution_started", _noop_async)
    monkeypatch.setattr(notebook_execution, "_mark_execution_finished", _noop_async)
    monkeypatch.setattr(notebook_execution, "_is_execution_cancelled", _not_cancelled)
    monkeypatch.setattr(notebook_execution, "_get_kernel_lock", lambda kernel_id: asyncio.Lock())

    await notebook_execution.handle_notebook_execute_cell(
        {
            "kernel_id": "kernel-1",
            "cell_id": "cell-1",
            "source": "print('ok')",
            "execution_timeout_s": 5,
        },
        object(),
    )

    assert observed["execution_timeout_s"] == 5.0
    assert fake_manager.messages[-1]["type"] == "notebook_cell_executed"


@pytest.mark.asyncio
async def test_handle_notebook_execute_cell_normalizes_ipynb_source_arrays(monkeypatch):
    fake_manager = FakeManager()
    observed: dict[str, str | None] = {}

    async def _noop_async(*args, **kwargs):
        return None

    async def _not_cancelled(*args, **kwargs):
        return False

    def _fake_build(*, source_code, **kwargs):
        observed["instrumented_source_code"] = source_code
        return "print('instrumented')"

    async def _fake_process(**kwargs):
        observed["processed_source_code"] = kwargs.get("source_code")
        return {
            "type": "notebook_cell_executed",
            "kernel_id": kwargs["kernel_id"],
            "cell_id": kwargs["cell_id"],
            "execution_id": kwargs["execution_id"],
            "execution_count": 1,
            "outputs": [],
            "variables": {},
        }

    monkeypatch.setattr(notebook_execution, "manager", fake_manager)
    monkeypatch.setattr(notebook_execution, "_build_notebook_instrumented_code", _fake_build)
    monkeypatch.setattr(notebook_execution, "_process_notebook_cell_execution", _fake_process)
    monkeypatch.setattr(notebook_execution, "_mark_execution_started", _noop_async)
    monkeypatch.setattr(notebook_execution, "_mark_execution_finished", _noop_async)
    monkeypatch.setattr(notebook_execution, "_is_execution_cancelled", _not_cancelled)
    monkeypatch.setattr(notebook_execution, "_get_kernel_lock", lambda kernel_id: asyncio.Lock())

    await notebook_execution.handle_notebook_execute_cell(
        {
            "kernel_id": "kernel-1",
            "cell_id": "cell-1",
            "source": ["x = 1\n", "Heading('Titulo')\n"],
        },
        object(),
    )

    assert observed["instrumented_source_code"] == "x = 1\nHeading('Titulo')\n"
    assert observed["processed_source_code"] == "x = 1\nHeading('Titulo')\n"
    assert fake_manager.messages[-1]["type"] == "notebook_cell_executed"


@pytest.mark.asyncio
async def test_handle_notebook_execute_cell_uses_execution_timeout_for_kernel_lock(monkeypatch):
    fake_manager = FakeManager()
    observed: dict[str, float | None] = {}

    @asynccontextmanager
    async def _fake_timed_lock(lock, *, timeout_s=None):
        observed["lock_timeout_s"] = timeout_s
        yield

    async def _noop_async(*args, **kwargs):
        return None

    async def _not_cancelled(*args, **kwargs):
        return False

    async def _fake_process(**kwargs):
        observed["execution_timeout_s"] = kwargs.get("execution_timeout_s")
        return {
            "type": "notebook_cell_executed",
            "kernel_id": kwargs["kernel_id"],
            "cell_id": kwargs["cell_id"],
            "execution_id": kwargs["execution_id"],
            "execution_count": 1,
            "outputs": [],
            "variables": {},
        }

    monkeypatch.setattr(notebook_execution, "manager", fake_manager)
    monkeypatch.setattr(notebook_execution, "LOCK_TIMEOUT_S", 0.01)
    monkeypatch.setattr(notebook_execution, "_timed_lock", _fake_timed_lock)
    monkeypatch.setattr(notebook_execution, "_process_notebook_cell_execution", _fake_process)
    monkeypatch.setattr(notebook_execution, "_mark_execution_started", _noop_async)
    monkeypatch.setattr(notebook_execution, "_mark_execution_finished", _noop_async)
    monkeypatch.setattr(notebook_execution, "_is_execution_cancelled", _not_cancelled)
    monkeypatch.setattr(notebook_execution, "_get_kernel_lock", lambda kernel_id: object())

    await notebook_execution.handle_notebook_execute_cell(
        {
            "kernel_id": "kernel-1",
            "cell_id": "cell-1",
            "source": "print('ok')",
            "execution_timeout_s": 5,
        },
        object(),
    )

    assert observed["execution_timeout_s"] == 5.0
    assert observed["lock_timeout_s"] == 5.0
    assert fake_manager.messages[-1]["type"] == "notebook_cell_executed"


@pytest.mark.asyncio
async def test_handle_notebook_execute_cell_reports_execution_timeout(monkeypatch):
    fake_manager = FakeManager()
    interrupts: list[str] = []

    class _TimeoutKernelManager:
        async def interrupt_kernel(self, kernel_id: str) -> None:
            interrupts.append(kernel_id)

    async def _noop_async(*args, **kwargs):
        return None

    async def _fake_process(**kwargs):
        raise TimeoutError("Timeout esperando execute_reply")

    monkeypatch.setattr(notebook_execution, "manager", fake_manager)
    monkeypatch.setattr(notebook_execution, "jupyter_kernel_manager", _TimeoutKernelManager())
    monkeypatch.setattr(notebook_execution, "_process_notebook_cell_execution", _fake_process)
    monkeypatch.setattr(notebook_execution, "_mark_execution_started", _noop_async)
    monkeypatch.setattr(notebook_execution, "_mark_execution_finished", _noop_async)
    monkeypatch.setattr(notebook_execution, "_get_kernel_lock", lambda kernel_id: asyncio.Lock())

    await notebook_execution.handle_notebook_execute_cell(
        {
            "kernel_id": "kernel-1",
            "cell_id": "cell-1",
            "source": "print('ok')",
            "execution_timeout_s": 12,
        },
        object(),
    )

    payload = fake_manager.messages[-1]
    assert payload["type"] == "notebook_cell_error"
    assert payload["error_code"] == "cell_execution_timeout"
    assert payload["details"]["execution_timeout_s"] == 12.0
    assert interrupts == ["kernel-1"]


@pytest.mark.asyncio
async def test_handle_notebook_execute_cell_emits_execution_keepalive(monkeypatch):
    keepalive_seen = asyncio.Event()

    class _KeepaliveManager(FakeManager):
        async def send_personal_message(self, payload: dict, websocket) -> None:
            await super().send_personal_message(payload, websocket)
            if payload.get("type") == "notebook_progress_update":
                keepalive_seen.set()

    fake_manager = _KeepaliveManager()

    async def _noop_async(*args, **kwargs):
        return None

    async def _not_cancelled(*args, **kwargs):
        return False

    async def _fake_process(**kwargs):
        await asyncio.wait_for(keepalive_seen.wait(), timeout=2)
        return {
            "type": "notebook_cell_executed",
            "kernel_id": kwargs["kernel_id"],
            "cell_id": kwargs["cell_id"],
            "execution_id": kwargs["execution_id"],
            "execution_count": 1,
            "outputs": [],
            "variables": {},
        }

    monkeypatch.setattr(notebook_execution, "manager", fake_manager)
    monkeypatch.setattr(notebook_execution, "EXECUTION_KEEPALIVE_INTERVAL_S", 0.01)
    monkeypatch.setattr(notebook_execution, "_process_notebook_cell_execution", _fake_process)
    monkeypatch.setattr(notebook_execution, "_mark_execution_started", _noop_async)
    monkeypatch.setattr(notebook_execution, "_mark_execution_finished", _noop_async)
    monkeypatch.setattr(notebook_execution, "_is_execution_cancelled", _not_cancelled)
    monkeypatch.setattr(notebook_execution, "_get_kernel_lock", lambda kernel_id: asyncio.Lock())

    await notebook_execution.handle_notebook_execute_cell(
        {
            "kernel_id": "kernel-1",
            "cell_id": "cell-1",
            "source": "print('ok')",
            "execution_id": "exec-keepalive",
        },
        object(),
    )

    payload_types = [payload["type"] for payload in fake_manager.messages]
    assert "notebook_progress_update" in payload_types
    assert payload_types[-1] == "notebook_cell_executed"
    keepalive_payload = next(payload for payload in fake_manager.messages if payload["type"] == "notebook_progress_update")
    assert keepalive_payload["execution_id"] == "exec-keepalive"
    assert keepalive_payload["message"] == "Ejecutando celda..."
    assert keepalive_payload["progress_scope"] == "execution"
    assert keepalive_payload["progress_stage"] == "cell_run"
    assert keepalive_payload["progress_status"] == "running"
    assert keepalive_payload["progress_indeterminate"] is True


@pytest.mark.asyncio
async def test_handle_notebook_execute_cell_queues_document_progress_after_terminal(monkeypatch):
    fake_manager = FakeManager()
    queued_jobs = []

    async def _noop_async(*args, **kwargs):
        return None

    async def _not_cancelled(*args, **kwargs):
        return False

    async def _fake_process(**kwargs):
        return {
            "type": "notebook_cell_executed",
            "kernel_id": kwargs["kernel_id"],
            "cell_id": kwargs["cell_id"],
            "execution_id": kwargs["execution_id"],
            "execution_count": 1,
            "outputs": [],
            "variables": {},
            "pdf_converting": True,
            "_document_job_request": notebook_service.DocumentJobRequest(
                kernel_id=kwargs["kernel_id"],
                execution_id=kwargs["execution_id"],
                reason="terminal",
                needs_pdf=True,
                source_path="C:/workspace/demo.ipynb",
                source_kind="notebook",
            ),
        }

    async def _record_queue(request, *, websocket, timeout_s=None):
        queued_jobs.append((request, websocket, timeout_s))

    monkeypatch.setattr(notebook_execution, "manager", fake_manager)
    monkeypatch.setattr(notebook_execution, "_process_notebook_cell_execution", _fake_process)
    monkeypatch.setattr(notebook_execution, "_mark_execution_started", _noop_async)
    monkeypatch.setattr(notebook_execution, "_mark_execution_finished", _noop_async)
    monkeypatch.setattr(notebook_execution, "_is_execution_cancelled", _not_cancelled)
    monkeypatch.setattr(notebook_execution, "_get_kernel_lock", lambda kernel_id: asyncio.Lock())
    monkeypatch.setattr(notebook_execution, "queue_document_pipeline_job", _record_queue)

    await notebook_execution.handle_notebook_execute_cell(
        {
            "kernel_id": "kernel-1",
            "cell_id": "cell-1",
            "source": "print('ok')",
            "execution_id": "exec-doc-progress",
        },
        object(),
    )

    payload_types = [payload["type"] for payload in fake_manager.messages]
    assert payload_types[0] == "notebook_cell_executed"
    assert payload_types == ["notebook_cell_executed"]
    assert len(queued_jobs) == 1
    queued_request, queued_websocket, queued_timeout = queued_jobs[0]
    assert queued_request.execution_id == "exec-doc-progress"
    assert queued_request.reason == "terminal"
    assert queued_websocket is not None
    assert queued_timeout == notebook_execution.NOTEBOOK_PDF_TIMEOUT_S


@pytest.mark.asyncio
async def test_queue_document_pipeline_job_latest_wins(monkeypatch):
    fake_manager = FakeManager()
    recover_calls = []

    async def _fake_recover(**kwargs):
        recover_calls.append(kwargs["execution_id"])

    monkeypatch.setattr(notebook_service, "manager", fake_manager)
    monkeypatch.setattr(notebook_service, "_recover_docx_and_emit_updates_background", _fake_recover)
    monkeypatch.setattr(notebook_service, "DOCUMENT_PIPELINE_STABILIZATION_DELAY_S", 0.01)

    notebook_service.clear_kernel_runtime_state("kernel-latest")

    try:
        await notebook_service.queue_document_pipeline_job(
            notebook_service.DocumentJobRequest(
                kernel_id="kernel-latest",
                execution_id="exec-1",
                reason="terminal",
                needs_pdf=True,
            ),
            websocket=object(),
            timeout_s=15,
        )
        await notebook_service.queue_document_pipeline_job(
            notebook_service.DocumentJobRequest(
                kernel_id="kernel-latest",
                execution_id="exec-2",
                reason="terminal",
                needs_pdf=True,
            ),
            websocket=object(),
            timeout_s=15,
        )

        await asyncio.sleep(0.08)
    finally:
        notebook_service.clear_kernel_runtime_state("kernel-latest")

    assert recover_calls == ["exec-2"]


@pytest.mark.asyncio
async def test_notebook_create_load_save_and_force_reconvert_echo_request_id(monkeypatch):
    fake_manager = FakeManager()
    fake_kernel_manager = FakeKernelManager()

    monkeypatch.setattr(notebook_execution, "manager", fake_manager)
    monkeypatch.setattr(notebook_execution, "jupyter_kernel_manager", fake_kernel_manager)
    monkeypatch.setattr(notebook_execution, "_bind_kernel_for_current_connection", lambda websocket, kernel_id: asyncio.sleep(0))
    monkeypatch.setattr(notebook_execution, "_shutdown_kernel_resources", lambda kernel_id: asyncio.sleep(0))

    await notebook_execution.handle_notebook_create({"request_id": "req-create", "path": "."}, object())
    await notebook_execution.handle_notebook_load(
        {
            "request_id": "req-load",
            "path": str(Path("demo.ipynb").resolve()),
            "content": {"cells": [], "metadata": {}, "nbformat": 4, "nbformat_minor": 5},
        },
        object(),
    )
    await notebook_execution.handle_notebook_save(
        {
            "request_id": "req-save",
            "notebook": {"cells": [], "metadata": {}, "nbformat": 4, "nbformat_minor": 5},
        },
        object(),
    )

    monkeypatch.setattr(notebook_execution, "build_pdf_context", lambda *args: ({"attempted": True}, "cGRm", "pdf-hash", None))
    notebook_execution.notebook_last_docx_b64["kernel-1"] = "ZG9jeA=="
    notebook_execution.notebook_docx_hash["kernel-1"] = "docx-hash"
    await notebook_execution.handle_force_reconvert_pdf(
        {"request_id": "req-pdf", "kernel_id": "kernel-1"},
        object(),
    )

    request_ids = {message["request_id"] for message in fake_manager.messages if "request_id" in message}
    assert {"req-create", "req-load", "req-save", "req-pdf"}.issubset(request_ids)


@pytest.mark.asyncio
async def test_handle_notebook_save_normalizes_ipynb_source_arrays(monkeypatch):
    fake_manager = FakeManager()
    monkeypatch.setattr(notebook_execution, "manager", fake_manager)

    await notebook_execution.handle_notebook_save(
        {
            "request_id": "req-save-lines",
            "notebook": {
                "cells": [
                    {
                        "id": "cell-1",
                        "cell_type": "code",
                        "source": ["x = 1\n", "Heading('Titulo')\n"],
                        "outputs": [],
                        "execution_count": None,
                        "metadata": {},
                    }
                ],
                "metadata": {},
                "nbformat": 4,
                "nbformat_minor": 5,
            },
        },
        object(),
    )

    payload = next(message for message in fake_manager.messages if message.get("type") == "notebook_saved")
    saved = json.loads(payload["content"])
    assert saved["cells"][0]["source"] == ["x = 1\n", "Heading('Titulo')\n"]


@pytest.mark.asyncio
async def test_force_reconvert_pdf_restores_docx_from_artifact_store(monkeypatch, tmp_path: Path):
    fake_manager = FakeManager()
    docx_path = tmp_path / "artifact.docx"
    docx_bytes = b"docx-restored"
    docx_path.write_bytes(docx_bytes)

    monkeypatch.setattr(notebook_execution, "manager", fake_manager)
    monkeypatch.setattr(
        notebook_execution,
        "build_pdf_context",
        lambda *args: ({"attempted": True}, "cGRm", "pdf-hash", None),
    )
    monkeypatch.setattr(
        notebook_execution,
        "get_latest_docx_artifact",
        lambda **kwargs: {"path": str(docx_path), "docx_hash": "docx-hash"},
    )
    monkeypatch.setattr(
        notebook_execution,
        "get_kernel_docx_source",
        lambda kernel_id: {"source_path": str(tmp_path / "report.ipynb"), "source_kind": "notebook"},
    )

    notebook_execution.notebook_last_docx_b64.pop("kernel-restore", None)
    notebook_execution.notebook_docx_hash.pop("kernel-restore", None)

    await notebook_execution.handle_force_reconvert_pdf(
        {"request_id": "req-restore", "kernel_id": "kernel-restore"},
        object(),
    )

    assert notebook_execution.notebook_last_docx_b64["kernel-restore"] == base64.b64encode(docx_bytes).decode("ascii")
    assert notebook_execution.notebook_docx_hash["kernel-restore"] == "docx-hash"
    assert fake_manager.messages[-1]["status"] == "ok"
    assert fake_manager.messages[-1]["request_id"] == "req-restore"


@pytest.mark.asyncio
async def test_kernel_control_handlers_echo_request_id(monkeypatch):
    fake_manager = FakeManager()
    fake_kernel_manager = FakeKernelManager()

    monkeypatch.setattr(notebook_kernel_control, "manager", fake_manager)
    monkeypatch.setattr(notebook_kernel_control, "jupyter_kernel_manager", fake_kernel_manager)
    monkeypatch.setattr(notebook_kernel_control, "_clear_execution_state", lambda kernel_id: asyncio.sleep(0))
    monkeypatch.setattr(notebook_kernel_control, "_cancel_kernel_execution", lambda kernel_id, execution_id=None: asyncio.sleep(0, result=execution_id))
    monkeypatch.setattr(notebook_kernel_control, "_shutdown_kernel_resources", lambda kernel_id: asyncio.sleep(0))
    monkeypatch.setattr(notebook_kernel_control, "_untrack_kernel_for_connection", lambda websocket, kernel_id: asyncio.sleep(0))
    monkeypatch.setattr(notebook_kernel_control.template_storage, "get_template_docx_path", lambda kernel_id: None)

    await notebook_kernel_control.handle_notebook_reset_kernel(
        {"request_id": "req-reset", "kernel_id": "kernel-1"},
        object(),
    )
    await notebook_kernel_control.handle_notebook_interrupt_kernel(
        {"request_id": "req-interrupt", "kernel_id": "kernel-1"},
        object(),
    )
    await notebook_kernel_control.handle_notebook_shutdown_kernel(
        {"request_id": "req-shutdown", "kernel_id": "kernel-1"},
        object(),
    )

    assert [message["request_id"] for message in fake_manager.messages] == [
        "req-reset",
        "req-interrupt",
        "req-shutdown",
    ]


@pytest.mark.asyncio
async def test_reset_kernel_falls_back_to_hard_reset_on_timeout(monkeypatch):
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")
    state = McpSessionState.get()
    state.register_notebook("kernel-1", notebook_path)
    state.set_kernel_state("kernel-1", "running", notebook_path=notebook_path, execution_id="exec-reset-1")

    fake_bridge = FakeBridge()

    async def fake_ws_request(msg_type: str, data: dict, **kwargs) -> dict:
        if msg_type == "notebook_reset_kernel":
            raise TimeoutError("soft reset timed out")
        if msg_type == "notebook_load":
            return {
                "type": "notebook_loaded",
                "kernel_id": "kernel-2",
                "notebook": data["content"],
            }
        raise AssertionError(f"Unexpected WS request type: {msg_type}")

    async def fake_read_notebook(bridge, path):
        return {"cells": [], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    fake_bridge.ws_request = fake_ws_request  # type: ignore[method-assign]
    monkeypatch.setattr(notebook, "_read_notebook", fake_read_notebook)

    result = await notebook.reset_kernel("kernel-1")

    assert result["status"] == "reset"
    assert result["hard"] is True
    assert result["kernel_id"] == "kernel-2"
    assert os.path.normcase(state.get_notebook_path("kernel-2") or "") == os.path.normcase(notebook_path)


@pytest.mark.asyncio
async def test_shutdown_kernel_clears_execution_history_and_cancels_tasks(monkeypatch):
    notebook_path = os.path.abspath("C:/workspace/demo.ipynb")
    state = McpSessionState.get()
    state.register_notebook("kernel-1", notebook_path)
    state.upsert_execution(
        "exec-shutdown-1",
        {
            "execution_id": "exec-shutdown-1",
            "kernel_id": "kernel-1",
            "notebook_path": notebook_path,
            "status": "running",
        },
    )

    async def _pending_execution() -> dict:
        await asyncio.sleep(60)
        return {"status": "completed"}

    pending_execution_task = asyncio.create_task(_pending_execution())
    notebook._track_execution_task("exec-shutdown-1", pending_execution_task)
    pending_late_task = asyncio.create_task(asyncio.sleep(60))
    notebook._track_background_task(pending_late_task, kernel_id="kernel-1")

    fake_bridge = FakeBridge(ws_response={"type": "notebook_kernel_shutdown"})
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await notebook.shutdown_kernel("kernel-1")

    assert result["status"] == "shutdown"
    assert state.get_execution("exec-shutdown-1") is None
    assert state.get_notebook_path("kernel-1") is None
    assert pending_execution_task.cancelled() is True
    assert pending_late_task.cancelled() is True


@pytest.mark.asyncio
async def test_upload_template_uses_multipart_and_template_token(monkeypatch, tmp_path):
    template_path = tmp_path / "demo.docx"
    template_path.write_bytes(b"docx-bytes")
    fake_bridge = FakeBridge(
        ws_response={
            "type": "template_uploaded",
            "kernel_id": "kernel-1",
            "template_token": "template-123",
            "template": {"styles": ["Normal"]},
        }
    )
    monkeypatch.setattr(templates.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await templates.upload_template("kernel-1", str(template_path))

    assert result["status"] == "attached"
    assert any(path == "/api/templates/upload" for path, _ in fake_bridge.rest_calls)
    assert any(msg_type == "template_attach" for msg_type, _, _ in fake_bridge.ws_calls)
    assert any(
        data.get("template_token") == "template-123"
        for msg_type, data, _ in fake_bridge.ws_calls
        if msg_type == "template_attach"
    )


@pytest.mark.asyncio
async def test_analysis_tools_use_symbol_first_contract(monkeypatch):
    fake_bridge = FakeBridge(
        ws_response={
            "type": "dependency_analysis_result",
            "symbol": "sigma",
            "graph": {"nodes": [{"name": "sigma"}], "edges": [], "analysis_mode": "dependencies"},
        }
    )
    monkeypatch.setattr(analysis.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await analysis.analyze_dependencies(symbol="sigma", kernel_id="kernel-1")

    assert result["status"] == "ok"
    assert result["nodes"][0]["name"] == "sigma"
    assert fake_bridge.ws_calls[0][1] == {"symbol": "sigma", "kernel_id": "kernel-1"}


@pytest.mark.asyncio
async def test_list_files_defaults_to_active_workspace(monkeypatch, tmp_path):
    fake_bridge = FakeBridge(
        rest_response={
            "active_workspace": str(tmp_path),
            "workspace_path": str(tmp_path),
            "workspace_root": str(tmp_path),
        }
    )

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {
                "active_workspace": str(tmp_path),
                "workspace_path": str(tmp_path),
                "workspace_root": str(tmp_path),
            }
        if path == "/api/files/tree":
            return {"path": params["path"], "children": []}
        raise AssertionError(f"Unexpected REST GET path: {path}")

    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(files.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await files.list_files()
    tree_calls = [call for call in fake_bridge.rest_calls if call[0] == "/api/files/tree"]

    assert result["path"] == str(tmp_path.resolve())
    assert tree_calls[-1] == (
        "/api/files/tree",
        {"path": str(tmp_path.resolve()), "depth": 3},
    )


@pytest.mark.asyncio
async def test_file_tools_resolve_relative_paths_inside_active_workspace(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    fake_bridge = FakeBridge()

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {
                "active_workspace": str(workspace_root),
                "workspace_path": str(workspace_root),
                "workspace_root": str(workspace_root),
            }
        if path == "/api/files/read":
            return {"content": "demo", "path": params["path"]}
        raise AssertionError(f"Unexpected REST GET path: {path}")

    async def fake_rest_post(path: str, *, json_data: dict) -> dict:
        fake_bridge.rest_calls.append((path, json_data))
        return {"status": "ok", "path": json_data.get("path")}

    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    fake_bridge.rest_post = fake_rest_post  # type: ignore[method-assign]
    monkeypatch.setattr(files.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    read_result = await files.read_file("reports\\beam.md")
    await files.create_file("reports\\probe.py")
    await files.rename_file("reports\\probe.py", "probe_renamed.py")

    expected_read_path = str((workspace_root / "reports" / "beam.md").resolve())
    expected_created_path = str((workspace_root / "reports").resolve())
    expected_old_path = str((workspace_root / "reports" / "probe.py").resolve())
    expected_new_name = "probe_renamed.py"
    relevant_calls = [
        call for call in fake_bridge.rest_calls
        if call[0] in {"/api/files/read", "/api/files/create", "/api/files/rename"}
    ]

    assert read_result["path"] == expected_read_path
    assert ("/api/files/read", {"path": expected_read_path}) in relevant_calls
    assert (
        "/api/files/create",
        {"path": expected_created_path, "name": "probe.py", "type": "file"},
    ) in relevant_calls
    assert (
        "/api/files/rename",
        {"oldPath": expected_old_path, "newName": expected_new_name},
    ) in relevant_calls


@pytest.mark.asyncio
async def test_file_tools_allow_notebook_paths(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    fake_bridge = FakeBridge()

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {
                "active_workspace": str(workspace_root),
                "workspace_path": str(workspace_root),
                "workspace_root": str(workspace_root),
            }
        if path == "/api/files/read":
            return {"content": '{"cells": [], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}', "path": params["path"]}
        raise AssertionError(f"Unexpected REST GET path: {path}")

    async def fake_rest_post(path: str, *, json_data: dict) -> dict:
        fake_bridge.rest_calls.append((path, json_data))
        return {"status": "ok", "path": json_data.get("path")}

    async def fake_rest_delete(path: str, *, params: dict) -> dict:
        fake_bridge.rest_calls.append((path, params))
        return {"status": "ok", "path": params.get("path")}

    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    fake_bridge.rest_post = fake_rest_post  # type: ignore[method-assign]
    fake_bridge.rest_delete = fake_rest_delete  # type: ignore[method-assign]
    monkeypatch.setattr(files.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    read_result = await files.read_file("reports\\beam.ipynb")
    await files.write_file("reports\\beam.ipynb", '{"cells": []}')
    await files.create_file("reports\\probe.ipynb")
    await files.rename_file("reports\\probe.ipynb", "probe_renamed.ipynb")
    await files.delete_file("reports\\beam.ipynb")

    expected_read_path = str((workspace_root / "reports" / "beam.ipynb").resolve())
    expected_create_parent = str((workspace_root / "reports").resolve())
    expected_old_path = str((workspace_root / "reports" / "probe.ipynb").resolve())
    relevant_calls = [
        call for call in fake_bridge.rest_calls
        if call[0] in {"/api/files/read", "/api/files/write", "/api/files/create", "/api/files/rename", "/api/files/delete"}
    ]

    assert read_result["path"] == expected_read_path
    assert ("/api/files/read", {"path": expected_read_path}) in relevant_calls
    assert ("/api/files/write", {"path": expected_read_path, "content": '{"cells": []}'}) in relevant_calls
    assert ("/api/files/create", {"path": expected_create_parent, "name": "probe.ipynb", "type": "file"}) in relevant_calls
    assert ("/api/files/rename", {"oldPath": expected_old_path, "newName": "probe_renamed.ipynb"}) in relevant_calls
    assert ("/api/files/delete", {"path": expected_read_path}) in relevant_calls


def test_notebook_source_to_text_preserves_line_boundaries():
    assert notebook._source_to_text(["# heading", "print('ok')"]) == "# heading\nprint('ok')"
    assert notebook._source_to_text(["x = 1\n", "print(x)"]) == "x = 1\nprint(x)"


@pytest.mark.asyncio
async def test_execute_cell_request_auto_enables_docx_for_doc_api_sources():
    fake_bridge = FakeBridge(
        ws_multi_response=[
            {
                "type": "notebook_cell_executed",
                "execution_count": 1,
                "outputs": [],
            }
        ]
    )

    _, execution_result = await notebook._execute_cell_request(
        fake_bridge,
        kernel_id="kernel-1",
        cell_id="cell-1",
        source="doc_reset()\nwith build_doc(order=1) as doc:\n    doc.text('hello')",
        timeout=5,
    )

    assert execution_result["status"] == "executed"
    assert fake_bridge.ws_calls[0][1]["emit_docx"] is True


@pytest.mark.asyncio
async def test_execute_cell_request_propagates_backend_execution_timeout():
    fake_bridge = FakeBridge(
        ws_multi_response=[
            {
                "type": "notebook_cell_executed",
                "execution_count": 1,
                "outputs": [],
            }
        ]
    )

    _, execution_result = await notebook._execute_cell_request(
        fake_bridge,
        kernel_id="kernel-1",
        cell_id="cell-1",
        source="print('ok')",
        timeout=42,
    )

    assert execution_result["status"] == "executed"
    assert fake_bridge.ws_calls[0][1]["execution_timeout_s"] == 42.0
    assert fake_bridge.ws_calls[0][2]["timeout"] == 47


def test_build_execution_error_maps_backend_execution_timeout_to_backend_timeout():
    error_payload = notebook._build_execution_error(
        {
            "error_code": "cell_execution_timeout",
            "message": "Cell execution timed out after 60.0s",
        },
        operation="execute_cell",
    )

    assert error_payload["code"] == "BACKEND_EXECUTION_TIMEOUT"
    assert error_payload["retryable"] is True


def test_build_execution_error_maps_keyboard_interrupt_to_cancelled():
    error_payload = notebook._build_execution_error(
        {
            "error_code": "notebook_execute_cell_failed",
            "message": "KeyboardInterrupt",
        },
        operation="execute_cell",
    )

    assert error_payload["code"] == "EXECUTION_CANCELLED"
    assert error_payload["retryable"] is True


def test_notebook_tool_timeouts_default_to_600_seconds():
    assert notebook_execution.NOTEBOOK_EXECUTION_TIMEOUT_S == 600.0
    assert notebook_service.NOTEBOOK_PDF_TIMEOUT_S == 600
    assert inspect.signature(notebook.execute_cell).parameters["timeout"].default == 600
    assert inspect.signature(notebook.execute_all_cells).parameters["timeout_per_cell"].default == 600
    assert inspect.signature(notebook.execute_cells).parameters["timeout_per_cell"].default == 600
    assert inspect.signature(notebook.execute_until).parameters["timeout_per_cell"].default == 600
    assert inspect.signature(notebook.execute_all_cells).parameters["background"].default is False


@pytest.mark.asyncio
async def test_execute_cell_records_inline_artifacts_even_without_backend_kernel_id(monkeypatch):
    class _BridgeStub:
        def register_execution_observer(self, execution_id: str):
            queue: asyncio.Queue = asyncio.Queue()
            return queue, lambda: None

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: _BridgeStub()))

    async def fake_execute_cell_request(*args, **kwargs):
        return [], {
            "status": "executed",
            "has_error": False,
            "raw": {
                "type": "notebook_cell_executed",
                "execution_id": "exec-inline",
                "docx_file_b64": "ZG9jeA==",
                "docx_hash": "docx-hash",
            },
        }

    monkeypatch.setattr(notebook, "_execute_cell_request", fake_execute_cell_request)

    result = await notebook.execute_cell(
        kernel_id="kernel-1",
        cell_id="cell-1",
        source="with build_doc(order=1) as doc:\n    doc.text('x')",
    )

    artifacts = notebook._SESSION_STATE.get_artifacts(kernel_id="kernel-1", execution_id="exec-inline")
    assert result["status"] == "executed"
    assert artifacts is not None
    assert artifacts["kernel_id"] == "kernel-1"
    assert artifacts["docx_file_b64"] == "ZG9jeA=="


@pytest.mark.asyncio
async def test_notebook_load_defaults_to_lightweight_cells(monkeypatch, tmp_path: Path):
    notebook_payload = {
        "cells": [
            {
                "id": "cell-1",
                "cell_type": "code",
                "source": "print('hola')",
                "metadata": {},
                "outputs": [{"output_type": "stream", "name": "stdout", "text": "hola\n"}],
                "execution_count": 1,
            }
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    fake_bridge = FakeBridge(
        rest_response={"content": notebook_payload},
        ws_response={"type": "notebook_loaded", "kernel_id": "kernel-1", "notebook": notebook_payload},
    )
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await notebook.notebook_load(str(tmp_path / "demo.ipynb"))

    assert result["status"] == "loaded"
    assert result["kernel_session"] == "created"
    assert result["reused_kernel"] is False
    cell = result["cells"][0]
    assert cell["id"] == "cell-1"
    assert "source_preview" in cell
    assert "source" not in cell
    assert "outputs" not in cell
    assert cell["has_outputs"] is True
    assert cell["last_execution_count"] == 1


@pytest.mark.asyncio
async def test_notebook_load_strips_runtime_state_before_kernel_load(monkeypatch, tmp_path: Path):
    notebook_payload = {
        "cells": [
            {
                "id": "cell-1",
                "cell_type": "code",
                "source": "print('hola')",
                "metadata": {"execution_duration_ms": 123, "inspyro_id": "cell-1"},
                "outputs": [{"output_type": "stream", "name": "stdout", "text": "hola\n"}],
                "execution_count": 1,
            }
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    class _LoadEchoBridge(FakeBridge):
        async def ws_request(self, msg_type: str, data: dict, **kwargs) -> dict:
            self.ws_calls.append((msg_type, data, kwargs))
            return {"type": "notebook_loaded", "kernel_id": "kernel-1", "notebook": data["content"]}

    fake_bridge = _LoadEchoBridge(rest_response={"content": notebook_payload})
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await notebook.notebook_load(str(tmp_path / "demo.ipynb"))

    ws_payload = fake_bridge.ws_calls[0][1]["content"]
    assert ws_payload["cells"][0]["outputs"] == []
    assert ws_payload["cells"][0]["execution_count"] is None
    assert "execution_duration_ms" not in ws_payload["cells"][0]["metadata"]
    assert result["cells"][0]["has_outputs"] is True
    assert result["cells"][0]["last_execution_count"] == 1


@pytest.mark.asyncio
async def test_notebook_create_accepts_cells_and_replaces_seed_cells(monkeypatch, tmp_path: Path):
    seeded_notebook = {
        "cells": [
            {
                "id": "welcome-cell",
                "cell_type": "code",
                "source": "print('hola')",
                "metadata": {},
                "outputs": [],
                "execution_count": None,
            }
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    fake_bridge = FakeBridge(
        ws_response={"type": "notebook_created", "kernel_id": "kernel-1", "notebook": seeded_notebook},
    )
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await notebook.notebook_create(
        str(tmp_path),
        name="created.ipynb",
        cells=[
            {"cell_type": "markdown", "source": "# Intro"},
            {"cell_type": "code", "source": "x = 1\nprint(x)"},
        ],
    )

    write_call = next(call for call in fake_bridge.rest_calls if call[0] == "/api/files/write")
    written_payload = write_call[1]["content"]

    assert result["status"] == "created"
    assert result["cell_count"] == 2
    assert result["sync_summary"]["deleted_cell_ids"] == ["welcome-cell"]
    assert [cell["cell_type"] for cell in written_payload["cells"]] == ["markdown", "code"]
    assert all(str(cell.get("id") or "").strip() for cell in written_payload["cells"])


@pytest.mark.asyncio
async def test_get_cell_list_cells_and_find_in_notebook(monkeypatch, tmp_path: Path):
    notebook_payload = {
        "cells": [
            {
                "id": "code-1",
                "cell_type": "code",
                "source": "alpha = 1\nbeta = alpha + 1",
                "metadata": {},
                "outputs": [{"output_type": "stream", "name": "stdout", "text": "2\n"}],
                "execution_count": 3,
            },
            {
                "id": "md-1",
                "cell_type": "markdown",
                "source": "Gamma heading",
                "metadata": {},
            },
            {
                "id": "code-2",
                "cell_type": "code",
                "source": "delta = 4",
                "metadata": {},
                "outputs": [],
                "execution_count": None,
            },
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    fake_bridge = FakeBridge(rest_response={"content": notebook_payload})
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    notebook_path = str(tmp_path / "demo.ipynb")

    listed = await notebook.list_cells(
        notebook_path,
        pattern="alpha",
        type="code",
        executed_only=True,
    )
    fetched = await notebook.get_cell(notebook_path, "code-1", include_source=True, include_outputs=True)
    plain_matches = await notebook.find_in_notebook(notebook_path, "gamma")
    regex_matches = await notebook.find_in_notebook(notebook_path, r"alpha\s*=\s*1", regex=True)

    assert listed["cell_count"] == 1
    assert listed["cells"][0]["id"] == "code-1"
    assert fetched["cell"]["source"] == "alpha = 1\nbeta = alpha + 1"
    assert fetched["cell"]["outputs"][0]["type"] == "stream"
    assert plain_matches["match_count"] == 1
    assert plain_matches["matches"][0]["cell_id"] == "md-1"
    assert regex_matches["match_count"] == 1
    assert regex_matches["matches"][0]["cell_id"] == "code-1"


@pytest.mark.asyncio
async def test_notebook_sync_cells_reorders_updates_and_drops_omitted_cells(monkeypatch, tmp_path: Path):
    notebook_payload = {
        "cells": [
            {
                "id": "code-1",
                "cell_type": "code",
                "source": "alpha = 1",
                "metadata": {},
                "outputs": [{"output_type": "stream", "name": "stdout", "text": "1\n"}],
                "execution_count": 3,
            },
            {
                "id": "md-1",
                "cell_type": "markdown",
                "source": "Gamma heading",
                "metadata": {},
            },
            {
                "id": "code-2",
                "cell_type": "code",
                "source": "delta = 4",
                "metadata": {},
                "outputs": [{"output_type": "stream", "name": "stdout", "text": "4\n"}],
                "execution_count": 8,
            },
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    fake_bridge = FakeBridge(rest_response={"content": notebook_payload})
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    notebook_path = str(tmp_path / "demo.ipynb")
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    result = await notebook.notebook_sync_cells(
        notebook_path,
        [
            {"cell_id": "code-2", "cell_type": "code", "source": "delta = 5"},
            {"cell_id": "md-1", "cell_type": "markdown", "source": "Gamma heading updated"},
            {"cell_type": "code", "source": "epsilon = 6"},
        ],
    )

    write_call = next(call for call in fake_bridge.rest_calls if call[0] == "/api/files/write")
    written_cells = write_call[1]["content"]["cells"]

    assert result["status"] == "synced"
    assert result["kernel_id"] == "kernel-1"
    assert [cell["id"] for cell in written_cells[:2]] == ["code-2", "md-1"]
    assert result["deleted_cell_ids"] == ["code-1"]
    assert result["modified_cell_ids"] == ["code-2", "md-1"]
    assert result["reused_cell_ids"] == ["code-2", "md-1"]
    assert len(result["created_cell_ids"]) == 1
    assert written_cells[0]["outputs"] == []
    assert written_cells[0]["execution_count"] is None
    assert written_cells[2]["source"] == "epsilon = 6"
    assert str(written_cells[2]["id"]).strip()


@pytest.mark.asyncio
async def test_notebook_sync_cells_persists_docx_as_nbformat_safe_code_cell(monkeypatch, tmp_path: Path):
    notebook_payload = {
        "cells": [],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    fake_bridge = FakeBridge(rest_response={"content": notebook_payload})
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    notebook_path = str(tmp_path / "docx-safe.ipynb")

    result = await notebook.notebook_sync_cells(
        notebook_path,
        [
            {
                "cell_id": "docx-1",
                "cell_type": "docx",
                "source": "with build_doc() as doc:\n    doc.text('A')",
            }
        ],
    )

    write_call = next(call for call in fake_bridge.rest_calls if call[0] == "/api/files/write")
    written_payload = write_call[1]["content"]
    written_cell = written_payload["cells"][0]

    assert result["cells"][0]["type"] == "docx"
    assert written_cell["cell_type"] == "code"
    assert written_cell["metadata"]["inspyro"]["cell_kind"] == "docx"

    nbformat = pytest.importorskip("nbformat")
    nbformat.validate(nbformat.from_dict(written_payload))


def test_docx_source_detector_avoids_pandas_dataframe_false_positive():
    assert notebook._should_emit_docx("import pandas as pd\ndf = pd.DataFrame({'a': [1]})") is False
    assert notebook._should_emit_docx("df = DataFrame({'a': [1]})") is False
    assert notebook._should_emit_docx("with build_doc(order=1) as doc:\n    doc.dataframe(df)") is True
    assert notebook._should_emit_docx("quality = doc_finalize(profile='delivery')") is True


@pytest.mark.asyncio
async def test_notebook_sync_cells_keeps_session_scoped_kernel_for_source_resolution(monkeypatch, tmp_path: Path):
    notebook_payload = {
        "cells": [
            {
                "id": "cell-1",
                "cell_type": "code",
                "source": "print('persisted')",
                "metadata": {},
                "outputs": [],
                "execution_count": None,
            }
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    fake_bridge = FakeBridge(rest_response={"content": notebook_payload})
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls, *args, **kwargs: fake_bridge))
    monkeypatch.setattr(notebook, "resolve_session_id", lambda session_id=None: session_id or "session-a")
    notebook_path = str(tmp_path / "session-scoped.ipynb")
    McpSessionState.get().register_notebook("kernel-session", notebook_path, session_id="session-a")

    result = await notebook.notebook_sync_cells(
        notebook_path,
        [{"cell_id": "cell-1", "cell_type": "code", "source": "print('persisted')"}],
    )
    source_text, cell_type = await notebook._resolve_cell_source_and_type(
        fake_bridge,
        kernel_id="kernel-session",
        cell_id="cell-1",
        source=None,
        session_id="session-a",
    )

    assert result["kernel_id"] == "kernel-session"
    assert source_text == "print('persisted')"
    assert cell_type == "code"


@pytest.mark.asyncio
async def test_find_in_notebook_resolves_relative_path_against_workspace(monkeypatch, tmp_path: Path):
    workspace = tmp_path / "workspace"
    notebook_file = workspace / "notebooks" / "demo.ipynb"
    notebook_file.parent.mkdir(parents=True)
    notebook_payload = {
        "cells": [{"id": "cell-1", "cell_type": "markdown", "source": "Gamma", "metadata": {}}],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    class WorkspaceBridge(FakeBridge):
        async def rest_get(self, path: str, *, params: dict | None = None) -> dict:
            self.rest_calls.append((path, params or {}))
            if path == "/api/system/info":
                return {"workspace_path": str(workspace)}
            if path == "/api/files/read":
                assert params == {"path": str(notebook_file.resolve())}
                return {"content": notebook_payload}
            return {}

    fake_bridge = WorkspaceBridge()
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls, *args, **kwargs: fake_bridge))

    result = await notebook.find_in_notebook("notebooks/demo.ipynb", "Gamma")

    assert result["status"] == "ok"
    assert result["path"] == str(notebook_file.resolve())
    assert result["match_count"] == 1


@pytest.mark.asyncio
async def test_create_kernel_and_attach_kernel_register_local_state(monkeypatch, tmp_path: Path):
    notebook_payload = {"cells": [{"id": "cell-1", "cell_type": "code", "source": "x = 1"}], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}
    notebook_path = str(tmp_path / "demo.ipynb")

    class _KernelBridge(FakeBridge):
        async def rest_get(self, path: str, *, params: dict | None = None) -> dict:
            if path == "/api/system/info":
                return {"workspace_path": str(tmp_path), "workspace_root": str(tmp_path)}
            if path == "/api/files/read":
                return {"content": notebook_payload}
            return await super().rest_get(path, params=params)

        async def ws_request(self, msg_type: str, data: dict, **kwargs) -> dict:
            self.ws_calls.append((msg_type, data, kwargs))
            if msg_type == "notebook_create":
                return {"type": "notebook_created", "kernel_id": "kernel-7", "notebook": notebook_payload}
            raise AssertionError(f"Unexpected ws_request: {msg_type}")

    fake_bridge = _KernelBridge()
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    created = await notebook.create_kernel(notebook_path)
    attached = await notebook.attach_kernel(created["kernel_id"], notebook_path)
    status = await notebook.kernel_status(created["kernel_id"])

    assert created["status"] == "created"
    assert created["kernel_id"] == "kernel-7"
    assert attached["status"] == "attached"
    assert attached["path"] == str(Path(notebook_path).resolve())
    assert status["state"] == "idle"
    assert os.path.normcase(McpSessionState.get().get_notebook_path("kernel-7") or "") == os.path.normcase(
        str(Path(notebook_path).resolve())
    )


@pytest.mark.asyncio
async def test_get_kernel_status_public_alias(monkeypatch, tmp_path: Path):
    notebook_path = str((tmp_path / "demo.ipynb").resolve())
    state = McpSessionState.get()
    state.register_notebook("kernel-1", notebook_path)
    state.set_kernel_state("kernel-1", "idle", notebook_path=notebook_path, execution_id="run-1")

    status = await notebook.get_kernel_status("kernel-1")

    assert status["status"] == "ok"
    assert status["kernel_id"] == "kernel-1"
    assert status["state"] == "idle"
    assert status["last_execution_id"] == "run-1"


@pytest.mark.asyncio
async def test_execute_cell_uses_persisted_source_when_source_is_omitted(monkeypatch, tmp_path: Path):
    notebook_payload = {
        "cells": [
            {
                "id": "cell-1",
                "cell_type": "code",
                "source": "print('persisted')",
                "metadata": {},
                "outputs": [],
                "execution_count": None,
            }
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    fake_bridge = FakeBridge(
        rest_response={"content": notebook_payload},
        ws_multi_response=[
            {
                "type": "notebook_cell_executed",
                "execution_count": 1,
                "outputs": [],
                "variables": {},
                "kernel_id": "kernel-1",
                "cell_id": "cell-1",
            }
        ],
    )
    notebook_path = str(tmp_path / "demo.ipynb")
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    result = await notebook.execute_cell("kernel-1", "cell-1")

    assert result["status"] == "executed"
    assert fake_bridge.ws_calls[0][1]["source"] == "print('persisted')"


@pytest.mark.asyncio
async def test_execute_cell_recovers_from_terminal_after_ws_disconnect(monkeypatch):
    class _DisconnectAfterTerminalBridge(FakeBridge):
        async def ws_request_multi(self, msg_type: str, data: dict, **kwargs) -> list[dict]:
            self.ws_calls.append((msg_type, data, kwargs))
            execution_id = str(data.get("execution_id") or "")
            McpSessionState.get().record_runtime_message(
                {
                    "type": "notebook_cell_executed",
                    "kernel_id": "kernel-1",
                    "cell_id": "cell-1",
                    "execution_id": execution_id,
                    "execution_count": 7,
                    "outputs": [{"output_type": "stream", "name": "stdout", "text": "ok\n"}],
                    "variables": {"x": {"type": "int", "repr": "1"}},
                    "docx_ref": "/api/docx/download?token=docx-terminal",
                    "docx_file_token": "docx-terminal",
                }
            )
            raise ConnectionError("WebSocket desconectado mientras se esperaba stream notebook_execute_cell")

    fake_bridge = _DisconnectAfterTerminalBridge()
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await notebook.execute_cell("kernel-1", "cell-1", source="print('ok')")
    status = await notebook.execution_status(result["execution_id"])

    assert result["status"] == "executed"
    assert result["recovered_after_disconnect"] is True
    assert result["recovery_reason"] == "terminal_after_ws_disconnect"
    assert result["error"] is None
    assert status["execution_status"] == "completed"
    assert status["recovered_after_disconnect"] is True
    assert status["cells"][0]["recovered_after_disconnect"] is True
    assert status["cells"][0]["recovery_reason"] == "terminal_after_ws_disconnect"


@pytest.mark.asyncio
async def test_execute_cell_recovers_from_exact_artifact_after_ws_disconnect(monkeypatch):
    class _DisconnectAfterArtifactBridge(FakeBridge):
        async def ws_request_multi(self, msg_type: str, data: dict, **kwargs) -> list[dict]:
            self.ws_calls.append((msg_type, data, kwargs))
            execution_id = str(data.get("execution_id") or "")
            McpSessionState.get().record_artifacts(
                {
                    "type": "notebook_docx_update",
                    "kernel_id": "kernel-1",
                    "cell_id": "cell-1",
                    "execution_id": execution_id,
                    "docx_file_token": "docx-recovered",
                    "docx_ref": "/api/docx/download?token=docx-recovered",
                    "docx_hash": "docx-recovered-hash",
                }
            )
            raise ConnectionError("WebSocket desconectado mientras se esperaba stream notebook_execute_cell")

    fake_bridge = _DisconnectAfterArtifactBridge()
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await notebook.execute_cell("kernel-1", "cell-1", source="builder.text('ok')")
    status = await notebook.execution_status(result["execution_id"])

    assert result["status"] == "executed"
    assert result["recovered_after_disconnect"] is True
    assert result["recovery_reason"] == "artifact_after_ws_disconnect"
    assert result["outputs_degraded"] is True
    assert result["variables_degraded"] is True
    assert result["error"] is None
    assert any(
        artifact.get("kind") == "docx" and artifact.get("token") == "docx-recovered"
        for artifact in (result.get("artifacts") or [])
    )
    assert status["execution_status"] == "completed"
    assert status["recovered_after_disconnect"] is True
    assert status["cells"][0]["recovery_reason"] == "artifact_after_ws_disconnect"
    assert status["cells"][0]["outputs_degraded"] is True
    assert status["cells"][0]["variables_degraded"] is True


@pytest.mark.asyncio
async def test_execute_cell_disconnect_without_evidence_keeps_kernel_state_error(monkeypatch):
    class _DisconnectWithoutEvidenceBridge(FakeBridge):
        async def ws_request_multi(self, msg_type: str, data: dict, **kwargs) -> list[dict]:
            self.ws_calls.append((msg_type, data, kwargs))
            raise ConnectionError("WebSocket desconectado mientras se esperaba stream notebook_execute_cell")

    fake_bridge = _DisconnectWithoutEvidenceBridge()
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await notebook.execute_cell("kernel-1", "cell-1", source="x = 1", timeout=1)
    status = await notebook.execution_status(result["execution_id"])

    assert result["status"] == "error"
    assert result["error"]["code"] == "KERNEL_STATE_ERROR"
    assert "recovered_after_disconnect" not in result
    assert status["execution_status"] == "failed"
    assert status["error"]["code"] == "KERNEL_STATE_ERROR"


@pytest.mark.asyncio
async def test_execute_all_cells_continues_after_recovered_disconnect(monkeypatch, tmp_path: Path):
    notebook_payload = {
        "cells": [
            {"id": "cell-1", "cell_type": "code", "source": "builder.text('one')", "outputs": [], "execution_count": None},
            {"id": "cell-2", "cell_type": "code", "source": "builder.text('two')", "outputs": [], "execution_count": None},
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    notebook_path = str((tmp_path / "batch-recovery.ipynb").resolve())

    class _BatchRecoveryBridge(FakeBridge):
        def __init__(self) -> None:
            super().__init__()
            self._notebook_payload = json.loads(json.dumps(notebook_payload))

        async def rest_get(self, path: str, *, params: dict | None = None) -> dict:
            self.rest_calls.append((path, params or {}))
            if path == "/api/files/read":
                return {"content": self._notebook_payload}
            return self.rest_response

        async def rest_post(self, path: str, *, json_data: dict) -> dict:
            self.rest_calls.append((path, json_data))
            if path == "/api/files/write" and isinstance(json_data.get("content"), dict):
                self._notebook_payload = json.loads(json.dumps(json_data["content"]))
                return {"status": "ok"}
            return self.rest_response

        async def ws_request_multi(self, msg_type: str, data: dict, **kwargs) -> list[dict]:
            self.ws_calls.append((msg_type, data, kwargs))
            execution_id = str(data.get("execution_id") or "")
            cell_id = str(data.get("cell_id") or "")
            if cell_id == "cell-1":
                McpSessionState.get().record_artifacts(
                    {
                        "type": "notebook_docx_update",
                        "kernel_id": "kernel-1",
                        "cell_id": cell_id,
                        "execution_id": execution_id,
                        "docx_file_token": "docx-batch-recovered",
                        "docx_ref": "/api/docx/download?token=docx-batch-recovered",
                        "docx_hash": "docx-batch-recovered-hash",
                    }
                )
                raise ConnectionError("WebSocket desconectado mientras se esperaba stream notebook_execute_cell")
            return [
                {
                    "type": "notebook_cell_executed",
                    "kernel_id": "kernel-1",
                    "cell_id": cell_id,
                    "execution_id": execution_id,
                    "execution_count": 2,
                    "outputs": [],
                    "variables": {},
                }
            ]

    fake_bridge = _BatchRecoveryBridge()
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    result = await notebook.execute_all_cells("kernel-1", notebook_path)
    status = await notebook.execution_status(result["execution_id"])

    assert result["status"] == "completed"
    assert result["failed"] == 0
    assert status["execution_status"] == "completed"
    first_cell = next(cell for cell in status["cells"] if cell["cell_id"] == "cell-1")
    second_cell = next(cell for cell in status["cells"] if cell["cell_id"] == "cell-2")
    assert first_cell["status"] == "completed"
    assert first_cell["recovered_after_disconnect"] is True
    assert first_cell["recovery_reason"] == "artifact_after_ws_disconnect"
    assert second_cell["status"] == "completed"


@pytest.mark.asyncio
async def test_execute_all_cells_background_exposes_run_status_and_preview(monkeypatch, tmp_path: Path):
    notebook_payload = {
        "cells": [
            {"id": "cell-1", "cell_type": "code", "source": "print('alpha')", "outputs": [], "execution_count": None},
            {"id": "cell-2", "cell_type": "code", "source": "beta = 2", "outputs": [], "execution_count": None},
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    notebook_path = str((tmp_path / "background.ipynb").resolve())

    class _BackgroundBridge(FakeBridge):
        def __init__(self) -> None:
            super().__init__()
            self._notebook_payload = json.loads(json.dumps(notebook_payload))

        async def rest_get(self, path: str, *, params: dict | None = None) -> dict:
            self.rest_calls.append((path, params or {}))
            if path == "/api/files/read":
                return {"content": self._notebook_payload}
            return self.rest_response

        async def rest_post(self, path: str, *, json_data: dict) -> dict:
            self.rest_calls.append((path, json_data))
            if path == "/api/files/write" and isinstance(json_data.get("content"), dict):
                self._notebook_payload = json.loads(json.dumps(json_data["content"]))
                return {"status": "ok"}
            return self.rest_response

        async def ws_request_multi(self, msg_type: str, data: dict, **kwargs) -> list[dict]:
            self.ws_calls.append((msg_type, data, kwargs))
            messages = [
                {
                    "type": "notebook_stream",
                    "execution_id": data["execution_id"],
                    "cell_id": data["cell_id"],
                    "kernel_id": data["kernel_id"],
                    "content": {"text": "stream\\n", "name": "stdout"},
                },
                {
                    "type": "notebook_cell_executed",
                    "execution_id": data["execution_id"],
                    "cell_id": data["cell_id"],
                    "kernel_id": data["kernel_id"],
                    "execution_count": 1,
                    "outputs": [],
                    "variables": {},
                },
            ]
            on_message = kwargs.get("on_message")
            if on_message is not None:
                for message in messages:
                    callback_result = on_message(message)
                    if asyncio.iscoroutine(callback_result):
                        await callback_result
            execution_id = data.get("execution_id")
            if execution_id:
                for queue in list(self.execution_observers.get(execution_id, [])):
                    for message in messages:
                        queue.put_nowait(message)
            return messages

    fake_bridge = _BackgroundBridge()
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    started = await notebook.execute_all_cells("kernel-1", notebook_path, background=True)
    await _wait_until(
        lambda: (McpSessionState.get().get_execution(started["run_id"]) or {}).get("status") == "completed"
    )
    status = await notebook.get_run_status(started["run_id"])

    assert started["status"] == "started"
    assert started["run_id"] == started["execution_id"]
    assert status["status"] == "ok"
    assert status["run_id"] == started["run_id"]
    assert status["execution_status"] == "completed"
    assert status["last_output_preview"] == "stream\\n"
    assert status["completed_cells"] == 2


@pytest.mark.asyncio
async def test_list_session_notebooks_and_close_session_notebook(monkeypatch, tmp_path: Path):
    notebook_path = str((tmp_path / "session.ipynb").resolve())
    other_notebook_path = str((tmp_path / "other.ipynb").resolve())
    state = McpSessionState.get()
    state.register_notebook("kernel-1", notebook_path)
    state.register_notebook("kernel-2", other_notebook_path)
    state.set_kernel_state("kernel-1", "running", notebook_path=notebook_path, execution_id="exec-1")
    state.set_kernel_state("kernel-2", "idle", notebook_path=other_notebook_path, execution_id="exec-2")

    fake_bridge = FakeBridge(ws_response={"type": "notebook_kernel_shutdown"})
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    listed = await notebook.list_session_notebooks()
    closed = await notebook.close_session_notebook("kernel-1")
    listed_after = await notebook.list_session_notebooks()

    assert listed["status"] == "ok"
    assert listed["notebook_count"] == 2
    assert {entry["kernel_id"] for entry in listed["notebooks"]} == {"kernel-1", "kernel-2"}
    assert closed["status"] == "closed"
    assert closed["shutdown_status"] == "shutdown"
    assert closed["kernel_id"] == "kernel-1"
    assert state.get_notebook_path("kernel-1") is None
    assert listed_after["notebook_count"] == 1
    assert listed_after["notebooks"][0]["kernel_id"] == "kernel-2"


@pytest.mark.asyncio
async def test_mcp_stateless_http_warns_or_rejects_notebook_session_workflow(monkeypatch, tmp_path: Path):
    mcp_config.set_runtime_transport(transport="streamable-http", stateless_http=True)
    fake_bridge = FakeBridge()
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    listed = await notebook.list_session_notebooks()

    with pytest.raises(BridgeError) as exc_info:
        await notebook.notebook_load(str(tmp_path / "demo.ipynb"))

    assert listed["status"] == "stateless"
    assert listed["notebook_sessions_supported"] is False
    assert "stateless-http" in listed["warning"]
    assert exc_info.value.payload["code"] == "NOTEBOOK_SESSION_REQUIRES_STATEFUL_MCP"
    assert exc_info.value.payload["mcp_stateless_http"] is True
    assert exc_info.value.payload["notebook_session_mode"] == "stateless-http"


@pytest.mark.asyncio
async def test_mcp_same_session_multiple_notebooks_parallel(monkeypatch, tmp_path: Path):
    notebook_a_path = str((tmp_path / "a.ipynb").resolve())
    notebook_b_path = str((tmp_path / "b.ipynb").resolve())
    notebook_a_payload = {
        "cells": [
            {"id": "cell-a", "cell_type": "code", "source": "print('a')", "outputs": [], "execution_count": None},
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    notebook_b_payload = {
        "cells": [
            {"id": "cell-b", "cell_type": "code", "source": "print('b')", "outputs": [], "execution_count": None},
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    class _ParallelBridge(FakeBridge):
        def __init__(self) -> None:
            super().__init__()
            self._notebooks = {
                notebook_a_path: json.loads(json.dumps(notebook_a_payload)),
                notebook_b_path: json.loads(json.dumps(notebook_b_payload)),
            }
            self.started: list[tuple[str, str]] = []
            self.active = 0
            self.max_active = 0
            self._counter_lock = asyncio.Lock()
            self.started_event = asyncio.Event()
            self.release_event = asyncio.Event()

        async def rest_get(self, path: str, *, params: dict | None = None) -> dict:
            self.rest_calls.append((path, params or {}))
            if path == "/api/files/read":
                return {"content": self._notebooks[str(Path(str(params["path"])).resolve())]}
            return self.rest_response

        async def rest_post(self, path: str, *, json_data: dict) -> dict:
            self.rest_calls.append((path, json_data))
            if path == "/api/files/write" and isinstance(json_data.get("content"), dict):
                self._notebooks[str(Path(str(json_data["path"])).resolve())] = json.loads(json.dumps(json_data["content"]))
                return {"status": "ok"}
            return self.rest_response

        async def ws_request_multi(self, msg_type: str, data: dict, **kwargs) -> list[dict]:
            self.ws_calls.append((msg_type, data, kwargs))
            async with self._counter_lock:
                self.started.append((str(data["kernel_id"]), str(data["execution_id"])))
                self.active += 1
                self.max_active = max(self.max_active, self.active)
                if len(self.started) >= 2:
                    self.started_event.set()
            await self.release_event.wait()
            messages = [
                {
                    "type": "notebook_stream",
                    "execution_id": data["execution_id"],
                    "cell_id": data["cell_id"],
                    "kernel_id": data["kernel_id"],
                    "content": {"text": f"{data['kernel_id']}\\n", "name": "stdout"},
                },
                {
                    "type": "notebook_cell_executed",
                    "execution_id": data["execution_id"],
                    "cell_id": data["cell_id"],
                    "kernel_id": data["kernel_id"],
                    "execution_count": 1,
                    "outputs": [],
                    "variables": {},
                },
            ]
            on_message = kwargs.get("on_message")
            if on_message is not None:
                for message in messages:
                    callback_result = on_message(message)
                    if asyncio.iscoroutine(callback_result):
                        await callback_result
            for queue in list(self.execution_observers.get(str(data["execution_id"]), [])):
                for message in messages:
                    queue.put_nowait(message)
            async with self._counter_lock:
                self.active -= 1
            return messages

    fake_bridge = _ParallelBridge()
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    McpSessionState.get().register_notebook("kernel-a", notebook_a_path)
    McpSessionState.get().register_notebook("kernel-b", notebook_b_path)

    started_a = await notebook.execute_all_cells("kernel-a", notebook_a_path, background=True)
    started_b = await notebook.execute_all_cells("kernel-b", notebook_b_path, background=True)
    await _wait_until(lambda: fake_bridge.started_event.is_set())
    fake_bridge.release_event.set()
    await _wait_until(
        lambda: (McpSessionState.get().get_execution(started_a["run_id"]) or {}).get("status") == "completed"
        and (McpSessionState.get().get_execution(started_b["run_id"]) or {}).get("status") == "completed"
    )
    status_a = await notebook.get_run_status(started_a["run_id"])
    status_b = await notebook.get_run_status(started_b["run_id"])

    assert fake_bridge.max_active >= 2
    assert {kernel_id for kernel_id, _execution_id in fake_bridge.started} == {"kernel-a", "kernel-b"}
    assert status_a["execution_status"] == "completed"
    assert status_b["execution_status"] == "completed"
    assert status_a["last_output_preview"] == "kernel-a\\n"
    assert status_b["last_output_preview"] == "kernel-b\\n"


@pytest.mark.asyncio
async def test_mcp_same_kernel_serializes_parallel_execs(monkeypatch, tmp_path: Path):
    notebook_path = str((tmp_path / "serial.ipynb").resolve())
    notebook_payload = {
        "cells": [
            {"id": "cell-1", "cell_type": "code", "source": "print('serial')", "outputs": [], "execution_count": None},
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    class _SerialBridge(FakeBridge):
        def __init__(self) -> None:
            super().__init__()
            self._notebook_payload = json.loads(json.dumps(notebook_payload))
            self.entered: list[str] = []
            self.active = 0
            self.max_active = 0
            self.first_entered = asyncio.Event()
            self.release_first = asyncio.Event()
            self._counter_lock = asyncio.Lock()

        async def rest_get(self, path: str, *, params: dict | None = None) -> dict:
            self.rest_calls.append((path, params or {}))
            if path == "/api/files/read":
                return {"content": self._notebook_payload}
            return self.rest_response

        async def rest_post(self, path: str, *, json_data: dict) -> dict:
            self.rest_calls.append((path, json_data))
            if path == "/api/files/write" and isinstance(json_data.get("content"), dict):
                self._notebook_payload = json.loads(json.dumps(json_data["content"]))
                return {"status": "ok"}
            return self.rest_response

        async def ws_request_multi(self, msg_type: str, data: dict, **kwargs) -> list[dict]:
            self.ws_calls.append((msg_type, data, kwargs))
            async with self._counter_lock:
                self.entered.append(str(data["execution_id"]))
                self.active += 1
                self.max_active = max(self.max_active, self.active)
                if len(self.entered) == 1:
                    self.first_entered.set()
            if len(self.entered) == 1:
                await self.release_first.wait()
            messages = [
                {
                    "type": "notebook_stream",
                    "execution_id": data["execution_id"],
                    "cell_id": data["cell_id"],
                    "kernel_id": data["kernel_id"],
                    "content": {"text": f"{data['execution_id']}\\n", "name": "stdout"},
                },
                {
                    "type": "notebook_cell_executed",
                    "execution_id": data["execution_id"],
                    "cell_id": data["cell_id"],
                    "kernel_id": data["kernel_id"],
                    "execution_count": 1,
                    "outputs": [],
                    "variables": {},
                },
            ]
            on_message = kwargs.get("on_message")
            if on_message is not None:
                for message in messages:
                    callback_result = on_message(message)
                    if asyncio.iscoroutine(callback_result):
                        await callback_result
            for queue in list(self.execution_observers.get(str(data["execution_id"]), [])):
                for message in messages:
                    queue.put_nowait(message)
            async with self._counter_lock:
                self.active -= 1
            return messages

    fake_bridge = _SerialBridge()
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    started_a = await notebook.execute_all_cells("kernel-1", notebook_path, background=True)
    started_b = await notebook.execute_all_cells("kernel-1", notebook_path, background=True)
    await _wait_until(lambda: fake_bridge.first_entered.is_set())
    await asyncio.sleep(0.1)
    assert len(fake_bridge.entered) == 1
    fake_bridge.release_first.set()
    await _wait_until(
        lambda: (McpSessionState.get().get_execution(started_a["run_id"]) or {}).get("status") == "completed"
        and (McpSessionState.get().get_execution(started_b["run_id"]) or {}).get("status") == "completed"
    )

    assert fake_bridge.max_active == 1
    assert len(fake_bridge.entered) == 2


@pytest.mark.asyncio
async def test_cancel_run_cancels_active_background_batch(monkeypatch, tmp_path: Path):
    notebook_payload = {
        "cells": [
            {"id": "cell-1", "cell_type": "code", "source": "print('alpha')", "outputs": [], "execution_count": None},
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    notebook_path = str((tmp_path / "cancel.ipynb").resolve())

    class _CancellableBridge(FakeBridge):
        def __init__(self) -> None:
            super().__init__()
            self._notebook_payload = json.loads(json.dumps(notebook_payload))
            self._blocked = asyncio.Event()

        async def rest_get(self, path: str, *, params: dict | None = None) -> dict:
            self.rest_calls.append((path, params or {}))
            if path == "/api/files/read":
                return {"content": self._notebook_payload}
            return self.rest_response

        async def rest_post(self, path: str, *, json_data: dict) -> dict:
            self.rest_calls.append((path, json_data))
            if path == "/api/files/write" and isinstance(json_data.get("content"), dict):
                self._notebook_payload = json.loads(json.dumps(json_data["content"]))
                return {"status": "ok"}
            return self.rest_response

        async def ws_request(self, msg_type: str, data: dict, **kwargs) -> dict:
            self.ws_calls.append((msg_type, data, kwargs))
            if msg_type == "notebook_cancel_execution":
                return {
                    "type": "notebook_execution_cancelled",
                    "kernel_id": data["kernel_id"],
                    "execution_id": data.get("execution_id"),
                    "cancelled": True,
                }
            return self.ws_response

        async def ws_request_multi(self, msg_type: str, data: dict, **kwargs) -> list[dict]:
            self.ws_calls.append((msg_type, data, kwargs))
            await self._blocked.wait()
            return []

    fake_bridge = _CancellableBridge()
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    started = await notebook.execute_all_cells("kernel-1", notebook_path, background=True)
    await _wait_until(
        lambda: (McpSessionState.get().get_execution(started["run_id"]) or {}).get("current_child_execution_id") is not None
    )
    cancelled = await notebook.cancel_run(started["run_id"])
    await _wait_until(
        lambda: (McpSessionState.get().get_execution(started["run_id"]) or {}).get("status") == "cancelled"
    )

    cancel_call = next(call for call in fake_bridge.ws_calls if call[0] == "notebook_cancel_execution")
    assert cancelled["status"] == "cancelled"
    assert cancelled["run_id"] == started["run_id"]
    assert cancel_call[1]["execution_id"].startswith("mcp_exec_")
    assert cancel_call[1]["execution_id"] != started["run_id"]


@pytest.mark.asyncio
async def test_resume_run_reuses_pending_or_failed_cells(monkeypatch, tmp_path: Path):
    notebook_path = str((tmp_path / "resume.ipynb").resolve())
    state = McpSessionState.get()
    state.register_notebook("kernel-1", notebook_path)
    state.upsert_execution(
        "run-old",
        {
            "execution_id": "run-old",
            "kernel_id": "kernel-1",
            "notebook_path": notebook_path,
            "status": "failed",
            "selected_cell_ids": ["cell-1", "cell-2", "cell-3"],
            "failed_cell_ids": ["cell-2"],
            "cell_statuses": {
                "cell-1": {"status": "completed", "order": 0},
                "cell-2": {"status": "failed", "order": 1},
            },
        },
    )
    state.set_kernel_state("kernel-1", "idle", notebook_path=notebook_path, execution_id="run-old")
    observed: list[dict[str, Any]] = []

    async def _fake_execute_cells(**kwargs):
        observed.append(kwargs)
        return {
            "status": "started",
            "run_id": "run-new",
            "execution_id": "run-new",
            "path": kwargs["notebook_path"],
            "kernel_id": kwargs["kernel_id"],
            "total_cells": len(kwargs["cell_ids"]),
        }

    monkeypatch.setattr(notebook, "execute_cells", _fake_execute_cells)

    resumed_pending = await notebook.resume_run("run-old")
    resumed_failed = await notebook.resume_run("run-old", retry_failed=True)

    assert resumed_pending["status"] == "started"
    assert resumed_pending["resumed_from_run_id"] == "run-old"
    assert resumed_pending["resumable_cell_ids"] == ["cell-3"]
    assert observed[0]["cell_ids"] == ["cell-3"]
    assert observed[0]["background"] is True
    assert observed[0]["stop_on_error"] is False

    assert resumed_failed["resumable_cell_ids"] == ["cell-2", "cell-3"]
    assert observed[1]["cell_ids"] == ["cell-2", "cell-3"]


@pytest.mark.asyncio
async def test_reset_kernel_falls_back_to_hard_reload(monkeypatch, tmp_path: Path):
    notebook_payload = {"cells": [{"id": "cell-1", "cell_type": "code", "source": "x = 1"}], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}
    notebook_path = str((tmp_path / "demo.ipynb").resolve())

    class _ResetBridge(FakeBridge):
        async def ws_request(self, msg_type: str, data: dict, **kwargs) -> dict:
            self.ws_calls.append((msg_type, data, kwargs))
            if msg_type == "notebook_reset_kernel":
                raise BridgeError(
                    "threads can only be started once",
                    payload={
                        "type": "mcp_notebook_error",
                        "error_code": "notebook_reset_kernel_failed",
                        "message": "threads can only be started once",
                    },
                )
            if msg_type == "notebook_load":
                return {"type": "notebook_loaded", "kernel_id": "kernel-2", "notebook": notebook_payload}
            raise AssertionError(f"Unexpected ws_request: {msg_type}")

    fake_bridge = _ResetBridge(rest_response={"content": notebook_payload})
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    result = await notebook.reset_kernel("kernel-1")

    assert result["status"] == "reset"
    assert result["hard"] is True
    assert result["previous_kernel_id"] == "kernel-1"
    assert result["kernel_id"] == "kernel-2"
    assert McpSessionState.get().get_notebook_path("kernel-1") is None
    assert os.path.normcase(McpSessionState.get().get_notebook_path("kernel-2") or "") == os.path.normcase(
        notebook_path
    )
    load_payload = next(
        data
        for msg_type, data, _kwargs in fake_bridge.ws_calls
        if msg_type == "notebook_load"
    )
    assert load_payload["content"]["cells"][0]["source"] == "x = 1"
    assert load_payload["content"]["cells"][0]["outputs"] == []
    assert load_payload["content"]["cells"][0]["execution_count"] is None


@pytest.mark.asyncio
async def test_hard_reset_retries_notebook_load_without_previous_kernel_after_timeout(monkeypatch, tmp_path: Path):
    notebook_payload = {"cells": [{"id": "cell-1", "cell_type": "code", "source": "x = 1"}], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}
    notebook_path = str((tmp_path / "demo.ipynb").resolve())

    class _RetryResetBridge(FakeBridge):
        async def ws_request(self, msg_type: str, data: dict, **kwargs) -> dict:
            self.ws_calls.append((msg_type, data, kwargs))
            if msg_type == "notebook_load" and data.get("previous_kernel_id"):
                raise TimeoutError("load timed out while recycling previous kernel")
            if msg_type == "notebook_load":
                return {"type": "notebook_loaded", "kernel_id": "kernel-2", "notebook": notebook_payload}
            raise AssertionError(f"Unexpected ws_request: {msg_type}")

    fake_bridge = _RetryResetBridge(rest_response={"content": notebook_payload})
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    McpSessionState.get().register_notebook("kernel-1", notebook_path)

    result = await notebook._hard_reset_kernel_session(
        fake_bridge,
        kernel_id="kernel-1",
        notebook_path=notebook_path,
    )

    load_payloads = [
        data
        for msg_type, data, _kwargs in fake_bridge.ws_calls
        if msg_type == "notebook_load"
    ]

    assert result["status"] == "reset"
    assert result["kernel_id"] == "kernel-2"
    assert len(load_payloads) == 2
    assert load_payloads[0]["previous_kernel_id"] == "kernel-1"
    assert "previous_kernel_id" not in load_payloads[1]


@pytest.mark.asyncio
async def test_relay_late_execution_messages_forwards_docx_update_before_pdf(monkeypatch):
    emitted_runtime: list[str] = []
    emitted_artifacts: list[str] = []
    unregister_calls: list[str] = []

    async def _fake_emit_runtime(message, *, resource):
        emitted_runtime.append(message["type"])

    async def _fake_emit_artifacts(message, *, resource):
        emitted_artifacts.append(message["type"])

    monkeypatch.setattr(notebook, "emit_notebook_runtime_message", _fake_emit_runtime)
    monkeypatch.setattr(notebook, "_emit_artifact_updates", _fake_emit_artifacts)

    queue: asyncio.Queue[dict[str, str]] = asyncio.Queue()
    queue.put_nowait({"type": "notebook_cell_executed", "execution_id": "exec-1"})
    queue.put_nowait({"type": "notebook_docx_update", "execution_id": "exec-1"})
    queue.put_nowait({"type": "notebook_pdf_ready", "execution_id": "exec-1"})

    await notebook._relay_late_execution_messages(
        queue=queue,
        unregister=lambda: unregister_calls.append("done"),
        resource={"path": "C:/workspace/demo.ipynb"},
        timeout=1,
    )

    assert emitted_runtime == ["notebook_docx_update", "notebook_pdf_ready"]
    assert emitted_artifacts == ["notebook_docx_update", "notebook_pdf_ready"]
    assert unregister_calls == ["done"]


@pytest.mark.asyncio
async def test_relay_late_execution_messages_records_late_artifacts(monkeypatch):
    state = notebook._SESSION_STATE
    state.clear()

    async def _fake_emit_runtime(message, *, resource):
        return None

    async def _fake_emit_artifacts(message, *, resource):
        return None

    monkeypatch.setattr(notebook, "emit_notebook_runtime_message", _fake_emit_runtime)
    monkeypatch.setattr(notebook, "_emit_artifact_updates", _fake_emit_artifacts)

    queue: asyncio.Queue[dict[str, str]] = asyncio.Queue()
    queue.put_nowait({"type": "notebook_cell_executed", "execution_id": "exec-2"})
    queue.put_nowait({
        "type": "notebook_docx_update",
        "execution_id": "exec-2",
        "docx_ref": "/api/docx/download?token=docx-2",
        "docx_file_token": "docx-2",
    })
    queue.put_nowait({
        "type": "notebook_pdf_ready",
        "execution_id": "exec-2",
        "pdf_ref": "/api/pdf/download?token=pdf-2",
        "pdf_file_token": "pdf-2",
    })

    await notebook._relay_late_execution_messages(
        queue=queue,
        unregister=lambda: None,
        resource={"kernel_id": "kernel-2", "cell_id": "cell-2", "execution_id": "exec-2"},
        timeout=1,
    )

    recorded = state.get_artifacts(kernel_id="kernel-2", execution_id="exec-2")
    assert recorded is not None
    assert recorded["docx_ref"] == "/api/docx/download?token=docx-2"
    assert recorded["pdf_ref"] == "/api/pdf/download?token=pdf-2"


@pytest.mark.asyncio
async def test_relay_late_execution_messages_records_late_artifacts_in_explicit_session(monkeypatch):
    state = notebook._SESSION_STATE
    state.clear()
    notebook_path = os.path.abspath("C:/workspace/session-late.ipynb")
    state.register_notebook("kernel-3", notebook_path, session_id="session-late")
    state.set_kernel_state(
        "kernel-3",
        "running",
        notebook_path=notebook_path,
        execution_id="batch-late",
        session_id="session-late",
    )
    state.register_artifact_alias(
        "kernel-3",
        execution_id="child-late",
        alias_execution_id="batch-late",
        session_id="session-late",
    )

    async def _fake_emit_runtime(message, *, resource):
        return None

    async def _fake_emit_artifacts(message, *, resource):
        return None

    monkeypatch.setattr(notebook, "emit_notebook_runtime_message", _fake_emit_runtime)
    monkeypatch.setattr(notebook, "_emit_artifact_updates", _fake_emit_artifacts)

    queue: asyncio.Queue[dict[str, str]] = asyncio.Queue()
    queue.put_nowait({"type": "notebook_cell_executed", "execution_id": "child-late"})
    queue.put_nowait(
        {
            "type": "notebook_docx_update",
            "execution_id": "child-late",
            "docx_ref": "/api/docx/download?token=docx-session",
            "docx_file_token": "docx-session",
        }
    )
    queue.put_nowait(
        {
            "type": "notebook_pdf_ready",
            "execution_id": "child-late",
            "pdf_ref": "/api/pdf/download?token=pdf-session",
            "pdf_file_token": "pdf-session",
        }
    )

    await notebook._relay_late_execution_messages(
        queue=queue,
        unregister=lambda: None,
        resource={"kernel_id": "kernel-3", "cell_id": "cell-3", "execution_id": "batch-late"},
        timeout=1,
        session_id="session-late",
    )

    session_artifacts = state.get_artifacts(
        kernel_id="kernel-3",
        execution_id="batch-late",
        session_id="session-late",
    )

    assert session_artifacts is not None
    assert session_artifacts["docx_file_token"] == "docx-session"
    assert session_artifacts["pdf_file_token"] == "pdf-session"
    assert state.get_artifacts(kernel_id="kernel-3", execution_id="batch-late") is None


@pytest.mark.asyncio
async def test_get_variables_filters_runtime_by_default(monkeypatch):
    async def fake_execute_cell_request(*args, **kwargs):
        return [], {
            "status": "executed",
            "has_error": False,
            "variables": {
                "x": {"repr": "1"},
                "__DOCX_RUNTIME": {"repr": "hidden"},
            },
            "raw": {"type": "notebook_cell_executed"},
        }

    monkeypatch.setattr(notebook, "_execute_cell_request", fake_execute_cell_request)
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: object()))

    filtered = await notebook.get_variables("kernel-1", "cell-1")
    unfiltered = await notebook.get_variables("kernel-1", "cell-1", include_runtime=True)

    assert "x" in filtered["variables"]
    assert "__DOCX_RUNTIME" not in filtered["variables"]
    assert "__DOCX_RUNTIME" in unfiltered["variables"]


@pytest.mark.asyncio
async def test_get_variables_prioritizes_public_variables_when_runtime_is_included(monkeypatch):
    runtime_noise = {
        f"_runtime_{index:03d}": {"repr": f"noise-{index}"}
        for index in range(260)
    }
    runtime_noise["analysis_formulas"] = {"type": "dict", "value": "{1 elementos}", "data": {"m": "w*l**2/8"}}
    runtime_noise["analysis_current_values"] = {"type": "dict", "value": "{1 elementos}", "data": {"w": 10.0}}

    async def fake_execute_cell_request(*args, **kwargs):
        return [], {
            "status": "executed",
            "has_error": False,
            "variables": runtime_noise,
            "raw": {"type": "notebook_cell_executed"},
        }

    monkeypatch.setattr(notebook, "_execute_cell_request", fake_execute_cell_request)
    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: object()))

    result = await notebook.get_variables("kernel-1", "cell-1", include_runtime=True)

    assert "analysis_formulas" in result["variables"]
    assert "analysis_current_values" in result["variables"]
    assert result["variables"]["analysis_formulas"]["data"] == {"m": "w*l**2/8"}
    assert "__meta__" in result["variables"]


@pytest.mark.asyncio
async def test_check_units_compatible_matches_aliases_from_backend(monkeypatch):
    fake_bridge = FakeBridge(
        rest_response={
            "dimension": "[length] * [mass] / [time] ** 2",
            "compatible": [
                {
                    "canonical": "lbf",
                    "display": "lbf",
                    "pint": "force_pound",
                    "pint_symbol": "lbf",
                    "aliases": ["lbf", "force_pound"],
                }
            ],
        }
    )
    monkeypatch.setattr(units.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await units.check_units_compatible("N", "force_pound")

    assert result["compatible"] is True
    assert any(path == "/api/units/compatible" for path, _ in fake_bridge.rest_calls)


@pytest.mark.asyncio
async def test_document_tools_are_link_first_by_default(monkeypatch):
    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-1",
            "docx_file_token": "docx-1",
            "docx_ref": "/api/docx/download?token=docx-1",
            "docx_file_name": "report.docx",
            "docx_hash": "docx-hash",
            "docx_size_bytes": 1234,
        }
    )
    fake_bridge = FakeBridge()
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await documents.get_document_docx("kernel-1", execution_id="exec-1")

    assert result["status"] == "ok"
    assert result["token"] == "docx-1"
    assert result["resource_uri"] == "inspyro://artifacts/kernel-1/docx/exec-1"
    assert result["portable_resource_uri"] == "inspyro://artifacts/token/docx/docx-1"
    assert result["resource_scope"] == "portable"
    assert result["filename"] == "report.docx"
    assert result["inline_content"] is False
    assert "docx_base64" not in result


@pytest.mark.asyncio
async def test_document_tools_support_docx_artifact_id_only_handles(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    export_dir = workspace_root / "exports"
    export_dir.mkdir()

    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-artifact",
            "docx_artifact_id": "artifact-1",
            "docx_download_url": "/api/docx/download?artifact_id=artifact-1",
            "docx_file_name": "report.docx",
            "docx_hash": "docx-hash",
            "docx_size_bytes": 1234,
        }
    )
    fake_bridge = FakeBridge()
    download_calls: list[tuple[str, dict]] = []

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {
                "active_workspace": str(workspace_root),
                "workspace_path": str(workspace_root),
                "workspace_root": str(workspace_root),
            }
        return {}

    async def fake_rest_get_bytes(path: str, *, params: dict | None = None) -> bytes:
        download_calls.append((path, params or {}))
        if path == "/api/docx/download":
            assert params == {"artifact_id": "artifact-1"}
            return base64.b64decode("ZG9jeA==")
        raise AssertionError(f"Unexpected REST GET BYTES path: {path}")

    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    fake_bridge.rest_get_bytes = fake_rest_get_bytes  # type: ignore[method-assign]
    monkeypatch.setattr(documents.file_tools, "list_root_paths", lambda: asyncio.sleep(0, result=[str(workspace_root)]))

    result = await documents.get_document_docx("kernel-1", execution_id="exec-artifact", inline_content=True)
    export_result = await documents.export_document_docx("kernel-1", path="exports\\artifact-report.docx")

    exported_path = export_dir / "artifact-report.docx"
    assert result["status"] == "ok"
    assert result["token"] is None
    assert result["ref"] == "/api/docx/download?artifact_id=artifact-1"
    assert result["portable_resource_uri"] is None
    assert result["resource_scope"] == "session"
    assert result["inline_content"] is True
    assert result["docx_base64"] == "ZG9jeA=="
    assert export_result["status"] == "ok"
    assert export_result["token"] is None
    assert export_result["ref"] == "/api/docx/download?artifact_id=artifact-1"
    assert export_result["portable_resource_uri"] is None
    assert exported_path.read_bytes() == b"docx"
    assert download_calls == [
        ("/api/docx/download", {"artifact_id": "artifact-1"}),
        ("/api/docx/download", {"artifact_id": "artifact-1"}),
    ]


@pytest.mark.asyncio
async def test_execute_all_cells_registers_batch_artifacts_for_document_lookup(monkeypatch):
    notebook_path = os.path.abspath("C:/workspace/batch.ipynb")
    fake_bridge = FakeBridge(
        ws_multi_response=[
            {
                "type": "notebook_cell_executed",
                "kernel_id": "kernel-1",
                "cell_id": "cell-1",
                "execution_id": "child-exec-1",
                "execution_count": 1,
                "outputs": [],
                "docx_file_token": "docx-batch-1",
                "docx_ref": "/api/docx/download?token=docx-batch-1",
                "docx_file_name": "batch.docx",
                "docx_hash": "docx-batch-hash",
                "docx_size_bytes": 4,
            }
        ]
    )

    async def fake_read_notebook(bridge, path):
        return {
            "cells": [
                {"id": "cell-1", "cell_type": "code", "source": "with build_doc(order=1) as doc:\n    doc.text('x')", "outputs": []}
            ],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        }

    async def fake_rest_get_bytes(path: str, *, params: dict | None = None) -> bytes:
        if path == "/api/docx/download":
            assert params == {"token": "docx-batch-1"}
            return b"docx"
        raise AssertionError(f"Unexpected REST GET BYTES path: {path}")

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    monkeypatch.setattr(notebook, "_read_notebook", fake_read_notebook)
    fake_bridge.rest_get_bytes = fake_rest_get_bytes  # type: ignore[method-assign]

    batch_result = await notebook.execute_all_cells("kernel-1", notebook_path)
    docx_result = await documents.get_document_docx(
        "kernel-1",
        execution_id=batch_result["execution_id"],
        inline_content=True,
    )

    assert batch_result["status"] == "completed"
    assert batch_result["child_execution_id"] == "child-exec-1"
    assert docx_result["status"] == "ok"
    assert docx_result["token"] == "docx-batch-1"
    assert docx_result["docx_base64"] == "ZG9jeA=="


@pytest.mark.asyncio
async def test_execute_all_cells_registers_late_batch_artifacts_for_document_lookup(monkeypatch):
    notebook_path = os.path.abspath("C:/workspace/batch-late.ipynb")

    class _LateArtifactBridge(FakeBridge):
        async def ws_request_multi(self, msg_type: str, data: dict, **kwargs) -> list[dict]:
            self.ws_calls.append((msg_type, data, kwargs))
            execution_id = str(data.get("execution_id") or "")
            terminal_message = {
                "type": "notebook_cell_executed",
                "kernel_id": "kernel-1",
                "cell_id": "cell-1",
                "execution_id": execution_id,
                "execution_count": 1,
                "outputs": [],
                "pdf_converting": True,
            }

            async def _emit_late_messages() -> None:
                for queue in list(self.execution_observers.get(execution_id, [])):
                    queue.put_nowait(dict(terminal_message))
                await asyncio.sleep(0.05)
                late_docx = {
                    "type": "notebook_docx_update",
                    "kernel_id": "kernel-1",
                    "cell_id": "cell-1",
                    "execution_id": execution_id,
                    "docx_file_token": "docx-late-1",
                    "docx_ref": "/api/docx/download?token=docx-late-1",
                    "docx_file_name": "late.docx",
                    "docx_hash": "docx-late-hash",
                    "docx_size_bytes": 4,
                }
                late_pdf = {
                    "type": "notebook_pdf_ready",
                    "kernel_id": "kernel-1",
                    "cell_id": "cell-1",
                    "execution_id": execution_id,
                    "pdf_file_token": "pdf-late-1",
                    "pdf_ref": "/api/pdf/download?token=pdf-late-1",
                }
                for queue in list(self.execution_observers.get(execution_id, [])):
                    queue.put_nowait(dict(late_docx))
                    queue.put_nowait(dict(late_pdf))

            asyncio.create_task(_emit_late_messages())
            return [terminal_message]

    fake_bridge = _LateArtifactBridge()

    async def fake_read_notebook(bridge, path):
        return {
            "cells": [
                {"id": "cell-1", "cell_type": "code", "source": "with build_doc(order=1) as doc:\n    doc.text('late')", "outputs": []}
            ],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5,
        }

    async def fake_rest_get_bytes(path: str, *, params: dict | None = None) -> bytes:
        if path == "/api/docx/download":
            assert params == {"token": "docx-late-1"}
            return b"docx"
        raise AssertionError(f"Unexpected REST GET BYTES path: {path}")

    monkeypatch.setattr(notebook.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    monkeypatch.setattr(notebook, "_read_notebook", fake_read_notebook)
    fake_bridge.rest_get_bytes = fake_rest_get_bytes  # type: ignore[method-assign]

    batch_result = await notebook.execute_all_cells("kernel-1", notebook_path)
    assert any(
        artifact.get("kind") == "docx" and artifact.get("token") == "docx-late-1"
        for artifact in (batch_result.get("artifacts") or [])
    )
    await _wait_until(
        lambda: (
            (McpSessionState.get().get_artifacts(kernel_id="kernel-1", execution_id=batch_result["execution_id"]) or {}).get(
                "docx_file_token"
            )
            == "docx-late-1"
        )
    )
    docx_result = await documents.get_document_docx(
        "kernel-1",
        execution_id=batch_result["execution_id"],
        inline_content=True,
    )

    assert batch_result["status"] == "completed"
    assert docx_result["status"] == "ok"
    assert docx_result["token"] == "docx-late-1"
    assert docx_result["docx_base64"] == "ZG9jeA=="


@pytest.mark.asyncio
async def test_document_tools_recover_pdf_token_from_ref_when_missing_file_token(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    export_dir = workspace_root / "exports"
    export_dir.mkdir()

    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_pdf_ready",
            "kernel_id": "kernel-1",
            "execution_id": "exec-pdf",
            "pdf_ref": "/api/pdf/download?token=pdf-7",
            "pdf_file_name": "report.pdf",
            "pdf_hash": "pdf-hash",
            "pdf_size_bytes": len(b"%PDF-1.4\n%fake\n"),
        }
    )
    fake_bridge = FakeBridge()
    download_calls: list[tuple[str, dict]] = []

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {
                "active_workspace": str(workspace_root),
                "workspace_path": str(workspace_root),
                "workspace_root": str(workspace_root),
            }
        return {}

    async def fake_rest_get_bytes(path: str, *, params: dict | None = None) -> bytes:
        download_calls.append((path, params or {}))
        if path == "/api/pdf/download":
            assert params == {"token": "pdf-7", "inline": "0"}
            return b"%PDF-1.4\n%fake\n"
        raise AssertionError(f"Unexpected REST GET BYTES path: {path}")

    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    fake_bridge.rest_get_bytes = fake_rest_get_bytes  # type: ignore[method-assign]
    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(documents.file_tools, "list_root_paths", lambda: asyncio.sleep(0, result=[str(workspace_root)]))

    result = await documents.get_document_pdf("kernel-1", execution_id="exec-pdf", inline_content=True)
    export_result = await documents.export_document_pdf("kernel-1", path="exports\\pdf-report")
    exported_path = export_dir / "pdf-report.pdf"

    assert result["status"] == "ok"
    assert result["token"] == "pdf-7"
    assert result["ref"] == "/api/pdf/download?token=pdf-7"
    assert result["portable_resource_uri"] == "inspyro://artifacts/token/pdf/pdf-7"
    assert result["resource_scope"] == "portable"
    assert result["inline_content"] is True
    assert result["pdf_base64"] == base64.b64encode(b"%PDF-1.4\n%fake\n").decode("ascii")
    assert export_result["status"] == "ok"
    assert export_result["token"] == "pdf-7"
    assert export_result["ref"] == "/api/pdf/download?token=pdf-7"
    assert export_result["portable_resource_uri"] == "inspyro://artifacts/token/pdf/pdf-7"
    assert exported_path.read_bytes() == b"%PDF-1.4\n%fake\n"
    assert download_calls == [
        ("/api/pdf/download", {"token": "pdf-7", "inline": "0"}),
        ("/api/pdf/download", {"token": "pdf-7", "inline": "0"}),
    ]


@pytest.mark.asyncio
async def test_reconvert_pdf_uses_long_timeout_budget(monkeypatch):
    fake_bridge = FakeBridge(
        ws_response={
            "type": "pdf_reconverted",
            "status": "ok",
            "pdf_file_token": "pdf-long",
            "pdf_ref": "/api/pdf/download?token=pdf-long",
            "pdf_hash": "pdf-long-hash",
        }
    )
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await documents.reconvert_pdf("kernel-1")

    assert result["status"] == "ok"
    assert fake_bridge.ws_calls
    _, _, kwargs = fake_bridge.ws_calls[-1]
    assert kwargs["timeout"] == documents._LONG_DOCUMENT_TIMEOUT_S


@pytest.mark.asyncio
async def test_check_document_quality_reads_cached_summary_and_normalizes_findings(monkeypatch):
    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-quality",
            "docx_artifact_id": "artifact-1",
            "docx_ref": "/api/docx/download?artifact_id=artifact-1",
        }
    )
    fake_bridge = FakeBridge(rest_response=_sample_quality_summary("artifact-1"))
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await documents.check_document_quality("kernel-1", execution_id="exec-quality", max_findings=1)

    assert result["status"] == "ok"
    assert result["artifact_id"] == "artifact-1"
    assert result["quality_status"] == "warning"
    assert result["findings"][0]["source"] == "audit"
    assert result["findings"][0]["location"] == "part=word/document.xml; id=1"
    assert result["truncated_findings"] is True
    assert ("/api/docx/quality", {"artifact_id": "artifact-1"}) in fake_bridge.rest_calls


@pytest.mark.asyncio
async def test_check_document_quality_cache_miss_returns_missing_quality(monkeypatch):
    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-quality",
            "docx_artifact_id": "artifact-1",
            "docx_ref": "/api/docx/download?artifact_id=artifact-1",
        }
    )
    fake_bridge = FakeBridge()

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/docx/quality":
            raise BridgeError("missing", payload={"status_code": 404})
        return {}

    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await documents.check_document_quality("kernel-1", execution_id="exec-quality")

    assert result["status"] == "missing_quality"
    assert result["artifact_id"] == "artifact-1"
    assert "run=True" in result["message"]


@pytest.mark.asyncio
async def test_check_document_quality_run_executes_audit_and_truncates(monkeypatch):
    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-quality",
            "docx_artifact_id": "artifact-1",
            "docx_ref": "/api/docx/download?artifact_id=artifact-1",
        }
    )
    fake_bridge = FakeBridge(rest_response=_sample_quality_summary("artifact-1", findings_count=4))
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await documents.check_document_quality(
        kernel_id="kernel-1",
        execution_id="exec-quality",
        run=True,
        max_findings=2,
    )

    assert result["status"] == "ok"
    assert result["ran_audit"] is True
    assert len(result["findings"]) == 2
    assert result["total_findings"] == 4
    assert result["truncated_findings"] is True
    assert ("/api/docx/quality/run", {"artifact_id": "artifact-1", "profile": "agent"}) in fake_bridge.rest_calls


@pytest.mark.asyncio
async def test_check_document_quality_resolves_latest_by_source_path(monkeypatch):
    fake_bridge = FakeBridge()

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/docx/history":
            return {
                "items": [
                    {
                        "artifact_id": "artifact-source",
                        "source_path": params["source_path"],
                        "filename": "source.docx",
                    }
                ]
            }
        if path == "/api/docx/quality":
            return _sample_quality_summary(str(params["artifact_id"]))
        return {}

    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await documents.check_document_quality(source_path="C:/workspace/source.ipynb", detail="compact")

    assert result["status"] == "ok"
    assert result["artifact_id"] == "artifact-source"
    assert "findings" not in result
    assert ("/api/docx/history", {"limit": 1, "source_path": "C:/workspace/source.ipynb"}) in fake_bridge.rest_calls


@pytest.mark.asyncio
async def test_check_document_quality_rejects_exported_docx_source_path(monkeypatch, tmp_path: Path):
    exported_docx = tmp_path / "report-clean.docx"
    exported_docx.write_bytes(b"not-a-real-docx-for-selector-test")
    fake_bridge = FakeBridge()

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/docx/history":
            return {"items": []}
        return {}

    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await documents.check_document_quality(source_path=str(exported_docx), run=True)

    assert result["status"] == "invalid_quality_selector"
    assert result["source_path"] == str(exported_docx)
    assert "artifact_id" in result["message"]
    assert ("/api/docx/history", {"limit": 1, "source_path": str(exported_docx)}) in fake_bridge.rest_calls


@pytest.mark.asyncio
async def test_run_document_workbench_returns_compact_handles(monkeypatch):
    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-quality",
            "docx_artifact_id": "artifact-1",
            "docx_ref": "/api/docx/download?artifact_id=artifact-1",
        }
    )
    fake_bridge = FakeBridge(
        rest_response={
            "status": "ok",
            "operation": "audit",
            "artifact_id": "artifact-1",
            "workbench_id": "wb-1",
            "summary": _sample_quality_summary("artifact-1", findings_count=3),
            "resources": [{"name": "page-1.png", "size_bytes": 10, "hash": "h", "resource_uri": "/api/docx/workbench/resource?workbench_id=wb-1&name=page-1.png"}],
        }
    )
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await documents.run_document_workbench("audit", kernel_id="kernel-1", execution_id="exec-quality", max_findings=1)

    assert result["status"] == "ok"
    assert result["workbench_id"] == "wb-1"
    assert result["quality"]["total_findings"] == 3
    assert result["quality"]["truncated_findings"] is True
    assert result["resources"][0]["resource_uri"].startswith("/api/docx/workbench/resource")
    assert "docx_base64" not in result
    assert (
        "/api/docx/workbench/run",
        {"artifact_id": "artifact-1", "operation": "audit"},
    ) in fake_bridge.rest_calls


@pytest.mark.asyncio
async def test_prepare_document_delivery_can_export_variant_resource(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-quality",
            "docx_artifact_id": "artifact-1",
            "docx_ref": "/api/docx/download?artifact_id=artifact-1",
        }
    )
    fake_bridge = FakeBridge(
        rest_response={
            "status": "ok",
            "operation": "prepare_delivery",
            "artifact_id": "artifact-1",
            "workbench_id": "wb-1",
            "variant": {
                "filename": "report-delivery.docx",
                "size_bytes": 12,
                "hash": "variant-hash",
                "resource_uri": "/api/docx/workbench/resource?workbench_id=wb-1&name=report-delivery.docx",
            },
            "resources": [
                {
                    "name": "report-delivery.docx",
                    "size_bytes": 12,
                    "hash": "variant-hash",
                    "resource_uri": "/api/docx/workbench/resource?workbench_id=wb-1&name=report-delivery.docx",
                }
            ],
        }
    )

    async def fake_rest_get_bytes(path: str, *, params: dict | None = None) -> bytes:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/docx/workbench/resource":
            assert params == {"workbench_id": "wb-1", "name": "report-delivery.docx"}
            return b"delivery-docx"
        raise AssertionError(f"Unexpected REST GET BYTES path: {path}")

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {"workspace_root": str(workspace_root), "workspace_path": str(workspace_root)}
        return fake_bridge.rest_response

    fake_bridge.rest_get_bytes = fake_rest_get_bytes  # type: ignore[method-assign]
    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    monkeypatch.setattr(documents.file_tools, "list_root_paths", lambda: asyncio.sleep(0, result=[str(workspace_root)]))

    result = await documents.prepare_document_delivery(kernel_id="kernel-1", execution_id="exec-quality", path="exports\\")

    exported_path = workspace_root / "exports" / "report-delivery.docx"
    assert result["status"] == "ok"
    assert result["export"]["path"] == str(exported_path)
    assert exported_path.read_bytes() == b"delivery-docx"


def test_workbench_resource_uri_parser_rejects_unexpected_paths():
    assert documents._resource_uri_to_rest_request(
        "/api/docx/workbench/resource?workbench_id=wb-1&name=report.docx"
    ) == (
        "/api/docx/workbench/resource",
        {"workbench_id": "wb-1", "name": "report.docx"},
    )

    with pytest.raises(BridgeError):
        documents._resource_uri_to_rest_request("/api/system/info")

    with pytest.raises(BridgeError):
        documents._resource_uri_to_rest_request("/api/docx/workbench/resource?workbench_id=wb-1")


@pytest.mark.asyncio
async def test_get_document_docx_include_quality_uses_cached_summary(monkeypatch):
    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-quality",
            "docx_artifact_id": "artifact-1",
            "docx_ref": "/api/docx/download?artifact_id=artifact-1",
            "docx_file_name": "report.docx",
            "docx_size_bytes": 4,
        }
    )
    fake_bridge = FakeBridge(rest_response=_sample_quality_summary("artifact-1"))
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await documents.get_document_docx("kernel-1", execution_id="exec-quality", include_quality=True)

    assert result["status"] == "ok"
    assert "docx_base64" not in result
    assert result["docx_quality"]["quality_status"] == "warning"
    assert result["docx_quality"]["detail"] == "compact"


@pytest.mark.asyncio
async def test_export_clean_document_docx_writes_inside_client_roots(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    export_dir = workspace_root / "exports"
    export_dir.mkdir(parents=True)
    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-clean",
            "docx_artifact_id": "artifact-1",
            "docx_ref": "/api/docx/download?artifact_id=artifact-1",
            "docx_file_name": "report.docx",
        }
    )
    fake_bridge = FakeBridge()

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {
                "active_workspace": str(workspace_root),
                "workspace_path": str(workspace_root),
                "workspace_root": str(workspace_root),
            }
        return {}

    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    monkeypatch.setattr(documents.file_tools, "list_root_paths", lambda: asyncio.sleep(0, result=[str(workspace_root)]))

    result = await documents.export_clean_document_docx(path="exports\\", kernel_id="kernel-1")

    exported_path = export_dir / "report-clean.docx"
    assert result["status"] == "ok"
    assert result["path"] == str(exported_path)
    assert exported_path.read_bytes() == b"clean-docx"
    assert result["hash"] == hashlib.sha256(b"clean-docx").hexdigest()
    assert (
        "/api/docx/quality/clean",
        {
            "artifact_id": "artifact-1",
            "tracked_changes": "accept",
            "scrub_metadata": True,
            "strip_comments": True,
        },
    ) in fake_bridge.rest_calls


@pytest.mark.asyncio
async def test_export_clean_document_docx_respects_overwrite_false(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    existing_path = workspace_root / "report-clean.docx"
    existing_path.write_bytes(b"old")
    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-clean",
            "docx_artifact_id": "artifact-1",
            "docx_ref": "/api/docx/download?artifact_id=artifact-1",
            "docx_file_name": "report.docx",
        }
    )
    fake_bridge = FakeBridge()

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {
                "active_workspace": str(workspace_root),
                "workspace_path": str(workspace_root),
                "workspace_root": str(workspace_root),
            }
        return {}

    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    monkeypatch.setattr(documents.file_tools, "list_root_paths", lambda: asyncio.sleep(0, result=[str(workspace_root)]))

    with pytest.raises(BridgeError, match="ya existe"):
        await documents.export_clean_document_docx(path=str(existing_path), kernel_id="kernel-1")

    assert existing_path.read_bytes() == b"old"
    assert not any(call[0] == "/api/docx/quality/clean" for call in fake_bridge.rest_calls)


@pytest.mark.asyncio
async def test_get_document_docx_falls_back_to_latest_artifact_for_current_execution(monkeypatch):
    notebook_path = os.path.abspath("C:/workspace/current.ipynb")
    state = McpSessionState.get()
    state.register_notebook("kernel-1", notebook_path)
    state.set_kernel_state("kernel-1", "idle", notebook_path=notebook_path, execution_id="batch-current")
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "batch-current",
            "status": "completed",
        }
    )
    state.record_artifacts(
        {
            "type": "notebook_docx_update",
            "kernel_id": "kernel-1",
            "docx_file_token": "docx-current",
            "docx_ref": "/api/docx/download?token=docx-current",
            "docx_hash": "docx-current-hash",
        }
    )

    fake_bridge = FakeBridge()

    async def fake_rest_get_bytes(path: str, *, params: dict | None = None) -> bytes:
        if path == "/api/docx/download":
            assert params == {"token": "docx-current"}
            return b"docx"
        raise AssertionError(f"Unexpected REST GET BYTES path: {path}")

    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    fake_bridge.rest_get_bytes = fake_rest_get_bytes  # type: ignore[method-assign]

    result = await documents.get_document_docx(
        "kernel-1",
        execution_id="batch-current",
        inline_content=True,
    )

    assert result["status"] == "ok"
    assert result["token"] == "docx-current"
    assert result["docx_base64"] == "ZG9jeA=="


@pytest.mark.asyncio
async def test_get_document_docx_waits_for_late_current_execution_artifact(monkeypatch):
    notebook_path = os.path.abspath("C:/workspace/current-wait.ipynb")
    state = McpSessionState.get()
    state.register_notebook("kernel-1", notebook_path)
    state.set_kernel_state("kernel-1", "idle", notebook_path=notebook_path, execution_id="batch-wait")
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "batch-wait",
            "status": "completed",
        }
    )

    fake_bridge = FakeBridge()

    async def fake_rest_get_bytes(path: str, *, params: dict | None = None) -> bytes:
        if path == "/api/docx/download":
            assert params == {"token": "docx-wait"}
            return b"docx"
        raise AssertionError(f"Unexpected REST GET BYTES path: {path}")

    async def record_late_artifact() -> None:
        await asyncio.sleep(0.05)
        state.record_artifacts(
            {
                "type": "notebook_docx_update",
                "kernel_id": "kernel-1",
                "execution_id": "batch-wait",
                "docx_file_token": "docx-wait",
                "docx_ref": "/api/docx/download?token=docx-wait",
                "docx_hash": "docx-wait-hash",
            }
        )

    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    fake_bridge.rest_get_bytes = fake_rest_get_bytes  # type: ignore[method-assign]

    late_task = asyncio.create_task(record_late_artifact())
    try:
        result = await documents.get_document_docx(
            "kernel-1",
            execution_id="batch-wait",
            inline_content=True,
        )
    finally:
        await late_task

    assert result["status"] == "ok"
    assert result["token"] == "docx-wait"
    assert result["docx_base64"] == "ZG9jeA=="


@pytest.mark.asyncio
async def test_document_tools_inline_content_is_opt_in(monkeypatch):
    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-2",
            "docx_file_b64": "ZG9jeA==",
            "docx_file_token": "docx-2",
            "docx_ref": "/api/docx/download?token=docx-2",
            "docx_file_name": "inline.docx",
            "docx_hash": "docx-hash",
            "docx_size_bytes": 4,
        }
    )
    fake_bridge = FakeBridge()
    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await documents.get_document_docx("kernel-1", execution_id="exec-2", inline_content=True)

    assert result["status"] == "ok"
    assert result["token"] == "docx-2"
    assert result["portable_resource_uri"] == "inspyro://artifacts/token/docx/docx-2"
    assert result["inline_content"] is True
    assert result["docx_base64"] == "ZG9jeA=="


@pytest.mark.asyncio
async def test_export_document_docx_writes_directory_using_default_filename(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    export_dir = workspace_root / "exports"
    export_dir.mkdir(parents=True)

    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-3",
            "docx_file_b64": "ZG9jeA==",
            "docx_file_token": "docx-3",
            "docx_ref": "/api/docx/download?token=docx-3",
            "docx_file_name": "report.docx",
            "docx_hash": "docx-hash",
            "docx_size_bytes": 4,
        }
    )
    fake_bridge = FakeBridge()

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {
                "active_workspace": str(workspace_root),
                "workspace_path": str(workspace_root),
                "workspace_root": str(workspace_root),
            }
        return {}

    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(documents.file_tools, "list_root_paths", lambda: asyncio.sleep(0, result=[str(workspace_root)]))

    result = await documents.export_document_docx("kernel-1", path="exports\\")

    exported_path = export_dir / "report.docx"
    assert result["status"] == "ok"
    assert result["path"] == str(exported_path)
    assert exported_path.read_bytes() == b"docx"
    assert result["portable_resource_uri"] == "inspyro://artifacts/token/docx/docx-3"


@pytest.mark.asyncio
async def test_export_document_pdf_appends_extension_when_missing(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()

    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_pdf_ready",
            "kernel_id": "kernel-1",
            "execution_id": "exec-4",
            "pdf_file_b64": base64.b64encode(b"%PDF-1.4\n%fake\n").decode("ascii"),
            "pdf_file_token": "pdf-4",
            "pdf_ref": "/api/pdf/download?token=pdf-4",
            "pdf_file_name": "report.pdf",
            "pdf_hash": "pdf-hash",
            "pdf_size_bytes": len(b"%PDF-1.4\n%fake\n"),
        }
    )
    fake_bridge = FakeBridge()

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {
                "active_workspace": str(workspace_root),
                "workspace_path": str(workspace_root),
                "workspace_root": str(workspace_root),
            }
        return {}

    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(documents.file_tools, "list_root_paths", lambda: asyncio.sleep(0, result=[str(workspace_root)]))

    result = await documents.export_document_pdf("kernel-1", path="reports\\final_report")

    exported_path = workspace_root / "reports" / "final_report.pdf"
    assert result["status"] == "ok"
    assert result["path"] == str(exported_path)
    assert exported_path.read_bytes() == b"%PDF-1.4\n%fake\n"


@pytest.mark.asyncio
async def test_export_document_docx_rejects_existing_path_without_overwrite(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    existing_path = workspace_root / "report.docx"
    existing_path.write_bytes(b"old")

    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-5",
            "docx_file_b64": "ZG9jeA==",
            "docx_file_token": "docx-5",
            "docx_ref": "/api/docx/download?token=docx-5",
            "docx_file_name": "report.docx",
            "docx_hash": "docx-hash",
            "docx_size_bytes": 4,
        }
    )
    fake_bridge = FakeBridge()

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {
                "active_workspace": str(workspace_root),
                "workspace_path": str(workspace_root),
                "workspace_root": str(workspace_root),
            }
        return {}

    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(documents.file_tools, "list_root_paths", lambda: asyncio.sleep(0, result=[str(workspace_root)]))

    with pytest.raises(BridgeError, match="ya existe"):
        await documents.export_document_docx("kernel-1", path=str(existing_path))


@pytest.mark.asyncio
async def test_export_document_docx_rejects_outside_client_roots(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()

    state = McpSessionState.get()
    state.record_artifacts(
        {
            "type": "notebook_cell_executed",
            "kernel_id": "kernel-1",
            "execution_id": "exec-6",
            "docx_file_b64": "ZG9jeA==",
            "docx_file_token": "docx-6",
            "docx_ref": "/api/docx/download?token=docx-6",
            "docx_file_name": "report.docx",
            "docx_hash": "docx-hash",
            "docx_size_bytes": 4,
        }
    )
    fake_bridge = FakeBridge()

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {
                "active_workspace": str(workspace_root),
                "workspace_path": str(workspace_root),
                "workspace_root": str(workspace_root),
            }
        return {}

    monkeypatch.setattr(documents.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(
        documents.file_tools,
        "list_root_paths",
        lambda: asyncio.sleep(0, result=[str(workspace_root / "allowed")]),
    )

    with pytest.raises(BridgeError, match="roots"):
        await documents.export_document_docx("kernel-1", path="exports\\report.docx")


@pytest.mark.asyncio
async def test_file_tools_enforce_client_roots(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    fake_bridge = FakeBridge()

    async def fake_rest_get(path: str, *, params: dict | None = None) -> dict:
        fake_bridge.rest_calls.append((path, params or {}))
        if path == "/api/system/info":
            return {
                "active_workspace": str(workspace_root),
                "workspace_path": str(workspace_root),
                "workspace_root": str(workspace_root),
            }
        if path == "/api/files/read":
            return {"content": "demo", "path": params["path"]}
        raise AssertionError(f"Unexpected REST GET path: {path}")

    monkeypatch.setattr(files.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))
    fake_bridge.rest_get = fake_rest_get  # type: ignore[method-assign]
    monkeypatch.setattr(files, "list_root_paths", lambda: asyncio.sleep(0, result=[str(workspace_root / "allowed")]))

    with pytest.raises(BridgeError, match="roots"):
        await files.read_file("reports\\beam.md")


@pytest.mark.asyncio
async def test_system_profile_tools_report_profiles():
    profiles = await system.list_component_profiles()
    changed = await system.set_component_profile("core")

    assert profiles["status"] == "ok"
    assert "core" in profiles["available_profiles"]
    assert changed["status"] in {"ok", "unsupported"}
    assert changed["profile"] == "core"


@pytest.mark.asyncio
async def test_run_sensitivity_raises_on_unsuccessful_backend(monkeypatch):
    fake_bridge = FakeBridge(
        ws_response={
            "type": "sensitivity_result",
            "success": False,
            "results": {},
            "error": "invalid formulas",
        }
    )
    monkeypatch.setattr(analysis.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    with pytest.raises(BridgeError, match="invalid formulas"):
        await analysis.run_sensitivity(
            modified_variables={"x": 1.0},
            output_variables=["y"],
            formulas={"y": "x + 1"},
            current_values={"x": 1.0},
        )


@pytest.mark.asyncio
async def test_check_units_compatible_treats_same_unit_as_compatible(monkeypatch):
    fake_bridge = FakeBridge(
        rest_response={
            "dimension": "[force]",
            "canonical": {
                "canonical": "kN",
                "display": "kN",
                "aliases": ["kN", "kilonewton"],
            },
            "compatible": [
                {"canonical": "N", "display": "N", "aliases": ["N"]},
            ],
        }
    )
    monkeypatch.setattr(units.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await units.check_units_compatible("kN", "kilonewton")

    assert result["status"] == "ok"
    assert result["compatible"] is True


@pytest.mark.asyncio
async def test_optimize_design_raises_when_backend_embeds_error_in_result(monkeypatch):
    fake_bridge = FakeBridge(
        ws_response={
            "type": "optimization_result",
            "error": "No hay variables de diseño válidas para optimizar",
            "recommended_design": None,
            "pareto_front": [],
        }
    )
    monkeypatch.setattr(analysis.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    with pytest.raises(BridgeError, match="No hay variables"):
        await analysis.optimize_design(
            objective={},
            variables=[],
            constraints=[],
            formulas={},
            current_values={},
        )


@pytest.mark.asyncio
async def test_optimize_design_uses_long_timeout_budget(monkeypatch):
    fake_bridge = FakeBridge(
        ws_response={
            "type": "optimization_result",
            "recommended_design": {"status": "ok"},
            "pareto_front": [],
        }
    )
    monkeypatch.setattr(analysis.InspyroBridge, "get", classmethod(lambda cls: fake_bridge))

    result = await analysis.optimize_design(
        objective={},
        variables=[],
        constraints=[],
        formulas={},
        current_values={},
    )

    assert result["status"] == "ok"
    assert fake_bridge.ws_calls
    _, _, kwargs = fake_bridge.ws_calls[-1]
    assert kwargs["timeout"] == max(600, int(analysis.config.CELL_EXECUTION_TIMEOUT))


@pytest.mark.asyncio
async def test_handle_optimize_design_emits_optimization_error_for_invalid_service_result(monkeypatch):
    fake_manager = FakeManager()

    monkeypatch.setattr(analysis_router, "_manager", fake_manager)
    monkeypatch.setattr(
        analysis_router.engineering_optimization_service,
        "optimize_design",
        lambda **kwargs: {
            "error": "No hay variables de diseño válidas para optimizar",
            "recommended_design": None,
            "pareto_front": [],
        },
    )

    await analysis_router.handle_optimize_design(
        {
            "request_id": "req-opt",
            "objective": {},
            "variables": [],
            "constraints": [],
            "formulas": {},
            "current_values": {},
        },
        object(),
    )

    assert fake_manager.messages[-1]["type"] == "optimization_error"
    assert "No hay variables" in fake_manager.messages[-1]["error"]


def test_start_mcp_stdio_does_not_write_stdout(monkeypatch, capsys):
    monkeypatch.setattr(start_mcp, "_check_dependencies", lambda silent=False: True)
    monkeypatch.setattr(start_mcp, "_check_backend", lambda silent=False, wait_seconds=None: True)

    calls: list[list[str]] = []
    fake_server_module = types.SimpleNamespace(main=lambda argv=None: calls.append(argv or []))
    monkeypatch.setitem(sys.modules, "mcp_server.server", fake_server_module)

    start_mcp.main(["--stdio"])
    captured = capsys.readouterr()

    assert calls == [["--stdio"]]
    assert captured.out == ""


def test_check_backend_waits_until_backend_is_ready(monkeypatch):
    import urllib.error
    import urllib.request

    attempts: list[tuple[str, int]] = []
    sleep_calls: list[float] = []

    class _Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def fake_urlopen(url: str, timeout: int):
        attempts.append((url, timeout))
        if len(attempts) == 1:
            raise urllib.error.URLError("down")
        return _Response()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(start_mcp.time, "sleep", lambda seconds: sleep_calls.append(seconds))

    assert start_mcp._check_backend(wait_seconds=1, silent=True) is True
    assert len(attempts) == 2
    assert len(sleep_calls) == 1


def test_server_main_passes_http_compat_flags(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr(mcp_server_main.mcp, "run", lambda **kwargs: calls.append(kwargs))

    mcp_server_main.main([
        "--host",
        "0.0.0.0",
        "--port",
        "9100",
        "--json-response",
        "--stateless-http",
    ])

    assert calls == [
        {
            "transport": "streamable-http",
            "host": "0.0.0.0",
            "port": 9100,
            "json_response": True,
            "stateless_http": True,
        }
    ]


def test_start_mcp_forwards_wait_and_http_flags(monkeypatch):
    monkeypatch.setattr(start_mcp, "_check_dependencies", lambda silent=False: True)
    backend_checks: list[tuple[bool, float | None]] = []

    def fake_check_backend(*, silent: bool = False, wait_seconds: float | None = None) -> bool:
        backend_checks.append((silent, wait_seconds))
        return True

    monkeypatch.setattr(start_mcp, "_check_backend", fake_check_backend)

    calls: list[list[str]] = []
    fake_server_module = types.SimpleNamespace(main=lambda argv=None: calls.append(argv or []))
    monkeypatch.setitem(sys.modules, "mcp_server.server", fake_server_module)

    start_mcp.main(["--json-response", "--stateless-http", "--wait-for-backend", "12"])

    assert backend_checks == [(False, 12.0)]
    assert calls == [["--json-response", "--stateless-http"]]
