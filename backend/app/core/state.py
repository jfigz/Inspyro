import asyncio
import os
from contextlib import suppress
from typing import Dict, Set, Tuple, Optional
from fastapi import WebSocket

# Opcionales para operaciones de limpieza, se importan localmente o aquí
from app.services.jupyter_kernel import jupyter_kernel_manager
from app.services.template import storage as template_storage
from app.services.template import preview as template_preview
from app.services import template_service
from app.services.notebook_service import clear_kernel_runtime_state
from librerias_propias.docx_builder.api import cleanup_inline_builders

# =============================================================================
# MANEJO DE ESTADO GLOBAL (conexiones, templates locks, ejecuciones)
# =============================================================================

_connection_kernels: Dict[int, Set[str]] = {}
_connection_kernels_lock = asyncio.Lock()

_template_mutation_locks: Dict[str, asyncio.Lock] = {}
_template_mutation_locks_lock = asyncio.Lock()

_preview_latest_request: Dict[Tuple[str, str], Optional[str]] = {}
_preview_latest_lock = asyncio.Lock()
_PREVIEW_TRACK_MAX_PER_KERNEL = max(8, int(os.getenv("INSPYRO_TEMPLATE_PREVIEW_TRACK_MAX_PER_KERNEL", "128")))

_queued_executions_by_kernel: Dict[str, Set[str]] = {}
_active_execution_by_kernel: Dict[str, str] = {}
_cancelled_executions_by_kernel: Dict[str, Set[str]] = {}
_execution_state_lock = asyncio.Lock()
_pending_disconnect_cleanup: Dict[str, asyncio.Task] = {}
_pending_disconnect_cleanup_lock = asyncio.Lock()
KERNEL_DISCONNECT_GRACE_S = max(
    5.0,
    float(os.getenv("INSPYRO_KERNEL_DISCONNECT_GRACE_S", "300")),
)


def _preview_track_key(kernel_id: str, preview_key: Optional[str], fallback: str) -> Tuple[str, str]:
    return (kernel_id, preview_key or fallback)


def _prune_preview_requests_locked(kernel_id: str) -> None:
    kernel_keys = [key for key in _preview_latest_request if key[0] == kernel_id]
    overflow = len(kernel_keys) - _PREVIEW_TRACK_MAX_PER_KERNEL
    if overflow <= 0:
        return
    for key in kernel_keys[:overflow]:
        _preview_latest_request.pop(key, None)


async def register_preview_request(
    kernel_id: str,
    preview_key: Optional[str],
    request_id: Optional[str],
    *,
    fallback: str,
) -> Tuple[str, str]:
    key = _preview_track_key(kernel_id, preview_key, fallback)
    async with _preview_latest_lock:
        _preview_latest_request.pop(key, None)
        _preview_latest_request[key] = request_id or ""
        _prune_preview_requests_locked(kernel_id)
    return key


async def is_preview_request_current(key: Tuple[str, str], request_id: Optional[str]) -> bool:
    async with _preview_latest_lock:
        return _preview_latest_request.get(key) == (request_id or "")


async def complete_preview_request(key: Tuple[str, str], request_id: Optional[str]) -> bool:
    async with _preview_latest_lock:
        current = _preview_latest_request.get(key)
        if current != (request_id or ""):
            return False
        _preview_latest_request.pop(key, None)
        return True


async def cancel_preview_by_key(kernel_id: str, preview_key: str) -> None:
    async with _preview_latest_lock:
        _preview_latest_request.pop((kernel_id, preview_key), None)


async def cancel_preview_by_request_id(kernel_id: str, request_id: str) -> int:
    cancelled = 0
    async with _preview_latest_lock:
        for key, value in list(_preview_latest_request.items()):
            if key[0] == kernel_id and value == request_id:
                _preview_latest_request.pop(key, None)
                cancelled += 1
    return cancelled


async def clear_preview_state_for_kernel(kernel_id: str) -> None:
    async with _preview_latest_lock:
        for key in [k for k in _preview_latest_request if k[0] == kernel_id]:
            _preview_latest_request.pop(key, None)


async def get_template_mutation_lock(kernel_id: str) -> asyncio.Lock:
    async with _template_mutation_locks_lock:
        lock = _template_mutation_locks.get(kernel_id)
        if lock is None:
            lock = asyncio.Lock()
            _template_mutation_locks[kernel_id] = lock
        return lock


async def track_kernel_for_connection(websocket: WebSocket, kernel_id: Optional[str]) -> None:
    if not kernel_id:
        return
    await _cancel_pending_disconnect_cleanup(kernel_id)
    connection_id = id(websocket)
    async with _connection_kernels_lock:
        kernel_ids = _connection_kernels.setdefault(connection_id, set())
        kernel_ids.add(kernel_id)


