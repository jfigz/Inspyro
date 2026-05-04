import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.file_watcher import build_workspace_fs_message, normalize_workspace_event


def test_normalize_workspace_event_keeps_move_shape_inside_workspace(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    old_dir = workspace / "old"
    new_dir = workspace / "new"
    old_dir.mkdir(parents=True)
    new_dir.mkdir(parents=True)

    event = normalize_workspace_event(
        {
            "action": "moved",
            "path": str(new_dir / "report.py"),
            "oldPath": str(old_dir / "report.py"),
            "isDirectory": False,
            "ts": 123.0,
        },
        workspace,
    )

    assert event == {
        "action": "moved",
        "path": str((new_dir / "report.py").resolve()),
        "oldPath": str((old_dir / "report.py").resolve()),
        "parentPath": str(new_dir.resolve()),
        "isDirectory": False,
        "hidden": False,
        "ts": 123.0,
    }


def test_normalize_workspace_event_filters_hard_ignored_and_directory_modified(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    git_dir = workspace / ".git"
    git_dir.mkdir(parents=True)

    ignored = normalize_workspace_event(
        {
            "action": "created",
            "path": str(git_dir / "config"),
            "isDirectory": False,
        },
        workspace,
    )
    assert ignored is None

    directory_modified = normalize_workspace_event(
        {
            "action": "modified",
            "path": str(workspace / "src"),
            "isDirectory": True,
        },
        workspace,
    )
    assert directory_modified is None


def test_build_workspace_fs_message_dedupes_identical_events(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    file_path = workspace / "demo.py"

    payload = build_workspace_fs_message(
        [
            {"action": "modified", "path": str(file_path), "isDirectory": False, "ts": 1},
            {"action": "modified", "path": str(file_path), "isDirectory": False, "ts": 2},
        ],
        workspace,
    )

    assert payload is not None
    assert payload["type"] == "workspace_fs_event"
    assert payload["workspace_path"] == str(workspace.resolve())
    assert len(payload["events"]) == 1
    assert payload["events"][0]["path"] == str(file_path.resolve())
