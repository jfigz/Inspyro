from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services import workspace_service

NOTEBOOK_SCAN_LIMIT = max(1, int(os.getenv("INSPYRO_HOME_NOTEBOOK_SCAN_LIMIT", "1000")))
MCP_CLIENT_STALE_AFTER_S = max(5, int(os.getenv("INSPYRO_MCP_CLIENT_STALE_AFTER", "90")))
NOTEBOOK_DIR_IGNORE_NAMES = {
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".venv",
    "venv",
    "venv_inspyro",
    "__pycache__",
    "node_modules",
    ".inspyro",
}
NOTEBOOK_HOME_INTERNAL_ROOT_NAMES = {
    "_agent_runs",
    ".inspyro",
    "Docx_Documents",
    "backend",
    "frontend",
    "desktop",
    "tools",
    "docs",
    "output",
    "outputs",
    "build",
    "dist",
    "coverage",
}
NOTEBOOK_HOME_INTERNAL_DIR_NAMES = {
    "demo_mcp",
    "mcp_smoke",
    "mcp_torture",
    "mcp_torture_workspaces",
    "artifacts",
    "generated",
    "snapshots",
}
WORKSPACE_META_DIRNAME = ".inspyro"
WORKSPACE_TEMPLATES_DIRNAME = "templates"
WORKSPACE_TEMPLATE_MIRRORS_DIRNAME = "mirrors"
WORKSPACE_TEMPLATE_INDEX_VERSION = 1
_TRACKED_RUNTIME_MESSAGE_TYPES = {
    "notebook_progress_update",
    "notebook_cell_executed",
    "notebook_cell_error",
    "notebook_error",
    "notebook_execution_cancelled",
    "notebook_kernel_reset",
    "notebook_kernel_interrupted",
    "notebook_kernel_shutdown",
    "notebook_docx_update",
    "notebook_pdf_ready",
    "template_uploaded",
    "template_deleted",
    "template_style_updated",
    "template_document_defaults_updated",
    "template_semantic_slots_updated",
    "template_style_created",
    "template_format_applied",
}
_TEMPLATE_MUTATION_MESSAGE_TYPES = {
    "template_uploaded",
    "template_style_updated",
    "template_document_defaults_updated",
    "template_semantic_slots_updated",
    "template_style_created",
    "template_format_applied",
}
_RUNTIME_NULLABLE_FIELDS = {
    "error",
    "message",
    "last_output_preview",
    "last_output_type",
    "progress_scope",
    "progress_stage",
    "progress_status",
    "progress_percent",
    "progress_indeterminate",
    "shared_resource",
}


def _now_ts() -> float:
    return time.time()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_path(path: Any) -> str | None:
    text = _normalize_text(path)
    if not text:
        return None
    try:
        return str(Path(text).expanduser().resolve())
    except Exception:
        return str(Path(text).expanduser())


def _safe_relpath(path: Path, root: Path) -> str | None:
    try:
        return str(path.resolve().relative_to(root.resolve()))
    except Exception:
        return None


def _split_relpath_parts(relpath: str | None) -> list[str]:
    text = str(relpath or "").replace("\\", "/").strip("/")
    if not text:
        return []
    return [part for part in text.split("/") if part]


def _classify_home_notebook_relpath(relpath: str | None) -> tuple[str, str | None, int]:
    parts = _split_relpath_parts(relpath)
    if not parts:
        return "workspace", None, 10

    lowered = [part.lower() for part in parts]
    first = lowered[0]
    internal_roots = {name.lower() for name in NOTEBOOK_HOME_INTERNAL_ROOT_NAMES}
    internal_dirs = {name.lower() for name in NOTEBOOK_HOME_INTERNAL_DIR_NAMES}

    if first in internal_roots or any(part in internal_dirs for part in lowered[:-1]):
        return "internal", "generated_or_internal_dir", 900
    if any(part.startswith(".") for part in parts[:-1]):
        return "internal", "hidden_dir", 900
    if len(parts) == 1:
        return "workspace", None, 0
    return "workspace", None, 10 + min(len(parts), 20)


def _classify_home_notebook_path(path: str | None, workspace_root: Path) -> tuple[str, str | None, int, str | None]:
    normalized_path = _normalize_path(path)
    if not normalized_path:
        return "internal", "missing_path", 900, None
    relpath = _safe_relpath(Path(normalized_path), workspace_root)
    if relpath is None:
        return "internal", "outside_workspace", 900, None
    role, reason, rank = _classify_home_notebook_relpath(relpath)
    return role, reason, rank, relpath


def _slugify_filename(value: str, *, fallback: str = "template") -> str:
    cleaned = "".join(char if char.isalnum() else "-" for char in str(value))
    normalized = "-".join(part for part in cleaned.split("-") if part)
    return normalized[:80] or fallback


def _is_ipynb_path(path: str | None) -> bool:
    return bool(path and str(path).lower().endswith(".ipynb"))


def _active_workspace_root() -> Path | None:
    snapshot = workspace_service.get_workspace_snapshot()
    active_workspace = _normalize_path((snapshot or {}).get("active_workspace"))
    if not active_workspace:
        return None
    root = Path(active_workspace)
    if not root.exists() or not root.is_dir():
        return None
    return root


def _workspace_template_paths(workspace_root: Path) -> tuple[Path, Path, Path]:
    templates_dir = workspace_root / WORKSPACE_META_DIRNAME / WORKSPACE_TEMPLATES_DIRNAME
    mirrors_dir = templates_dir / WORKSPACE_TEMPLATE_MIRRORS_DIRNAME
    index_path = templates_dir / "index.json"
    return templates_dir, mirrors_dir, index_path


