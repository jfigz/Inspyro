import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app
from app.services import docx_downloads, pdf_downloads, template_service, template_tokens, workspace_service


def test_system_info_uses_user_projects_root_when_no_active_workspace(tmp_path, monkeypatch) -> None:
    state_dir = tmp_path / "state"
    projects_root = tmp_path / "Documents" / "Inspyro" / "Projects"
    monkeypatch.setenv("INSPYRO_APP_STATE_DIR", str(state_dir))
    monkeypatch.setenv("INSPYRO_DEFAULT_PROJECTS_ROOT", str(projects_root))

    client = TestClient(app)
    response = client.get("/api/system/info")

    assert response.status_code == 200
    payload = response.json()
    assert payload["workspace_root"] == str(projects_root.resolve())
    assert payload["workspace_path"] == str(projects_root.resolve())
    assert payload["active_workspace"] is None
    assert payload["workspace_source"] == "default"
    assert payload["suggested_workspace_root"] == str(projects_root.resolve())
    assert projects_root.exists()


def test_set_active_workspace_updates_system_info(tmp_path, monkeypatch) -> None:
    state_dir = tmp_path / "state"
    projects_root = tmp_path / "Projects"
    active_workspace = tmp_path / "cliente-a"
    active_workspace.mkdir(parents=True)
    monkeypatch.setenv("INSPYRO_APP_STATE_DIR", str(state_dir))
    monkeypatch.setenv("INSPYRO_DEFAULT_PROJECTS_ROOT", str(projects_root))

    client = TestClient(app)
    response = client.post(
        "/api/system/workspace",
        json={"path": str(active_workspace)},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["workspace_root"] == str(active_workspace.resolve())
    assert payload["active_workspace"] == str(active_workspace.resolve())
    assert payload["workspace_source"] == "active"

    info_response = client.get("/api/system/info")
    info_payload = info_response.json()
    assert info_payload["workspace_root"] == str(active_workspace.resolve())
    assert info_payload["recent_workspaces"] == [str(active_workspace.resolve())]


def test_create_workspace_endpoint_creates_and_activates_workspace(tmp_path, monkeypatch) -> None:
    state_dir = tmp_path / "state"
    parent_dir = tmp_path / "workspaces"
    parent_dir.mkdir(parents=True)
    monkeypatch.setenv("INSPYRO_APP_STATE_DIR", str(state_dir))
    monkeypatch.setenv("INSPYRO_DEFAULT_PROJECTS_ROOT", str(tmp_path / "default-projects"))

    client = TestClient(app)
    response = client.post(
        "/api/system/workspace/create",
        json={"name": "Proyecto Demo", "parent_path": str(parent_dir)},
    )

    assert response.status_code == 200
    payload = response.json()
    expected_path = parent_dir / "Proyecto Demo"
    assert payload["success"] is True
    assert payload["created"] is True
    assert payload["workspace_root"] == str(expected_path.resolve())
    assert expected_path.exists()
    assert expected_path.is_dir()


def test_app_storage_helpers_use_app_state_dir(tmp_path, monkeypatch) -> None:
    state_dir = tmp_path / "state"
    monkeypatch.setenv("INSPYRO_APP_STATE_DIR", str(state_dir))

    assert workspace_service.get_app_state_dir() == state_dir.resolve()
    assert workspace_service.get_app_storage_dir("docx_downloads") == (state_dir / "docx_downloads").resolve()
    assert workspace_service.get_app_storage_dir("templates") == (state_dir / "templates").resolve()


def test_download_and_token_storage_defaults_to_app_state(tmp_path, monkeypatch) -> None:
    state_dir = tmp_path / "state"
    monkeypatch.setenv("INSPYRO_APP_STATE_DIR", str(state_dir))
    monkeypatch.delenv("INSPYRO_DOCX_CACHE_DIR", raising=False)
    monkeypatch.delenv("INSPYRO_PDF_CACHE_DIR", raising=False)
    monkeypatch.delenv("INSPYRO_TEMPLATE_TOKEN_DIR", raising=False)

    assert docx_downloads._resolve_docx_download_dir() == (state_dir / "docx_downloads").resolve()
    assert pdf_downloads._resolve_pdf_download_dir() == (state_dir / "pdf_downloads").resolve()
    assert template_tokens._resolve_template_token_dir() == (state_dir / "template_tokens").resolve()


def test_app_storage_helper_rejects_invalid_names(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("INSPYRO_APP_STATE_DIR", str(tmp_path / "state"))

    try:
        workspace_service.get_app_storage_dir("../escape")
    except ValueError as exc:
        assert "no es válido" in str(exc)
    else:
        raise AssertionError("Se esperaba ValueError para nombres inválidos")


def test_template_storage_defaults_to_app_state_and_migrates_legacy(tmp_path, monkeypatch) -> None:
    state_dir = tmp_path / "state"
    legacy_dir = tmp_path / "legacy_templates"
    legacy_kernel_dir = legacy_dir / "kernel-demo"
    legacy_kernel_dir.mkdir(parents=True)
    (legacy_kernel_dir / "template.docx").write_bytes(b"legacy-docx")
    monkeypatch.setenv("INSPYRO_APP_STATE_DIR", str(state_dir))
    monkeypatch.delenv("INSPYRO_TEMPLATE_DIR", raising=False)
    monkeypatch.setattr(template_service, "_LEGACY_TEMPLATE_DIR", legacy_dir)

    resolved = template_service._resolve_template_base_dir()

    assert resolved == (state_dir / "templates").resolve()
    assert (resolved / "kernel-demo" / "template.docx").read_bytes() == b"legacy-docx"
