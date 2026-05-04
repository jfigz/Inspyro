"""Notebook execution handlers."""

import base64
import os
import asyncio
import json
import hashlib
import time
import traceback
from pathlib import Path
from uuid import uuid4

from fastapi import WebSocket

try:
    import nbformat
    from nbformat.v4 import new_notebook, new_code_cell, new_markdown_cell
except ImportError:
    nbformat = None

from app.routers.notebook_common import (
    KernelLockTimeoutError,
    NOTEBOOK_PDF_TIMEOUT_S,
    manager,
    jupyter_kernel_manager,
    active_tasks,
    notebook_cumulative_graphs,
    notebook_cumulative_variables,
    notebook_cumulative_call_stacks,
    notebook_last_docx_b64,
    notebook_docx_hash,
    _get_kernel_lock,
    _build_notebook_instrumented_code,
    _forward_iopub,
    _mark_execution_queued,
    _mark_execution_running,
    _mark_execution_finished,
    _is_execution_cancelled,
    _process_notebook_cell_execution,
    _execute_docx_export,
    _prepare_pdf_payload,
    _execute_python_code_simple,
    queue_document_pipeline_job,
    _send_notebook_error,
    _timed_lock,
    _bind_kernel_to_connection,
    _shutdown_kernel_resources,
    set_kernel_docx_source,
    clear_kernel_runtime_state,
)
from app.services.pdf_converter import (
    build_pdf_context,
    build_pdf_context_async,
    pdf_cache_set as _pdf_cache_set,
)
from app.services.docx_artifacts import get_latest_docx_artifact
from app.services.home_compact import home_compact_store
from app.services.notebook_service import (
    DocumentJobRequest,
    get_kernel_docx_source,
    _build_notebook_progress_update_payload,
    get_kernel_notebook_snapshot,
    set_kernel_notebook_snapshot,
)


NOTEBOOK_EXECUTION_TIMEOUT_S = max(
    1.0,
    float(os.getenv("INSPYRO_NOTEBOOK_EXECUTION_TIMEOUT", "600")),
)
LOCK_TIMEOUT_S = max(0.1, float(os.getenv("INSPYRO_LOCK_TIMEOUT", "60")))
EXECUTION_KEEPALIVE_INTERVAL_S = max(
    5.0,
    float(os.getenv("INSPYRO_NOTEBOOK_PROGRESS_HEARTBEAT", "15")),
)
NOTEBOOK_DOCUMENT_MUTATION_TIMEOUT_S = max(
    NOTEBOOK_EXECUTION_TIMEOUT_S,
    float(NOTEBOOK_PDF_TIMEOUT_S),
)
_code_run_by_path: dict[str, str] = {}
_DEFAULT_BUILD_PDF_CONTEXT = build_pdf_context
_INSPYRO_CELL_TYPES = {"code", "markdown", "docx"}
_PERSISTENCE_SAFE_CELL_TYPES = _INSPYRO_CELL_TYPES | {"raw"}
_DOCX_SOURCE_HINTS = (
    "build_doc(",
    "doc_begin(",
    "doc_block(",
    "doc_end(",
    "doc_reset(",
    "doc_export(",
    ".heading(",
    ".text(",
    ".math_latex(",
    ".table(",
    ".dataframe(",
    ".figure(",
    ".image(",
    ".caption(",
    ".reference(",
    "Heading(",
    "Text(",
    "Table(",
    "DataFrame(",
    "Figure(",
    "Image(",
    "Caption(",
    "Reference(",
)
_DEFAULT_BUILD_PDF_CONTEXT_ASYNC = build_pdf_context_async
_mark_execution_started = _mark_execution_queued


def _normalize_runtime_path(path: str | None) -> str | None:
    if not path or not str(path).strip():
        return None
    try:
        return str(Path(str(path)).expanduser().resolve())
    except Exception:
        return str(path).strip()


def _unregister_code_task(run_id: str | None) -> None:
    normalized_run_id = str(run_id or "").strip()
    if not normalized_run_id:
        return
    entry = active_tasks.pop(normalized_run_id, None)
    if not isinstance(entry, dict):
        return
    file_path = entry.get("file_path")
    if file_path and _code_run_by_path.get(file_path) == normalized_run_id:
        _code_run_by_path.pop(file_path, None)


def _serialize_notebook_cell_source(raw_source) -> str:
    if isinstance(raw_source, list):
        parts = [
            part
            if isinstance(part, str)
            else ("" if part is None else str(part))
            for part in raw_source
        ]
        has_explicit_breaks = any(("\n" in part) or ("\r" in part) for part in parts)
        text = "".join(parts) if has_explicit_breaks else "\n".join(parts)
        return text.replace("\r\n", "\n").replace("\r", "\n")
    if isinstance(raw_source, str):
        return raw_source.replace("\r\n", "\n").replace("\r", "\n")
    return ""


def _normalize_notebook_cell_type(raw_cell_type) -> str:
    cell_type = str(raw_cell_type or "code").strip().lower() or "code"
    return cell_type if cell_type in _PERSISTENCE_SAFE_CELL_TYPES else "code"


