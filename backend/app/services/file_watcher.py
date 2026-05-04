"""Watcher del workspace activo para refresco del explorer."""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path
from typing import Any

from app.core.security import is_hidden_name, is_hard_ignored_name
from app.services import workspace_service
from app.services.websocket_manager import manager

try:
    from watchdog.events import FileSystemEvent, FileSystemEventHandler
    from watchdog.observers import Observer
except Exception:  # pragma: no cover - degradacion si watchdog no existe
    FileSystemEvent = Any  # type: ignore[assignment]
    FileSystemEventHandler = object  # type: ignore[assignment]
    Observer = None  # type: ignore[assignment]


EVENT_BATCH_WINDOW_MS = max(50, int(os.getenv("INSPYRO_FS_EVENT_BATCH_MS", "150")))
EVENT_QUEUE_MAXSIZE = max(32, int(os.getenv("INSPYRO_FS_EVENT_QUEUE_MAXSIZE", "512")))


def _normalize_path(path: str | None) -> Path | None:
    if not path:
        return None
    try:
        return Path(path).expanduser().resolve(strict=False)
    except OSError:
        return None


def _is_under_workspace(path: Path | None, workspace_path: Path) -> bool:
    if path is None:
        return False
    try:
        path.relative_to(workspace_path)
        return True
    except ValueError:
        return False


def _has_hard_ignored_part(path: Path, workspace_path: Path) -> bool:
    try:
        relative_parts = path.relative_to(workspace_path).parts
    except ValueError:
        relative_parts = path.parts
    return any(is_hard_ignored_name(part) for part in relative_parts)


def normalize_workspace_event(raw_event: dict[str, Any], workspace_path: str | Path) -> dict[str, Any] | None:
    """Normaliza un evento crudo del watcher a payload WS estable."""
    workspace_root = Path(workspace_path).expanduser().resolve(strict=False)
    action = str(raw_event.get("action") or "").strip().lower()
    path = _normalize_path(raw_event.get("path"))
    old_path = _normalize_path(raw_event.get("oldPath"))
    is_directory = bool(raw_event.get("isDirectory"))
    timestamp = float(raw_event.get("ts") or time.time())

    if action not in {"created", "deleted", "modified", "moved"}:
        return None

    if action == "moved":
        path_in_workspace = _is_under_workspace(path, workspace_root)
        old_in_workspace = _is_under_workspace(old_path, workspace_root)
        if path_in_workspace and not old_in_workspace:
            action = "created"
            old_path = None
        elif old_in_workspace and not path_in_workspace:
            action = "deleted"
            path = old_path
            old_path = None
        elif not path_in_workspace and not old_in_workspace:
            return None

    if not _is_under_workspace(path, workspace_root):
        return None

    assert path is not None

    if _has_hard_ignored_part(path, workspace_root):
        return None
    if old_path is not None and _has_hard_ignored_part(old_path, workspace_root):
        old_path = None

    if action == "modified" and is_directory:
        return None

    return {
        "action": action,
        "path": str(path),
        "oldPath": str(old_path) if old_path else None,
        "parentPath": str(path.parent),
        "isDirectory": is_directory,
        "hidden": is_hidden_name(path.name),
        "ts": timestamp,
    }


