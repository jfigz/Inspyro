import os
import sys
import asyncio
import json
import base64
import hashlib
import logging
import traceback
import textwrap
import shutil
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from copy import deepcopy
from pathlib import Path
from typing import Any, Optional, Callable, Awaitable
from uuid import uuid4
from collections import OrderedDict

from fastapi import WebSocket
try:
    import nbformat
    from nbformat.v4 import new_notebook, new_code_cell, new_markdown_cell
except ImportError:
    nbformat = None

from app.services.websocket_manager import manager
from app.services.jupyter_kernel import jupyter_kernel_manager
from app.services.pdf_converter import (
    MS_WORD_AVAILABLE,
    compute_docx_semantic_hash,
    build_pdf_context_async,
    pdf_cache_get as _pdf_cache_get,
    pdf_cache_set as _pdf_cache_set,
)
from app.services.docx_artifacts import (
    build_docx_download_url as build_persisted_docx_download_url,
    detect_docx_body_is_empty,
    store_docx_artifact,
)
from app.services.docx_downloads import store_docx_base64
from app.services.docx_sanitizer import sanitize_docx_b64_for_delivery
from app.services.home_compact import home_compact_store
from app.services.pdf_downloads import store_pdf_base64

logger = logging.getLogger(__name__)

# =============================================================================
# ESTADO GLOBAL
# =============================================================================
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCX_INLINE_MAX_B64 = int(os.getenv("INSPYRO_DOCX_INLINE_MAX_B64", str(6 * 1024 * 1024)))
PDF_INLINE_MAX_B64 = int(os.getenv("INSPYRO_PDF_INLINE_MAX_B64", str(3 * 1024 * 1024)))
NOTEBOOK_PDF_TIMEOUT_S = max(1, int(os.getenv("INSPYRO_NOTEBOOK_PDF_TIMEOUT", "600")))
DOCUMENT_PIPELINE_STABILIZATION_DELAY_S = max(
    0.0,
    float(os.getenv("INSPYRO_NOTEBOOK_DOCUMENT_STABILIZATION_DELAY", "0.35")),
)
DOCX_DEFAULT_FILENAME = "inspyro_document.docx"
PDF_DEFAULT_FILENAME = "inspyro_document.pdf"
DOCX_EXCHANGE_DIR_PREFIX = "inspyro-docx-export-"
DOCX_EMPTY_EXECUTION_WARNING = "La celda no generÃ³ contenido DOCX real; se conserva el Ãºltimo documento vÃ¡lido."
DOCUMENT_PROGRESS_STAGE_PERCENTS: dict[str, int] = {
    "queued": 8,
    "docx_export": 30,
    "docx_ready": 55,
    "pdf_convert": 80,
}
_SOURCE_FIELD_MISSING = object()

# Tareas activas por cliente (re-exportar o usar desde aquÃ­)
@dataclass(frozen=True)
class DocumentJobRequest:
    kernel_id: str
    execution_id: Optional[str]
    reason: str
    needs_pdf: bool
    source_path: Optional[str] = None
    source_kind: Optional[str] = None
    queued_at_monotonic: Optional[float] = None


@dataclass
class _QueuedDocumentJob:
    generation: int
    request: DocumentJobRequest
    websocket: WebSocket
    timeout_s: int


active_tasks = {}

# Acumuladores por kernel
notebook_cumulative_graphs: dict = {}
notebook_cumulative_variables: dict = {}
notebook_cumulative_call_stacks: dict = {}
notebook_docx_hash: dict[str, str] = {}
notebook_last_docx_b64: dict[str, str] = {}
notebook_docx_source_path: dict[str, str] = {}
notebook_docx_source_kind: dict[str, str] = {}
notebook_runtime_snapshots: dict[str, dict[str, Any]] = {}

# Control de conversiones PDF
_pdf_conversion_inflight: dict[str, tuple[str, str, Optional[str], Optional[dict[str, Any]]]] = {}
_pdf_conversion_pending: dict[str, tuple[str, str, Optional[str], Optional[dict[str, Any]]]] = {}
_pdf_conversion_lock = threading.Lock()
_document_job_generation: dict[str, int] = {}
_document_job_latest: dict[str, _QueuedDocumentJob] = {}
_document_job_tasks: dict[str, asyncio.Task] = {}
_document_job_lock = threading.Lock()

# Kernel Locks
_kernel_locks: dict[str, asyncio.Lock] = {}
_kernel_locks_creation_lock = threading.Lock()


# =============================================================================
# FUNCIONES HELPERS (Locks, PDF Queue)
# =============================================================================

def _get_kernel_lock(kernel_id: str) -> asyncio.Lock:
    with _kernel_locks_creation_lock:
        lk = _kernel_locks.get(kernel_id)
        if lk is None:
            lk = asyncio.Lock()
            _kernel_locks[kernel_id] = lk
        return lk

def _queue_pdf_conversion(
    kernel_id: str,
    docx_hash: Optional[str],
    docx_b64: Optional[str],
    execution_id: Optional[str] = None,
    docx_meta: Optional[dict[str, Any]] = None,
) -> bool:
    if not kernel_id or not docx_hash or not docx_b64:
        return False
    with _pdf_conversion_lock:
        inflight = _pdf_conversion_inflight.get(kernel_id)
        if inflight:
            inflight_hash = inflight[0]
            if inflight_hash == docx_hash:
                return False
            _pdf_conversion_pending[kernel_id] = (docx_hash, docx_b64, execution_id, docx_meta)
            return False
        _pdf_conversion_inflight[kernel_id] = (docx_hash, docx_b64, execution_id, docx_meta)
        return True

def _next_pdf_conversion(
    kernel_id: str, completed_hash: Optional[str]
) -> Optional[tuple[str, str, Optional[str], Optional[dict[str, Any]]]]:
    if not kernel_id:
        return None
    with _pdf_conversion_lock:
        inflight = _pdf_conversion_inflight.get(kernel_id)
        if inflight and inflight[0] == completed_hash:
            _pdf_conversion_inflight.pop(kernel_id, None)
        pending = _pdf_conversion_pending.pop(kernel_id, None)
        if pending:
            _pdf_conversion_inflight[kernel_id] = pending
            return pending
        return None

def _clear_pdf_inflight(kernel_id: str, docx_hash: Optional[str]) -> None:
    if not kernel_id or not docx_hash:
        return
    with _pdf_conversion_lock:
        inflight = _pdf_conversion_inflight.get(kernel_id)
        if inflight and inflight[0] == docx_hash:
            _pdf_conversion_inflight.pop(kernel_id, None)


def _normalize_source_path(source_path: Optional[str]) -> Optional[str]:
    if not source_path or not str(source_path).strip():
        return None
    try:
        return os.path.abspath(os.path.expanduser(str(source_path)))
    except Exception:
        return str(source_path).strip()


def set_kernel_docx_source(
    kernel_id: Optional[str],
    *,
    source_path: Optional[str] = None,
    source_kind: Optional[str] = None,
) -> None:
    if not kernel_id:
        return
    normalized_source_path = _normalize_source_path(source_path)
    if normalized_source_path:
        notebook_docx_source_path[kernel_id] = normalized_source_path
    elif source_path is not None:
        notebook_docx_source_path.pop(kernel_id, None)
    if source_kind:
        notebook_docx_source_kind[kernel_id] = str(source_kind)
    elif kernel_id not in notebook_docx_source_kind:
        notebook_docx_source_kind[kernel_id] = "notebook"


def get_kernel_docx_source(kernel_id: Optional[str]) -> dict[str, Optional[str]]:
    if not kernel_id:
        return {"source_path": None, "source_kind": None}
    return {
        "source_path": notebook_docx_source_path.get(kernel_id),
        "source_kind": notebook_docx_source_kind.get(kernel_id, "notebook"),
    }


def _resolve_source_info(
    kernel_id: Optional[str],
    *,
    source_path: Optional[str] = None,
    source_kind: Optional[str] = None,
) -> dict[str, Optional[str]]:
    source_info = get_kernel_docx_source(kernel_id)
    normalized_source_path = _normalize_source_path(source_path)
    if normalized_source_path is not None:
        source_info["source_path"] = normalized_source_path
    if source_kind is not None:
        normalized_source_kind = str(source_kind).strip() or None
        if normalized_source_kind is not None:
            source_info["source_kind"] = normalized_source_kind
    return {
        "source_path": source_info.get("source_path"),
        "source_kind": source_info.get("source_kind"),
    }


def set_kernel_notebook_snapshot(kernel_id: Optional[str], notebook_payload: Optional[dict[str, Any]]) -> None:
    if not kernel_id:
        return
    if not isinstance(notebook_payload, dict):
        notebook_runtime_snapshots.pop(kernel_id, None)
        return
    notebook_runtime_snapshots[kernel_id] = deepcopy(notebook_payload)


def get_kernel_notebook_snapshot(kernel_id: Optional[str]) -> Optional[dict[str, Any]]:
    if not kernel_id:
        return None
    snapshot = notebook_runtime_snapshots.get(kernel_id)
    return deepcopy(snapshot) if isinstance(snapshot, dict) else None


def clear_kernel_runtime_state(kernel_id: Optional[str]) -> None:
    """Remove all per-kernel runtime state and queued PDF work."""
    if not kernel_id:
        return
    notebook_cumulative_graphs.pop(kernel_id, None)
    notebook_cumulative_variables.pop(kernel_id, None)
    notebook_cumulative_call_stacks.pop(kernel_id, None)
    notebook_last_docx_b64.pop(kernel_id, None)
    notebook_docx_hash.pop(kernel_id, None)
    notebook_docx_source_path.pop(kernel_id, None)
    notebook_docx_source_kind.pop(kernel_id, None)
    notebook_runtime_snapshots.pop(kernel_id, None)
    _kernel_locks.pop(kernel_id, None)
    with _pdf_conversion_lock:
        _pdf_conversion_inflight.pop(kernel_id, None)
        _pdf_conversion_pending.pop(kernel_id, None)
    with _document_job_lock:
        _document_job_generation.pop(kernel_id, None)
        _document_job_latest.pop(kernel_id, None)
        task = _document_job_tasks.pop(kernel_id, None)
    if task is not None and not task.done():
        task.cancel()
    home_compact_store.clear_notebook_runtime(kernel_id)


def _register_document_job(
    request: DocumentJobRequest,
    *,
    websocket: WebSocket,
    timeout_s: Optional[int] = None,
) -> bool:
    effective_timeout_s = max(1, int(timeout_s if timeout_s is not None else NOTEBOOK_PDF_TIMEOUT_S))
    with _document_job_lock:
        generation = _document_job_generation.get(request.kernel_id, 0) + 1
        _document_job_generation[request.kernel_id] = generation
        _document_job_latest[request.kernel_id] = _QueuedDocumentJob(
            generation=generation,
            request=request,
            websocket=websocket,
            timeout_s=effective_timeout_s,
        )
        existing_task = _document_job_tasks.get(request.kernel_id)
        return existing_task is None or existing_task.done()