async def bind_kernel_to_connection(websocket: WebSocket, kernel_id: Optional[str]) -> None:
    """Rebind a live kernel to the current websocket connection.

    This is stronger than ``track_kernel_for_connection``: it refreshes the
    disconnect grace window and transfers kernel ownership away from stale
    notebook sockets so a late cleanup task cannot shut the kernel down while
    the new connection is already using it.
    """
    if not kernel_id:
        return
    await _cancel_pending_disconnect_cleanup(kernel_id)
    connection_id = id(websocket)
    async with _connection_kernels_lock:
        stale_connection_ids: list[int] = []
        for candidate_connection_id, kernel_ids in _connection_kernels.items():
            if candidate_connection_id == connection_id:
                continue
            if kernel_id in kernel_ids:
                kernel_ids.discard(kernel_id)
                if not kernel_ids:
                    stale_connection_ids.append(candidate_connection_id)
        for stale_connection_id in stale_connection_ids:
            _connection_kernels.pop(stale_connection_id, None)
        kernel_ids = _connection_kernels.setdefault(connection_id, set())
        kernel_ids.add(kernel_id)


async def untrack_kernel_for_connection(websocket: WebSocket, kernel_id: Optional[str]) -> None:
    if not kernel_id:
        return
    connection_id = id(websocket)
    async with _connection_kernels_lock:
        kernel_ids = _connection_kernels.get(connection_id)
        if not kernel_ids:
            return
        kernel_ids.discard(kernel_id)
        if not kernel_ids:
            _connection_kernels.pop(connection_id, None)


async def drop_kernel_from_all_connections(kernel_id: Optional[str]) -> None:
    if not kernel_id:
        return
    async with _connection_kernels_lock:
        to_delete: list[int] = []
        for connection_id, kernel_ids in _connection_kernels.items():
            kernel_ids.discard(kernel_id)
            if not kernel_ids:
                to_delete.append(connection_id)
        for connection_id in to_delete:
            _connection_kernels.pop(connection_id, None)


async def mark_execution_started(kernel_id: Optional[str], execution_id: Optional[str]) -> None:
    """Backward-compatible alias for legacy callers that meant "running"."""
    await mark_execution_running(kernel_id, execution_id)


async def mark_execution_queued(kernel_id: Optional[str], execution_id: Optional[str]) -> None:
    if not kernel_id or not execution_id:
        return
    async with _execution_state_lock:
        queued = _queued_executions_by_kernel.setdefault(kernel_id, set())
        queued.add(execution_id)
        cancelled = _cancelled_executions_by_kernel.get(kernel_id)
        if cancelled:
            cancelled.discard(execution_id)
            if not cancelled:
                _cancelled_executions_by_kernel.pop(kernel_id, None)


async def mark_execution_running(kernel_id: Optional[str], execution_id: Optional[str]) -> None:
    if not kernel_id or not execution_id:
        return
    async with _execution_state_lock:
        queued = _queued_executions_by_kernel.get(kernel_id)
        if queued:
            queued.discard(execution_id)
            if not queued:
                _queued_executions_by_kernel.pop(kernel_id, None)
        _active_execution_by_kernel[kernel_id] = execution_id
        cancelled = _cancelled_executions_by_kernel.get(kernel_id)
        if cancelled:
            cancelled.discard(execution_id)
            if not cancelled:
                _cancelled_executions_by_kernel.pop(kernel_id, None)


async def mark_execution_finished(kernel_id: Optional[str], execution_id: Optional[str]) -> None:
    if not kernel_id or not execution_id:
        return
    async with _execution_state_lock:
        queued = _queued_executions_by_kernel.get(kernel_id)
        if queued:
            queued.discard(execution_id)
            if not queued:
                _queued_executions_by_kernel.pop(kernel_id, None)
        if _active_execution_by_kernel.get(kernel_id) == execution_id:
            _active_execution_by_kernel.pop(kernel_id, None)
        cancelled = _cancelled_executions_by_kernel.get(kernel_id)
        if cancelled:
            cancelled.discard(execution_id)
            if not cancelled:
                _cancelled_executions_by_kernel.pop(kernel_id, None)


async def cancel_kernel_execution(kernel_id: Optional[str], execution_id: Optional[str]) -> Optional[str]:
    if not kernel_id:
        return None
    async with _execution_state_lock:
        queued = _queued_executions_by_kernel.get(kernel_id) or set()
        if execution_id:
            effective_execution_id = execution_id if (
                execution_id in queued or _active_execution_by_kernel.get(kernel_id) == execution_id
            ) else None
        else:
            effective_execution_id = _active_execution_by_kernel.get(kernel_id)
        if not effective_execution_id:
            return None
        cancelled = _cancelled_executions_by_kernel.setdefault(kernel_id, set())
        cancelled.add(effective_execution_id)
        return effective_execution_id