def _looks_like_docx_cell_source(raw_source) -> bool:
    source = _serialize_notebook_cell_source(raw_source)
    return any(hint in source for hint in _DOCX_SOURCE_HINTS)


def _has_custom_notebook_cell_types(notebook_payload: dict) -> bool:
    return any(
        _normalize_notebook_cell_type(cell.get("cell_type")) not in {"code", "markdown"}
        for cell in notebook_payload.get("cells", [])
        if isinstance(cell, dict)
    )


def _restore_kernel_docx_snapshot(kernel_id: str) -> tuple[str | None, str | None]:
    docx_b64 = notebook_last_docx_b64.get(kernel_id)
    docx_hash = notebook_docx_hash.get(kernel_id)
    if docx_b64:
        return docx_b64, docx_hash

    source_info = get_kernel_docx_source(kernel_id)
    latest = None
    source_path = source_info.get("source_path")
    if source_path:
        latest = get_latest_docx_artifact(
            source_path=source_path,
            skip_empty=True,
        )
    if latest is None:
        latest = get_latest_docx_artifact(
            kernel_id=kernel_id,
            skip_empty=True,
        )
    artifact_path = latest.get("path") if isinstance(latest, dict) else None
    if not artifact_path:
        return None, None

    try:
        docx_bytes = Path(str(artifact_path)).read_bytes()
    except OSError:
        return None, None
    if not docx_bytes:
        return None, None

    restored_b64 = base64.b64encode(docx_bytes).decode("ascii")
    restored_hash = str((latest or {}).get("docx_hash") or "").strip() or None
    notebook_last_docx_b64[kernel_id] = restored_b64
    if restored_hash:
        notebook_docx_hash[kernel_id] = restored_hash
    return restored_b64, restored_hash


def _resolve_execution_timeout_s(message: dict) -> float:
    raw_timeout = message.get("execution_timeout_s")
    if raw_timeout is None:
        return NOTEBOOK_EXECUTION_TIMEOUT_S
    try:
        resolved = float(raw_timeout)
    except (TypeError, ValueError):
        return NOTEBOOK_EXECUTION_TIMEOUT_S
    return resolved if resolved > 0 else NOTEBOOK_EXECUTION_TIMEOUT_S


def _resolve_kernel_lock_timeout_s(execution_timeout_s: float | None) -> float:
    """Allow queued cell requests to wait at least as long as a valid cell runtime."""
    try:
        runtime_timeout = float(execution_timeout_s) if execution_timeout_s is not None else 0.0
    except (TypeError, ValueError):
        runtime_timeout = 0.0
    return max(LOCK_TIMEOUT_S, runtime_timeout)


async def _bind_kernel_for_current_connection(
    websocket: WebSocket,
    kernel_id: str | None,
) -> None:
    if not kernel_id:
        return
    await _bind_kernel_to_connection(websocket, kernel_id)


async def _build_pdf_context_for_force_reconvert(
    docx_b64: str,
    docx_hash: str | None,
) -> tuple[dict, str | None, str | None, bool]:
    """Keep the async path in production while honoring legacy sync patch points."""
    if build_pdf_context_async is not _DEFAULT_BUILD_PDF_CONTEXT_ASYNC:
        return await build_pdf_context_async(
            docx_b64,
            docx_hash,
            True,
            False,
            None,
            NOTEBOOK_PDF_TIMEOUT_S,
        )

    if build_pdf_context is not _DEFAULT_BUILD_PDF_CONTEXT:
        return await asyncio.to_thread(
            build_pdf_context,
            docx_b64,
            docx_hash,
            True,
            False,
            None,
            NOTEBOOK_PDF_TIMEOUT_S,
        )

    return await _DEFAULT_BUILD_PDF_CONTEXT_ASYNC(
        docx_b64,
        docx_hash,
        True,
        False,
        None,
        NOTEBOOK_PDF_TIMEOUT_S,
    )


async def _emit_execution_keepalive(
    *,
    kernel_id: str,
    cell_id: str,
    execution_id: str,
    websocket: WebSocket,
    interval_s: float | None = None,
) -> None:
    effective_interval = max(
        1.0,
        float(interval_s if interval_s is not None else EXECUTION_KEEPALIVE_INTERVAL_S),
    )
    while True:
        await asyncio.sleep(effective_interval)
        if await _is_execution_cancelled(kernel_id, execution_id):
            return
        source_info = get_kernel_docx_source(kernel_id)
        try:
            await manager.send_personal_message(
                _build_notebook_progress_update_payload(
                    kernel_id=kernel_id,
                    cell_id=cell_id,
                    execution_id=execution_id,
                    message="Ejecutando celda...",
                    progress_scope="execution",
                    progress_stage="cell_run",
                    progress_status="running",
                    progress_indeterminate=True,
                    source_path=source_info.get("source_path"),
                    source_kind=source_info.get("source_kind"),
                ),
                websocket,
            )
        except Exception:
            return