def _get_current_document_job(kernel_id: str) -> Optional[_QueuedDocumentJob]:
    with _document_job_lock:
        job = _document_job_latest.get(kernel_id)
        if job is None:
            return None
        return _QueuedDocumentJob(
            generation=job.generation,
            request=job.request,
            websocket=job.websocket,
            timeout_s=job.timeout_s,
        )


def _is_document_job_current(kernel_id: str, generation: int) -> bool:
    with _document_job_lock:
        job = _document_job_latest.get(kernel_id)
        return bool(job and job.generation == generation)


def _release_document_job_if_current(kernel_id: str, generation: int) -> None:
    with _document_job_lock:
        job = _document_job_latest.get(kernel_id)
        if job and job.generation == generation:
            _document_job_latest.pop(kernel_id, None)


def _set_document_job_task(kernel_id: str, task: asyncio.Task) -> None:
    with _document_job_lock:
        _document_job_tasks[kernel_id] = task


def _clear_document_job_task(kernel_id: str, task: asyncio.Task) -> None:
    with _document_job_lock:
        current = _document_job_tasks.get(kernel_id)
        if current is task:
            _document_job_tasks.pop(kernel_id, None)

def _approx_b64_size_bytes(b64_text: str) -> int:
    return int(len(b64_text) * 3 / 4)


def _elapsed_ms(started_at: float | None) -> int | None:
    if started_at is None:
        return None
    return int((time.perf_counter() - started_at) * 1000)


def _merge_timing_maps(*maps: Optional[dict[str, Any]]) -> dict[str, int]:
    merged: dict[str, int] = {}
    for mapping in maps:
        if not isinstance(mapping, dict):
            continue
        for key, value in mapping.items():
            if isinstance(value, (int, float)):
                merged[str(key)] = int(value)
    return merged


def _append_docx_warning(existing: Optional[list[str]], warning: Optional[str]) -> Optional[list[str]]:
    if not warning:
        return existing
    warnings = [str(item) for item in (existing or []) if str(item).strip()]
    if warning not in warnings:
        warnings.append(warning)
    return warnings


def _classify_docx_capture(docx_b64: Optional[str]) -> Optional[bool]:
    if not docx_b64:
        return None
    try:
        return detect_docx_body_is_empty(base64.b64decode(docx_b64))
    except Exception:
        return None


def _build_notebook_progress_update_payload(
    *,
    kernel_id: str,
    execution_id: Optional[str] = None,
    cell_id: Optional[str] = None,
    message: Optional[str] = None,
    progress_scope: Optional[str] = None,
    progress_stage: Optional[str] = None,
    progress_status: Optional[str] = None,
    progress_percent: Optional[float] = None,
    progress_indeterminate: Optional[bool] = None,
    source_path: Any = _SOURCE_FIELD_MISSING,
    source_kind: Any = _SOURCE_FIELD_MISSING,
    shared_resource: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type": "notebook_progress_update",
        "kernel_id": kernel_id,
    }
    if execution_id:
        payload["execution_id"] = execution_id
    if cell_id:
        payload["cell_id"] = cell_id
    if message is not None:
        payload["message"] = message
    if progress_scope:
        payload["progress_scope"] = progress_scope
    if progress_stage:
        payload["progress_stage"] = progress_stage
    if progress_status:
        payload["progress_status"] = progress_status
    if progress_percent is not None:
        payload["progress_percent"] = progress_percent
    if progress_indeterminate is not None:
        payload["progress_indeterminate"] = progress_indeterminate
    if source_path is not _SOURCE_FIELD_MISSING:
        payload["source_path"] = source_path
    if source_kind is not _SOURCE_FIELD_MISSING:
        payload["source_kind"] = source_kind
    if isinstance(shared_resource, dict) and shared_resource:
        payload["shared_resource"] = deepcopy(shared_resource)
    return payload


def _build_shared_resource_payload(kind: str, status: str, *, scope: str = "global") -> Optional[dict[str, Any]]:
    if not kind or not status:
        return None
    return {
        "kind": str(kind).strip(),
        "scope": str(scope).strip() or "global",
        "status": str(status).strip(),
    }


def _build_pdf_converter_shared_resource(status: str) -> Optional[dict[str, Any]]:
    if not MS_WORD_AVAILABLE:
        return None
    return _build_shared_resource_payload("pdf_converter", status)