async def is_execution_cancelled(kernel_id: Optional[str], execution_id: Optional[str]) -> bool:
    if not kernel_id or not execution_id:
        return False
    async with _execution_state_lock:
        cancelled = _cancelled_executions_by_kernel.get(kernel_id)
        return bool(cancelled and execution_id in cancelled)


async def clear_execution_state(kernel_id: Optional[str]) -> None:
    if not kernel_id:
        return
    async with _execution_state_lock:
        _queued_executions_by_kernel.pop(kernel_id, None)
        _active_execution_by_kernel.pop(kernel_id, None)
        _cancelled_executions_by_kernel.pop(kernel_id, None)


async def _cancel_pending_disconnect_cleanup(kernel_id: Optional[str]) -> None:
    if not kernel_id:
        return
    current_task = asyncio.current_task()
    async with _pending_disconnect_cleanup_lock:
        task = _pending_disconnect_cleanup.get(kernel_id)
        if task is current_task:
            return
        _pending_disconnect_cleanup.pop(kernel_id, None)
    if task is not None and not task.done():
        task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await task


async def _kernel_has_live_connections(kernel_id: str) -> bool:
    async with _connection_kernels_lock:
        return any(kernel_id in kernel_ids for kernel_ids in _connection_kernels.values())


async def _kernel_has_active_execution(kernel_id: str) -> bool:
    async with _execution_state_lock:
        return kernel_id in _active_execution_by_kernel


async def _schedule_disconnect_cleanup(kernel_id: Optional[str]) -> None:
    if not kernel_id:
        return
    current_task = asyncio.current_task()
    async with _pending_disconnect_cleanup_lock:
        existing = _pending_disconnect_cleanup.get(kernel_id)
        if existing is not None and existing is not current_task and not existing.done():
            return

    async def _cleanup_worker() -> None:
        try:
            while True:
                await asyncio.sleep(KERNEL_DISCONNECT_GRACE_S)
                if await _kernel_has_live_connections(kernel_id):
                    return
                if await _kernel_has_active_execution(kernel_id):
                    continue
                await shutdown_kernel_resources(kernel_id, cancel_pending_cleanup=False)
                return
        except asyncio.CancelledError:
            return
        finally:
            async with _pending_disconnect_cleanup_lock:
                current = _pending_disconnect_cleanup.get(kernel_id)
                if current is asyncio.current_task():
                    _pending_disconnect_cleanup.pop(kernel_id, None)

    task = asyncio.create_task(_cleanup_worker(), name=f"disconnect-cleanup:{kernel_id}")
    async with _pending_disconnect_cleanup_lock:
        existing = _pending_disconnect_cleanup.get(kernel_id)
        if existing is not None and not existing.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            return
        _pending_disconnect_cleanup[kernel_id] = task


async def shutdown_kernel_resources(
    kernel_id: Optional[str],
    *,
    cancel_pending_cleanup: bool = True,
) -> None:
    if not kernel_id:
        return
    if cancel_pending_cleanup:
        await _cancel_pending_disconnect_cleanup(kernel_id)
    if jupyter_kernel_manager is not None:
        try:
            await jupyter_kernel_manager.shutdown_kernel(kernel_id)
        except Exception:
            pass
    try:
        template_storage.delete_template(kernel_id)
    except Exception:
        pass
    try:
        template_preview.clear_preview_cache(kernel_id)
    except Exception:
        pass
    try:
        template_service.cleanup_kernel_processes(kernel_id)
    except Exception:
        pass
    clear_kernel_runtime_state(kernel_id)
    cleanup_inline_builders()
    await clear_execution_state(kernel_id)
    await clear_preview_state_for_kernel(kernel_id)
    await drop_kernel_from_all_connections(kernel_id)


async def cleanup_notebook_connection(websocket: WebSocket) -> dict:
    connection_id = id(websocket)
    async with _connection_kernels_lock:
        kernel_ids = list(_connection_kernels.pop(connection_id, set()))
    scheduled_cleanup: list[str] = []
    for kernel_id in kernel_ids:
        await _schedule_disconnect_cleanup(kernel_id)
        scheduled_cleanup.append(kernel_id)
    return {
        "connection_id": connection_id,
        "kernel_ids": kernel_ids,
        "scheduled_cleanup_kernel_ids": scheduled_cleanup,
        "disconnect_grace_s": KERNEL_DISCONNECT_GRACE_S,
    }
