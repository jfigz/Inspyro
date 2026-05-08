import base64
import os
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app
from app.services.template import storage as template_storage


def test_export_template_returns_portable_json(tmp_path, monkeypatch) -> None:
    docx_path = tmp_path / "template.docx"
    docx_path.write_bytes(b"portable-docx")
    monkeypatch.setattr(
        template_storage,
        "get_template",
        lambda kernel_id: {"styles": [{"name": "Normal"}], "style_browser": {"counts": {"body": 1}}},
    )
    monkeypatch.setattr(template_storage, "get_template_docx_path", lambda kernel_id: str(docx_path))

    client = TestClient(app)
    response = client.get("/api/templates/export", params={"kernel_id": "kernel-template"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema_version"] == "1.1"
    assert payload["kernel_id"] == "kernel-template"
    assert payload["file_name"] == "template.docx"
    assert payload["template"]["styles"][0]["name"] == "Normal"
    assert base64.b64decode(payload["docx_base64"]) == b"portable-docx"


def test_tokenize_template_path_returns_ephemeral_token(tmp_path) -> None:
    docx_path = tmp_path / "mirror-template.docx"
    docx_path.write_bytes(b"mirror-docx")

    client = TestClient(app)
    response = client.post("/api/templates/tokenize", json={"path": str(docx_path)})

    assert response.status_code == 200
    payload = response.json()
    assert payload["path"] == str(docx_path.resolve())
    assert payload["file_name"] == "mirror-template.docx"
    assert payload["size_bytes"] == len(b"mirror-docx")
    assert isinstance(payload["template_token"], str)
    assert payload["template_token"]


def test_export_template_rejects_missing_template(monkeypatch) -> None:
    monkeypatch.setattr(template_storage, "get_template", lambda kernel_id: None)

    client = TestClient(app)
    response = client.get("/api/templates/export", params={"kernel_id": "kernel-template"})

    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error_code"] == "missing_active_template"
    assert "plantilla activa" in detail["message"]


def test_export_template_rejects_missing_docx(tmp_path, monkeypatch) -> None:
    missing_path = tmp_path / "missing-template.docx"
    monkeypatch.setattr(template_storage, "get_template", lambda kernel_id: {"styles": []})
    monkeypatch.setattr(template_storage, "get_template_docx_path", lambda kernel_id: str(missing_path))

    client = TestClient(app)
    response = client.get("/api/templates/export", params={"kernel_id": "kernel-template"})

    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error_code"] == "missing_template_docx_file"
    assert "DOCX" in detail["message"]


def test_export_template_rejects_empty_docx(tmp_path, monkeypatch) -> None:
    docx_path = tmp_path / "template.docx"
    docx_path.write_bytes(b"")
    monkeypatch.setattr(template_storage, "get_template", lambda kernel_id: {"styles": []})
    monkeypatch.setattr(template_storage, "get_template_docx_path", lambda kernel_id: str(docx_path))

    client = TestClient(app)
    response = client.get("/api/templates/export", params={"kernel_id": "kernel-template"})

    assert response.status_code == 500
    detail = response.json()["detail"]
    assert detail["error_code"] == "empty_template_docx"
    assert "vacio" in detail["message"]