def _build_document_progress_payload(
    *,
    kernel_id: str,
    execution_id: Optional[str] = None,
    stage: str,
    message: Optional[str] = None,
    status: str = "running",
    percent: Optional[float] = None,
    indeterminate: bool = False,
    source_path: Optional[str] = None,
    source_kind: Optional[str] = None,
    shared_resource: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    source_info = _resolve_source_info(
        kernel_id,
        source_path=source_path,
        source_kind=source_kind,
    )
    return _build_notebook_progress_update_payload(
        kernel_id=kernel_id,
        execution_id=execution_id,
        message=message,
        progress_scope="document",
        progress_stage=stage,
        progress_status=status,
        progress_percent=(
            percent
            if percent is not None
            else DOCUMENT_PROGRESS_STAGE_PERCENTS.get(stage)
        ),
        progress_indeterminate=indeterminate,
        source_path=source_info.get("source_path"),
        source_kind=source_info.get("source_kind"),
        shared_resource=shared_resource,
    )


def _build_notebook_pdf_ready_payload(
    *,
    kernel_id: str,
    execution_id: Optional[str] = None,
    source_path: Optional[str] = None,
    source_kind: Optional[str] = None,
    **extra_fields: Any,
) -> dict[str, Any]:
    source_info = _resolve_source_info(
        kernel_id,
        source_path=source_path,
        source_kind=source_kind,
    )
    payload: dict[str, Any] = {
        "type": "notebook_pdf_ready",
        "kernel_id": kernel_id,
        "execution_id": execution_id,
    }
    payload.update(extra_fields)
    payload["source_path"] = source_info.get("source_path")
    payload["source_kind"] = source_info.get("source_kind")
    return payload


def _parse_docx_provenance_manifest(raw_manifest: Optional[str]) -> Optional[dict]:
    if not raw_manifest:
        return None
    try:
        parsed = json.loads(raw_manifest)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    items = parsed.get("items")
    if not isinstance(items, list):
        parsed["items"] = []
    return parsed


def _has_meaningful_docx_update(payload: Optional[dict[str, Any]]) -> bool:
    if not isinstance(payload, dict):
        return False
    if payload.get("docx_is_empty"):
        return True
    if payload.get("docx_warnings") or payload.get("docx_error"):
        return True
    return any(
        payload.get(key)
        for key in (
            "docx_file_b64",
            "docx_ref",
            "docx_file_token",
            "docx_artifact_id",
            "docx_hash",
        )
    )


def _build_notebook_docx_update_payload(
    *,
    kernel_id: str,
    execution_id: Optional[str],
    docx_results: dict[str, Any],
) -> dict[str, Any]:
    return {
        "type": "notebook_docx_update",
        "kernel_id": kernel_id,
        "execution_id": execution_id,
        "docx_file_b64": docx_results.get("docx_file_b64"),
        "docx_file_token": docx_results.get("docx_file_token"),
        "docx_download_url": docx_results.get("docx_download_url"),
        "docx_ref": docx_results.get("docx_ref"),
        "docx_artifact_id": docx_results.get("docx_artifact_id"),
        "docx_file_name": docx_results.get("docx_file_name"),
        "docx_provenance_available": docx_results.get("docx_provenance_available"),
        "docx_provenance_ref": docx_results.get("docx_provenance_ref"),
        "docx_inline": docx_results.get("docx_inline"),
        "docx_store_error": docx_results.get("docx_store_error"),
        "docx_size_bytes": docx_results.get("docx_size_bytes"),
        "docx_hash": docx_results.get("docx_hash"),
        "docx_is_empty": docx_results.get("docx_is_empty"),
        "docx_warnings": docx_results.get("docx_warnings"),
        "docx_error": docx_results.get("docx_error"),
        "workspace_path": docx_results.get("workspace_path"),
        "workspace_relpath": docx_results.get("workspace_relpath"),
        "workspace_warning": docx_results.get("workspace_warning"),
        "source_path": docx_results.get("source_path"),
        "source_kind": docx_results.get("source_kind"),
        "document_timing_ms": docx_results.get("document_timing_ms"),
    }

def _prepare_docx_payload(
    docx_b64: Optional[str],
    *,
    filename: str = DOCX_DEFAULT_FILENAME,
    docx_hash: Optional[str] = None,
    source_kind: Optional[str] = None,
    source_path: Optional[str] = None,
    kernel_id: Optional[str] = None,
    execution_id: Optional[str] = None,
    docx_is_empty: bool = False,
    docx_warning: Optional[str] = None,
    docx_provenance_manifest: Optional[dict] = None,
    prefer_link_only: bool = False,
) -> dict:
    if not docx_b64:
        return {
            "docx_file_b64": None, "docx_file_token": None, "docx_download_url": None,
            "docx_ref": None,
            "docx_artifact_id": None,
            "docx_file_name": None, "docx_size_bytes": None, "docx_inline": False, "docx_store_error": None,
            "docx_is_empty": bool(docx_is_empty), "docx_warning": docx_warning,
            "docx_provenance_available": False, "docx_provenance_ref": None,
            "document_timing_ms": {},
        }
    sanitize_started_at = time.perf_counter()
    visible_docx_b64 = sanitize_docx_b64_for_delivery(docx_b64) or docx_b64
    sanitize_ms = _elapsed_ms(sanitize_started_at)
    try:
        visible_docx_size_bytes = len(base64.b64decode(visible_docx_b64))
    except Exception:
        visible_docx_size_bytes = _approx_b64_size_bytes(visible_docx_b64)
    inline_docx = len(visible_docx_b64) <= DOCX_INLINE_MAX_B64
    artifact_info = None
    legacy_info = None
    errors: list[str] = []
    artifact_store_ms = None
    legacy_store_ms = None

    artifact_store_started_at = time.perf_counter()
    try:
        artifact_info = store_docx_artifact(
            docx_b64,
            filename=filename,
            delivery_docx_b64=visible_docx_b64,
            docx_hash=docx_hash,
            source_kind=source_kind,
            source_path=source_path,
            kernel_id=kernel_id,
            execution_id=execution_id,
            docx_is_empty=docx_is_empty,
            docx_warning=docx_warning,
            provenance_manifest=docx_provenance_manifest,
        )
    except Exception as exc:
        errors.append(f"artifact_store={exc}")
    artifact_store_ms = _elapsed_ms(artifact_store_started_at)

    if not isinstance(artifact_info, dict):
        legacy_store_started_at = time.perf_counter()
        try:
            legacy_info = store_docx_base64(visible_docx_b64, filename=filename)
        except Exception as exc:
            errors.append(f"legacy_store={exc}")
        legacy_store_ms = _elapsed_ms(legacy_store_started_at)

    legacy_token = legacy_info.get("token") if isinstance(legacy_info, dict) else None
    legacy_ref = f"/api/docx/download?token={legacy_token}" if legacy_token else None
    runtime_ref = build_persisted_docx_download_url(kernel_id=kernel_id) if kernel_id else None
    stable_ref = (
        artifact_info.get("download_url") if isinstance(artifact_info, dict) else None
    ) or legacy_ref or runtime_ref
    should_inline = (inline_docx and not prefer_link_only) or not stable_ref

    return {
        "docx_file_b64": visible_docx_b64 if should_inline else None,
        "docx_file_token": legacy_token,
        "docx_download_url": stable_ref,
        "docx_ref": stable_ref,
        "docx_artifact_id": artifact_info.get("artifact_id") if isinstance(artifact_info, dict) else None,
        "docx_file_name": (
            (artifact_info.get("filename") if isinstance(artifact_info, dict) else None)
            or (legacy_info.get("filename") if isinstance(legacy_info, dict) else None)
            or filename
        ),
        "docx_size_bytes": (
            (legacy_info.get("size_bytes") if isinstance(legacy_info, dict) else None)
            or visible_docx_size_bytes
        ),
        "docx_inline": should_inline,
        "docx_store_error": "; ".join(errors) if errors else None,
        "docx_is_empty": bool(docx_is_empty),
        "docx_warning": docx_warning,
        "docx_provenance_available": bool(
            isinstance(artifact_info, dict) and artifact_info.get("docx_provenance_available")
        ),
        "docx_provenance_ref": (
            artifact_info.get("docx_provenance_ref") if isinstance(artifact_info, dict) else None
        ),
        "workspace_path": (
            artifact_info.get("workspace_path") if isinstance(artifact_info, dict) else None
        ),
        "workspace_relpath": (
            artifact_info.get("workspace_relpath") if isinstance(artifact_info, dict) else None
        ),
        "workspace_warning": (
            artifact_info.get("workspace_warning") if isinstance(artifact_info, dict) else None
        ),
        "document_timing_ms": _merge_timing_maps(
            (
                artifact_info.get("artifact_timing_ms")
                if isinstance(artifact_info, dict)
                else None
            ),
            {
                "sanitize_ms": sanitize_ms,
                "artifact_store_ms": artifact_store_ms,
                "legacy_store_ms": legacy_store_ms,
            }
        ),
    }


def _prepare_pdf_payload(
    pdf_b64: Optional[str],
    *,
    prefer_link_only: bool = False,
) -> dict:
    if not pdf_b64:
        return {
            "pdf_file_b64": None,
            "pdf_file_token": None,
            "pdf_ref": None,
            "pdf_file_name": None,
            "pdf_size_bytes": None,
            "pdf_inline": False,
            "pdf_store_error": None,
        }

    pdf_size_bytes = _approx_b64_size_bytes(pdf_b64)
    inline_pdf = len(pdf_b64) <= PDF_INLINE_MAX_B64
    try:
        stored = store_pdf_base64(pdf_b64, filename=PDF_DEFAULT_FILENAME)
        token = stored.get("token")
        ref_url = f"/api/pdf/download?token={token}" if token else None
        should_inline = (inline_pdf and not prefer_link_only) or not ref_url
        return {
            "pdf_file_b64": pdf_b64 if should_inline else None,
            "pdf_file_token": token,
            "pdf_ref": ref_url,
            "pdf_file_name": stored.get("filename") or PDF_DEFAULT_FILENAME,
            "pdf_size_bytes": stored.get("size_bytes") or pdf_size_bytes,
            "pdf_inline": should_inline,
            "pdf_store_error": None,
        }
    except Exception as exc:
        should_inline = inline_pdf
        return {
            "pdf_file_b64": pdf_b64 if should_inline else None,
            "pdf_file_token": None,
            "pdf_ref": None,
            "pdf_file_name": PDF_DEFAULT_FILENAME,
            "pdf_size_bytes": pdf_size_bytes,
            "pdf_inline": should_inline,
            "pdf_store_error": str(exc),
        }


async def queue_document_pipeline_job(
    request: DocumentJobRequest,
    *,
    websocket: WebSocket,
    timeout_s: Optional[int] = None,
) -> None:
    should_start = _register_document_job(request, websocket=websocket, timeout_s=timeout_s)
    if not should_start:
        return
    task = asyncio.create_task(_document_pipeline_runner(request.kernel_id))
    _set_document_job_task(request.kernel_id, task)

    def _cleanup(done_task: asyncio.Task) -> None:
        _clear_document_job_task(request.kernel_id, done_task)
        if not done_task.cancelled():
            try:
                _ = done_task.exception()
            except Exception:
                pass

    task.add_done_callback(_cleanup)


async def _document_pipeline_runner(kernel_id: str) -> None:
    while True:
        queued = _get_current_document_job(kernel_id)
        if queued is None:
            return

        generation = queued.generation
        if DOCUMENT_PIPELINE_STABILIZATION_DELAY_S > 0:
            await asyncio.sleep(DOCUMENT_PIPELINE_STABILIZATION_DELAY_S)

        queued = _get_current_document_job(kernel_id)
        if queued is None:
            return
        if queued.generation != generation:
            continue

        try:
            await manager.send_personal_message(
                _build_document_progress_payload(
                    kernel_id=kernel_id,
                    execution_id=queued.request.execution_id,
                    stage="queued",
                    message="Preparando documento...",
                    source_path=queued.request.source_path,
                    source_kind=queued.request.source_kind,
                ),
                queued.websocket,
            )
        except Exception:
            pass

        if not _is_document_job_current(kernel_id, generation):
            continue

        await _recover_docx_and_emit_updates_background(
            kernel_id=kernel_id,
            websocket=queued.websocket,
            execution_id=queued.request.execution_id,
            timeout_s=queued.timeout_s,
            generation=generation,
            queued_at_monotonic=queued.request.queued_at_monotonic,
            source_path=queued.request.source_path,
            source_kind=queued.request.source_kind,
        )

        if _is_document_job_current(kernel_id, generation):
            _release_document_job_if_current(kernel_id, generation)

        if _get_current_document_job(kernel_id) is None:
            return

# =============================================================================
# FUNCIONES CORE (InstrumentaciÃ³n, EjecuciÃ³n, PDF Background)
# =============================================================================

def _build_notebook_instrumented_code(*, source_code: str, cell_id: str, cell_index: Optional[int], emit_docx: bool, docx_validation: bool = True, skip_docx_export: bool = False) -> str:
    normalized_source = source_code or ""
    effective_code = False
    for line in normalized_source.splitlines():
        s = line.strip()
        if s and not s.startswith('#'):
            effective_code = True; break
    if not normalized_source.strip() or not effective_code:
        normalized_source = "pass\n" + normalized_source

    units_preamble = textwrap.dedent(
        f"""# --- UNITS PREAMBULO ---
import sys as __sys
__UNITS_BR={_BACKEND_ROOT!r}
if __UNITS_BR not in __sys.path: __sys.path.insert(0, __UNITS_BR)
if not globals().get('__INSP_UNITS_READY__', False):
    try:
        __INSP_UNITS_BEFORE = set(globals().keys())
        from librerias_propias.inspyro_units import *
        import librerias_propias.inspyro_units as u
        from librerias_propias.inspyro_units.serialization import serialize_quantity as __serialize_quantity
        __INSP_UNITS_AFTER = set(globals().keys())
        __INSP_UNITS_IMPORTED_NAMES = frozenset(__INSP_UNITS_AFTER - __INSP_UNITS_BEFORE)
        __INSP_UNITS_IMPORTED_IDS = {{
            name: id(globals().get(name))
            for name in __INSP_UNITS_IMPORTED_NAMES
            if name in globals()
        }}
        __UNITS_IMPORT_ERROR = None
        __INSP_UNITS_READY__ = True
    except Exception as __units_err:
        __UNITS_IMPORT_ERROR = __units_err
        __INSP_UNITS_IMPORTED_NAMES = frozenset()
        __INSP_UNITS_IMPORTED_IDS = {{}}
        __INSP_UNITS_READY__ = False
else:
    __UNITS_IMPORT_ERROR = None
    if '__INSP_UNITS_IMPORTED_NAMES' not in globals():
        __INSP_UNITS_IMPORTED_NAMES = frozenset()
    if '__INSP_UNITS_IMPORTED_IDS' not in globals():
        __INSP_UNITS_IMPORTED_IDS = {{}}
    if 'u' not in globals():
        try:
            import librerias_propias.inspyro_units as u
        except Exception:
            pass
# --- FIN UNITS PREAMBULO ---
"""
    )

    reset_marker = "__INSP_NOTEBOOK_DOCX_WARNINGS = []\n__INSP_NOTEBOOK_DOCX_ERROR = None\n"
    if not emit_docx:
        return units_preamble + reset_marker + normalized_source

    mdoc_preamble = textwrap.dedent(f"""# --- DOCX PREAMBULO NOTEBOOK ---
import sys as __sys, os as __os
__DOCX_BR={_BACKEND_ROOT!r}
if __DOCX_BR not in __sys.path: __sys.path.insert(0, __DOCX_BR)
if any(__name not in globals() for __name in ('build_doc', 'doc_begin', 'doc_block', 'doc_end', 'doc_export', 'doc_export_provenance', 'doc_start_cell', 'doc_finish_cell', 'EquationLatex', 'get_session')):
    try:
        from librerias_propias.math_to_docx import (
            build_doc, doc_begin, doc_block, doc_end, doc_export, doc_export_provenance, doc_help, doc_reset,
            Heading, Text, List, Code, Link, Equation, EquationLatex, Reference, Image, Figure,
            Caption, Table, DataFrame, Section, TableOfContents, PageBreak,
            Metadata, Style, Header, Footer, doc_start_cell, doc_finish_cell, get_session
        )
        __DOCX_IMPORT_ERROR = None
    except Exception as __docx_err:
        __DOCX_IMPORT_ERROR = __docx_err
else:
    __DOCX_IMPORT_ERROR = None
# --- FIN DOCX PREAMBULO ---
""")
    notebook_source_literal = repr(normalized_source)
    order_setup = f"__DOCX_ORDER_VALUE = {int(cell_index)}\n" if isinstance(cell_index, int) else "__DOCX_ORDER_VALUE = globals().get('__INSP_DOCX_ORDER_COUNTER', 0) + 1\nglobals()['__INSP_DOCX_ORDER_COUNTER'] = __DOCX_ORDER_VALUE\n"
    strict_flag = "True" if docx_validation else "False"
    doc_setup = textwrap.dedent(f"""__DOCX_AUTOCLOSE = False
__INSP_NOTEBOOK_DOCX_WARNINGS = []
__INSP_NOTEBOOK_DOCX_ERROR = None
__DOCX_NOTEBOOK_CELL = {repr(cell_id)}
if __DOCX_IMPORT_ERROR is None:
    if '__INSP_DOCX_RAW_BUILD_DOC' not in globals():
        __INSP_DOCX_RAW_BUILD_DOC = build_doc
    if '__INSP_DOCX_RAW_DOC_BLOCK' not in globals():
        __INSP_DOCX_RAW_DOC_BLOCK = doc_block
    if '__INSP_DOCX_RAW_DOC_BEGIN' not in globals():
        __INSP_DOCX_RAW_DOC_BEGIN = doc_begin
    def __insp_docx_bind_owner(__kwargs):
        __bound = dict(__kwargs or {{}})
        if __bound.get('notebook_cell_id') is None and __DOCX_NOTEBOOK_CELL is not None:
            __bound['notebook_cell_id'] = __DOCX_NOTEBOOK_CELL
        return __bound
    def build_doc(*args, **kwargs):
        return __INSP_DOCX_RAW_BUILD_DOC(*args, **__insp_docx_bind_owner(kwargs))
    def doc_block(*args, **kwargs):
        return __INSP_DOCX_RAW_DOC_BLOCK(*args, **__insp_docx_bind_owner(kwargs))
    def doc_begin(*args, **kwargs):
        return __INSP_DOCX_RAW_DOC_BEGIN(*args, **__insp_docx_bind_owner(kwargs))
    import builtins as __insp_docx_builtins
    for __name in (
        'build_doc', 'doc_begin', 'doc_block', 'doc_end', 'doc_export', 'doc_export_provenance', 'doc_help', 'doc_reset', 'get_session',
        'Heading', 'Text', 'List', 'Code', 'Link', 'Equation', 'EquationLatex', 'Reference', 'Image', 'Figure',
        'Caption', 'Table', 'DataFrame', 'Section', 'TableOfContents', 'PageBreak',
        'Metadata', 'Style', 'Header', 'Footer', 'doc_start_cell', 'doc_finish_cell'
    ):
        if __name in globals():
            setattr(__insp_docx_builtins, __name, globals()[__name])
__DOCX_CAN_TRACK = ('doc_start_cell' in globals()) and ('doc_finish_cell' in globals())
{order_setup}if __DOCX_IMPORT_ERROR is not None:
    print('[docx import error]', __DOCX_IMPORT_ERROR)
else:
    try:
        if __DOCX_CAN_TRACK: doc_start_cell(notebook_cell_id=__DOCX_NOTEBOOK_CELL)
        doc_begin(block_id={repr(cell_id)}, auto_clear=True, order=__DOCX_ORDER_VALUE, strict={strict_flag}, notebook_cell_id=__DOCX_NOTEBOOK_CELL if __DOCX_CAN_TRACK else None)
        __DOCX_AUTOCLOSE = True
    except Exception as __docx_init_exc:
        __INSP_NOTEBOOK_DOCX_ERROR = str(__docx_init_exc)
        print('[docx init error]', __docx_init_exc)
""")
    warning_setup = textwrap.dedent("""import warnings as __warnings
__DOCX_WARNINGS_BUFFER = []
__DOCX_OLD_SHOWWARNING = __warnings.showwarning
def __insp_showwarning(message, category, filename, lineno, file=None, line=None):
    try:
        __msg = str(message)
        if __msg.startswith("[DOCX API]"): __DOCX_WARNINGS_BUFFER.append(__msg)
    except Exception: pass
    return __DOCX_OLD_SHOWWARNING(message, category, filename, lineno, file=file, line=line)
__warnings.showwarning = __insp_showwarning
""")
    execution_body = textwrap.dedent(
        f"""try:
    __INSP_NOTEBOOK_SOURCE = {notebook_source_literal}
    __INSP_NOTEBOOK_FILENAME = f"<inspyro-notebook:{{__DOCX_NOTEBOOK_CELL}}>"
    __INSP_NOTEBOOK_CODE = compile(__INSP_NOTEBOOK_SOURCE, __INSP_NOTEBOOK_FILENAME, "exec")
    exec(__INSP_NOTEBOOK_CODE, globals(), globals())
finally:
    if __DOCX_AUTOCLOSE:
        try:
            doc_end()
        except Exception as __docx_close_exc:
            __INSP_NOTEBOOK_DOCX_ERROR = str(__docx_close_exc)
            print('[docx close error]', __docx_close_exc)
    if __DOCX_CAN_TRACK:
        try: doc_finish_cell(notebook_cell_id=__DOCX_NOTEBOOK_CELL)
        except Exception as __docx_finish_exc: print('[docx finish error]', __docx_finish_exc)
    try:
        import warnings as __warnings
        __warnings.showwarning = __DOCX_OLD_SHOWWARNING
    except Exception:
        pass
    try:
        __INSP_NOTEBOOK_DOCX_WARNINGS = list(__DOCX_WARNINGS_BUFFER)
    except Exception:
        pass
"""
    )
    return units_preamble + mdoc_preamble + doc_setup + warning_setup + execution_body

def _normalize_base64_text(raw_value: Any) -> Optional[str]:
    if raw_value is None:
        return None
    candidate = "".join(str(raw_value).split())
    if not candidate:
        return None
    pad_mod = len(candidate) % 4
    if pad_mod:
        candidate += "=" * (4 - pad_mod)
    try:
        base64.b64decode(candidate, validate=True)
        return candidate
    except Exception:
        return None


def _collect_stream_chunk_payload(
    outputs: list[dict[str, Any]],
    *,
    begin_marker: str,
    end_marker: str,
) -> Optional[str]:
    collecting = False
    parts: list[str] = []
    for out in outputs:
        if out.get("output_type") != "stream":
            continue
        text = out.get("text")
        if isinstance(text, list):
            text = "".join(text)
        if not isinstance(text, str):
            continue
        for line in text.splitlines():
            stripped = line.strip()
            if stripped == begin_marker:
                collecting = True
                parts.clear()
                continue
            if stripped == end_marker:
                collecting = False
                continue
            if collecting and stripped and all(c.isalnum() or c in "+/=" for c in stripped):
                parts.append(stripped)
    return "".join(parts) if parts else None


def _read_optional_text_file(path: Path) -> Optional[str]:
    try:
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8")
    except Exception:
        return None


def _build_docx_exchange_code(*, docx_path: str, provenance_path: str, result_path: str) -> str:
    return textwrap.dedent(
        f"""
        from pathlib import Path as __insp_path
        import base64 as __insp_b64
        import json as __insp_json
        import traceback as __insp_traceback

        __insp_docx_path = {docx_path!r}
        __insp_provenance_path = {provenance_path!r}
        __insp_result_path = {result_path!r}
        __insp_result = {{
            "docx_path": __insp_docx_path,
            "provenance_path": __insp_provenance_path,
            "docx_bytes": 0,
            "provenance_bytes": 0,
            "transport": "file",
            "error": None,
        }}
        try:
            __insp_session = get_session() if "get_session" in globals() else None
            __insp_docx_bytes = None
            if __insp_session is not None and hasattr(__insp_session, "serialize_docx_bytes"):
                __insp_docx_bytes = __insp_session.serialize_docx_bytes()
            elif "doc_export" in globals():
                __insp_docx_b64 = doc_export(format="docx")
                if __insp_docx_b64:
                    __insp_docx_bytes = __insp_b64.b64decode(__insp_docx_b64)
            if __insp_docx_bytes:
                __insp_path(__insp_docx_path).write_bytes(__insp_docx_bytes)
                __insp_result["docx_bytes"] = len(__insp_docx_bytes)

            __insp_provenance = None
            if __insp_session is not None and hasattr(__insp_session, "export_provenance_manifest_json"):
                __insp_provenance = __insp_session.export_provenance_manifest_json()
            elif "doc_export_provenance" in globals():
                __insp_provenance = doc_export_provenance()
            if __insp_provenance:
                __insp_provenance_text = (
                    __insp_provenance
                    if isinstance(__insp_provenance, str)
                    else str(__insp_provenance)
                )
                __insp_path(__insp_provenance_path).write_text(
                    __insp_provenance_text,
                    encoding="utf-8",
                )
                __insp_result["provenance_bytes"] = len(
                    __insp_provenance_text.encode("utf-8")
                )
        except Exception as __insp_exc:
            __insp_result["error"] = f"{{type(__insp_exc).__name__}}: {{__insp_exc}}"
            __insp_result["traceback"] = __insp_traceback.format_exc(limit=8)
        finally:
            __insp_path(__insp_result_path).write_text(
                __insp_json.dumps(__insp_result, ensure_ascii=False),
                encoding="utf-8",
            )
        """
    )


async def _export_docx_via_file_handoff(
    kernel_id: str,
    *,
    execution_timeout_s: Optional[float] = None,
) -> dict[str, Any]:
    exchange_dir = Path(tempfile.mkdtemp(prefix=DOCX_EXCHANGE_DIR_PREFIX))
    docx_path = exchange_dir / "document.docx"
    provenance_path = exchange_dir / "provenance.json"
    result_path = exchange_dir / "result.json"
    kernel_export_started_at = time.perf_counter()
    transport_result: dict[str, Any] = {}
    docx_bytes: bytes | None = None
    provenance_text: Optional[str] = None
    transport_error: Optional[str] = None
    read_ms = None
    cleanup_ms = None
    kernel_export_ms = None
    result_payload: dict[str, Any] = {
        "docx_b64": None,
        "docx_provenance_manifest": None,
        "transport_error": None,
        "document_timing_ms": {},
    }

    try:
        exchange_code = _build_docx_exchange_code(
            docx_path=str(docx_path),
            provenance_path=str(provenance_path),
            result_path=str(result_path),
        )
        await jupyter_kernel_manager.execute_cell(
            kernel_id,
            exchange_code,
            capture_variables=False,
            execution_timeout=execution_timeout_s,
        )
        kernel_export_ms = _elapsed_ms(kernel_export_started_at)

        read_started_at = time.perf_counter()
        if result_path.exists():
            try:
                transport_result = json.loads(result_path.read_text(encoding="utf-8"))
            except Exception:
                transport_result = {}
        try:
            if docx_path.exists():
                docx_bytes = docx_path.read_bytes()
        except Exception:
            docx_bytes = None
        provenance_text = _read_optional_text_file(provenance_path)
        read_ms = _elapsed_ms(read_started_at)

        if not docx_bytes:
            raw_error = str(transport_result.get("error") or "").strip()
            if raw_error:
                transport_error = raw_error
            elif not transport_result:
                transport_error = "missing_docx_transport_file"

        result_payload = {
            "docx_b64": (
                base64.b64encode(docx_bytes).decode("ascii")
                if docx_bytes
                else None
            ),
            "docx_provenance_manifest": _parse_docx_provenance_manifest(provenance_text),
            "transport_error": transport_error,
            "document_timing_ms": _merge_timing_maps(
                {
                    "kernel_export_ms": kernel_export_ms,
                    "raw_export_ms": kernel_export_ms,
                    "transport_read_ms": read_ms,
                    "docx_transfer_bytes": (
                        len(docx_bytes)
                        if docx_bytes is not None
                        else transport_result.get("docx_bytes")
                    ),
                    "provenance_transfer_bytes": (
                        len(provenance_text.encode("utf-8"))
                        if provenance_text is not None
                        else transport_result.get("provenance_bytes")
                    ),
                }
            ),
        }
    except Exception as exc:
        kernel_export_ms = _elapsed_ms(kernel_export_started_at)
        result_payload = {
            "docx_b64": None,
            "docx_provenance_manifest": None,
            "transport_error": f"transport_execute_failed:{type(exc).__name__}:{exc}",
            "document_timing_ms": _merge_timing_maps(
                {
                    "kernel_export_ms": kernel_export_ms,
                    "raw_export_ms": kernel_export_ms,
                }
            ),
        }
    finally:
        cleanup_started_at = time.perf_counter()
        shutil.rmtree(exchange_dir, ignore_errors=True)
        cleanup_ms = _elapsed_ms(cleanup_started_at)
        result_payload["document_timing_ms"] = _merge_timing_maps(
            result_payload.get("document_timing_ms"),
            {"transport_cleanup_ms": cleanup_ms},
        )
    return result_payload


async def _export_docx_via_stdout_legacy(
    kernel_id: str,
    *,
    execution_timeout_s: Optional[float] = None,
) -> dict[str, Any]:
    retrieve_code = (
        "__val = ((get_session().export_docx_base64()) if 'get_session' in globals() else (doc_export(format='docx') if 'doc_export' in globals() else None))\n"
        "__prov = (doc_export_provenance() if 'doc_export_provenance' in globals() else None)\n"
        "print('__DOCX_DOC_BEGIN__')\n"
        "if __val:\n"
        "    for i in range(0, len(__val), 8192):\n"
        "        print(__val[i:i+8192])\n"
        "print('__DOCX_DOC_END__')\n"
        "print('__DOCX_PROV_BEGIN__')\n"
        "if __prov:\n"
        "    import base64 as __docx_b64\n"
        "    __prov_b64 = __docx_b64.b64encode(__prov.encode('utf-8')).decode('ascii')\n"
        "    for i in range(0, len(__prov_b64), 8192):\n"
        "        print(__prov_b64[i:i+8192])\n"
        "print('__DOCX_PROV_END__')\n"
    )
    raw_export_started_at = time.perf_counter()
    outputs, _, _, _ = await jupyter_kernel_manager.execute_cell(
        kernel_id,
        retrieve_code,
        capture_variables=False,
        execution_timeout=execution_timeout_s,
    )
    docx_b64 = _normalize_base64_text(
        _collect_stream_chunk_payload(
            outputs,
            begin_marker="__DOCX_DOC_BEGIN__",
            end_marker="__DOCX_DOC_END__",
        )
    )
    provenance_b64 = _normalize_base64_text(
        _collect_stream_chunk_payload(
            outputs,
            begin_marker="__DOCX_PROV_BEGIN__",
            end_marker="__DOCX_PROV_END__",
        )
    )
    provenance_manifest = None
    if provenance_b64:
        try:
            provenance_manifest = _parse_docx_provenance_manifest(
                base64.b64decode(provenance_b64).decode("utf-8")
            )
        except Exception:
            provenance_manifest = None
    raw_export_ms = _elapsed_ms(raw_export_started_at)
    return {
        "docx_b64": docx_b64,
        "docx_provenance_manifest": provenance_manifest,
        "document_timing_ms": _merge_timing_maps(
            {
                "stdout_export_ms": raw_export_ms,
                "stdout_docx_transfer_bytes": (
                    len(base64.b64decode(docx_b64))
                    if docx_b64
                    else None
                ),
            }
        ),
    }


async def _retrieve_docx_via_stdout(kernel_id: str) -> Optional[str]:
    file_handoff = await _export_docx_via_file_handoff(kernel_id)
    if file_handoff.get("docx_b64"):
        return file_handoff.get("docx_b64")
    legacy_handoff = await _export_docx_via_stdout_legacy(kernel_id)
    return legacy_handoff.get("docx_b64")

async def _forward_iopub(
    msg_type,
    content,
    cell_id,
    websocket,
    *,
    kernel_id: Optional[str] = None,
    execution_id: Optional[str] = None,
    source_path: Optional[str] = None,
    source_kind: Optional[str] = None,
):
    source_info = _resolve_source_info(
        kernel_id,
        source_path=source_path,
        source_kind=source_kind,
    )
    if msg_type == "error":
        ename = (content or {}).get("ename")
        evalue = (content or {}).get("evalue")
        error_message = f"{ename}: {evalue}" if ename and evalue else (evalue or ename or "Kernel execution error")
        await manager.send_personal_message(
            {
                "type": "notebook_error",
                "kernel_id": kernel_id,
                "cell_id": cell_id,
                "execution_id": execution_id,
                "error": error_message,
                "message": error_message,
                "error_code": "kernel_iopub_error",
                "details": {
                    "ename": ename,
                    "evalue": evalue,
                    "traceback": (content or {}).get("traceback", []),
                },
                "content": content,
                "source_path": source_info.get("source_path"),
                "source_kind": source_info.get("source_kind"),
            },
            websocket,
        )
        return

    forward_types = {
        "execute_input": "notebook_execute_input",
        "stream": "notebook_stream",
        "execute_result": "notebook_execute_result",
        "display_data": "notebook_display_data",
        "clear_output": "notebook_clear_output",
        "update_display_data": "notebook_update_display_data",
        "comm_open": "notebook_comm_open",
        "comm_msg": "notebook_comm_msg",
        "comm_close": "notebook_comm_close",
    }
    mapped = forward_types.get(msg_type)
    if mapped:
        await manager.send_personal_message(
            {
                "type": mapped,
                "kernel_id": kernel_id,
                "cell_id": cell_id,
                "execution_id": execution_id,
                "content": content,
                "source_path": source_info.get("source_path"),
                "source_kind": source_info.get("source_kind"),
            },
            websocket,
        )

async def _process_notebook_cell_execution(
    *,
    kernel_id: str,
    cell_id: str,
    instrumented_code: str,
    source_code: str,
    enable_tracing: bool,
    emit_docx: bool,
    execution_timeout_s: Optional[float] = None,
    skip_pdf: bool = False,
    defer_docx_export: bool = False,
    on_iopub: Callable[[str, dict, str], Awaitable[None]],
    websocket: WebSocket,
    execution_id: Optional[str] = None,
) -> dict:
    # Legacy compatibility: document export is always deferred to the background pipeline.
    force_doc = bool(os.getenv("INSPYRO_TEST_FORCE_DOCX"))
    doc_pipeline_requested = (emit_docx or force_doc) and not skip_pdf
    t_start = time.time()
    outputs, exec_count, variables, extras = await jupyter_kernel_manager.execute_cell(
        kernel_id,
        instrumented_code,
        capture_variables=True,
        on_iopub=on_iopub,
        execution_timeout=execution_timeout_s,
    )
    duration_ms = int((time.time() - t_start) * 1000)
    if not isinstance(extras, dict):
        extras = {"performance_data": {}, "execution_states": []}
    execution_diagnostics = extras.get("execution_diagnostics") if isinstance(extras, dict) else None
    if isinstance(execution_diagnostics, dict):
        execution_diagnostics = dict(execution_diagnostics)
    else:
        execution_diagnostics = {}
    variables_snapshot_degraded = bool(extras.get("variables_snapshot_degraded")) if isinstance(extras, dict) else False
    if execution_diagnostics.get("variables_capture_degraded"):
        variables_snapshot_degraded = True
    if variables_snapshot_degraded:
        execution_diagnostics.setdefault("variables_capture_degraded", True)
    if execution_diagnostics:
        logger.warning(
            "Notebook execution degraded but will still complete for kernel=%s cell=%s execution=%s: %s",
            kernel_id,
            cell_id,
            execution_id,
            execution_diagnostics,
        )

    # Fallback tracing
    if enable_tracing and (not isinstance(extras, dict) or not extras.get("execution_states")):
        try:
            r_outputs, _, _, _ = await jupyter_kernel_manager.execute_cell(kernel_id, "import json; print('__INSP_STATES__'+json.dumps(globals().get('__insp_states', [])))", capture_variables=False)
            for out in r_outputs:
                if out.get("output_type") == "stream":
                    text = out.get("text") or ""
                    if isinstance(text, list): text = "".join(text)
                    idx = text.find("__INSP_STATES__")
                    if idx >= 0:
                        try: 
                            payload = text[idx + 15 :].strip()
                            recovered = json.loads(payload)
                            if recovered: 
                                if isinstance(extras, dict): extras["execution_states"] = recovered
                                else: extras = {"execution_states": recovered, "performance_data": {}}
                        except Exception: pass
                        break
        except Exception: pass

    # Merge Graph
    dependency_graph = {"nodes": [], "links": []} # Placeholder logic
    try:
        # NOTE: Full merge logic is simplified here to avoid duplication, assuming graph comes from extras or variables
        # In real scenario, dependency analyzer runs here.
        pass 
    except Exception: pass

    # Merge Variables
    try:
        prev_vars = notebook_cumulative_variables.get(kernel_id, {})
        merged_vars = dict(prev_vars)
        for k, v in (variables or {}).items(): merged_vars[k] = v
        notebook_cumulative_variables[kernel_id] = merged_vars
        variables = merged_vars
    except Exception: pass
    
    # Call stack basic
    basic_call_stack = [{"function_name": f"cell_{exec_count or 'unknown'}", "filename": "notebook.ipynb", "line_number": 1, "locals_vars": variables or {}, "globals_vars": {}, "frame_id": f"notebook_cell_{cell_id}"}]
    notebook_cumulative_call_stacks[kernel_id] = basic_call_stack
    basic_execution_states = [{"call_stack": basic_call_stack, "variables": variables or {}, "current_line": 1, "current_file": "notebook.ipynb", "execution_step": exec_count or 1, "timestamp": 0.0, "memory_usage": 0.0, "cpu_time": 0.0, "function_calls": {}}]
    if isinstance(extras, dict) and extras.get("execution_states"):
        basic_execution_states = extras.get("execution_states")

    source_info = get_kernel_docx_source(kernel_id)
    document_job_request: Optional[DocumentJobRequest] = None

    if doc_pipeline_requested:
        document_job_request = DocumentJobRequest(
            kernel_id=kernel_id,
            execution_id=execution_id,
            reason=(
                "degraded_terminal"
                if execution_diagnostics.get("idle_missing") or execution_diagnostics.get("iopub_error")
                else "terminal"
            ),
            needs_pdf=True,
            source_path=source_info.get("source_path"),
            source_kind=source_info.get("source_kind"),
            queued_at_monotonic=time.perf_counter(),
        )


    return {
        "type": "notebook_cell_executed", "kernel_id": kernel_id, "cell_id": cell_id, "execution_id": execution_id, "execution_count": exec_count, "execution_duration_ms": duration_ms,
        "outputs": outputs, "status": "ok", "variables": variables, "execution_states": basic_execution_states,
        "performance_data": (extras.get("performance_data") if isinstance(extras, dict) else None),
        "execution_diagnostics": (execution_diagnostics or None),
        "variables_snapshot_degraded": variables_snapshot_degraded,
        "dependency_graph": dependency_graph,
        "docx_file_b64": None, "docx_file_token": None,
        "docx_download_url": None, "docx_ref": None, "docx_artifact_id": None, "docx_file_name": None,
        "docx_provenance_available": False,
        "docx_provenance_ref": None,
        "docx_hash": None, "pdf_file_b64": None, "pdf_hash": None,
        "pdf_ref": None, "pdf_file_token": None, "pdf_inline": False,
        "pdf_file_name": None,
        "pdf_store_error": None,
        "pdf_attempted": bool(document_job_request), "pdf_converting": bool(document_job_request),
        "pdf_conversion_error": None,
        "pdf_conversion_stdout": None, "pdf_conversion_stderr": None,
        "pdf_conversion_ms": None, "pdf_conversion_error_kind": None,
        "docx_size_bytes": None,
        "pdf_size_bytes": None, "pdf_from_cache": False, "docx_binary_hash": None,
        "docx_inline": False, "docx_store_error": None, "docx_is_empty": False,
        "source_path": source_info.get("source_path"), "source_kind": source_info.get("source_kind"),
        "docx_warnings": None, "docx_error": None,
        "converter_used": None, "word_error": None,
        "document_timing_ms": None,
        "_document_job_request": document_job_request,
    }

async def _convert_pdf_background(
    kernel_id: str,
    docx_b64: str,
    docx_hash: str,
    websocket: WebSocket,
    execution_id: Optional[str] = None,
    timeout_s: Optional[int] = None,
    docx_meta: Optional[dict[str, Any]] = None,
):
    effective_timeout_s = max(1, int(timeout_s if timeout_s is not None else NOTEBOOK_PDF_TIMEOUT_S))
    source_info = _resolve_source_info(
        kernel_id,
        source_path=(docx_meta or {}).get("source_path"),
        source_kind=(docx_meta or {}).get("source_kind"),
    )
    async def safe_send(msg: dict):
        try: await manager.send_personal_message(msg, websocket); return True
        except Exception: return False
    try:
        loop = asyncio.get_running_loop()
        await safe_send(
            _build_document_progress_payload(
                kernel_id=kernel_id,
                execution_id=execution_id,
                stage="docx_ready",
                message="DOCX listo. Preparando conversion PDF...",
                source_path=source_info.get("source_path"),
                source_kind=source_info.get("source_kind"),
            )
        )
        await safe_send(
            _build_document_progress_payload(
                kernel_id=kernel_id,
                execution_id=execution_id,
                stage="pdf_convert",
                message="Convirtiendo a PDF...",
                source_path=source_info.get("source_path"),
                source_kind=source_info.get("source_kind"),
                shared_resource=_build_pdf_converter_shared_resource("running"),
            )
        )
        async def _notify_pdf_queue_wait():
            await safe_send(
                _build_document_progress_payload(
                    kernel_id=kernel_id,
                    execution_id=execution_id,
                    stage="pdf_convert",
                    message="Esperando turno del convertidor PDF...",
                    source_path=source_info.get("source_path"),
                    source_kind=source_info.get("source_kind"),
                    shared_resource=_build_pdf_converter_shared_resource("waiting"),
                )
            )
        def _sync_progress(msg: str):
            if loop: 
                try:
                    asyncio.run_coroutine_threadsafe(
                        safe_send(
                            _build_document_progress_payload(
                                kernel_id=kernel_id,
                                execution_id=execution_id,
                                stage="pdf_convert",
                                message=msg,
                                source_path=source_info.get("source_path"),
                                source_kind=source_info.get("source_kind"),
                                shared_resource=_build_pdf_converter_shared_resource("running"),
                            )
                        ),
                        loop,
                    )
                except Exception: pass

        pdf_diag, pdf_b64, pdf_hash, _ = await build_pdf_context_async(
            docx_b64,
            docx_hash,
            True,
            False,
            _sync_progress,
            effective_timeout_s,
            on_queue_wait=_notify_pdf_queue_wait,
        )
        pdf_payload = _prepare_pdf_payload(pdf_b64, prefer_link_only=True)

        await safe_send(
            _build_notebook_pdf_ready_payload(
                kernel_id=kernel_id,
                execution_id=execution_id,
                source_path=source_info.get("source_path"),
                source_kind=source_info.get("source_kind"),
                docx_hash=docx_hash,
                docx_artifact_id=(docx_meta or {}).get("docx_artifact_id"),
                docx_provenance_available=(docx_meta or {}).get("docx_provenance_available"),
                docx_provenance_ref=(docx_meta or {}).get("docx_provenance_ref"),
                pdf_file_b64=pdf_payload.get("pdf_file_b64"),
                pdf_hash=pdf_hash,
                pdf_attempted=pdf_diag.get("attempted"),
                pdf_ref=pdf_payload.get("pdf_ref"),
                pdf_file_token=pdf_payload.get("pdf_file_token"),
                pdf_file_name=pdf_payload.get("pdf_file_name"),
                pdf_inline=pdf_payload.get("pdf_inline"),
                pdf_store_error=pdf_payload.get("pdf_store_error"),
                pdf_conversion_error=pdf_diag.get("error") if not pdf_b64 else None,
                pdf_conversion_error_kind=pdf_diag.get("error_kind") if not pdf_b64 else None,
                pdf_conversion_stdout=pdf_diag.get("stdout"),
                pdf_conversion_stderr=pdf_diag.get("stderr"),
                pdf_conversion_ms=pdf_diag.get("duration_ms"),
                pdf_size_bytes=pdf_payload.get("pdf_size_bytes") or pdf_diag.get("pdf_size_bytes"),
                converter_used=pdf_diag.get("converter_used"),
                word_error=pdf_diag.get("word_error"),
                document_timing_ms=pdf_diag.get("stage_timings_ms"),
            )
        )
    except Exception as e:
        await safe_send(
            _build_document_progress_payload(
                kernel_id=kernel_id,
                execution_id=execution_id,
                stage="pdf_convert",
                status="failed",
                message=f"Error generando PDF: {e}",
                source_path=source_info.get("source_path"),
                source_kind=source_info.get("source_kind"),
            )
        )
        await safe_send(
            _build_notebook_pdf_ready_payload(
                kernel_id=kernel_id,
                execution_id=execution_id,
                source_path=source_info.get("source_path"),
                source_kind=source_info.get("source_kind"),
                docx_hash=docx_hash,
                docx_artifact_id=(docx_meta or {}).get("docx_artifact_id"),
                docx_provenance_available=(docx_meta or {}).get("docx_provenance_available"),
                docx_provenance_ref=(docx_meta or {}).get("docx_provenance_ref"),
                pdf_file_b64=None,
                pdf_hash=None,
                pdf_conversion_error=str(e),
            )
        )
    finally:
        next_item = _next_pdf_conversion(kernel_id, docx_hash)
        if next_item:
            next_hash, next_docx_b64, next_execution_id, next_docx_meta = next_item
            if _pdf_cache_get(next_hash) is None and next_docx_b64:
                _t = asyncio.create_task(
                    _convert_pdf_background(
                        kernel_id=kernel_id,
                        docx_b64=next_docx_b64,
                        docx_hash=next_hash,
                        websocket=websocket,
                        execution_id=next_execution_id,
                        timeout_s=effective_timeout_s,
                        docx_meta=next_docx_meta,
                    )
                )
                _t.add_done_callback(lambda t: t.exception() if not t.cancelled() and t.exception() else None)
            else:
                _clear_pdf_inflight(kernel_id, next_hash)

async def _execute_docx_export(
    kernel_id: str,
    websocket: WebSocket,
    pdf_timeout_s: Optional[int] = None,
    execution_id: Optional[str] = None,
    generation: Optional[int] = None,
    queued_at_monotonic: Optional[float] = None,
):
    effective_timeout_s = max(1, int(pdf_timeout_s if pdf_timeout_s is not None else NOTEBOOK_PDF_TIMEOUT_S))
    transport_results = await _export_docx_via_file_handoff(
        kernel_id,
        execution_timeout_s=effective_timeout_s,
    )
    docx_b64 = transport_results.get("docx_b64")
    docx_provenance_manifest = transport_results.get("docx_provenance_manifest")
    document_timing_ms = _merge_timing_maps(transport_results.get("document_timing_ms"))
    if not docx_b64 and transport_results.get("transport_error"):
        legacy_results = await _export_docx_via_stdout_legacy(
            kernel_id,
            execution_timeout_s=effective_timeout_s,
        )
        docx_b64 = legacy_results.get("docx_b64")
        if legacy_results.get("docx_provenance_manifest") is not None:
            docx_provenance_manifest = legacy_results.get("docx_provenance_manifest")
        document_timing_ms = _merge_timing_maps(
            document_timing_ms,
            legacy_results.get("document_timing_ms"),
        )
    docx_hash = None; docx_payload = _prepare_docx_payload(None); pdf_b64 = None; pdf_hash = None; pdf_payload = _prepare_pdf_payload(None); pdf_diag = {'attempted': False, 'pdf_b64': None, 'error': None, 'stage_timings_ms': {}}; docx_warnings = None; docx_is_empty = False
    source_info = get_kernel_docx_source(kernel_id)
    
    if docx_b64:
        detected_empty_docx = _classify_docx_capture(docx_b64)
        if detected_empty_docx:
            docx_is_empty = True
            docx_payload = _prepare_docx_payload(
                None,
                docx_is_empty=True,
                docx_warning=DOCX_EMPTY_EXECUTION_WARNING,
            )
            docx_warnings = _append_docx_warning(docx_warnings, DOCX_EMPTY_EXECUTION_WARNING)
            document_timing_ms = _merge_timing_maps(
                document_timing_ms,
                docx_payload.get("document_timing_ms"),
                {"terminal_to_docx_ms": _elapsed_ms(queued_at_monotonic)},
            )
        else:
            docx_hash, _ = compute_docx_semantic_hash(docx_b64)
            notebook_docx_hash[kernel_id] = docx_hash
            notebook_last_docx_b64[kernel_id] = docx_b64
            docx_payload = _prepare_docx_payload(
                docx_b64,
                filename=DOCX_DEFAULT_FILENAME,
                docx_hash=docx_hash,
                source_kind=source_info.get("source_kind"),
                source_path=source_info.get("source_path"),
                kernel_id=kernel_id,
                execution_id=execution_id,
                docx_provenance_manifest=docx_provenance_manifest,
                prefer_link_only=True,
            )
            document_timing_ms = _merge_timing_maps(
                document_timing_ms,
                docx_payload.get("document_timing_ms"),
                {"terminal_to_docx_ms": _elapsed_ms(queued_at_monotonic)},
            )

            loop = asyncio.get_running_loop()

            async def send_progress(msg: str, *, shared_resource_status: str = "running"):
                if not websocket:
                    return
                if generation is not None and not _is_document_job_current(kernel_id, generation):
                    return
                progress_payload = _build_document_progress_payload(
                    kernel_id=kernel_id,
                    execution_id=execution_id,
                    stage="pdf_convert",
                    message=msg,
                    source_path=source_info.get("source_path"),
                    source_kind=source_info.get("source_kind"),
                    shared_resource=_build_pdf_converter_shared_resource(shared_resource_status),
                )
                try:
                    await manager.send_personal_message(progress_payload, websocket)
                except Exception:
                    pass

            def _sync_progress_wrapper(msg: str):
                if generation is not None and not _is_document_job_current(kernel_id, generation):
                    return
                if loop and websocket:
                    asyncio.run_coroutine_threadsafe(send_progress(msg), loop)

            async def _notify_pdf_queue_wait():
                await send_progress(
                    "Esperando turno del convertidor PDF...",
                    shared_resource_status="waiting",
                )

            docx_to_pdf_started_at = time.perf_counter()
            try:
                pdf_diag, pdf_b64, pdf_hash, _ = await build_pdf_context_async(
                    docx_b64,
                    docx_hash,
                    True,
                    False,
                    _sync_progress_wrapper,
                    effective_timeout_s,
                    on_queue_wait=_notify_pdf_queue_wait,
                )
                if pdf_b64:
                    pdf_payload = _prepare_pdf_payload(pdf_b64, prefer_link_only=True)
            except Exception as e:
                pdf_diag["error"] = str(e)
            document_timing_ms = _merge_timing_maps(
                document_timing_ms,
                pdf_diag.get("stage_timings_ms"),
                {"docx_to_pdf_ms": _elapsed_ms(docx_to_pdf_started_at)},
            )

    if document_timing_ms:
        logger.debug(
            "Document pipeline timings kernel=%s execution=%s timings=%s",
            kernel_id,
            execution_id,
            document_timing_ms,
        )

    return {
        "docx_file_b64": docx_payload.get("docx_file_b64"), "docx_file_token": docx_payload.get("docx_file_token"),
        "docx_download_url": docx_payload.get("docx_download_url"), "docx_ref": docx_payload.get("docx_ref"), "docx_artifact_id": docx_payload.get("docx_artifact_id"), "docx_file_name": docx_payload.get("docx_file_name"),
        "docx_provenance_available": docx_payload.get("docx_provenance_available"), "docx_provenance_ref": docx_payload.get("docx_provenance_ref"),
        "docx_inline": docx_payload.get("docx_inline"), "docx_store_error": docx_payload.get("docx_store_error"),
        "docx_size_bytes": docx_payload.get("docx_size_bytes") or pdf_diag.get("docx_size_bytes"), "docx_hash": docx_hash, "docx_is_empty": docx_payload.get("docx_is_empty") or docx_is_empty, "docx_warnings": docx_warnings,
        "workspace_path": docx_payload.get("workspace_path"),
        "workspace_relpath": docx_payload.get("workspace_relpath"),
        "workspace_warning": docx_payload.get("workspace_warning"),
        "source_path": source_info.get("source_path"), "source_kind": source_info.get("source_kind"),
        "pdf_file_b64": pdf_payload.get("pdf_file_b64"), "pdf_hash": pdf_hash,
        "pdf_ref": pdf_payload.get("pdf_ref"), "pdf_file_token": pdf_payload.get("pdf_file_token"),
        "pdf_file_name": pdf_payload.get("pdf_file_name"),
        "pdf_inline": pdf_payload.get("pdf_inline"), "pdf_store_error": pdf_payload.get("pdf_store_error"),
        "pdf_conversion_error": pdf_diag.get('error'), "pdf_attempted": pdf_diag.get('attempted'),
        "pdf_conversion_stdout": pdf_diag.get('stdout'), "pdf_conversion_stderr": pdf_diag.get('stderr'),
        "pdf_conversion_ms": pdf_diag.get('duration_ms'), "pdf_size_bytes": pdf_payload.get("pdf_size_bytes") or pdf_diag.get("pdf_size_bytes"),
        "converter_used": pdf_diag.get("converter_used"), "word_error": pdf_diag.get("word_error"),
        "document_timing_ms": document_timing_ms,
    }


async def _recover_docx_and_emit_updates_background(
    *,
    kernel_id: str,
    websocket: WebSocket,
    execution_id: Optional[str] = None,
    timeout_s: Optional[int] = None,
    generation: Optional[int] = None,
    queued_at_monotonic: Optional[float] = None,
    source_path: Optional[str] = None,
    source_kind: Optional[str] = None,
) -> None:
    effective_timeout_s = max(1, int(timeout_s if timeout_s is not None else NOTEBOOK_PDF_TIMEOUT_S))
    recovery_source_info = _resolve_source_info(
        kernel_id,
        source_path=source_path,
        source_kind=source_kind,
    )

    async def safe_send(message: dict[str, Any]) -> bool:
        if generation is not None and not _is_document_job_current(kernel_id, generation):
            return False
        try:
            await manager.send_personal_message(message, websocket)
            return True
        except Exception:
            return False

    await safe_send(
        _build_document_progress_payload(
            kernel_id=kernel_id,
            execution_id=execution_id,
            stage="docx_export",
            message="Recuperando documento DOCX...",
            source_path=recovery_source_info.get("source_path"),
            source_kind=recovery_source_info.get("source_kind"),
        )
    )

    try:
        docx_results = await _execute_docx_export(
            kernel_id,
            websocket,
            pdf_timeout_s=effective_timeout_s,
            execution_id=execution_id,
            generation=generation,
            queued_at_monotonic=queued_at_monotonic,
        )
    except Exception as exc:
        await safe_send(
            _build_document_progress_payload(
                kernel_id=kernel_id,
                execution_id=execution_id,
                stage="docx_export",
                status="failed",
                message=f"Error recuperando documento DOCX: {exc}",
                source_path=recovery_source_info.get("source_path"),
                source_kind=recovery_source_info.get("source_kind"),
            )
        )
        await safe_send(
            _build_notebook_pdf_ready_payload(
                kernel_id=kernel_id,
                execution_id=execution_id,
                source_path=recovery_source_info.get("source_path"),
                source_kind=recovery_source_info.get("source_kind"),
                docx_hash=None,
                pdf_file_b64=None,
                pdf_hash=None,
                pdf_ref=None,
                pdf_file_token=None,
                pdf_file_name=None,
                pdf_inline=False,
                pdf_store_error=None,
                pdf_conversion_error=f"docx_recovery_failed: {exc}",
                pdf_attempted=True,
                pdf_conversion_stdout=None,
                pdf_conversion_stderr=None,
                pdf_conversion_ms=None,
                pdf_size_bytes=None,
                converter_used=None,
                word_error=None,
            )
        )
        return

    if generation is not None and not _is_document_job_current(kernel_id, generation):
        return

    recovery_source_info = _resolve_source_info(
        kernel_id,
        source_path=docx_results.get("source_path") or recovery_source_info.get("source_path"),
        source_kind=docx_results.get("source_kind") or recovery_source_info.get("source_kind"),
    )

    if _has_meaningful_docx_update(docx_results):
        await safe_send(
            _build_document_progress_payload(
                kernel_id=kernel_id,
                execution_id=execution_id,
                stage="docx_ready",
                message="DOCX listo.",
                source_path=recovery_source_info.get("source_path"),
                source_kind=recovery_source_info.get("source_kind"),
            )
        )
        await safe_send(
            _build_notebook_docx_update_payload(
                kernel_id=kernel_id,
                execution_id=execution_id,
                docx_results=docx_results,
            )
        )

    pdf_conversion_error = docx_results.get("pdf_conversion_error")
    if docx_results.get("pdf_attempted") or docx_results.get("pdf_file_b64") or docx_results.get("pdf_ref") or pdf_conversion_error:
        await safe_send(
            _build_document_progress_payload(
                kernel_id=kernel_id,
                execution_id=execution_id,
                stage="pdf_convert",
                status="failed" if bool(pdf_conversion_error) else "running",
                message=(
                    f"Error generando PDF: {pdf_conversion_error}"
                    if pdf_conversion_error
                    else "Convirtiendo a PDF..."
                ),
                source_path=recovery_source_info.get("source_path"),
                source_kind=recovery_source_info.get("source_kind"),
            )
        )
    if (
        not pdf_conversion_error
        and not docx_results.get("pdf_file_b64")
        and not docx_results.get("pdf_ref")
        and not docx_results.get("docx_is_empty")
        and not _has_meaningful_docx_update(docx_results)
    ):
        pdf_conversion_error = "docx_recovery_failed"

    await safe_send(
        _build_notebook_pdf_ready_payload(
            kernel_id=kernel_id,
            execution_id=execution_id,
            source_path=recovery_source_info.get("source_path"),
            source_kind=recovery_source_info.get("source_kind"),
            docx_hash=docx_results.get("docx_hash"),
            docx_artifact_id=docx_results.get("docx_artifact_id"),
            docx_provenance_available=docx_results.get("docx_provenance_available"),
            docx_provenance_ref=docx_results.get("docx_provenance_ref"),
            workspace_path=docx_results.get("workspace_path"),
            workspace_relpath=docx_results.get("workspace_relpath"),
            workspace_warning=docx_results.get("workspace_warning"),
            pdf_file_b64=docx_results.get("pdf_file_b64"),
            pdf_hash=docx_results.get("pdf_hash"),
            pdf_ref=docx_results.get("pdf_ref"),
            pdf_file_token=docx_results.get("pdf_file_token"),
            pdf_file_name=docx_results.get("pdf_file_name"),
            pdf_inline=docx_results.get("pdf_inline"),
            pdf_store_error=docx_results.get("pdf_store_error"),
            pdf_conversion_error=pdf_conversion_error,
            pdf_attempted=docx_results.get("pdf_attempted"),
            pdf_conversion_stdout=docx_results.get("pdf_conversion_stdout"),
            pdf_conversion_stderr=docx_results.get("pdf_conversion_stderr"),
            pdf_conversion_ms=docx_results.get("pdf_conversion_ms"),
            pdf_size_bytes=docx_results.get("pdf_size_bytes"),
            converter_used=docx_results.get("converter_used"),
            word_error=docx_results.get("word_error"),
            document_timing_ms=docx_results.get("document_timing_ms"),
        )
    )


# =============================================================================
# FUNCIONES EJECUCIÃ“N AISLADA (Legacy/Simple Mode)
# =============================================================================

def execute_code_isolated(code: str):
    dependency_graph = {"nodes": [], "links": []}
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as fdep:
        json.dump(dependency_graph, fdep)
        dep_path = fdep.name
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as fvars:
        var_path = fvars.name
    
    script = f"import sys, json, io, base64, traceback, os as _os\nBR={_BACKEND_ROOT!r}\nif BR not in sys.path: sys.path.insert(0, BR)\ndef is_user_defined_variable(n,v):\n    if n.startswith('__') and n.endswith('__'): return False\n    if n in ('json','sys','traceback','__builtins__','is_user_defined_variable','serialize_value'): return False\n    if callable(v) and getattr(v,'__module__',None) in ('builtins',None): return False\n    return True\ndef serialize_value(v):\n    try:\n        t=type(v).__name__\n        if v is None or isinstance(v,(int,float,bool,str)): return {{'type':t,'len':len(v),'repr':repr(v)[:100]}}\n        if isinstance(v,(list,tuple,set)): return {{'type':t,'len':len(v),'repr':repr(list(v))[:100]}}\n        if isinstance(v,dict): return {{'type':'dict','len':len(v),'repr':repr(v)[:100]}}\n        return {{'type':t,'repr':repr(v)[:100]}}\n    except Exception as e: return {{'type':'error','repr':str(e)}}\ntry:\n    from librerias_propias.math_to_docx import (\n        build_doc, doc_begin, doc_block, doc_end, doc_export, doc_help, doc_reset, get_session,\n        Heading, Text, List, Code, Link, Equation, EquationLatex, Reference, Image, Figure,\n        Caption, Table, DataFrame, Section, TableOfContents, PageBreak,\n        Metadata, Style, Header, Footer, doc_start_cell, doc_finish_cell,\n    )\n    __DOCX_EDITOR_ORDER = globals().get('__DOCX_EDITOR_ORDER', 0) + 1\n    globals()['__DOCX_EDITOR_ORDER'] = __DOCX_EDITOR_ORDER\n    __DOCX_EDITOR_CELL_ID = f\"__editor_cell__{{__DOCX_EDITOR_ORDER}}\"\n    __DOCX_EDITOR_BLOCK_ID = f\"__editor_block__{{__DOCX_EDITOR_ORDER}}\"\n    try: doc_start_cell(notebook_cell_id=__DOCX_EDITOR_CELL_ID)\n    except Exception: pass\n    _DOCX_BUILDER = doc_begin(block_id=__DOCX_EDITOR_BLOCK_ID, auto_clear=True, order=__DOCX_EDITOR_ORDER, notebook_cell_id=__DOCX_EDITOR_CELL_ID)\n    def mdoc(expr, label=None, number=False): Equation(expr, label=label, number=number)\n    def mdoc_latex(expr, label=None, number=False): EquationLatex(expr, label=label, number=number)\n    def txtdoc(text): Text(str(text))\n    def __export_docx_base64():\n        global _DOCX_BUILDER\n        try:\n            if _DOCX_BUILDER is not None:\n                doc_end()\n                doc_finish_cell(notebook_cell_id=__DOCX_EDITOR_CELL_ID)\n                _DOCX_BUILDER = None\n        except Exception: pass\n        return get_session().export_docx_base64()\nexcept Exception: _DOCX_BUILDER = None\ncode={code!r}\ng={{'__name__':'__main__'}}\nfor _name in ('mdoc','mdoc_latex','txtdoc','__export_docx_base64'):\n    if _name in globals(): g[_name]=globals()[_name]\ntry: exec(code, g)\nexcept Exception: g['__exec_error__']=traceback.format_exc()\nuser_vars={{}}\nfor k,v in list(g.items()):\n    if is_user_defined_variable(k,v): user_vars[k]=serialize_value(v)\ntry:\n    with open({dep_path!r},'r') as f: dep_graph=json.load(f)\nexcept Exception: dep_graph={{'nodes':[], 'links':[]}}\nout={{'variables':user_vars,'dependency_graph':dep_graph}}\ntry:\n    if '__export_docx_base64' in g: out['docx_file_b64']=g['__export_docx_base64']()\nexcept Exception: out['docx_file_b64']=None\nif (not out.get('docx_file_b64')) and _os.getenv('INSPYRO_TEST_FORCE_DOCX'):\n    try:\n        from docx import Document\n        _d=Document(); _d.add_paragraph('(doc vacÃ­o aislado)'); _bio=io.BytesIO(); _d.save(_bio)\n        import base64 as _b64; out['docx_file_b64']=_b64.b64encode(_bio.getvalue()).decode('utf-8')\n    except Exception: pass\nwith open({var_path!r},'w') as f: json.dump(out,f)\n"
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as tf:
        tf.write(script); script_path = tf.name
    try:
        proc = subprocess.run([sys.executable, script_path], capture_output=True, text=True, timeout=10)
        variables={}; dependency_graph={"nodes":[],"links":[]}; docx_b64=None
        try:
            with open(var_path,'r') as vf:
                data=json.load(vf); variables=data.get('variables',{}); dependency_graph=data.get('dependency_graph',{"nodes":[],"links":[]}); docx_b64=data.get('docx_file_b64')
        except Exception: pass
        return {'success': proc.returncode==0,'stdout':proc.stdout,'stderr':proc.stderr,'return_code':proc.returncode,'variables':variables,'dependency_graph':dependency_graph,'docx_file_b64':docx_b64}
    except subprocess.TimeoutExpired:
        return {'success':False,'stdout':'','stderr':'ERROR: CÃ³digo cancelado por timeout (>10s)','return_code':-1,'variables':{},'dependency_graph':dependency_graph,'docx_file_b64':None}
    except Exception as e:
        return {'success':False,'stdout':'','stderr':f'ERROR: {e}','return_code':-1,'variables':{},'dependency_graph':dependency_graph,'docx_file_b64':None}
    finally:
        for p in (script_path, dep_path, var_path):
            try: os.unlink(p)
            except Exception: pass

async def _execute_python_code_simple(
    code: str,
    websocket: WebSocket,
    *,
    file_path: Optional[str] = None,
    run_id: Optional[str] = None,
):
    normalized_file_path = _normalize_source_path(file_path)
    if normalized_file_path:
        home_compact_store.register_code_runtime(
            file_path=normalized_file_path,
            run_id=run_id,
            state="running",
        )
    await manager.send_personal_message(
        {
            "type": "execution_started",
            "mode": "run_all",
            "file_path": normalized_file_path,
            "run_id": run_id,
        },
        websocket,
    )
    mdoc_preamble = textwrap.dedent(f"""# --- DOCX PREAMBULO AUTO-INYECTADO ---
import sys as __sys, os as __os
__DOCX_BR={_BACKEND_ROOT!r}
if __DOCX_BR not in __sys.path: __sys.path.insert(0, __DOCX_BR)
try:
    from librerias_propias.math_to_docx import (
        build_doc, doc_begin, doc_block, doc_end, doc_export, doc_help, doc_reset, get_session,
        Heading, Text, List, Code, Link, Equation, EquationLatex, Reference, Image, Figure,
        Caption, Table, DataFrame, Section, TableOfContents, PageBreak,
        Metadata, Style, Header, Footer, doc_start_cell, doc_finish_cell,
    )
    __DOCX_IMPORT_ERROR = None
except Exception as __docx_err:
    __DOCX_IMPORT_ERROR = __docx_err
__DOCX_BUILDER = None
__DOCX_EDITOR_ORDER = 0
__DOCX_EDITOR_CELL_ID = None
__DOCX_EDITOR_BLOCK_ID = None
def __docx_available(): return __DOCX_IMPORT_ERROR is None
def __ensure_docx_builder():
    global __DOCX_BUILDER, __DOCX_EDITOR_ORDER, __DOCX_EDITOR_CELL_ID, __DOCX_EDITOR_BLOCK_ID
    if not __docx_available(): return None
    if __DOCX_BUILDER is None:
        __DOCX_EDITOR_ORDER += 1
        __DOCX_EDITOR_CELL_ID = f"__editor_cell_{{__DOCX_EDITOR_ORDER}}"
        __DOCX_EDITOR_BLOCK_ID = f"__editor_block_{{__DOCX_EDITOR_ORDER}}"
        try: doc_start_cell(notebook_cell_id=__DOCX_EDITOR_CELL_ID)
        except Exception: pass
        __DOCX_BUILDER = doc_begin(block_id=__DOCX_EDITOR_BLOCK_ID, auto_clear=True, order=__DOCX_EDITOR_ORDER, notebook_cell_id=__DOCX_EDITOR_CELL_ID)
    return __DOCX_BUILDER
def mdoc(expression: str, label: str | None = None, number: bool = False):
    if not __docx_available(): return None
    __ensure_docx_builder()
    Equation(expression, label=label, number=number)
def mdoc_latex(expression: str, label: str | None = None, number: bool = False):
    if not __docx_available(): return None
    __ensure_docx_builder()
    EquationLatex(expression, label=label, number=number)
def txtdoc(text: str):
    if not __docx_available(): return None
    __ensure_docx_builder()
    Text(str(text))
def __export_docx_base64():
    global __DOCX_BUILDER, __DOCX_EDITOR_CELL_ID
    if not __docx_available(): return None
    try:
        if __DOCX_BUILDER is not None:
            doc_end()
            if __DOCX_EDITOR_CELL_ID is not None:
                try: doc_finish_cell(notebook_cell_id=__DOCX_EDITOR_CELL_ID)
                except Exception: pass
            __DOCX_BUILDER = None
            __DOCX_EDITOR_CELL_ID = None
    except Exception: pass
    try: return get_session().export_docx_base64()
    except Exception: return None
# --- FIN DOCX PREAMBULO ---
""")
    full_code = mdoc_preamble + "\n" + code
    loop = asyncio.get_running_loop()
    def run_sandbox():
        try:
            from app.services.docker_executor import docker_executor
            if docker_executor and docker_executor.health_check():
                return docker_executor.execute_code(full_code, mode='run_all', timeout=30)
        except Exception: pass
        return execute_code_isolated(full_code)

    try:
        result = await loop.run_in_executor(None, run_sandbox)
        docx_hash = None
        if result.get("docx_file_b64"):
            try:
                docx_hash, _ = compute_docx_semantic_hash(result.get("docx_file_b64"))
            except Exception:
                docx_hash = None
        docx_payload = _prepare_docx_payload(
            result.get("docx_file_b64"),
            filename=DOCX_DEFAULT_FILENAME,
            docx_hash=docx_hash,
            source_kind="code",
            source_path=file_path,
        )
        await manager.send_personal_message({
            "type": "execution_result", "success": result.get("success", False),
            "output": result.get("stdout", ""), "error": result.get("stderr", ""),
            "variables": result.get("variables", {}), "dependency_graph": result.get("dependency_graph", {"nodes": [], "links": []}),
            "docx_file_b64": docx_payload.get("docx_file_b64"), "docx_file_token": docx_payload.get("docx_file_token"),
            "docx_download_url": docx_payload.get("docx_download_url"), "docx_ref": docx_payload.get("docx_ref"), "docx_artifact_id": docx_payload.get("docx_artifact_id"), "docx_file_name": docx_payload.get("docx_file_name"),
            "docx_inline": docx_payload.get("docx_inline"), "docx_store_error": docx_payload.get("docx_store_error"),
            "docx_size_bytes": docx_payload.get("docx_size_bytes"),
            "file_path": normalized_file_path,
            "run_id": run_id,
            "source_path": normalized_file_path,
            "source_kind": "code",
        }, websocket)
        if normalized_file_path:
            home_compact_store.update_code_runtime(
                file_path=normalized_file_path,
                run_id=run_id,
                state="idle",
                message="Execution completed",
                docx_artifact_id=docx_payload.get("docx_artifact_id"),
                docx_ref=docx_payload.get("docx_ref"),
            )
    except asyncio.CancelledError:
        if normalized_file_path:
            home_compact_store.clear_code_runtime(file_path=normalized_file_path)
        raise
    except Exception as e:
        if normalized_file_path:
            home_compact_store.update_code_runtime(
                file_path=normalized_file_path,
                run_id=run_id,
                state="error",
                error=str(e),
                message=str(e),
            )
        await manager.send_personal_message({
            "type": "execution_error",
            "error": str(e),
            "traceback": traceback.format_exc(),
            "file_path": normalized_file_path,
            "run_id": run_id,
        }, websocket)