def build_workspace_fs_message(raw_events: list[dict[str, Any]], workspace_path: str | Path) -> dict[str, Any] | None:
    """Construye el payload WS batch para el explorer."""
    workspace_root = Path(workspace_path).expanduser().resolve(strict=False)
    seen: set[tuple[str, str, str | None]] = set()
    normalized_events: list[dict[str, Any]] = []

    for raw_event in raw_events:
        normalized = normalize_workspace_event(raw_event, workspace_root)
        if not normalized:
            continue
        dedupe_key = (
            str(normalized["action"]),
            str(normalized["path"]),
            str(normalized.get("oldPath")) if normalized.get("oldPath") else None,
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        normalized_events.append(normalized)

    if not normalized_events:
        return None

    return {
        "type": "workspace_fs_event",
        "workspace_path": str(workspace_root),
        "events": normalized_events,
    }


class _WorkspaceEventHandler(FileSystemEventHandler):
    def __init__(self, watcher: "WorkspaceFileWatcher") -> None:
        self._watcher = watcher

    def _emit(self, action: str, event: FileSystemEvent) -> None:
        path = getattr(event, "src_path", None)
        old_path = None
        if action == "moved":
            path = getattr(event, "dest_path", None)
            old_path = getattr(event, "src_path", None)
        self._watcher.push_raw_event(
            {
                "action": action,
                "path": path,
                "oldPath": old_path,
                "isDirectory": bool(getattr(event, "is_directory", False)),
                "ts": time.time(),
            }
        )

    def on_created(self, event: FileSystemEvent) -> None:  # pragma: no cover - thread callback
        self._emit("created", event)

    def on_deleted(self, event: FileSystemEvent) -> None:  # pragma: no cover - thread callback
        self._emit("deleted", event)

    def on_modified(self, event: FileSystemEvent) -> None:  # pragma: no cover - thread callback
        self._emit("modified", event)

    def on_moved(self, event: FileSystemEvent) -> None:  # pragma: no cover - thread callback
        self._emit("moved", event)


class WorkspaceFileWatcher:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue[dict[str, Any]] | None = None
        self._pump_task: asyncio.Task[None] | None = None
        self._observer: Observer | None = None  # type: ignore[type-arg]
        self._workspace_path: str | None = None
        self._available = Observer is not None

    @property
    def available(self) -> bool:
        return self._available

    @property
    def workspace_path(self) -> str | None:
        return self._workspace_path

    def push_raw_event(self, raw_event: dict[str, Any]) -> None:
        if self._loop is None or self._queue is None:
            return

        def _enqueue() -> None:
            if self._queue is None:
                return
            if self._queue.full():
                try:
                    self._queue.get_nowait()
                    self._queue.task_done()
                except asyncio.QueueEmpty:
                    pass
            try:
                self._queue.put_nowait(raw_event)
            except asyncio.QueueFull:
                pass

        self._loop.call_soon_threadsafe(_enqueue)

    async def start(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        if self._loop is not None:
            return

        self._loop = loop or asyncio.get_running_loop()
        self._queue = asyncio.Queue(maxsize=EVENT_QUEUE_MAXSIZE)
        self._pump_task = asyncio.create_task(self._pump_events())

        snapshot = workspace_service.get_workspace_snapshot()
        await self.update_workspace(snapshot.get("active_workspace"))

    async def stop(self) -> None:
        if self._observer is not None:
            self._observer.stop()
            self._observer.join(timeout=2)
            self._observer = None

        if self._pump_task is not None:
            self._pump_task.cancel()
            try:
                await self._pump_task
            except asyncio.CancelledError:
                pass
            self._pump_task = None

        self._workspace_path = None
        self._queue = None
        self._loop = None

    async def update_workspace(self, workspace_path: str | None) -> None:
        normalized = None
        if workspace_path:
            try:
                candidate = Path(workspace_path).expanduser().resolve(strict=False)
                if candidate.exists() and candidate.is_dir():
                    normalized = str(candidate)
            except OSError:
                normalized = None

        if normalized == self._workspace_path:
            return

        self._workspace_path = normalized

        if self._observer is not None:
            self._observer.stop()
            self._observer.join(timeout=2)
            self._observer = None

        if not normalized or not self._available:
            return

        handler = _WorkspaceEventHandler(self)
        observer = Observer()  # type: ignore[operator]
        observer.daemon = True
        observer.schedule(handler, normalized, recursive=True)
        observer.start()
        self._observer = observer

    async def _pump_events(self) -> None:
        assert self._queue is not None
        queue = self._queue

        while True:
            first = await queue.get()
            pending = [first]
            queue.task_done()

            deadline = time.monotonic() + (EVENT_BATCH_WINDOW_MS / 1000.0)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=remaining)
                except asyncio.TimeoutError:
                    break
                pending.append(item)
                queue.task_done()

            workspace_path = self._workspace_path
            if not workspace_path:
                continue

            message = build_workspace_fs_message(pending, workspace_path)
            if message:
                await manager.broadcast(message)


workspace_fs_watcher = WorkspaceFileWatcher()
