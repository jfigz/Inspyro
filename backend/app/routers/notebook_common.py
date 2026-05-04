import os
import sys
import asyncio
import json
import logging
import binascii
import time
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, Dict, Set, Tuple
from uuid import uuid4

from fastapi import APIRouter, WebSocket, HTTPException

logger = logging.getLogger(__name__)

try:
    import nbformat
    from nbformat.v4 import new_notebook, new_code_cell, new_markdown_cell
except ImportError:
    nbformat = None

from app.services.websocket_manager import manager
from app.services.jupyter_kernel import jupyter_kernel_manager
from app.services.pdf_converter import build_pdf_context, pdf_cache_set as _pdf_cache_set
from app.services.notebook_service import (
    NOTEBOOK_PDF_TIMEOUT_S,
    active_tasks,
    notebook_cumulative_graphs,
    notebook_cumulative_variables,
    notebook_cumulative_call_stacks,
    notebook_last_docx_b64,
    notebook_docx_hash,
    _get_kernel_lock,
    _process_notebook_cell_execution,
    _build_notebook_instrumented_code,
    _forward_iopub,
    _recover_docx_and_emit_updates_background,
    _execute_docx_export,
    _prepare_pdf_payload,
    _execute_python_code_simple,
    set_kernel_docx_source,
    queue_document_pipeline_job,
    clear_kernel_runtime_state,
)
from librerias_propias.docx_builder.api import cleanup_inline_builders
from app.services import template_extract
from app.services.template import preview as template_preview
from app.services.template import storage as template_storage
from app.services.template import mutation as template_style_apply
from app.services.template import table_format as template_table_format
from app.services import template_service
from app.services import runtime_metrics
from app.services import template_tokens


router = APIRouter()
TEMPLATE_TABLE_PREVIEW_CONCURRENCY = max(1, int(os.getenv("INSPYRO_TEMPLATE_TABLE_PREVIEW_CONCURRENCY", "1")))
_template_table_preview_semaphore = asyncio.Semaphore(TEMPLATE_TABLE_PREVIEW_CONCURRENCY)
TEMPLATE_STYLE_PREVIEW_CONCURRENCY = max(1, int(os.getenv("INSPYRO_TEMPLATE_STYLE_PREVIEW_CONCURRENCY", "1")))
_template_style_preview_semaphore = asyncio.Semaphore(TEMPLATE_STYLE_PREVIEW_CONCURRENCY)
TEMPLATE_PREVIEW_TIMEOUT_S = max(5, int(os.getenv("INSPYRO_TEMPLATE_PREVIEW_TIMEOUT", "20")))
LOCK_TIMEOUT_S = max(0.1, float(os.getenv("INSPYRO_LOCK_TIMEOUT", "60")))
BACKEND_ROOT = Path(__file__).resolve().parents[2]
from app.core.state import (
    register_preview_request as _register_preview_request,
    is_preview_request_current as _is_preview_request_current,
    complete_preview_request as _complete_preview_request,
    cancel_preview_by_key as _cancel_preview_by_key,
    cancel_preview_by_request_id as _cancel_preview_by_request_id,
    clear_preview_state_for_kernel as _clear_preview_state_for_kernel,
    get_template_mutation_lock as _get_template_mutation_lock,
    bind_kernel_to_connection as _bind_kernel_to_connection,
    track_kernel_for_connection as _track_kernel_for_connection,
    untrack_kernel_for_connection as _untrack_kernel_for_connection,
    drop_kernel_from_all_connections as _drop_kernel_from_all_connections,
    mark_execution_started as _mark_execution_started,
    mark_execution_queued as _mark_execution_queued,
    mark_execution_running as _mark_execution_running,
    mark_execution_finished as _mark_execution_finished,
    cancel_kernel_execution as _cancel_kernel_execution,
    is_execution_cancelled as _is_execution_cancelled,
    clear_execution_state as _clear_execution_state,
    shutdown_kernel_resources as _shutdown_kernel_resources,
    cleanup_notebook_connection,
)


def _parse_table_index(raw_value) -> Optional[int]:
    """Parse user-provided table index while rejecting ambiguous values."""
    if isinstance(raw_value, bool):
        return None
    if isinstance(raw_value, int):
        return raw_value
    if isinstance(raw_value, str):
        raw = raw_value.strip()
        if not raw:
            return None
        try:
            return int(raw)
        except ValueError:
            return None
    return None


def _kernel_preamble() -> str:
    return (
        "import sys as _sys\n"
        f"_BR={str(BACKEND_ROOT)!r}\n"
        "if _BR not in _sys.path: _sys.path.insert(0, _BR)\n"
    )


def _kernel_docx_set_template_code(
    template_path: Optional[str],
    table_style_runtime_defaults: Optional[Dict[str, object]] = None,
    builder_required_style_defaults: Optional[Dict[str, object]] = None,
    semantic_style_slots: Optional[Dict[str, object]] = None,
) -> str:
    return (
        _kernel_preamble()
        + "from librerias_propias.docx_builder.session import get_session\n"
        + "_session = get_session()\n"
        + f"_session.set_template_path({template_path!r})\n"
        + f"_session.set_template_table_style_defaults({table_style_runtime_defaults or {}!r})\n"
        + f"_session.set_template_required_style_defaults({builder_required_style_defaults or {}!r})\n"
        + f"_session.set_template_semantic_style_slots({semantic_style_slots or {}!r})\n"
        + "_session.reset(hard=True)\n"
        + "del _session\n"
    )


def _kernel_docx_reset_code() -> str:
    return (
        _kernel_preamble()
        + "from librerias_propias.docx_builder.session import get_session\n"
        + "_session = get_session()\n"
        + "_session.reset(hard=True)\n"
        + "del _session\n"
    )