def _ensure_notebook_cell_ids(notebook_payload):
    if not isinstance(notebook_payload, dict):
        return notebook_payload

    cells = notebook_payload.get("cells")
    if not isinstance(cells, list):
        return notebook_payload

    next_cells = []
    changed = False

    for cell in cells:
        if not isinstance(cell, dict):
            next_cells.append(cell)
            continue

        cell_changed = False
        metadata = cell.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
            cell_changed = True

        cell_id = cell.get("id")
        if not isinstance(cell_id, str) or not cell_id.strip():
            metadata_cell_id = metadata.get("inspyro_id")
            if isinstance(metadata_cell_id, str) and metadata_cell_id.strip():
                cell_id = metadata_cell_id.strip()
            else:
                cell_id = str(uuid4())
            cell_changed = True

        if metadata.get("inspyro_id") != cell_id:
            metadata = {**metadata, "inspyro_id": cell_id}
            cell_changed = True

        cell_type = _normalize_notebook_cell_type(cell.get("cell_type"))
        if cell_type == "code" and _looks_like_docx_cell_source(cell.get("source")):
            cell_type = "docx"
        if cell.get("cell_type") != cell_type:
            cell_changed = True

        if cell_changed:
            changed = True
            next_cells.append({**cell, "id": cell_id, "cell_type": cell_type, "metadata": metadata})
        else:
            next_cells.append(cell)

    if not changed:
        return notebook_payload

    return {
        **notebook_payload,
        "cells": next_cells,
    }


