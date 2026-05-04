"""Helpers para resolver y persistir el workspace activo de Inspyro."""

from __future__ import annotations

import json
import os
from pathlib import Path

APP_NAME = "Inspyro"
STATE_FILE_NAME = "workspace_state.json"
MAX_RECENT_WORKSPACES = 8


def _resolve_path(raw_path: str | os.PathLike[str]) -> Path:
    return Path(raw_path).expanduser().resolve()


def _user_home() -> Path:
    return Path.home().resolve()


def _documents_dir() -> Path:
    candidate = _user_home() / "Documents"
    if candidate.exists() or os.name == "nt":
        return candidate
    return _user_home()


def get_default_projects_root() -> Path:
    override = os.getenv("INSPYRO_DEFAULT_PROJECTS_ROOT")
    if override:
        return _resolve_path(override)
    return (_documents_dir() / APP_NAME / "Projects").resolve()


def _state_dir() -> Path:
    override = os.getenv("INSPYRO_APP_STATE_DIR")
    if override:
        return _resolve_path(override)

    if os.name == "nt":
        base = Path(os.getenv("LOCALAPPDATA") or (_user_home() / "AppData" / "Local"))
    else:
        base = Path(os.getenv("XDG_STATE_HOME") or (_user_home() / ".local" / "state"))

    return (base / APP_NAME).resolve()


def _state_path() -> Path:
    return _state_dir() / STATE_FILE_NAME


def get_app_state_dir() -> Path:
    state_dir = _state_dir()
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir


def get_app_storage_dir(name: str) -> Path:
    storage_name = str(name).strip().strip("/\\")
    if not storage_name:
        raise ValueError("El nombre del storage no puede estar vacío")
    if any(sep in storage_name for sep in ("/", "\\")) or storage_name in {".", ".."}:
        raise ValueError("El nombre del storage no es válido")
    storage_dir = get_app_state_dir() / storage_name
    storage_dir.mkdir(parents=True, exist_ok=True)
    return storage_dir


def _load_state() -> dict:
    path = _state_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_state(state: dict) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


def _normalize_recent_paths(entries: list[str], active_workspace: str | None) -> list[str]:
    seen: set[str] = set()
    ordered = []

    for candidate in [active_workspace, *entries]:
        if not candidate:
            continue
        try:
            resolved = str(_resolve_path(candidate))
        except OSError:
            continue
        if resolved in seen:
            continue
        if not Path(resolved).is_dir():
            continue
        seen.add(resolved)
        ordered.append(resolved)
        if len(ordered) >= MAX_RECENT_WORKSPACES:
            break

    return ordered


def _workspace_snapshot(active_workspace: str | None = None) -> dict:
    default_root = get_default_projects_root()
    default_root.mkdir(parents=True, exist_ok=True)

    state = _load_state()
    active_candidate = active_workspace or state.get("active_workspace")
    active_resolved = None
    if active_candidate:
        try:
            candidate_path = _resolve_path(active_candidate)
            if candidate_path.is_dir():
                active_resolved = str(candidate_path)
        except OSError:
            active_resolved = None

    workspace_root = active_resolved or str(default_root)
    recent = _normalize_recent_paths(state.get("recent_workspaces", []), active_resolved)
    state_changed = False

    if state.get("active_workspace") != active_resolved:
        state["active_workspace"] = active_resolved
        state_changed = True
    if state.get("recent_workspaces") != recent:
        state["recent_workspaces"] = recent
        state_changed = True

    if state_changed:
        _save_state(state)

    return {
        "workspace_root": workspace_root,
        "workspace_path": workspace_root,
        "active_workspace": active_resolved,
        "workspace_source": "active" if active_resolved else "default",
        "suggested_workspace_root": str(default_root),
        "recent_workspaces": recent,
    }


def get_workspace_snapshot() -> dict:
    return _workspace_snapshot()


def set_active_workspace(path: str, *, create_if_missing: bool = False) -> dict:
    resolved = _resolve_path(path)
    if create_if_missing:
        resolved.mkdir(parents=True, exist_ok=True)

    if not resolved.exists():
        raise FileNotFoundError(str(resolved))
    if not resolved.is_dir():
        raise NotADirectoryError(str(resolved))

    state = _load_state()
    state["active_workspace"] = str(resolved)
    state["recent_workspaces"] = _normalize_recent_paths(
        state.get("recent_workspaces", []),
        str(resolved),
    )
    _save_state(state)
    return _workspace_snapshot(str(resolved))


def create_workspace(name: str, parent_path: str | None = None) -> dict:
    workspace_name = name.strip()
    if not workspace_name:
        raise ValueError("El nombre del workspace no puede estar vacío")
    if any(sep in workspace_name for sep in ("/", "\\")) or workspace_name in {".", ".."}:
        raise ValueError("El nombre del workspace no es válido")

    parent = _resolve_path(parent_path) if parent_path else get_default_projects_root()
    parent.mkdir(parents=True, exist_ok=True)

    workspace_path = parent / workspace_name
    if workspace_path.exists():
        raise FileExistsError(str(workspace_path))

    workspace_path.mkdir(parents=False, exist_ok=False)
    return set_active_workspace(str(workspace_path))