class KernelLockTimeoutError(TimeoutError):
    """Raised when a per-kernel lock cannot be acquired within the expected window."""


async def _execute_kernel_code_safely(
    kernel_id: Optional[str],
    code: str,
    *,
    timeout_s: Optional[float] = None,
    execution_timeout_s: Optional[float] = None,
):
    """Execute code in a kernel while honoring the per-kernel lock."""
    if not kernel_id or jupyter_kernel_manager is None:
        return None
    lock = _get_kernel_lock(kernel_id)
    effective_timeout = float(timeout_s if timeout_s is not None else LOCK_TIMEOUT_S)
    async with _timed_lock(lock, timeout_s=effective_timeout):
        return await jupyter_kernel_manager.execute_cell(
            kernel_id,
            code,
            capture_variables=False,
            execution_timeout=execution_timeout_s,
        )


@asynccontextmanager
async def _timed_lock(lock: asyncio.Lock, *, timeout_s: Optional[float] = None) -> None:
    wait_started = time.perf_counter()
    try:
        if timeout_s is None:
            await lock.acquire()
        else:
            await asyncio.wait_for(lock.acquire(), timeout=timeout_s)
    except asyncio.TimeoutError as exc:
        runtime_metrics.record_kernel_lock_wait((time.perf_counter() - wait_started) * 1000.0)
        raise KernelLockTimeoutError(
            f"Timeout waiting {timeout_s:.1f}s for kernel lock"
        ) from exc
    runtime_metrics.record_kernel_lock_wait((time.perf_counter() - wait_started) * 1000.0)
    try:
        yield
    finally:
        lock.release()


@asynccontextmanager
async def _track_template_handler(handler_name: str):
    started = time.perf_counter()
    try:
        yield
    finally:
        runtime_metrics.record_template_handler_duration(
            handler_name,
            (time.perf_counter() - started) * 1000.0,
        )


async def _apply_template_bytes_to_kernel(
    *,
    kernel_id: str,
    docx_bytes: bytes,
) -> dict:
    extracted = await template_service.run_template_executor(template_extract.extract_styles_from_docx, docx_bytes)

    mutation_lock = await _get_template_mutation_lock(kernel_id)
    template_path = None
    async with asyncio.timeout(float(os.getenv("INSPYRO_LOCK_TIMEOUT", "60"))):
        async with mutation_lock:
            template_storage.save_template(kernel_id, docx_bytes, extracted)
            template_path = template_storage.get_template_docx_path(kernel_id)
            extracted = template_storage.get_template(kernel_id) or extracted

        if template_path and jupyter_kernel_manager:
            try:
                lock = _get_kernel_lock(kernel_id)
                async with _timed_lock(lock):
                    set_template_code = _kernel_docx_set_template_code(
                        template_path,
                        extracted.get(template_service.TABLE_STYLE_RUNTIME_DEFAULTS_KEY),
                        extracted.get(template_service.BUILDER_REQUIRED_STYLE_DEFAULTS_KEY),
                    )
                    await jupyter_kernel_manager.execute_cell(kernel_id, set_template_code, capture_variables=False)
            except Exception as exc:
                logger.warning("[Template] Could not set template in kernel: %s", exc)

        notebook_docx_hash.pop(kernel_id, None)
        notebook_last_docx_b64.pop(kernel_id, None)

    extracted["style_coverage"] = template_extract.get_style_coverage(extracted)
    return extracted


def _template_error_payload(
    message: str,
    *,
    error_code: str = "template_error",
    request_id: Optional[str] = None,
    kernel_id: Optional[str] = None,
    traceback_text: Optional[str] = None,
    extra: Optional[dict] = None,
) -> dict:
    payload = {
        "type": "template_error",
        "error": message,
        "message": message,
        "error_code": error_code,
    }
    if request_id is not None:
        payload["request_id"] = request_id
    if kernel_id is not None:
        payload["kernel_id"] = kernel_id
    if traceback_text:
        payload["traceback"] = traceback_text
    if isinstance(extra, dict):
        payload.update(extra)
    return payload


async def _send_template_error(
    websocket: WebSocket,
    message: str,
    *,
    error_code: str = "template_error",
    request_id: Optional[str] = None,
    kernel_id: Optional[str] = None,
    traceback_text: Optional[str] = None,
    extra: Optional[dict] = None,
) -> None:
    await manager.send_personal_message(
        _template_error_payload(
            message,
            error_code=error_code,
            request_id=request_id,
            kernel_id=kernel_id,
            traceback_text=traceback_text,
            extra=extra,
        ),
        websocket,
    )


def _notebook_error_payload(
    message: str,
    *,
    error_code: str = "notebook_handler_error",
    traceback_text: Optional[str] = None,
    extra: Optional[dict] = None,
) -> dict:
    payload = {
        "type": "notebook_error",
        "error": message,
        "message": message,
        "error_code": error_code,
    }
    if traceback_text:
        payload["traceback"] = traceback_text
    if isinstance(extra, dict):
        payload.update(extra)
    return payload


async def _send_notebook_error(
    websocket: WebSocket,
    message: str,
    *,
    error_code: str = "notebook_handler_error",
    traceback_text: Optional[str] = None,
    extra: Optional[dict] = None,
) -> None:
    await manager.send_personal_message(
        _notebook_error_payload(
            message,
            error_code=error_code,
            traceback_text=traceback_text,
            extra=extra,
        ),
        websocket,
    )

# =============================================================================
# HANDLERS PÚBLICOS
# =============================================================================