def _load_workspace_template_index(workspace_root: Path) -> dict[str, Any]:
    _, _, index_path = _workspace_template_paths(workspace_root)
    if not index_path.exists():
        return {
            "version": WORKSPACE_TEMPLATE_INDEX_VERSION,
            "updated_at": None,
            "entries": [],
        }
    try:
        raw = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {
            "version": WORKSPACE_TEMPLATE_INDEX_VERSION,
            "updated_at": None,
            "entries": [],
        }
    if not isinstance(raw, dict):
        return {
            "version": WORKSPACE_TEMPLATE_INDEX_VERSION,
            "updated_at": None,
            "entries": [],
        }
    entries = raw.get("entries")
    if not isinstance(entries, list):
        entries = []
    return {
        "version": int(raw.get("version") or WORKSPACE_TEMPLATE_INDEX_VERSION),
        "updated_at": _normalize_text(raw.get("updated_at")),
        "entries": [entry for entry in entries if isinstance(entry, dict)],
    }


def _save_workspace_template_index(workspace_root: Path, payload: dict[str, Any]) -> None:
    templates_dir, _, index_path = _workspace_template_paths(workspace_root)
    templates_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": WORKSPACE_TEMPLATE_INDEX_VERSION,
        "updated_at": _now_iso(),
        "entries": payload.get("entries") if isinstance(payload.get("entries"), list) else [],
    }
    index_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _cleanup_workspace_template_mirrors(workspace_root: Path, entries: list[dict[str, Any]]) -> None:
    _, mirrors_dir, _ = _workspace_template_paths(workspace_root)
    if not mirrors_dir.exists():
        return
    referenced_paths: set[str] = set()
    for entry in entries:
        relpath = _normalize_text(entry.get("template_mirror_relpath"))
        if relpath:
            referenced_paths.add(relpath.replace("\\", "/"))

    for candidate in mirrors_dir.glob("*.docx"):
        relpath = _safe_relpath(candidate, workspace_root)
        if relpath and relpath.replace("\\", "/") in referenced_paths:
            continue
        try:
            candidate.unlink(missing_ok=True)
        except OSError:
            continue


class HomeCompactStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._runtime_entries: dict[str, dict[str, Any]] = {}
        self._runtime_key_by_kernel: dict[str, str] = {}
        self._code_runtime_entries: dict[str, dict[str, Any]] = {}
        self._clients: dict[str, dict[str, Any]] = {}

    def reset(self) -> None:
        with self._lock:
            self._runtime_entries.clear()
            self._runtime_key_by_kernel.clear()
            self._code_runtime_entries.clear()
            self._clients.clear()

    def clear_mcp_clients(self) -> None:
        with self._lock:
            self._clients.clear()

    def _runtime_key(self, kernel_id: str, notebook_path: str) -> str:
        return f"{kernel_id}::{notebook_path}"

    def register_notebook_runtime(
        self,
        *,
        kernel_id: str,
        notebook_path: str | None,
        source_kind: str | None = None,
        state: str = "idle",
    ) -> dict[str, Any] | None:
        normalized_kernel = _normalize_text(kernel_id)
        normalized_path = _normalize_path(notebook_path)
        if normalized_kernel is None or normalized_path is None or not _is_ipynb_path(normalized_path):
            return None

        now = _now_ts()
        with self._lock:
            previous_key = self._runtime_key_by_kernel.get(normalized_kernel)
            key = self._runtime_key(normalized_kernel, normalized_path)
            if previous_key and previous_key != key:
                self._runtime_entries.pop(previous_key, None)

            entry = self._runtime_entries.setdefault(
                key,
                {
                    "key": key,
                    "kernel_id": normalized_kernel,
                    "notebook_path": normalized_path,
                    "created_at": _now_iso(),
                },
            )
            entry["kernel_id"] = normalized_kernel
            entry["notebook_path"] = normalized_path
            entry["notebook_name"] = Path(normalized_path).name
            entry["notebook_relpath"] = self._resolve_notebook_relpath(normalized_path)
            entry["source_kind"] = _normalize_text(source_kind) or entry.get("source_kind") or "notebook"
            entry["state"] = _normalize_text(state) or entry.get("state") or "idle"
            entry["updated_at"] = _now_iso()
            entry["updated_at_ts"] = now
            entry["heartbeat_at_ts"] = now
            self._runtime_key_by_kernel[normalized_kernel] = key
            return deepcopy(entry)

    def _resolve_notebook_relpath(self, notebook_path: str) -> str | None:
        workspace_root = _active_workspace_root()
        if workspace_root is None:
            return None
        return _safe_relpath(Path(notebook_path), workspace_root)

    def update_runtime_for_kernel(self, kernel_id: str, **updates: Any) -> dict[str, Any] | None:
        normalized_kernel = _normalize_text(kernel_id)
        if normalized_kernel is None:
            return None
        with self._lock:
            key = self._runtime_key_by_kernel.get(normalized_kernel)
            if key is None:
                path = _normalize_path(updates.get("notebook_path") or updates.get("path") or updates.get("source_path"))
                if path and _is_ipynb_path(path):
                    registered = self.register_notebook_runtime(
                        kernel_id=normalized_kernel,
                        notebook_path=path,
                        source_kind=updates.get("source_kind"),
                        state=str(updates.get("state") or "idle"),
                    )
                    if registered is None:
                        return None
                    key = registered["key"]
                else:
                    return None

            entry = self._runtime_entries.get(key)
            if entry is None:
                return None

            now = _now_ts()
            for field, value in updates.items():
                if value is None and field not in _RUNTIME_NULLABLE_FIELDS:
                    continue
                if field in {"path", "notebook_path", "source_path"}:
                    normalized_path = _normalize_path(value)
                    if normalized_path and _is_ipynb_path(normalized_path):
                        entry["notebook_path"] = normalized_path
                        entry["notebook_name"] = Path(normalized_path).name
                        entry["notebook_relpath"] = self._resolve_notebook_relpath(normalized_path)
                elif field in {"state", "execution_id", "current_cell_id", "progress_scope", "progress_stage", "progress_status"}:
                    entry[field] = _normalize_text(value)
                elif field == "shared_resource":
                    entry[field] = deepcopy(value) if isinstance(value, dict) else None
                elif field in {"error", "message", "last_output_preview", "last_output_type", "source_kind"}:
                    entry[field] = value
                else:
                    entry[field] = deepcopy(value)
            entry["updated_at"] = _now_iso()
            entry["updated_at_ts"] = now
            entry["heartbeat_at_ts"] = now
            return deepcopy(entry)

    def clear_notebook_runtime(self, kernel_id: str) -> None:
        normalized_kernel = _normalize_text(kernel_id)
        if normalized_kernel is None:
            return
        with self._lock:
            key = self._runtime_key_by_kernel.pop(normalized_kernel, None)
            if key:
                self._runtime_entries.pop(key, None)

    def register_code_runtime(
        self,
        *,
        file_path: str | None,
        run_id: str | None = None,
        state: str = "running",
    ) -> dict[str, Any] | None:
        normalized_path = _normalize_path(file_path)
        if normalized_path is None:
            return None
        now = _now_ts()
        with self._lock:
            entry = self._code_runtime_entries.setdefault(
                normalized_path,
                {
                    "file_path": normalized_path,
                    "file_name": Path(normalized_path).name,
                    "file_relpath": self._resolve_notebook_relpath(normalized_path),
                    "created_at": _now_iso(),
                    "runtime_kind": "code",
                    "source_kind": "code",
                },
            )
            entry["state"] = _normalize_text(state) or entry.get("state") or "running"
            entry["run_id"] = _normalize_text(run_id) or entry.get("run_id")
            entry["updated_at"] = _now_iso()
            entry["updated_at_ts"] = now
            entry["heartbeat_at_ts"] = now
            return deepcopy(entry)

    def update_code_runtime(
        self,
        *,
        file_path: str | None = None,
        run_id: str | None = None,
        **updates: Any,
    ) -> dict[str, Any] | None:
        normalized_path = _normalize_path(file_path)
        normalized_run_id = _normalize_text(run_id)
        with self._lock:
            entry = None
            if normalized_path is not None:
                entry = self._code_runtime_entries.get(normalized_path)
            if entry is None and normalized_run_id is not None:
                entry = next(
                    (item for item in self._code_runtime_entries.values() if item.get("run_id") == normalized_run_id),
                    None,
                )
            if entry is None:
                if normalized_path is None:
                    return None
                entry = self.register_code_runtime(
                    file_path=normalized_path,
                    run_id=normalized_run_id,
                    state=str(updates.get("state") or "running"),
                )
                if entry is None:
                    return None
                self._code_runtime_entries[normalized_path] = entry
                entry = self._code_runtime_entries[normalized_path]

            now = _now_ts()
            for field, value in updates.items():
                if value is None and field not in {"error", "message"}:
                    continue
                if field in {"state", "message", "error", "run_id"}:
                    entry[field] = _normalize_text(value) if field != "message" else value
                else:
                    entry[field] = deepcopy(value)
            if normalized_run_id:
                entry["run_id"] = normalized_run_id
            entry["updated_at"] = _now_iso()
            entry["updated_at_ts"] = now
            entry["heartbeat_at_ts"] = now
            return deepcopy(entry)

    def clear_code_runtime(self, *, file_path: str | None = None, run_id: str | None = None) -> None:
        normalized_path = _normalize_path(file_path)
        normalized_run_id = _normalize_text(run_id)
        with self._lock:
            if normalized_path is not None:
                self._code_runtime_entries.pop(normalized_path, None)
                return
            if normalized_run_id is None:
                return
            to_delete = [
                path
                for path, entry in self._code_runtime_entries.items()
                if entry.get("run_id") == normalized_run_id
            ]
            for path in to_delete:
                self._code_runtime_entries.pop(path, None)

    def get_runtime_by_kernel(self, kernel_id: str) -> dict[str, Any] | None:
        normalized_kernel = _normalize_text(kernel_id)
        if normalized_kernel is None:
            return None
        with self._lock:
            key = self._runtime_key_by_kernel.get(normalized_kernel)
            entry = self._runtime_entries.get(key or "")
            return deepcopy(entry) if entry else None

    def observe_notebook_message(self, message: dict[str, Any]) -> None:
        message_type = _normalize_text((message or {}).get("type"))
        if message_type not in _TRACKED_RUNTIME_MESSAGE_TYPES:
            return

        kernel_id = _normalize_text(message.get("kernel_id"))
        if kernel_id is None:
            return

        notebook_path = _normalize_path(
            message.get("notebook_path") or message.get("path") or message.get("source_path")
        )

        if notebook_path and _is_ipynb_path(notebook_path):
            self.register_notebook_runtime(
                kernel_id=kernel_id,
                notebook_path=notebook_path,
                source_kind=message.get("source_kind"),
                state="idle",
            )

        if message_type == "notebook_progress_update":
            self.update_runtime_for_kernel(
                kernel_id,
                notebook_path=notebook_path,
                state="running",
                execution_id=message.get("execution_id"),
                current_cell_id=message.get("cell_id"),
                progress_scope=message.get("progress_scope"),
                progress_stage=message.get("progress_stage"),
                progress_status=message.get("progress_status"),
                progress_percent=message.get("progress_percent"),
                progress_indeterminate=bool(message.get("progress_indeterminate")),
                shared_resource=message.get("shared_resource"),
                message=message.get("message"),
            )
            return

        if message_type == "notebook_cell_executed":
            self.update_runtime_for_kernel(
                kernel_id,
                notebook_path=notebook_path,
                state="idle",
                execution_id=message.get("execution_id"),
                current_cell_id=message.get("cell_id"),
                progress_scope=None,
                progress_stage=None,
                progress_status="completed",
                progress_percent=None,
                shared_resource=None,
                message=message.get("message"),
                error=None,
            )
            return

        if message_type in {"notebook_cell_error", "notebook_error"}:
            self.update_runtime_for_kernel(
                kernel_id,
                notebook_path=notebook_path,
                state="error",
                execution_id=message.get("execution_id"),
                current_cell_id=message.get("cell_id"),
                progress_scope=None,
                progress_stage=None,
                progress_status="failed",
                progress_percent=None,
                shared_resource=None,
                error=message.get("error") or message.get("message"),
                message=message.get("message") or message.get("error"),
            )
            return

        if message_type == "notebook_execution_cancelled":
            self.update_runtime_for_kernel(
                kernel_id,
                notebook_path=notebook_path,
                state="cancelled",
                execution_id=message.get("execution_id"),
                progress_scope=None,
                progress_stage=None,
                progress_status="cancelled",
                progress_percent=None,
                shared_resource=None,
            )
            return

        if message_type == "notebook_kernel_reset":
            self.update_runtime_for_kernel(
                kernel_id,
                notebook_path=notebook_path,
                state="idle",
                progress_scope=None,
                progress_stage=None,
                progress_status="idle",
                progress_percent=None,
                shared_resource=None,
                error=None,
            )
            return

        if message_type == "notebook_kernel_interrupted":
            self.update_runtime_for_kernel(
                kernel_id,
                notebook_path=notebook_path,
                state="interrupted",
                progress_scope=None,
                progress_stage=None,
                progress_status="interrupted",
                progress_percent=None,
                shared_resource=None,
            )
            return

        if message_type == "notebook_kernel_shutdown":
            self.clear_notebook_runtime(kernel_id)
            return

        if message_type == "notebook_docx_update":
            self.update_runtime_for_kernel(
                kernel_id,
                notebook_path=notebook_path,
                last_document_update_at=_now_iso(),
                last_document_execution_id=message.get("execution_id"),
                docx_artifact_id=message.get("docx_artifact_id"),
                docx_ref=message.get("docx_ref"),
                pdf_ref=message.get("pdf_ref"),
                workspace_path=message.get("workspace_path"),
                workspace_relpath=message.get("workspace_relpath"),
            )
            return

        if message_type == "notebook_pdf_ready":
            pdf_conversion_error = _normalize_text(message.get("pdf_conversion_error"))
            self.update_runtime_for_kernel(
                kernel_id,
                notebook_path=notebook_path,
                state="error" if pdf_conversion_error else "idle",
                progress_scope=None,
                progress_stage=None,
                progress_status="failed" if pdf_conversion_error else "completed",
                progress_percent=None,
                shared_resource=None,
                error=pdf_conversion_error,
                message=pdf_conversion_error or message.get("message") or "PDF listo",
                last_document_update_at=_now_iso(),
                last_document_execution_id=message.get("execution_id"),
                docx_artifact_id=message.get("docx_artifact_id"),
                docx_ref=message.get("docx_ref"),
                pdf_ref=message.get("pdf_ref"),
                workspace_path=message.get("workspace_path"),
                workspace_relpath=message.get("workspace_relpath"),
            )
            return

        if message_type == "template_deleted":
            self.update_runtime_for_kernel(
                kernel_id,
                notebook_path=notebook_path,
                template_attached=False,
                template_updated_at=_now_iso(),
            )
            self.clear_template_association_for_kernel(kernel_id)
            return

        if message_type in _TEMPLATE_MUTATION_MESSAGE_TYPES:
            self.update_runtime_for_kernel(
                kernel_id,
                notebook_path=notebook_path,
                template_attached=True,
                template_token=message.get("template_token"),
                template_updated_at=_now_iso(),
            )
            self.persist_template_association_for_kernel(
                kernel_id,
                template_token=message.get("template_token"),
            )

    def _copy_runtime_entries(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                *[deepcopy(entry) for entry in self._runtime_entries.values()],
                *[deepcopy(entry) for entry in self._code_runtime_entries.values()],
            ]

    def snapshot_runtime_entries(self, *, workspace_root: str | None = None) -> list[dict[str, Any]]:
        entries = self._copy_runtime_entries()
        root_path = _normalize_path(workspace_root)
        if root_path:
            resolved_root = Path(root_path)
            filtered: list[dict[str, Any]] = []
            for entry in entries:
                resource_path = _normalize_path(entry.get("notebook_path") or entry.get("file_path"))
                if resource_path is None:
                    continue
                if _safe_relpath(Path(resource_path), resolved_root) is None:
                    continue
                filtered.append(entry)
            entries = filtered
        entries.sort(
            key=lambda item: (
                item.get("notebook_relpath")
                or item.get("file_relpath")
                or item.get("notebook_name")
                or item.get("file_name")
                or "",
                item.get("kernel_id") or item.get("run_id") or "",
            )
        )
        return entries

    def _workspace_notebook_and_runtime(self, kernel_id: str) -> tuple[Path | None, dict[str, Any] | None, Path | None]:
        runtime_entry = self.get_runtime_by_kernel(kernel_id)
        notebook_path = _normalize_path((runtime_entry or {}).get("notebook_path"))
        workspace_root = _active_workspace_root()
        if workspace_root is None or notebook_path is None:
            return None, runtime_entry, workspace_root
        notebook_file = Path(notebook_path)
        if _safe_relpath(notebook_file, workspace_root) is None:
            return None, runtime_entry, workspace_root
        return notebook_file, runtime_entry, workspace_root

    def persist_template_association_for_kernel(
        self,
        kernel_id: str,
        *,
        template_token: str | None = None,
    ) -> dict[str, Any] | None:
        notebook_file, runtime_entry, workspace_root = self._workspace_notebook_and_runtime(kernel_id)
        if notebook_file is None or workspace_root is None:
            return None

        from app.services import template_service

        template_docx_path = template_service.get_template_docx_path(kernel_id)
        if not template_docx_path:
            return None

        source_path = Path(template_docx_path)
        if not source_path.exists() or not source_path.is_file():
            return None

        docx_bytes = source_path.read_bytes()
        if not docx_bytes:
            return None

        _, mirrors_dir, _ = _workspace_template_paths(workspace_root)
        mirrors_dir.mkdir(parents=True, exist_ok=True)

        template_hash = hashlib.sha256(docx_bytes).hexdigest()
        mirror_name = f"{_slugify_filename(notebook_file.stem)}--{template_hash[:12]}.docx"
        mirror_path = mirrors_dir / mirror_name
        if not mirror_path.exists():
            mirror_path.write_bytes(docx_bytes)

        relpath = _safe_relpath(notebook_file, workspace_root)
        mirror_relpath = _safe_relpath(mirror_path, workspace_root)
        if relpath is None or mirror_relpath is None:
            return None

        index_payload = _load_workspace_template_index(workspace_root)
        entries = [entry for entry in index_payload["entries"] if entry.get("notebook_path") != str(notebook_file)]
        entry = {
            "entry_id": hashlib.sha1(str(notebook_file).encode("utf-8")).hexdigest()[:16],
            "kernel_id": _normalize_text(kernel_id),
            "notebook_path": str(notebook_file),
            "notebook_relpath": relpath,
            "template_token": _normalize_text(template_token) or _normalize_text((runtime_entry or {}).get("template_token")),
            "template_hash": template_hash,
            "template_source_path": str(source_path),
            "template_mirror_path": str(mirror_path),
            "template_mirror_relpath": mirror_relpath,
            "template_size_bytes": len(docx_bytes),
            "style_count": self._template_style_count(kernel_id),
            "updated_at": _now_iso(),
        }
        entries.append(entry)
        entries.sort(key=lambda item: str(item.get("notebook_relpath") or item.get("notebook_path") or ""))
        _save_workspace_template_index(workspace_root, {"entries": entries})
        _cleanup_workspace_template_mirrors(workspace_root, entries)

        self.update_runtime_for_kernel(
            kernel_id,
            template_attached=True,
            template_token=entry.get("template_token"),
            template_updated_at=entry["updated_at"],
            template_hash=template_hash,
            template_mirror_path=str(mirror_path),
            template_mirror_relpath=mirror_relpath,
        )
        return entry

    def _template_style_count(self, kernel_id: str) -> int | None:
        try:
            from app.services import template_service

            template_payload = template_service.get_template(kernel_id) or {}
        except Exception:
            return None
        styles = template_payload.get("styles")
        if not isinstance(styles, list):
            return None
        return len(styles)

    def clear_template_association_for_kernel(self, kernel_id: str) -> bool:
        notebook_file, _, workspace_root = self._workspace_notebook_and_runtime(kernel_id)
        if notebook_file is None or workspace_root is None:
            return False
        return self.clear_template_association_for_notebook(notebook_file)

    def clear_template_association_for_notebook(self, notebook_path: str | Path) -> bool:
        workspace_root = _active_workspace_root()
        if workspace_root is None:
            return False
        normalized_notebook_path = _normalize_path(str(notebook_path))
        if normalized_notebook_path is None:
            return False

        index_payload = _load_workspace_template_index(workspace_root)
        entries = [entry for entry in index_payload["entries"] if entry.get("notebook_path") != normalized_notebook_path]
        changed = len(entries) != len(index_payload["entries"])
        if not changed:
            return False
        _save_workspace_template_index(workspace_root, {"entries": entries})
        _cleanup_workspace_template_mirrors(workspace_root, entries)
        return True

    def register_client_heartbeat(self, payload: dict[str, Any]) -> dict[str, Any]:
        client_id = _normalize_text(payload.get("client_id")) or _normalize_text(payload.get("session_id"))
        if client_id is None:
            raise ValueError("client_id is required")

        now = _now_ts()
        with self._lock:
            entry = self._clients.setdefault(
                client_id,
                {
                    "client_id": client_id,
                    "created_at": _now_iso(),
                },
            )
            entry["client_id"] = client_id
            entry["client_label"] = _normalize_text(payload.get("client_label")) or entry.get("client_label")
            entry["transport"] = _normalize_text(payload.get("transport")) or entry.get("transport") or "streamable-http"
            entry["session_id"] = _normalize_text(payload.get("session_id")) or entry.get("session_id") or client_id
            if "metadata" in payload and isinstance(payload.get("metadata"), dict):
                entry["metadata"] = deepcopy(payload.get("metadata"))
            if "workspace_path" in payload:
                entry["workspace_path"] = _normalize_path(payload.get("workspace_path"))
            if "active_runs" in payload:
                active_runs = payload.get("active_runs")
                if isinstance(active_runs, list):
                    entry["active_runs"] = [str(item) for item in active_runs if _normalize_text(item)]
                elif isinstance(active_runs, int):
                    entry["active_run_count"] = max(0, int(active_runs))
            entry["last_seen_at"] = _now_iso()
            entry["last_seen_at_ts"] = now
            entry["updated_at"] = entry["last_seen_at"]
            entry["updated_at_ts"] = now
            entry["status"] = "active"
            return deepcopy(entry)

    def observe_mcp_activity_event(self, event: dict[str, Any]) -> dict[str, Any]:
        client_id = _normalize_text(event.get("client_id"))
        now = _now_ts()

        with self._lock:
            if client_id:
                entry = self._clients.setdefault(
                    client_id,
                    {
                        "client_id": client_id,
                        "created_at": _now_iso(),
                    },
                )
                if _normalize_text(event.get("client_label")):
                    entry["client_label"] = _normalize_text(event.get("client_label"))
                if _normalize_text(event.get("transport")):
                    entry["transport"] = _normalize_text(event.get("transport"))
                if _normalize_text(event.get("run_id")):
                    entry["last_run_id"] = _normalize_text(event.get("run_id"))
                entry["last_activity_at"] = _normalize_text(event.get("ts")) or _now_iso()
                entry["last_activity_at_ts"] = now
                entry["last_activity_summary"] = _normalize_text(event.get("summary")) or entry.get("last_activity_summary")
                phase = _normalize_text(event.get("phase")) or "started"
                active_runs = set(entry.get("active_runs") or [])
                run_id = _normalize_text(event.get("run_id"))
                if run_id:
                    if phase == "started":
                        active_runs.add(run_id)
                    else:
                        active_runs.discard(run_id)
                entry["active_runs"] = sorted(active_runs)
                entry["active_run_count"] = len(active_runs)
                if "last_seen_at_ts" not in entry:
                    entry["last_seen_at_ts"] = now
                    entry["last_seen_at"] = _normalize_text(event.get("ts")) or _now_iso()
                entry["updated_at"] = _now_iso()
                entry["updated_at_ts"] = now

                event = dict(event)
                if not _normalize_text(event.get("client_label")) and _normalize_text(entry.get("client_label")):
                    event["client_label"] = entry["client_label"]
                if not _normalize_text(event.get("transport")) and _normalize_text(entry.get("transport")):
                    event["transport"] = entry["transport"]

            return event

    def mark_clients_stale(self) -> None:
        cutoff = _now_ts() - MCP_CLIENT_STALE_AFTER_S
        with self._lock:
            for entry in self._clients.values():
                last_seen = float(entry.get("last_seen_at_ts") or 0.0)
                last_activity = float(entry.get("last_activity_at_ts") or 0.0)
                latest = max(last_seen, last_activity)
                entry["status"] = "active" if latest >= cutoff or entry.get("active_runs") else "stale"

    def snapshot_clients_grouped(self) -> dict[str, Any]:
        self.mark_clients_stale()
        with self._lock:
            items = [deepcopy(entry) for entry in self._clients.values()]

        items.sort(key=lambda item: (item.get("status") != "active", item.get("client_label") or item.get("client_id") or ""))
        by_status: dict[str, list[dict[str, Any]]] = {}
        by_transport: dict[str, list[dict[str, Any]]] = {}
        for item in items:
            status = _normalize_text(item.get("status")) or "stale"
            by_status.setdefault(status, []).append(item)
            transport = _normalize_text(item.get("transport")) or "unknown"
            by_transport.setdefault(transport, []).append(item)

        return {
            "total": len(items),
            "active": len(by_status.get("active", [])),
            "stale": len(by_status.get("stale", [])),
            "by_status": by_status,
            "by_transport": by_transport,
            "items": items,
        }

    def discover_workspace_notebooks(self, workspace_root: Path) -> dict[str, Any]:
        discovered: list[dict[str, Any]] = []
        total_seen = 0
        internal_seen = 0
        for root, dirnames, filenames in os.walk(workspace_root):
            dirnames[:] = [name for name in dirnames if name not in NOTEBOOK_DIR_IGNORE_NAMES]
            for filename in sorted(filenames):
                if not filename.lower().endswith(".ipynb"):
                    continue
                total_seen += 1
                if len(discovered) >= NOTEBOOK_SCAN_LIMIT:
                    continue
                notebook_path = Path(root) / filename
                relpath = _safe_relpath(notebook_path, workspace_root)
                workspace_role, workspace_role_reason, workspace_rank = _classify_home_notebook_relpath(relpath)
                if workspace_role == "internal":
                    internal_seen += 1
                    continue
                discovered.append(
                    {
                        "notebook_path": str(notebook_path.resolve()),
                        "notebook_relpath": relpath or filename,
                        "exists": True,
                        "workspace_role": workspace_role,
                        "workspace_role_reason": workspace_role_reason,
                        "home_rank": workspace_rank,
                    }
                )
        discovered.sort(key=lambda item: (
            int(item.get("home_rank") or 0),
            item.get("notebook_relpath") or item.get("notebook_path") or "",
        ))
        return {
            "items": discovered,
            "count": total_seen - internal_seen,
            "total_seen_count": total_seen,
            "internal_count": internal_seen,
            "returned": len(discovered),
            "truncated": (total_seen - internal_seen) > len(discovered),
            "limit": NOTEBOOK_SCAN_LIMIT,
        }

    def build_template_inventory(self, workspace_root: Path) -> dict[str, Any]:
        discovery = self.discover_workspace_notebooks(workspace_root)
        runtime_entries = self.snapshot_runtime_entries(workspace_root=str(workspace_root))
        runtime_by_path = {
            _normalize_path(entry.get("notebook_path")): entry
            for entry in runtime_entries
            if _normalize_path(entry.get("notebook_path"))
        }
        index_payload = _load_workspace_template_index(workspace_root)
        persisted_by_path = {
            _normalize_path(entry.get("notebook_path")): entry
            for entry in index_payload.get("entries", [])
            if _normalize_path(entry.get("notebook_path"))
        }

        inventory_items: list[dict[str, Any]] = []
        seen_paths: set[str] = set()
        try:
            from app.services import template_binding as template_binding_service
        except Exception:
            template_binding_service = None
        for discovered in discovery["items"]:
            notebook_path = _normalize_path(discovered.get("notebook_path"))
            if notebook_path is None:
                continue
            seen_paths.add(notebook_path)
            persisted = persisted_by_path.get(notebook_path) or {}
            runtime_entry = runtime_by_path.get(notebook_path) or {}
            binding_status = None
            if template_binding_service is not None:
                try:
                    binding_status = template_binding_service.inspect_notebook_template_binding(notebook_path)
                except Exception:
                    binding_status = None
            binding_active = bool(binding_status and binding_status.get("status") not in {"none", None})
            template_attached = binding_active or bool(persisted)
            inventory_items.append(
                {
                    "notebook_path": notebook_path,
                    "notebook_relpath": discovered.get("notebook_relpath"),
                    "exists": True,
                    "workspace_role": discovered.get("workspace_role") or "workspace",
                    "workspace_role_reason": discovered.get("workspace_role_reason"),
                    "home_rank": discovered.get("home_rank") or 10,
                    "kernel_id": runtime_entry.get("kernel_id") or persisted.get("kernel_id"),
                    "runtime_state": runtime_entry.get("state"),
                    "runtime_updated_at": runtime_entry.get("updated_at"),
                    "template_attached": template_attached,
                    "template_binding": binding_status,
                    "template_binding_status": binding_status.get("status") if binding_status else None,
                    "template_json_path": binding_status.get("template_json_path") if binding_status else None,
                    "template_json_relpath": binding_status.get("template_json_relpath") if binding_status else None,
                    "template_legacy": bool(persisted and not binding_active),
                    "template_hash": persisted.get("template_hash"),
                    "template_token": persisted.get("template_token"),
                    "template_mirror_path": persisted.get("template_mirror_path"),
                    "template_mirror_relpath": persisted.get("template_mirror_relpath"),
                    "template_updated_at": persisted.get("updated_at"),
                    "style_count": persisted.get("style_count"),
                }
            )

        for notebook_path, persisted in persisted_by_path.items():
            if notebook_path is None or notebook_path in seen_paths:
                continue
            workspace_role, workspace_role_reason, workspace_rank, relpath = _classify_home_notebook_path(
                notebook_path,
                workspace_root,
            )
            if workspace_role == "internal":
                continue
            runtime_entry = runtime_by_path.get(notebook_path) or {}
            binding_status = None
            if template_binding_service is not None and Path(notebook_path).exists():
                try:
                    binding_status = template_binding_service.inspect_notebook_template_binding(notebook_path)
                except Exception:
                    binding_status = None
            binding_active = bool(binding_status and binding_status.get("status") not in {"none", None})
            inventory_items.append(
                {
                    "notebook_path": notebook_path,
                    "notebook_relpath": persisted.get("notebook_relpath") or relpath,
                    "exists": Path(notebook_path).exists(),
                    "workspace_role": workspace_role,
                    "workspace_role_reason": workspace_role_reason,
                    "home_rank": workspace_rank,
                    "kernel_id": runtime_entry.get("kernel_id") or persisted.get("kernel_id"),
                    "runtime_state": runtime_entry.get("state"),
                    "runtime_updated_at": runtime_entry.get("updated_at"),
                    "template_attached": True,
                    "template_binding": binding_status,
                    "template_binding_status": binding_status.get("status") if binding_status else None,
                    "template_json_path": binding_status.get("template_json_path") if binding_status else None,
                    "template_json_relpath": binding_status.get("template_json_relpath") if binding_status else None,
                    "template_legacy": not binding_active,
                    "template_hash": persisted.get("template_hash"),
                    "template_token": persisted.get("template_token"),
                    "template_mirror_path": persisted.get("template_mirror_path"),
                    "template_mirror_relpath": persisted.get("template_mirror_relpath"),
                    "template_updated_at": persisted.get("updated_at"),
                    "style_count": persisted.get("style_count"),
                }
            )

        inventory_items.sort(key=lambda item: (
            0 if item.get("template_attached") else 1,
            int(item.get("home_rank") or 10),
            item.get("notebook_relpath") or item.get("notebook_path") or "",
        ))
        return {
            "items": inventory_items,
            "count": len(inventory_items),
            "scan": {
                "discovered_count": discovery["count"],
                "total_seen_count": discovery.get("total_seen_count", discovery["count"]),
                "internal_count": discovery.get("internal_count", 0),
                "returned_count": discovery["returned"],
                "truncated": discovery["truncated"],
                "limit": discovery["limit"],
            },
        }

    def _build_client_activity_slice(
        self,
        client: dict[str, Any],
        *,
        events: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        client_id = _normalize_text(client.get("client_id"))
        client_label = _normalize_text(client.get("client_label"))
        matched: list[dict[str, Any]] = []
        for event in events:
            event_client_id = _normalize_text(event.get("client_id"))
            event_client_label = _normalize_text(event.get("client_label"))
            if client_id and event_client_id == client_id:
                matched.append(event)
                continue
            if client_label and event_client_label == client_label:
                matched.append(event)

        matched.sort(key=lambda item: item.get("ts") or "", reverse=True)
        return [
            {
                "event_id": event.get("event_id"),
                "run_id": event.get("run_id"),
                "phase": event.get("phase"),
                "status": event.get("status"),
                "summary": event.get("summary"),
                "detail": event.get("detail"),
                "tool_name": event.get("tool_name"),
                "ts": event.get("ts"),
            }
            for event in matched[:5]
        ]

    def build_home_summary(
        self,
        *,
        mcp_server: dict[str, Any],
        mcp_activity_snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        from app.services.docx_artifacts import list_workspace_docx_artifacts

        workspace_snapshot = workspace_service.get_workspace_snapshot()
        workspace_root = _normalize_path(workspace_snapshot.get("active_workspace")) or _normalize_path(workspace_snapshot.get("workspace_root"))
        runtime_entries = self.snapshot_runtime_entries(workspace_root=workspace_root)
        template_inventory_summary = (
            self.build_template_inventory(Path(workspace_root))
            if workspace_root and Path(workspace_root).exists()
            else {"items": [], "count": 0, "scan": {"discovered_count": 0, "total_seen_count": 0, "internal_count": 0, "returned_count": 0, "truncated": False, "limit": NOTEBOOK_SCAN_LIMIT}}
        )
        recent_docx_items = list_workspace_docx_artifacts(
            workspace_root=workspace_root,
            limit=32,
            include_empty=False,
        ) if workspace_root else []
        if workspace_root:
            workspace_root_path = Path(workspace_root)
            filtered_docx_items: list[dict[str, Any]] = []
            for item in recent_docx_items:
                if bool(item.get("docx_is_empty")):
                    continue
                source_path = _normalize_path(item.get("source_path"))
                if _is_ipynb_path(source_path):
                    role, _, _, _ = _classify_home_notebook_path(source_path, workspace_root_path)
                    if role == "internal":
                        continue
                filtered_docx_items.append(item)
            recent_docx_items = filtered_docx_items[:8]
        mcp_clients_summary = self.snapshot_clients_grouped()

        template_by_path = {
            _normalize_path(item.get("notebook_path")): item
            for item in template_inventory_summary["items"]
            if _normalize_path(item.get("notebook_path"))
        }
        latest_docx_by_path: dict[str, dict[str, Any]] = {}
        for item in recent_docx_items:
            source_path = _normalize_path(item.get("source_path"))
            if source_path and source_path not in latest_docx_by_path:
                latest_docx_by_path[source_path] = item

        notebook_runtime_items: list[dict[str, Any]] = []
        code_runtime_items: list[dict[str, Any]] = []
        for entry in runtime_entries:
            runtime_kind = _normalize_text(entry.get("runtime_kind") or entry.get("source_kind")) or "notebook"
            if runtime_kind == "code":
                progress_percent = entry.get("progress_percent")
                try:
                    progress_percent_value = float(progress_percent) if progress_percent is not None else None
                except (TypeError, ValueError):
                    progress_percent_value = None
                code_runtime_items.append(
                    {
                        **entry,
                        "progress": {
                            "scope": entry.get("progress_scope"),
                            "stage": entry.get("progress_stage"),
                            "status": entry.get("progress_status"),
                            "percent": progress_percent_value,
                            "indeterminate": bool(entry.get("progress_indeterminate")),
                            "shared_resource": deepcopy(entry.get("shared_resource")) if isinstance(entry.get("shared_resource"), dict) else None,
                            "message": entry.get("message"),
                            "updated_at": entry.get("updated_at"),
                        },
                    }
                )
                continue
            notebook_path = _normalize_path(entry.get("notebook_path"))
            template_entry = template_by_path.get(notebook_path) or {}
            latest_docx = latest_docx_by_path.get(notebook_path)
            progress_percent = entry.get("progress_percent")
            try:
                progress_percent_value = float(progress_percent) if progress_percent is not None else None
            except (TypeError, ValueError):
                progress_percent_value = None
            notebook_runtime_items.append(
                {
                    **entry,
                    "progress": {
                        "scope": entry.get("progress_scope"),
                        "stage": entry.get("progress_stage"),
                        "status": entry.get("progress_status"),
                        "percent": progress_percent_value,
                        "indeterminate": bool(entry.get("progress_indeterminate")),
                        "shared_resource": deepcopy(entry.get("shared_resource")) if isinstance(entry.get("shared_resource"), dict) else None,
                        "message": entry.get("message"),
                        "updated_at": entry.get("updated_at"),
                    },
                    "template_attached": bool(template_entry.get("template_attached") or entry.get("template_attached")),
                    "template_token": template_entry.get("template_token") or entry.get("template_token"),
                    "template_hash": template_entry.get("template_hash") or entry.get("template_hash"),
                    "template_mirror_path": template_entry.get("template_mirror_path") or entry.get("template_mirror_path"),
                    "template_mirror_relpath": template_entry.get("template_mirror_relpath") or entry.get("template_mirror_relpath"),
                    "template_updated_at": template_entry.get("template_updated_at") or entry.get("template_updated_at"),
                    "template_style_count": template_entry.get("style_count"),
                    "latest_docx_item": deepcopy(latest_docx) if latest_docx else None,
                }
            )

        mcp_events = mcp_activity_snapshot.get("events", [])
        mcp_clients = [
            {
                **client,
                "recent_activity": self._build_client_activity_slice(client, events=mcp_events),
            }
            for client in mcp_clients_summary.get("items", [])
        ]
        template_attached_count = sum(1 for item in template_inventory_summary["items"] if item.get("template_attached"))
        runtime_active_count = sum(1 for item in runtime_entries if item.get("state") == "running")
        updated_at = _now_iso()
        mcp_service = {
            **mcp_server,
            "activity": {
                "active_count": mcp_activity_snapshot.get("active_count", 0),
                "active_runs": mcp_activity_snapshot.get("active_runs", []),
                "events": mcp_events,
                "tool_summary": mcp_activity_snapshot.get("tool_summary", []),
            },
            "client_count": mcp_clients_summary["total"],
            "client_active_count": mcp_clients_summary["active"],
        }

        return {
            "generated_at": updated_at,
            "updated_at": updated_at,
            "workspace": workspace_snapshot,
            "workspace_path": workspace_root,
            "overview": {
                "workspace_notebook_count": template_inventory_summary["scan"]["discovered_count"],
                "template_attached_count": template_attached_count,
                "runtime_notebook_count": len(notebook_runtime_items),
                "runtime_code_count": len(code_runtime_items),
                "runtime_total_count": len(runtime_entries),
                "runtime_active_count": runtime_active_count,
                "mcp_client_count": mcp_clients_summary["total"],
                "mcp_client_active_count": mcp_clients_summary["active"],
                "mcp_active_run_count": mcp_activity_snapshot.get("active_count", 0),
                "recent_docx_count": len(recent_docx_items),
            },
            "mcp_service": mcp_service,
            "notebook_runtime_items": notebook_runtime_items,
            "code_runtime_items": code_runtime_items,
            "runtime_items": [*notebook_runtime_items, *code_runtime_items],
            "recent_docx_items": recent_docx_items,
            "mcp_clients": mcp_clients,
            "template_inventory": template_inventory_summary["items"],
            "mcp": mcp_service,
            "mcp_clients_summary": mcp_clients_summary,
            "notebook_runtime": notebook_runtime_items,
            "template_inventory_summary": template_inventory_summary,
        }


home_compact_store = HomeCompactStore()
