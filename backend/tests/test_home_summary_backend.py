from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.routers import mcp_manager
from app.services import template_service, workspace_service
from app.services.home_compact import home_compact_store
from app.services.mcp_activity import mcp_activity_store
from main import app


@pytest.fixture(autouse=True)
def _reset_home_state(monkeypatch, tmp_path):
    home_compact_store.reset()
    asyncio.run(mcp_activity_store.clear())
    monkeypatch.setenv("INSPYRO_APP_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("INSPYRO_DEFAULT_PROJECTS_ROOT", str(tmp_path / "projects"))
    yield
    home_compact_store.reset()
    asyncio.run(mcp_activity_store.clear())


def test_mcp_client_heartbeat_endpoint_registers_grouped_clients():
    client = TestClient(app)

    response = client.post(
        "/api/mcp/client-heartbeat",
        json={
            "client_id": "client-a",
            "client_label": "Codex",
            "transport": "streamable-http",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "accepted"
    assert payload["client"]["client_id"] == "client-a"
    assert payload["mcp_clients"]["total"] == 1
    assert payload["mcp_clients"]["active"] == 1
    assert payload["mcp_clients"]["by_transport"]["streamable-http"][0]["client_label"] == "Codex"


@pytest.mark.asyncio
async def test_mcp_activity_endpoint_enriches_client_label_from_heartbeat(monkeypatch):
    broadcast_messages: list[dict] = []

    async def fake_broadcast(payload: dict) -> int:
        broadcast_messages.append(payload)
        return 1

    monkeypatch.setattr(mcp_manager.websocket_manager, "broadcast", fake_broadcast)

    home_compact_store.register_client_heartbeat(
        {
            "client_id": "client-a",
            "client_label": "Claude Desktop",
            "transport": "streamable-http",
        }
    )

    response = await mcp_manager.mcp_activity_events(
        {
            "run_id": "run-client-a",
            "phase": "started",
            "tool_name": "execute_cell",
            "tool_group": "notebook",
            "summary": "Executing notebook cell",
            "client_id": "client-a",
            "transport": "streamable-http",
        }
    )

    assert response["status"] == "accepted"
    assert response["event"]["client_id"] == "client-a"
    assert response["event"]["client_label"] == "Claude Desktop"
    assert broadcast_messages[0]["client_label"] == "Claude Desktop"


@pytest.mark.asyncio
async def test_mcp_restart_clears_active_runs_and_clients(monkeypatch):
    calls: list[str] = []

    async def fake_stop():
        calls.append("stop")
        return {"status": "stopped"}

    async def fake_start():
        calls.append("start")
        return {"status": "started", "pid": 1234}

    monkeypatch.setattr(mcp_manager, "_is_running", lambda: True)
    monkeypatch.setattr(mcp_manager, "mcp_stop", fake_stop)
    monkeypatch.setattr(mcp_manager, "mcp_start", fake_start)
    monkeypatch.setattr(mcp_manager, "get_mcp_server_snapshot", lambda: {"status": "running", "pid": 1234})

    home_compact_store.register_client_heartbeat(
        {"client_id": "client-a", "client_label": "Codex", "transport": "streamable-http"}
    )
    await mcp_activity_store.record_event(
        {
            "run_id": "run-active",
            "phase": "started",
            "tool_name": "execute_cell",
            "tool_group": "notebook",
            "summary": "Executing",
            "client_id": "client-a",
            "transport": "streamable-http",
        }
    )

    result = await mcp_manager.mcp_restart()
    snapshot = await mcp_activity_store.snapshot(limit=10)

    assert result["status"] == "restarted"
    assert calls == ["stop", "start"]
    assert snapshot["active_count"] == 0
    assert home_compact_store.snapshot_clients_grouped()["total"] == 0


def test_home_summary_aggregates_runtime_templates_and_mcp_clients(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    notebook_a = workspace_root / "reports" / "beam.ipynb"
    notebook_a.parent.mkdir(parents=True)
    notebook_a.write_text("{}", encoding="utf-8")
    notebook_b = workspace_root / "checks.ipynb"
    notebook_b.write_text("{}", encoding="utf-8")
    workspace_service.set_active_workspace(str(workspace_root), create_if_missing=True)

    home_compact_store.register_notebook_runtime(
        kernel_id="kernel-1",
        notebook_path=str(notebook_a),
        source_kind="notebook",
        state="idle",
    )
    home_compact_store.update_runtime_for_kernel(
        "kernel-1",
        state="running",
        execution_id="exec-1",
        progress_scope="execution",
        progress_stage="cell_run",
        progress_status="running",
    )

    template_file = tmp_path / "template.docx"
    template_file.write_bytes(b"demo-template")
    monkeypatch.setattr(template_service, "get_template_docx_path", lambda kernel_id: str(template_file))
    monkeypatch.setattr(
        template_service,
        "get_template",
        lambda kernel_id: {"styles": [{"name": "Heading 1"}, {"name": "Normal"}]},
    )
    home_compact_store.persist_template_association_for_kernel("kernel-1", template_token="tpl-001")

    client = TestClient(app)
    heartbeat_response = client.post(
        "/api/mcp/client-heartbeat",
        json={
            "client_id": "client-a",
            "client_label": "Codex",
            "transport": "streamable-http",
        },
    )
    assert heartbeat_response.status_code == 200

    activity_response = client.post(
        "/api/mcp/activity/events",
        json={
            "run_id": "run-home",
            "phase": "started",
            "tool_name": "execute_all_cells",
            "tool_group": "notebook",
            "summary": "Executing notebook beam.ipynb",
            "client_id": "client-a",
            "transport": "streamable-http",
        },
    )
    assert activity_response.status_code == 200

    response = client.get("/api/system/home-summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["workspace_path"] == str(workspace_root.resolve())
    assert payload["overview"]["workspace_notebook_count"] == 2
    assert payload["overview"]["template_attached_count"] == 1
    assert payload["overview"]["runtime_active_count"] == 1
    assert payload["overview"]["mcp_client_count"] == 1
    assert payload["overview"]["mcp_active_run_count"] == 1
    assert payload["mcp_service"]["status"] == "stopped"
    assert payload["mcp_clients"][0]["client_label"] == "Codex"
    assert payload["mcp_clients"][0]["recent_activity"][0]["summary"] == "Executing notebook beam.ipynb"
    assert payload["mcp_clients_summary"]["by_transport"]["streamable-http"][0]["client_label"] == "Codex"

    runtime_entry = next(item for item in payload["notebook_runtime_items"] if item["kernel_id"] == "kernel-1")
    assert runtime_entry["notebook_path"] == str(notebook_a.resolve())
    assert runtime_entry["state"] == "running"
    assert runtime_entry["progress"]["stage"] == "cell_run"
    assert runtime_entry["template_attached"] is True

    inventory_entry = next(item for item in payload["template_inventory"] if item["notebook_path"] == str(notebook_a.resolve()))
    assert inventory_entry["template_attached"] is True
    assert inventory_entry["template_token"] == "tpl-001"
    assert inventory_entry["style_count"] == 2
    assert inventory_entry["template_mirror_relpath"].replace("\\", "/").startswith(".inspyro/templates/mirrors/")
    assert Path(inventory_entry["template_mirror_path"]).exists()
    assert payload["template_inventory_summary"]["count"] == 2


def test_home_summary_filters_internal_notebooks_and_empty_docx(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    user_notebook = workspace_root / "report.ipynb"
    user_notebook.write_text("{}", encoding="utf-8")
    internal_notebook = workspace_root / "_agent_runs" / "run-1" / "generated.ipynb"
    internal_notebook.parent.mkdir(parents=True)
    internal_notebook.write_text("{}", encoding="utf-8")
    demo_notebook = workspace_root / "backend" / "demo_mcp" / "smoke.ipynb"
    demo_notebook.parent.mkdir(parents=True)
    demo_notebook.write_text("{}", encoding="utf-8")
    workspace_service.set_active_workspace(str(workspace_root), create_if_missing=True)

    def fake_list_workspace_docx_artifacts(*, workspace_root, limit, include_empty):
        assert include_empty is False
        assert limit == 32
        workspace_path = Path(workspace_root)
        return [
            {
                "artifact_id": "empty-user",
                "source_path": str(user_notebook.resolve()),
                "workspace_path": str(workspace_path / "Docx_Documents" / "empty.docx"),
                "docx_is_empty": True,
            },
            {
                "artifact_id": "internal-docx",
                "source_path": str(internal_notebook.resolve()),
                "workspace_path": str(workspace_path / "Docx_Documents" / "internal.docx"),
                "docx_is_empty": False,
            },
            {
                "artifact_id": "user-docx",
                "source_path": str(user_notebook.resolve()),
                "workspace_path": str(workspace_path / "Docx_Documents" / "report.docx"),
                "docx_is_empty": False,
            },
        ]

    monkeypatch.setattr(
        "app.services.docx_artifacts.list_workspace_docx_artifacts",
        fake_list_workspace_docx_artifacts,
    )

    client = TestClient(app)
    response = client.get("/api/system/home-summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["overview"]["workspace_notebook_count"] == 1
    assert payload["overview"]["recent_docx_count"] == 1
    assert [item["notebook_relpath"] for item in payload["template_inventory"]] == ["report.ipynb"]
    assert payload["template_inventory_summary"]["scan"]["total_seen_count"] == 3
    assert payload["template_inventory_summary"]["scan"]["internal_count"] == 2
    assert [item["artifact_id"] for item in payload["recent_docx_items"]] == ["user-docx"]


def test_home_summary_exposes_code_runtime_items(tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    script_file = workspace_root / "checks" / "beam.py"
    script_file.parent.mkdir(parents=True)
    script_file.write_text("print('beam')", encoding="utf-8")
    workspace_service.set_active_workspace(str(workspace_root), create_if_missing=True)

    home_compact_store.register_code_runtime(
        file_path=str(script_file),
        run_id="code-run-1",
        state="running",
    )
    home_compact_store.update_code_runtime(
        file_path=str(script_file),
        run_id="code-run-1",
        progress_scope="execution",
        progress_stage="run",
        progress_status="running",
        progress_percent=42,
        message="Executing beam.py",
    )

    client = TestClient(app)
    response = client.get("/api/system/home-summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["overview"]["runtime_code_count"] == 1
    assert len(payload["code_runtime_items"]) == 1
    runtime_entry = payload["code_runtime_items"][0]
    assert runtime_entry["file_path"] == str(script_file.resolve())
    assert runtime_entry["run_id"] == "code-run-1"
    assert runtime_entry["progress"]["stage"] == "run"
    assert any(item.get("run_id") == "code-run-1" for item in payload["runtime_items"])


def test_home_summary_tracks_shared_pdf_converter_progress_and_clears_on_pdf_ready(tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    notebook_file = workspace_root / "parallel-report.ipynb"
    notebook_file.write_text("{}", encoding="utf-8")
    workspace_service.set_active_workspace(str(workspace_root), create_if_missing=True)

    source_path = str(notebook_file.resolve())
    home_compact_store.observe_notebook_message(
        {
            "type": "notebook_progress_update",
            "kernel_id": "kernel-shared",
            "execution_id": "exec-shared",
            "source_path": source_path,
            "source_kind": "notebook",
            "progress_scope": "document",
            "progress_stage": "pdf_convert",
            "progress_status": "running",
            "progress_percent": 80,
            "progress_indeterminate": False,
            "shared_resource": {
                "kind": "pdf_converter",
                "scope": "global",
                "status": "waiting",
            },
            "message": "Esperando turno del convertidor PDF...",
        }
    )

    client = TestClient(app)
    response = client.get("/api/system/home-summary")
    assert response.status_code == 200
    payload = response.json()

    runtime_entry = next(item for item in payload["notebook_runtime_items"] if item["kernel_id"] == "kernel-shared")
    assert runtime_entry["state"] == "running"
    assert runtime_entry["progress"]["stage"] == "pdf_convert"
    assert runtime_entry["progress"]["shared_resource"]["kind"] == "pdf_converter"
    assert runtime_entry["progress"]["shared_resource"]["status"] == "waiting"

    home_compact_store.observe_notebook_message(
        {
            "type": "notebook_pdf_ready",
            "kernel_id": "kernel-shared",
            "execution_id": "exec-shared",
            "source_path": source_path,
            "source_kind": "notebook",
            "pdf_ref": "/api/pdf/download?token=pdf-ready",
        }
    )

    response = client.get("/api/system/home-summary")
    assert response.status_code == 200
    payload = response.json()

    runtime_entry = next(item for item in payload["notebook_runtime_items"] if item["kernel_id"] == "kernel-shared")
    assert runtime_entry["state"] == "idle"
    assert runtime_entry["progress"]["stage"] is None
    assert runtime_entry["progress"]["status"] == "completed"
    assert runtime_entry["progress"]["shared_resource"] is None
