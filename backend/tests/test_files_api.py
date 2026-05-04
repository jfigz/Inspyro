import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app
from app.routers import files as files_router


def test_file_tree_returns_lazy_metadata_and_honors_show_hidden(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    src_dir = workspace / "src"
    src_dir.mkdir(parents=True)
    (src_dir / "main.py").write_text("print('ok')\n", encoding="utf-8")
    (workspace / ".hidden.py").write_text("secret = True\n", encoding="utf-8")
    (workspace / ".git").mkdir()
    (workspace / ".git" / "config").write_text("[core]\n", encoding="utf-8")

    client = TestClient(app)

    response = client.get(
        "/api/files/tree",
        params={"path": str(workspace), "depth": 1},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["path"] == str(workspace.resolve())
    assert payload["relativePath"] == "."
    assert payload["hasChildren"] is True

    names = [child["name"] for child in payload["children"]]
    assert "src" in names
    assert ".hidden.py" not in names
    assert ".git" not in names

    src_node = next(child for child in payload["children"] if child["name"] == "src")
    assert src_node["isDirectory"] is True
    assert src_node["children"] == []
    assert src_node["hasChildren"] is True
    assert src_node["relativePath"] == "src"
    assert isinstance(src_node["writable"], bool)
    assert isinstance(src_node["hidden"], bool)
    assert isinstance(src_node["symlink"], bool)
    assert isinstance(src_node["modified"], float)

    hidden_response = client.get(
        "/api/files/tree",
        params={"path": str(workspace), "depth": 1, "show_hidden": True},
    )

    assert hidden_response.status_code == 200
    hidden_names = [child["name"] for child in hidden_response.json()["children"]]
    assert ".hidden.py" in hidden_names
    assert ".git" not in hidden_names


def test_file_search_ranks_basename_matches_and_respects_limit(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "calc").mkdir()
    (workspace / "calc_utils.py").write_text("value = 1\n", encoding="utf-8")
    (workspace / "mycalc.py").write_text("value = 2\n", encoding="utf-8")
    docs_dir = workspace / "docs"
    docs_dir.mkdir()
    (docs_dir / "advanced_calc.md").write_text("# calc\n", encoding="utf-8")

    client = TestClient(app)
    response = client.get(
        "/api/files/search",
        params={"path": str(workspace), "query": "calc", "limit": 3},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["query"] == "calc"
    assert len(payload["results"]) == 3
    assert payload["results"][0]["name"] == "calc"
    assert payload["results"][1]["name"] == "calc_utils.py"
    assert payload["results"][2]["name"] in {"mycalc.py", "advanced_calc.md"}
    assert payload["results"][0]["score"] > payload["results"][1]["score"] > payload["results"][2]["score"]


def test_move_copy_duplicate_and_descendant_guard(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    src_dir = workspace / "src"
    nested_dir = src_dir / "nested"
    src_dir.mkdir(parents=True)
    nested_dir.mkdir()
    module_path = src_dir / "module.py"
    module_path.write_text("print('demo')\n", encoding="utf-8")
    destination_dir = workspace / "lib"
    destination_dir.mkdir()

    client = TestClient(app)

    move_response = client.post(
        "/api/files/move",
        json={
            "sourcePath": str(module_path),
            "destinationPath": str(destination_dir / "module.py"),
        },
    )
    assert move_response.status_code == 200
    assert (destination_dir / "module.py").exists()
    assert not module_path.exists()

    copy_response = client.post(
        "/api/files/copy",
        json={
            "sourcePath": str(src_dir),
            "destinationPath": str(workspace / "src-copy"),
        },
    )
    assert copy_response.status_code == 200
    assert (workspace / "src-copy" / "nested").exists()

    duplicate_response = client.post(
        "/api/files/duplicate",
        json={"sourcePath": str(destination_dir / "module.py")},
    )
    assert duplicate_response.status_code == 200
    assert (destination_dir / "module copy.py").exists()

    invalid_move = client.post(
        "/api/files/move",
        json={
            "sourcePath": str(src_dir),
            "destinationPath": str(nested_dir / "src"),
        },
    )
    assert invalid_move.status_code == 400
    assert "descendiente" in invalid_move.json()["detail"]


def test_open_default_application_launches_existing_file(tmp_path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    target = workspace / "report.pdf"
    target.write_bytes(b"%PDF-1.4\n")
    opened_paths: list[str] = []

    def fake_open(path: Path) -> dict[str, object]:
        opened_paths.append(str(path))
        return {
            "success": True,
            "path": str(path),
            "method": "system_default",
        }

    monkeypatch.setattr(files_router, "_open_with_default_app_sync", fake_open)

    client = TestClient(app)
    response = client.post(
        "/api/files/open-default",
        json={"path": str(target)},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["path"] == str(target.resolve())
    assert payload["method"] == "system_default"
    assert opened_paths == [str(target.resolve())]


def test_open_default_application_rejects_directories_and_missing_paths(tmp_path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    launcher_calls: list[str] = []

    def fake_open(path: Path) -> dict[str, object]:
        launcher_calls.append(str(path))
        return {"success": True, "path": str(path), "method": "system_default"}

    monkeypatch.setattr(files_router, "_open_with_default_app_sync", fake_open)
    client = TestClient(app)

    directory_response = client.post(
        "/api/files/open-default",
        json={"path": str(workspace)},
    )
    missing_response = client.post(
        "/api/files/open-default",
        json={"path": str(workspace / "missing.bin")},
    )

    assert directory_response.status_code == 400
    assert "archivo" in directory_response.json()["detail"].lower()
    assert missing_response.status_code == 404
    assert launcher_calls == []


def test_open_default_application_rejects_unsafe_paths(tmp_path, monkeypatch) -> None:
    target = tmp_path / "unsafe.txt"
    target.write_text("secret\n", encoding="utf-8")
    monkeypatch.setattr(files_router, "is_path_safe", lambda _path: False)
    launcher_calls: list[str] = []
    monkeypatch.setattr(
        files_router,
        "_open_with_default_app_sync",
        lambda path: launcher_calls.append(str(path)),
    )

    client = TestClient(app)
    response = client.post(
        "/api/files/open-default",
        json={"path": str(target)},
    )

    assert response.status_code == 403
    assert launcher_calls == []