async def handle_notebook_attach_kernel(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        if jupyter_kernel_manager is None:
            raise RuntimeError("Kernels Jupyter no disponibles")

        kernel_id = message.get("kernel_id")
        path = message.get("path")
        if not kernel_id and path:
            normalized_path = _normalize_runtime_path(path)
            runtime_entries = home_compact_store.snapshot_runtime_entries()
            matched_entry = next(
                (
                    entry
                    for entry in runtime_entries
                    if _normalize_runtime_path(entry.get("notebook_path")) == normalized_path
                ),
                None,
            )
            kernel_id = matched_entry.get("kernel_id") if matched_entry else None

        if not kernel_id:
            raise RuntimeError("No se pudo resolver el kernel del notebook")

        snapshot = get_kernel_notebook_snapshot(kernel_id)
        if snapshot is None:
            raise RuntimeError(f"No hay snapshot notebook disponible para {kernel_id}")

        source_info = get_kernel_docx_source(kernel_id)
        runtime_entry = home_compact_store.get_runtime_by_kernel(kernel_id or "") or {}
        notebook_path = _normalize_runtime_path(
            path
            or source_info.get("source_path")
            or runtime_entry.get("notebook_path")
        )
        await _bind_kernel_for_current_connection(websocket, kernel_id)
        if notebook_path:
            set_kernel_docx_source(kernel_id, source_path=notebook_path, source_kind="notebook")
            home_compact_store.register_notebook_runtime(
                kernel_id=kernel_id,
                notebook_path=notebook_path,
                source_kind="notebook",
                state=(home_compact_store.get_runtime_by_kernel(kernel_id) or {}).get("state") or "idle",
            )

        await manager.send_personal_message(
            {
                "type": "notebook_attached",
                "kernel_id": kernel_id,
                "notebook_path": notebook_path,
                "notebook": snapshot,
                "request_id": request_id,
            },
            websocket,
        )
    except Exception as e:
        await _send_notebook_error(
            websocket,
            str(e),
            error_code="notebook_attach_kernel_failed",
            traceback_text=traceback.format_exc(),
            extra={"request_id": request_id},
        )


async def handle_notebook_create(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        if jupyter_kernel_manager is None:
            raise RuntimeError("Kernels Jupyter no disponibles")

        previous_kernel_id = message.get("previous_kernel_id")
        if isinstance(previous_kernel_id, str) and previous_kernel_id:
            await _shutdown_kernel_resources(previous_kernel_id)

        cwd = message.get("cwd")
        if not cwd and message.get("path"):
            path_arg = message.get("path")
            if os.path.exists(path_arg):
                cwd = os.path.dirname(path_arg) if os.path.isfile(path_arg) else path_arg

        kernel_id = await jupyter_kernel_manager.start_kernel("python3", cwd=cwd)
        await _bind_kernel_for_current_connection(websocket, kernel_id)
        set_kernel_docx_source(kernel_id, source_path=message.get("path"), source_kind="notebook")
        home_compact_store.register_notebook_runtime(
            kernel_id=kernel_id,
            notebook_path=message.get("path"),
            source_kind="notebook",
            state="idle",
        )
        notebook_cumulative_graphs[kernel_id] = {"nodes": [], "links": []}
        notebook_cumulative_variables[kernel_id] = {}
        notebook_cumulative_call_stacks[kernel_id] = []

        if nbformat:
            nb = new_notebook(
                cells=[new_code_cell("# Bienvenido a Inspyro Notebook\nprint('¡Hola desde Jupyter Notebook!')")],
                metadata={"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python"}}
            )
            for cell in nb.cells: cell.setdefault("id", str(uuid4()))
            notebook_payload = {
                "cells": [
                    {
                        "id": cell.get("id", str(uuid4())),
                        "cell_type": cell.get("cell_type", "code"),
                        "source": cell.get("source", "").split("\n") if isinstance(cell.get("source"), str) else (cell.get("source") or [""]),
                        "outputs": cell.get("outputs", []),
                        "execution_count": cell.get("execution_count"),
                        "metadata": cell.get("metadata", {}),
                    } for cell in nb.cells
                ],
                "metadata": nb.metadata,
                "nbformat": nb.nbformat,
                "nbformat_minor": nb.nbformat_minor,
            }
        else:
            notebook_payload = {"cells": [{"id": str(uuid4()), "cell_type": "code", "source": ["# Bienvenido"], "outputs": []}], "metadata": {}}

        set_kernel_notebook_snapshot(kernel_id, notebook_payload)

        await manager.send_personal_message(
            {
                "type": "notebook_created",
                "kernel_id": kernel_id,
                "notebook_path": (
                    str(Path(str(message.get("path"))).expanduser().resolve())
                    if message.get("path")
                    else None
                ),
                "notebook": notebook_payload,
                "request_id": request_id,
            },
            websocket,
        )
    except Exception as e:
        await _send_notebook_error(
            websocket,
            str(e),
            error_code="notebook_create_failed",
            traceback_text=traceback.format_exc(),
            extra={"request_id": request_id},
        )

async def handle_notebook_load(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        if jupyter_kernel_manager is None: raise RuntimeError("Kernels Jupyter no disponibles")
        previous_kernel_id = message.get("previous_kernel_id")
        if isinstance(previous_kernel_id, str) and previous_kernel_id:
            await _shutdown_kernel_resources(previous_kernel_id)

        ipynb_content = message.get("content")
        notebook_payload = json.loads(ipynb_content) if isinstance(ipynb_content, str) else ipynb_content
        notebook_payload = _ensure_notebook_cell_ids(notebook_payload)
        
        cwd = message.get("cwd") or (os.path.dirname(message.get("path")) if message.get("path") else None)
        kernel_id = await jupyter_kernel_manager.start_kernel("python3", cwd=cwd)
        await _bind_kernel_for_current_connection(websocket, kernel_id)
        set_kernel_docx_source(kernel_id, source_path=message.get("path"), source_kind="notebook")
        home_compact_store.register_notebook_runtime(
            kernel_id=kernel_id,
            notebook_path=message.get("path"),
            source_kind="notebook",
            state="idle",
        )
        notebook_cumulative_graphs[kernel_id] = {"nodes": [], "links": []}
        notebook_cumulative_variables[kernel_id] = {}
        notebook_cumulative_call_stacks[kernel_id] = []
        set_kernel_notebook_snapshot(kernel_id, notebook_payload)

        await manager.send_personal_message(
            {
                "type": "notebook_loaded",
                "kernel_id": kernel_id,
                "notebook_path": (
                    str(Path(str(message.get("path"))).expanduser().resolve())
                    if message.get("path")
                    else None
                ),
                "notebook": notebook_payload,
                "request_id": request_id,
            },
            websocket,
        )
    except Exception as e:
        await _send_notebook_error(
            websocket,
            str(e),
            error_code="notebook_load_failed",
            traceback_text=traceback.format_exc(),
            extra={"request_id": request_id},
        )

async def handle_notebook_save(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        notebook_data = _ensure_notebook_cell_ids(message.get("notebook") or {})
        if _has_custom_notebook_cell_types(notebook_data):
            content = json.dumps(notebook_data, ensure_ascii=False, indent=1)
        elif nbformat:
            nb = new_notebook(cells=[], metadata=notebook_data.get("metadata", {}))
            for cell in notebook_data.get("cells", []):
                cell_type = _normalize_notebook_cell_type(cell.get("cell_type", "code"))
                source = _serialize_notebook_cell_source(cell.get("source", []))
                if cell_type == "markdown": nb_cell = new_markdown_cell(source=source)
                else: nb_cell = new_code_cell(source=source, execution_count=cell.get("execution_count"), outputs=cell.get("outputs", []))
                nb_cell["id"] = cell.get("id", str(uuid4()))
                nb_cell["metadata"] = cell.get("metadata", {})
                nb.cells.append(nb_cell)
            content = nbformat.writes(nb, version=4)
        else:
            content = json.dumps(notebook_data, ensure_ascii=False, indent=1)
        await manager.send_personal_message(
            {
                "type": "notebook_saved",
                "content": content,
                "request_id": request_id,
            },
            websocket,
        )
    except Exception as e:
        await _send_notebook_error(
            websocket,
            str(e),
            error_code="notebook_save_failed",
            extra={"request_id": request_id},
        )

async def handle_notebook_execute_cell(message: dict, websocket: WebSocket):
    cell_id = message.get("cell_id")
    kernel_id = message.get("kernel_id")
    execution_id_raw = message.get("execution_id")
    execution_id = str(execution_id_raw).strip() if execution_id_raw is not None else ""
    if not execution_id:
        execution_id = f"exec_{uuid4().hex}"
    execution_timeout_s = _resolve_execution_timeout_s(message)

    try:
        if jupyter_kernel_manager is None: raise RuntimeError("Kernels Jupyter no disponibles")
        await _bind_kernel_for_current_connection(websocket, kernel_id)
        await _mark_execution_queued(kernel_id, execution_id)
        raw_source = message.get("source", [])
        source_code = _serialize_notebook_cell_source(raw_source)
        set_kernel_docx_source(kernel_id, source_path=message.get("path"), source_kind="notebook")
        emit_docx_requested = bool(message.get("emit_docx", False)) or bool(os.getenv('INSPYRO_TEST_FORCE_DOCX'))
        
        instrumented_code = _build_notebook_instrumented_code(
            source_code=source_code,
            cell_id=cell_id,
            cell_index=message.get("cell_index"),
            emit_docx=emit_docx_requested,
            docx_validation=bool(message.get("docx_validation", True)),
        )

        lock = _get_kernel_lock(kernel_id)
        response_payload = None
        keepalive_task = None

        try:
            lock_timeout_s = _resolve_kernel_lock_timeout_s(execution_timeout_s)
            async with _timed_lock(lock, timeout_s=lock_timeout_s):
                await _mark_execution_running(kernel_id, execution_id)
                keepalive_task = asyncio.create_task(
                    _emit_execution_keepalive(
                        kernel_id=kernel_id,
                        cell_id=cell_id,
                        execution_id=execution_id,
                        websocket=websocket,
                    )
                )
                response_payload = await _process_notebook_cell_execution(
                    kernel_id=kernel_id,
                    cell_id=cell_id,
                    instrumented_code=instrumented_code,
                    source_code=source_code,
                    enable_tracing=bool(message.get("enable_tracing", False)),
                    emit_docx=emit_docx_requested,
                    execution_timeout_s=execution_timeout_s,
                    skip_pdf=bool(message.get("skip_pdf", False)),
                    on_iopub=lambda t, c, p: _forward_iopub(
                        t,
                        c,
                        cell_id,
                        websocket,
                        kernel_id=kernel_id,
                        execution_id=execution_id,
                    ),
                    websocket=websocket,
                    execution_id=execution_id,
                )
        finally:
            if keepalive_task is not None:
                keepalive_task.cancel()
                try:
                    await keepalive_task
                except asyncio.CancelledError:
                    pass

        if response_payload:
            if await _is_execution_cancelled(kernel_id, execution_id):
                await manager.send_personal_message(
                    {
                        "type": "notebook_cell_error",
                        "kernel_id": kernel_id,
                        "cell_id": cell_id,
                        "execution_id": execution_id,
                        "error": "Execution cancelled",
                        "message": "Execution cancelled",
                        "error_code": "execution_cancelled",
                    },
                    websocket,
                )
                return
            document_job_request = response_payload.pop("_document_job_request", None)
            MAX_PAYLOAD = 8 * 1024 * 1024
            docx_len = len(response_payload.get("docx_file_b64") or "")
            pdf_len = len(response_payload.get("pdf_file_b64") or "")
            if (docx_len + pdf_len) > MAX_PAYLOAD:
                if response_payload.get("docx_file_b64") and response_payload.get("docx_ref"):
                    response_payload["docx_file_b64"] = None
                    response_payload["docx_inline"] = False
                fallback_pdf_payload = _prepare_pdf_payload(response_payload.get("pdf_file_b64"))
                response_payload["pdf_file_b64"] = fallback_pdf_payload.get("pdf_file_b64")
                response_payload["pdf_ref"] = fallback_pdf_payload.get("pdf_ref")
                response_payload["pdf_file_token"] = fallback_pdf_payload.get("pdf_file_token")
                response_payload["pdf_file_name"] = fallback_pdf_payload.get("pdf_file_name")
                response_payload["pdf_inline"] = fallback_pdf_payload.get("pdf_inline")
                response_payload["pdf_store_error"] = fallback_pdf_payload.get("pdf_store_error")
                response_payload["pdf_size_bytes"] = fallback_pdf_payload.get("pdf_size_bytes") or response_payload.get("pdf_size_bytes")
                if not response_payload.get("pdf_file_b64") and not response_payload.get("pdf_ref"):
                    response_payload["pdf_conversion_error"] = "Output too large"

            runtime_snapshot = get_kernel_notebook_snapshot(kernel_id) or {}
            runtime_cells = runtime_snapshot.get("cells")
            if isinstance(runtime_cells, list) and cell_id:
                updated_cells = []
                for cell in runtime_cells:
                    if isinstance(cell, dict) and cell.get("id") == cell_id:
                        updated_cells.append(
                            {
                                **cell,
                                "outputs": response_payload.get("outputs", cell.get("outputs", [])),
                                "execution_count": response_payload.get("execution_count", cell.get("execution_count")),
                            }
                        )
                    else:
                        updated_cells.append(cell)
                set_kernel_notebook_snapshot(
                    kernel_id,
                    {
                        **runtime_snapshot,
                        "cells": updated_cells,
                    },
                )
             
            await manager.send_personal_message(response_payload, websocket)

            if document_job_request is not None:
                await queue_document_pipeline_job(
                    document_job_request,
                    websocket=websocket,
                    timeout_s=NOTEBOOK_PDF_TIMEOUT_S,
                )
    except KernelLockTimeoutError:
        lock_timeout_s = _resolve_kernel_lock_timeout_s(execution_timeout_s)
        message_text = f"Timeout waiting {lock_timeout_s:.1f}s for kernel lock"
        await manager.send_personal_message(
            {
                "type": "notebook_cell_error",
                "kernel_id": kernel_id,
                "cell_id": cell_id,
                "execution_id": execution_id,
                "error": message_text,
                "message": message_text,
                "error_code": "kernel_lock_timeout",
                "details": {"lock_timeout_s": lock_timeout_s},
            },
            websocket,
        )
    except TimeoutError as exc:
        if jupyter_kernel_manager is not None and kernel_id:
            try:
                await jupyter_kernel_manager.interrupt_kernel(kernel_id)
            except Exception:
                pass
        message_text = f"Cell execution timed out after {execution_timeout_s:.1f}s"
        await manager.send_personal_message(
            {
                "type": "notebook_cell_error",
                "kernel_id": kernel_id,
                "cell_id": cell_id,
                "execution_id": execution_id,
                "error": message_text,
                "message": message_text,
                "error_code": "cell_execution_timeout",
                "details": {
                    "execution_timeout_s": execution_timeout_s,
                    "cause": str(exc),
                },
            },
            websocket,
        )
    except Exception as e:
        await manager.send_personal_message(
            {
                "type": "notebook_cell_error",
                "kernel_id": kernel_id,
                "cell_id": cell_id,
                "execution_id": execution_id,
                "error": str(e),
                "message": str(e),
                "error_code": "notebook_execute_cell_failed",
                "traceback": traceback.format_exc(),
            },
            websocket,
        )
    finally:
        await _mark_execution_finished(kernel_id, execution_id)

async def handle_notebook_delete_cell(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        kernel_id = message.get('kernel_id')
        cell_id = message.get('cell_id')
        execution_id = f"docmut_{uuid4().hex}"
        await _bind_kernel_for_current_connection(websocket, kernel_id)
        lock = _get_kernel_lock(kernel_id)
        async with asyncio.timeout(NOTEBOOK_DOCUMENT_MUTATION_TIMEOUT_S):
            async with _timed_lock(lock):
                await jupyter_kernel_manager.execute_cell(kernel_id, f"from librerias_propias.math_to_docx import doc_clear_cell\ntry: doc_clear_cell({cell_id!r})\nexcept Exception: pass\n", capture_variables=False)
        source_info = get_kernel_docx_source(kernel_id)
        await queue_document_pipeline_job(
            DocumentJobRequest(
                kernel_id=kernel_id,
                execution_id=execution_id,
                reason="delete_cell",
                needs_pdf=True,
                source_path=source_info.get("source_path"),
                source_kind=source_info.get("source_kind"),
                queued_at_monotonic=time.perf_counter(),
            ),
            websocket=websocket,
            timeout_s=NOTEBOOK_PDF_TIMEOUT_S,
        )
        runtime_snapshot = get_kernel_notebook_snapshot(kernel_id) or {}
        runtime_cells = runtime_snapshot.get("cells")
        if isinstance(runtime_cells, list) and cell_id:
            set_kernel_notebook_snapshot(
                kernel_id,
                {
                    **runtime_snapshot,
                    "cells": [
                        cell
                        for cell in runtime_cells
                        if not (isinstance(cell, dict) and cell.get("id") == cell_id)
                    ],
                },
            )
        await manager.send_personal_message(
            {
                'type': 'notebook_cell_deleted',
                'cell_id': cell_id,
                'kernel_id': kernel_id,
                'request_id': request_id,
                'execution_id': execution_id,
                'source_path': source_info.get("source_path"),
                'source_kind': source_info.get("source_kind"),
            },
            websocket,
        )
    except Exception as e:
        await _send_notebook_error(
            websocket,
            str(e),
            error_code="notebook_delete_cell_failed",
            extra={"request_id": request_id},
        )

async def handle_notebook_set_order(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        kernel_id = message.get("kernel_id")
        cell_order = message.get("order", [])
        execution_id = f"docmut_{uuid4().hex}"
        await _bind_kernel_for_current_connection(websocket, kernel_id)
        lock = _get_kernel_lock(kernel_id)

        async with asyncio.timeout(NOTEBOOK_DOCUMENT_MUTATION_TIMEOUT_S):
            async with _timed_lock(lock):
                reorder_code = f"from librerias_propias.math_to_docx import doc_reorder\ntry: doc_reorder({cell_order!r})\nexcept Exception as e: print('[doc_reorder error]', e)"
                await jupyter_kernel_manager.execute_cell(kernel_id, reorder_code, capture_variables=False)
        source_info = get_kernel_docx_source(kernel_id)
        await queue_document_pipeline_job(
            DocumentJobRequest(
                kernel_id=kernel_id,
                execution_id=execution_id,
                reason="set_order",
                needs_pdf=True,
                source_path=source_info.get("source_path"),
                source_kind=source_info.get("source_kind"),
                queued_at_monotonic=time.perf_counter(),
            ),
            websocket=websocket,
            timeout_s=NOTEBOOK_PDF_TIMEOUT_S,
        )
        runtime_snapshot = get_kernel_notebook_snapshot(kernel_id) or {}
        runtime_cells = runtime_snapshot.get("cells")
        if isinstance(runtime_cells, list) and cell_order:
            by_id = {
                cell.get("id"): cell
                for cell in runtime_cells
                if isinstance(cell, dict)
            }
            ordered_cells = [by_id[cell_id] for cell_id in cell_order if cell_id in by_id]
            ordered_ids = {cell.get("id") for cell in ordered_cells if isinstance(cell, dict)}
            ordered_cells.extend(
                cell
                for cell in runtime_cells
                if not (isinstance(cell, dict) and cell.get("id") in ordered_ids)
            )
            set_kernel_notebook_snapshot(
                kernel_id,
                {
                    **runtime_snapshot,
                    "cells": ordered_cells,
                },
            )
        await manager.send_personal_message(
            {
                'type': 'notebook_order_set',
                'kernel_id': kernel_id,
                'order': cell_order,
                'request_id': request_id,
                'execution_id': execution_id,
                'source_path': source_info.get("source_path"),
                'source_kind': source_info.get("source_kind"),
            },
            websocket,
        )
    except Exception as e:
        await _send_notebook_error(
            websocket,
            str(e),
            error_code="notebook_set_order_failed",
            extra={"request_id": request_id},
        )

async def handle_notebook_move_cell(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        kernel_id = message.get("kernel_id")
        cell_id = message.get("cell_id")
        direction = message.get("direction", "up")
        execution_id = f"docmut_{uuid4().hex}"
        await _bind_kernel_for_current_connection(websocket, kernel_id)
        lock = _get_kernel_lock(kernel_id)

        async with asyncio.timeout(NOTEBOOK_DOCUMENT_MUTATION_TIMEOUT_S):
            async with _timed_lock(lock):
                move_code = f"from librerias_propias.math_to_docx import doc_move_cell\ntry: doc_move_cell({cell_id!r}, direction={direction!r})\nexcept Exception as e: print('[doc_move_cell error]', e)"
                await jupyter_kernel_manager.execute_cell(kernel_id, move_code, capture_variables=False)
        source_info = get_kernel_docx_source(kernel_id)
        await queue_document_pipeline_job(
            DocumentJobRequest(
                kernel_id=kernel_id,
                execution_id=execution_id,
                reason="move_cell",
                needs_pdf=True,
                source_path=source_info.get("source_path"),
                source_kind=source_info.get("source_kind"),
                queued_at_monotonic=time.perf_counter(),
            ),
            websocket=websocket,
            timeout_s=NOTEBOOK_PDF_TIMEOUT_S,
        )
        runtime_snapshot = get_kernel_notebook_snapshot(kernel_id) or {}
        runtime_cells = runtime_snapshot.get("cells")
        if isinstance(runtime_cells, list) and cell_id:
            current_index = next(
                (
                    index
                    for index, cell in enumerate(runtime_cells)
                    if isinstance(cell, dict) and cell.get("id") == cell_id
                ),
                None,
            )
            if current_index is not None:
                next_index = current_index - 1 if direction == "up" else current_index + 1
                if 0 <= next_index < len(runtime_cells):
                    updated_cells = list(runtime_cells)
                    updated_cells[current_index], updated_cells[next_index] = updated_cells[next_index], updated_cells[current_index]
                    set_kernel_notebook_snapshot(
                        kernel_id,
                        {
                            **runtime_snapshot,
                            "cells": updated_cells,
                        },
                    )

        await manager.send_personal_message(
            {
                'type': 'notebook_cell_moved',
                'kernel_id': kernel_id,
                'cell_id': cell_id,
                'direction': direction,
                'request_id': request_id,
                'execution_id': execution_id,
                'source_path': source_info.get("source_path"),
                'source_kind': source_info.get("source_kind"),
            },
            websocket,
        )
    except Exception as e:
        await _send_notebook_error(
            websocket,
            str(e),
            error_code="notebook_move_cell_failed",
            extra={"request_id": request_id},
        )

async def handle_reconvert_pdf(message: dict, websocket: WebSocket):
    """Check if PDF reconversion is possible for a specific kernel."""
    try:
        kernel_id = message.get('kernel_id')
        if not kernel_id:
            await manager.send_personal_message({'type':'reconvert_pdf_result','status':'no_kernel'}, websocket)
            return
        await _bind_kernel_for_current_connection(websocket, kernel_id)
            
        current_hash = notebook_docx_hash.get(kernel_id)
        if not current_hash:
            await manager.send_personal_message({'type':'reconvert_pdf_result','status':'no_docx'}, websocket)
            return
        await manager.send_personal_message({'type':'reconvert_pdf_result','status':'need_rerun'}, websocket)
    except Exception as e:
        await manager.send_personal_message({'type':'reconvert_pdf_result','status':'error','error':str(e)}, websocket)

async def handle_force_reconvert_pdf(message: dict, websocket: WebSocket):
    """Force PDF reconversion for a specific kernel's DOCX."""
    request_id = message.get("request_id")
    try:
        kernel_id = message.get('kernel_id')
        if not kernel_id:
            await manager.send_personal_message(
                {
                    'type': 'pdf_reconverted',
                    'status': 'no_kernel',
                    'request_id': request_id,
                },
                websocket,
            )
            return
        await _bind_kernel_for_current_connection(websocket, kernel_id)
            
        docx_b64, restored_hash = _restore_kernel_docx_snapshot(kernel_id)
        if not docx_b64:
            await manager.send_personal_message(
                {
                    'type': 'pdf_reconverted',
                    'status': 'no_docx',
                    'request_id': request_id,
                },
                websocket,
            )
            return
            
        docx_hash = notebook_docx_hash.get(kernel_id) or restored_hash
        pdf_diag, pdf_b64, pdf_hash, _ = await _build_pdf_context_for_force_reconvert(
            docx_b64,
            docx_hash,
        )
        pdf_payload = _prepare_pdf_payload(pdf_b64, prefer_link_only=True)
        
        if pdf_b64 and docx_hash:
            _pdf_cache_set(docx_hash, pdf_b64)

        await manager.send_personal_message({
            'type':'pdf_reconverted',
            'status':('ok' if pdf_b64 else 'error'),
            'request_id': request_id,
            'pdf_file_b64': pdf_payload.get("pdf_file_b64"),
            'pdf_hash': pdf_hash,
            'pdf_ref': pdf_payload.get("pdf_ref"),
            'pdf_file_token': pdf_payload.get("pdf_file_token"),
            'pdf_file_name': pdf_payload.get("pdf_file_name"),
            'pdf_inline': pdf_payload.get("pdf_inline"),
            'pdf_store_error': pdf_payload.get("pdf_store_error"),
            'pdf_attempted': pdf_diag.get('attempted'), 
            'pdf_conversion_error': (None if pdf_b64 else pdf_diag.get('error')),
            'pdf_conversion_error_kind': (None if pdf_b64 else pdf_diag.get('error_kind')), 
            'pdf_conversion_stdout': pdf_diag.get('stdout'), 
            'pdf_conversion_stderr': pdf_diag.get('stderr'), 
            'pdf_conversion_ms': pdf_diag.get('duration_ms'), 
            'docx_size_bytes': pdf_diag.get('docx_size_bytes'), 
            'pdf_size_bytes': pdf_payload.get("pdf_size_bytes") or pdf_diag.get('pdf_size_bytes')
        }, websocket)
    except Exception as e:
        await manager.send_personal_message(
            {
                'type': 'pdf_reconverted',
                'status': 'error',
                'request_id': request_id,
                'error': str(e),
            },
            websocket,
        )

async def handle_code_execution(message: dict, websocket: WebSocket):
    code = message.get("code", "")
    file_path = _normalize_runtime_path(message.get("file_path"))
    run_id = str(message.get("run_id") or "").strip() or f"code_run_{uuid4().hex}"
    current_task = asyncio.current_task()
    try:
        previous_run_id = _code_run_by_path.get(file_path) if file_path else None
        if previous_run_id and previous_run_id != run_id:
            previous_entry = active_tasks.get(previous_run_id)
            previous_task = previous_entry.get("task") if isinstance(previous_entry, dict) else None
            if previous_task and not previous_task.done():
                previous_task.cancel()
        if file_path:
            _code_run_by_path[file_path] = run_id
        active_tasks[run_id] = {
            "task": current_task,
            "file_path": file_path,
            "websocket_id": id(websocket),
        }
        await _execute_python_code_simple(
            code,
            websocket,
            file_path=file_path,
            run_id=run_id,
        )
    except asyncio.CancelledError:
        if file_path:
            home_compact_store.clear_code_runtime(file_path=file_path)
        await manager.send_personal_message(
            {
                "type": "execution_error",
                "error": "Execution cancelled",
                "message": "Execution cancelled",
                "error_code": "execution_cancelled",
                "file_path": file_path,
                "run_id": run_id,
            },
            websocket,
        )
    except Exception as e:
        await manager.send_personal_message(
            {
                "type": "execution_error",
                "error": str(e),
                "file_path": file_path,
                "run_id": run_id,
            },
            websocket,
        )
    finally:
        _unregister_code_task(run_id)


async def handle_cancel_code_execution(message: dict, websocket: WebSocket):
    run_id = str(message.get("run_id") or "").strip() or None
    file_path = _normalize_runtime_path(message.get("file_path"))
    target_run_id = run_id or (_code_run_by_path.get(file_path) if file_path else None)
    target_entry = active_tasks.get(target_run_id or "") if target_run_id else None
    target_task = target_entry.get("task") if isinstance(target_entry, dict) else None
    target_file_path = file_path or (target_entry.get("file_path") if isinstance(target_entry, dict) else None)
    had_active_task = bool(target_task and not target_task.done())

    if had_active_task:
        target_task.cancel()

    if target_file_path:
        home_compact_store.clear_code_runtime(file_path=target_file_path)
    elif target_run_id:
        home_compact_store.clear_code_runtime(run_id=target_run_id)

    if had_active_task:
        await manager.send_personal_message(
            {
                "type": "execution_error",
                "error": "Execution cancelled",
                "message": "Execution cancelled",
                "error_code": "execution_cancelled",
                "file_path": target_file_path,
                "run_id": target_run_id,
            },
            websocket,
        )

# =============================================================================
# TEMPLATE HANDLERS
# =============================================================================
