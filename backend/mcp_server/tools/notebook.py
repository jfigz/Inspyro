"""Tools MCP - Notebook: ejecucion, celdas y ciclo de vida del kernel."""

from __future__ import annotations

import asyncio
import copy
import contextlib
import json
import logging
import os
import re
import time
import uuid
from typing import Any, Awaitable, Callable, Optional

from .. import config
from ..activity import mcp_activity_tool
from ..bridge import BridgeError, InspyroBridge
from ..config import CELL_EXECUTION_TIMEOUT
from ..mirror import (
    emit_artifact_update,
    emit_notebook_runtime_message,
    emit_notebook_snapshot,
    emit_open_resource,
)
from ..runtime import log_info, report_progress, resolve_session_id
from ..session_state import McpSessionState

logger = logging.getLogger("inspyro.mcp.tools.notebook")

_SESSION_STATE = McpSessionState.get()
_LATE_RUNTIME_MESSAGE_TYPES = {"notebook_progress_update", "notebook_docx_update", "notebook_pdf_ready"}
_TERMINAL_RUNTIME_MESSAGE_TYPES = {"notebook_cell_executed", "notebook_cell_error", "notebook_error"}
_LATE_RUNTIME_TASKS: dict[asyncio.Task[None], tuple[str, str | None]] = {}
_BACKGROUND_EXECUTION_TASKS: dict[str, dict[str, asyncio.Task[dict[str, Any]]]] = {}
_KERNEL_EXECUTION_LOCKS: dict[str, dict[str, asyncio.Lock]] = {}
_DEFAULT_SOURCE_PREVIEW_CHARS = 300
_DEFAULT_OUTPUT_LIMIT_CHARS = 4000
_DEFAULT_CELL_TIMEOUT = max(1, int(CELL_EXECUTION_TIMEOUT))
_DEFAULT_RESET_TIMEOUT = max(30, int(os.getenv("INSPYRO_MCP_RESET_TIMEOUT", "90")))
_BATCH_ARTIFACT_WAIT_TIMEOUT_S = max(
    0.0,
    float(os.getenv("INSPYRO_MCP_BATCH_ARTIFACT_WAIT_TIMEOUT", str(_DEFAULT_CELL_TIMEOUT))),
)
_BATCH_ARTIFACT_WAIT_POLL_S = max(0.05, float(os.getenv("INSPYRO_MCP_BATCH_ARTIFACT_WAIT_POLL", "0.2")))
_MAX_TRACKED_VARIABLES = 200
_RUNTIME_VARIABLE_PREFIXES = ("__", "_DOCX", "__DOCX", "__INSP", "__UNITS")
_RUNTIME_METADATA_KEYS = ("execution_duration", "execution_duration_ms")
_RECOVERY_FIELD_NAMES = (
    "recovered_after_disconnect",
    "recovery_reason",
    "outputs_degraded",
    "variables_degraded",
)
_RECOVERY_ARTIFACT_FIELDS = (
    "docx_ref",
    "docx_download_url",
    "docx_file_token",
    "docx_artifact_id",
    "docx_file_name",
    "docx_size_bytes",
    "docx_hash",
    "docx_binary_hash",
    "docx_warnings",
    "pdf_ref",
    "pdf_file_token",
    "pdf_file_name",
    "pdf_size_bytes",
    "pdf_hash",
    "pdf_from_cache",
    "pdf_attempted",
    "pdf_converting",
    "pdf_conversion_error",
    "pdf_conversion_error_kind",
)
_STATEFUL_NOTEBOOK_SESSION_ERROR_CODE = "NOTEBOOK_SESSION_REQUIRES_STATEFUL_MCP"


def _now_ts() -> float:
    return time.time()


def _get_bridge(session_id: str | None = None) -> InspyroBridge:
    resolved_session_id = resolve_session_id(session_id)
    try:
        return InspyroBridge.get(resolved_session_id)
    except TypeError:
        # Legacy tests often monkeypatch InspyroBridge.get with a single-arg classmethod.
        return InspyroBridge.get()


def _session_lock_registry(session_id: str | None = None) -> dict[str, asyncio.Lock]:
    return _KERNEL_EXECUTION_LOCKS.setdefault(resolve_session_id(session_id), {})


def _get_kernel_execution_lock(kernel_id: str, *, session_id: str | None = None) -> asyncio.Lock:
    normalized_kernel_id = str(kernel_id or "").strip()
    if not normalized_kernel_id:
        raise ValueError("kernel_id requerido")
    registry = _session_lock_registry(session_id)
    lock = registry.get(normalized_kernel_id)
    if lock is None:
        lock = asyncio.Lock()
        registry[normalized_kernel_id] = lock
    return lock


def _drop_kernel_execution_lock(kernel_id: str, *, session_id: str | None = None) -> None:
    normalized_kernel_id = str(kernel_id or "").strip()
    if not normalized_kernel_id:
        return
    resolved_session_id = resolve_session_id(session_id)
    registry = _KERNEL_EXECUTION_LOCKS.get(resolved_session_id)
    if not registry:
        return
    lock = registry.get(normalized_kernel_id)
    if lock is not None and lock.locked():
        return
    registry.pop(normalized_kernel_id, None)
    if not registry:
        _KERNEL_EXECUTION_LOCKS.pop(resolved_session_id, None)


@contextlib.asynccontextmanager
async def _serialized_kernel_execution(
    kernel_id: str,
    *,
    session_id: str | None = None,
):
    lock = _get_kernel_execution_lock(kernel_id, session_id=session_id)
    async with lock:
        try:
            yield
        finally:
            _drop_kernel_execution_lock(kernel_id, session_id=session_id)


def _session_notebooks_payload(*, session_id: str | None = None) -> dict[str, Any]:
    resolved_session_id = resolve_session_id(session_id)
    notebooks = _SESSION_STATE.list_notebook_sessions(session_id=resolved_session_id)
    notebooks = sorted(
        notebooks,
        key=lambda entry: (
            str(entry.get("notebook_path") or ""),
            str(entry.get("kernel_id") or ""),
        ),
    )
    payload = {
        "status": "ok",
        "session_id": resolved_session_id,
        "notebook_count": len(notebooks),
        "active_notebook_count": sum(1 for notebook in notebooks if notebook.get("active")),
        "notebooks": notebooks,
    }
    payload.update(config.notebook_session_mode_payload())
    if not payload.get("notebook_sessions_supported", True):
        payload["status"] = "stateless"
        payload["warning"] = (
            "El servidor MCP corre con `--stateless-http`: los kernels/notebooks no permanecen "
            "entre requests y los flujos notebook-first no son confiables en este modo."
        )
    return payload


def _ensure_stateful_notebook_sessions(
    operation: str,
    *,
    kernel_id: str | None = None,
    notebook_path: str | None = None,
    execution_id: str | None = None,
    session_id: str | None = None,
) -> str:
    resolved_session_id = resolve_session_id(session_id)
    session_payload = config.notebook_session_mode_payload()
    if bool(session_payload.get("notebook_sessions_supported", True)):
        return resolved_session_id

    _raise_typed_error(
        _STATEFUL_NOTEBOOK_SESSION_ERROR_CODE,
        "Este workflow notebook-first requiere una sesion MCP persistente. Reinicia el servidor sin `--stateless-http` o usa `stdio`.",
        kernel_id=kernel_id,
        notebook_path=notebook_path,
        execution_id=execution_id,
        operation=operation,
        extra={
            "session_id": resolved_session_id,
            **session_payload,
        },
    )
    return resolved_session_id


async def _close_other_session_notebooks(current_kernel_id: str, *, session_id: str | None = None) -> list[str]:
    closed_kernel_ids: list[str] = []
    for notebook in _SESSION_STATE.list_notebook_sessions(session_id=resolve_session_id(session_id)):
        other_kernel_id = str(notebook.get("kernel_id") or "").strip()
        if not other_kernel_id or other_kernel_id == current_kernel_id:
            continue
        try:
            await _shutdown_kernel_impl(other_kernel_id, session_id=session_id)
        except Exception as exc:  # pragma: no cover - defensive cleanup
            logger.warning("Could not close sibling kernel %s after notebook switch: %s", other_kernel_id, exc)
            continue
        closed_kernel_ids.append(other_kernel_id)
    return closed_kernel_ids


def _make_error(
    code: str,
    message: str,
    *,
    cause: Any = None,
    retryable: bool = False,
    kernel_id: str | None = None,
    cell_id: str | None = None,
    notebook_path: str | None = None,
    operation: str | None = None,
    execution_id: str | None = None,
    extra: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    payload = {
        "type": "mcp_notebook_error",
        "code": code,
        "error_code": code,
        "message": message,
        "retryable": bool(retryable),
        "cause": cause,
        "kernel_id": kernel_id,
        "cell_id": cell_id,
        "notebook_path": notebook_path,
        "operation": operation,
        "execution_id": execution_id,
    }
    if extra:
        payload.update(extra)
    return {key: value for key, value in payload.items() if value is not None}


def _raise_typed_error(
    code: str,
    message: str,
    *,
    cause: Any = None,
    retryable: bool = False,
    kernel_id: str | None = None,
    cell_id: str | None = None,
    notebook_path: str | None = None,
    operation: str | None = None,
    execution_id: str | None = None,
    extra: Optional[dict[str, Any]] = None,
) -> None:
    raise BridgeError(
        message,
        payload=_make_error(
            code,
            message,
            cause=cause,
            retryable=retryable,
            kernel_id=kernel_id,
            cell_id=cell_id,
            notebook_path=notebook_path,
            operation=operation,
            execution_id=execution_id,
            extra=extra,
        ),
    )


def _error_from_exception(
    exc: Exception,
    *,
    operation: str,
    kernel_id: str | None = None,
    cell_id: str | None = None,
    notebook_path: str | None = None,
    execution_id: str | None = None,
) -> dict[str, Any]:
    if isinstance(exc, BridgeError) and isinstance(exc.payload, dict):
        payload = dict(exc.payload)
        payload.setdefault("type", "mcp_notebook_error")
        payload.setdefault("message", str(exc))
        payload.setdefault("operation", operation)
        if kernel_id is not None:
            payload.setdefault("kernel_id", kernel_id)
        if cell_id is not None:
            payload.setdefault("cell_id", cell_id)
        if notebook_path is not None:
            payload.setdefault("notebook_path", notebook_path)
        if execution_id is not None:
            payload.setdefault("execution_id", execution_id)
        return payload

    if isinstance(exc, TimeoutError):
        return _make_error(
            "RPC_WAIT_TIMEOUT",
            str(exc),
            retryable=True,
            kernel_id=kernel_id,
            cell_id=cell_id,
            notebook_path=notebook_path,
            operation=operation,
            execution_id=execution_id,
        )
    if isinstance(exc, ConnectionError):
        return _make_error(
            "KERNEL_STATE_ERROR",
            str(exc),
            retryable=True,
            kernel_id=kernel_id,
            cell_id=cell_id,
            notebook_path=notebook_path,
            operation=operation,
            execution_id=execution_id,
        )

    return _make_error(
        "CELL_EXECUTION_ERROR",
        str(exc),
        cause=exc.__class__.__name__,
        retryable=False,
        kernel_id=kernel_id,
        cell_id=cell_id,
        notebook_path=notebook_path,
        operation=operation,
        execution_id=execution_id,
    )


def _normalize_notebook_path(path: str) -> str:
    return os.path.abspath(os.path.expanduser(path))


def _source_to_text(source: Any) -> str:
    if isinstance(source, list):
        parts = [str(part) for part in source]
        if not parts:
            return ""
        normalized: list[str] = []
        for index, part in enumerate(parts):
            normalized.append(part)
            if index < len(parts) - 1 and not part.endswith("\n"):
                normalized.append("\n")
        return "".join(normalized)
    return str(source or "")


def _source_preview(source: Any, limit: int = _DEFAULT_SOURCE_PREVIEW_CHARS) -> str:
    text = _source_to_text(source).strip()
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 3)].rstrip()}..."


def _truncate_text(value: Any, limit: int = _DEFAULT_OUTPUT_LIMIT_CHARS) -> tuple[str, bool, int]:
    text = str(value or "")
    original_size = len(text)
    if original_size <= limit:
        return text, False, original_size
    preview = text[: max(0, limit - 3)].rstrip()
    return f"{preview}...", True, original_size


def _compact_json_preview(value: Any, limit: int = _DEFAULT_OUTPUT_LIMIT_CHARS) -> tuple[str, bool, int]:
    try:
        serialized = json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        serialized = repr(value)
    return _truncate_text(serialized, limit)


_DOCX_SOURCE_HINTS = (
    "build_doc(",
    "doc_begin(",
    "doc_end(",
    "doc_reset(",
    "doc_export(",
    "doc_help(",
    ".heading(",
    ".text(",
    ".list(",
    ".code(",
    ".math(",
    ".math_latex(",
    ".create_math_latex_element(",
    ".equation(",
    ".table(",
    ".dataframe(",
    ".figure(",
    ".image(",
    ".caption(",
    ".reference(",
    ".link(",
    ".section(",
    ".table_of_contents(",
    ".page_break(",
    ".metadata(",
    ".style(",
    ".header(",
    ".footer(",
    "Heading(",
    "Text(",
    "List(",
    "Code(",
    "Equation(",
    "EquationLatex(",
    "Table(",
    "DataFrame(",
    "Figure(",
    "Image(",
    "Caption(",
    "Reference(",
    "Link(",
    "Section(",
    "TableOfContents(",
    "PageBreak(",
    "Metadata(",
    "Style(",
    "Header(",
    "Footer(",
)
_INSPYRO_CELL_TYPES = {"code", "markdown", "docx"}
_RUNNABLE_CELL_TYPES = {"code", "docx"}


def _should_emit_docx(source: str) -> bool:
    source_text = _source_to_text(source)
    return any(hint in source_text for hint in _DOCX_SOURCE_HINTS)


def _normalize_cell_type(raw_cell_type: Any) -> str:
    cell_type = str(raw_cell_type or "code").strip().lower() or "code"
    return cell_type if cell_type in _INSPYRO_CELL_TYPES else "code"


def _is_docx_cell(cell: dict[str, Any]) -> bool:
    return _normalize_cell_type(cell.get("cell_type")) == "docx"


def _is_runnable_cell(cell: dict[str, Any], *, include_docx: bool = True) -> bool:
    cell_type = _normalize_cell_type(cell.get("cell_type"))
    return cell_type == "code" or (include_docx and cell_type == "docx")


def _normalize_notebook_cell_types(notebook_payload: dict[str, Any]) -> dict[str, Any]:
    cells = notebook_payload.get("cells")
    if not isinstance(cells, list):
        return notebook_payload
    for cell in cells:
        if not isinstance(cell, dict):
            continue
        cell_type = _normalize_cell_type(cell.get("cell_type"))
        if cell_type == "code" and _should_emit_docx(_source_to_text(cell.get("source", ""))):
            cell_type = "docx"
        cell["cell_type"] = cell_type
    return notebook_payload


def _summarize_notebook_output(output: dict[str, Any], limit: int = _DEFAULT_OUTPUT_LIMIT_CHARS) -> dict[str, Any]:
    output_type = str(output.get("output_type") or output.get("type") or "unknown")

    if output_type == "stream":
        text, truncated, original_size = _truncate_text(output.get("text", ""), limit)
        payload = {
            "type": "stream",
            "stream": output.get("name", output.get("stream", "stdout")),
            "text": text,
        }
        if truncated:
            payload["truncated"] = True
            payload["original_size"] = original_size
        return payload

    if output_type in {"execute_result", "display_data", "update_display_data"}:
        data = output.get("data") or output.get("content", {}).get("data") or {}
        metadata = output.get("metadata") or output.get("content", {}).get("metadata") or {}
        preview_source = None
        for key in ("text/plain", "text/html", "text/markdown"):
            if key in data:
                preview_source = data.get(key)
                break
        preview, truncated, original_size = _compact_json_preview(preview_source or data, limit)
        payload = {
            "type": output_type,
            "data_keys": sorted(str(key) for key in data.keys())[:10],
            "metadata_keys": sorted(str(key) for key in metadata.keys())[:10],
            "preview": preview,
        }
        if truncated:
            payload["truncated"] = True
            payload["original_size"] = original_size
        return payload

    if output_type == "error":
        traceback_preview, truncated, original_size = _truncate_text(
            "\n".join(output.get("traceback", []) or []),
            limit,
        )
        payload = {
            "type": "error",
            "ename": output.get("ename"),
            "evalue": output.get("evalue"),
            "traceback_preview": traceback_preview,
        }
        if truncated:
            payload["truncated"] = True
            payload["original_size"] = original_size
        return payload

    preview, truncated, original_size = _compact_json_preview(output, limit)
    payload = {
        "type": output_type,
        "preview": preview,
    }
    if truncated:
        payload["truncated"] = True
        payload["original_size"] = original_size
    return payload


def _summarize_variable_value(value: Any, limit: int = _DEFAULT_OUTPUT_LIMIT_CHARS) -> dict[str, Any]:
    if isinstance(value, dict):
        summary = dict(value)
        for text_field in ("repr", "value", "unit_display", "unit_canonical", "unit_pint"):
            if text_field in summary and isinstance(summary[text_field], str):
                preview, truncated, original_size = _truncate_text(summary[text_field], limit)
                summary[text_field] = preview
                if truncated:
                    summary.setdefault("truncated_fields", {})[text_field] = {
                        "truncated": True,
                        "original_size": original_size,
                    }
        return summary

    preview, truncated, original_size = _compact_json_preview(value, limit)
    payload = {"preview": preview}
    if truncated:
        payload["truncated"] = True
        payload["original_size"] = original_size
    return payload


def _filter_variables(
    variables: dict[str, Any],
    *,
    include_runtime: bool = False,
    limit: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
) -> dict[str, Any]:
    filtered: dict[str, Any] = {}
    omitted = 0
    sorted_names = sorted(
        variables.keys(),
        key=lambda name: (
            1 if name.startswith("_") else 0,
            1 if any(name.startswith(prefix) for prefix in _RUNTIME_VARIABLE_PREFIXES) else 0,
            name,
        ),
    )
    for name in sorted_names:
        is_runtime_name = any(name.startswith(prefix) for prefix in _RUNTIME_VARIABLE_PREFIXES)
        if not include_runtime and is_runtime_name:
            omitted += 1
            continue
        filtered[name] = _summarize_variable_value(variables[name], limit=limit)
        if len(filtered) >= _MAX_TRACKED_VARIABLES:
            omitted += max(0, len(variables) - len(filtered) - omitted)
            break

    if omitted:
        filtered["__meta__"] = {
            "omitted_variables": omitted,
            "max_variables": _MAX_TRACKED_VARIABLES,
            "include_runtime": include_runtime,
        }
    return filtered


def _serialize_cell(
    cell: dict[str, Any],
    *,
    order: int,
    include_source_preview: bool = True,
    include_source: bool = False,
    include_outputs: bool = False,
    output_limit_chars: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
    max_source_preview_chars: int = _DEFAULT_SOURCE_PREVIEW_CHARS,
) -> dict[str, Any]:
    source_text = _source_to_text(cell.get("source", ""))
    outputs = list(cell.get("outputs") or [])
    payload = {
        "id": cell.get("id"),
        "type": cell.get("cell_type", "code"),
        "order": order,
        "source_len": len(source_text),
        "has_outputs": bool(outputs),
        "last_execution_count": cell.get("execution_count"),
    }
    if include_source_preview:
        payload["source_preview"] = _source_preview(source_text, max_source_preview_chars)
    if include_source:
        payload["source"] = source_text
    if include_outputs:
        payload["outputs"] = [
            _summarize_notebook_output(output, limit=output_limit_chars)
            for output in outputs
        ]
    return payload


def _format_outputs(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Extrae y formatea outputs relevantes desde los mensajes WS."""
    outputs: list[dict[str, Any]] = []
    for msg in messages:
        msg_type = str(msg.get("type") or "")
        if msg_type == "notebook_stream":
            content = msg.get("content", {})
            outputs.append(
                {
                    "type": "stream",
                    "text": content.get("text", ""),
                    "stream": content.get("name", "stdout"),
                }
            )
        elif msg_type == "notebook_execute_result":
            outputs.append({"type": "execute_result", "content": msg.get("content", {})})
        elif msg_type == "notebook_display_data":
            outputs.append({"type": "display_data", "content": msg.get("content", {})})
        elif msg_type == "notebook_update_display_data":
            outputs.append({"type": "update_display_data", "content": msg.get("content", {})})
        elif msg_type in {"notebook_comm_open", "notebook_comm_msg", "notebook_comm_close"}:
            outputs.append({"type": msg_type, "content": msg.get("content", {})})
        elif msg_type == "notebook_cell_executed":
            outputs.append(
                {
                    "type": "result",
                    "execution_count": msg.get("execution_count"),
                    "outputs": msg.get("outputs", []),
                    "variables": msg.get("variables", {}),
                    "docx_ref": msg.get("docx_ref"),
                    "pdf_ref": msg.get("pdf_ref"),
                }
            )
        elif msg_type == "notebook_cell_error":
            outputs.append(
                {
                    "type": "error",
                    "error": msg.get("error", msg.get("message", "Unknown error")),
                    "error_code": msg.get("error_code", ""),
                }
            )
        elif msg_type == "notebook_clear_output":
            outputs.append({"type": "clear_output"})
    return outputs


def _sanitize_outputs(
    outputs: list[dict[str, Any]],
    *,
    limit: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
) -> list[dict[str, Any]]:
    return [_summarize_notebook_output(output, limit=limit) for output in outputs]


def _trim_result_for_status(
    result: dict[str, Any],
    *,
    include_outputs: bool = False,
    include_variables: bool = False,
) -> dict[str, Any]:
    trimmed = dict(result)
    if not include_outputs:
        trimmed.pop("outputs", None)
    if not include_variables:
        trimmed.pop("variables", None)
    return trimmed


def _apply_recovery_fields(source: dict[str, Any] | None, target: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(source, dict):
        return target
    for field in _RECOVERY_FIELD_NAMES:
        value = source.get(field)
        if value is None:
            continue
        if isinstance(value, bool) and not value:
            continue
        target[field] = value
    return target


def _merge_artifact_fields(message: dict[str, Any], artifact: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(artifact, dict):
        return dict(message)
    merged = dict(message)
    for field in _RECOVERY_ARTIFACT_FIELDS:
        value = artifact.get(field)
        if value is not None:
            merged.setdefault(field, value)
    return merged


def _resolve_execution_started_at(execution_id: str, *, session_id: str | None = None) -> float | None:
    execution = _SESSION_STATE.get_execution(execution_id, session_id=session_id) or {}
    raw_started_at = execution.get("started_at")
    try:
        started_at = float(raw_started_at)
    except (TypeError, ValueError):
        return None
    return started_at if started_at > 0 else None


def _serialize_execution_status(
    execution: dict[str, Any],
    *,
    include_failed_outputs: bool = False,
    session_id: str | None = None,
) -> dict[str, Any]:
    execution_id = execution.get("execution_id")
    kernel_id = execution.get("kernel_id")
    selected_cell_ids = [str(cell_id) for cell_id in execution.get("selected_cell_ids") or []]
    cell_statuses = execution.get("cell_statuses") or {}
    cell_results = execution.get("cell_results") or {}
    failed_cell_ids = {str(cell_id) for cell_id in execution.get("failed_cell_ids") or []}
    ordered_cell_ids: list[str] = []
    seen: set[str] = set()

    for cell_id in selected_cell_ids:
        if cell_id not in seen:
            ordered_cell_ids.append(cell_id)
            seen.add(cell_id)

    extras = sorted(
        (str(cell_id) for cell_id in cell_statuses.keys() if str(cell_id) not in seen),
        key=lambda cell_id: (
            int((cell_statuses.get(cell_id) or {}).get("order", 10**9)),
            cell_id,
        ),
    )
    ordered_cell_ids.extend(extras)

    cells: list[dict[str, Any]] = []
    for cell_id in ordered_cell_ids:
        status_payload = dict(cell_statuses.get(cell_id) or {})
        status_payload["cell_id"] = cell_id
        status_payload.setdefault("status", "pending")
        result = cell_results.get(cell_id)
        if isinstance(result, dict):
            _apply_recovery_fields(result, status_payload)
            error_payload = result.get("error")
            if error_payload is not None:
                status_payload["error"] = error_payload
            if include_failed_outputs and cell_id in failed_cell_ids:
                status_payload["result"] = _trim_result_for_status(
                    result,
                    include_outputs=True,
                    include_variables=False,
                )
        cells.append(status_payload)

    events = list(execution.get("events") or [])
    if len(events) > 20:
        events = events[-20:]

    payload = {
        "status": execution.get("status", "unknown"),
        "run_id": execution_id,
        "execution_id": execution_id,
        "kernel_id": kernel_id,
        "path": execution.get("notebook_path"),
        "operation": execution.get("kind"),
        "background": bool(execution.get("background")),
        "started_at": execution.get("started_at"),
        "completed_at": execution.get("completed_at"),
        "heartbeat_at": execution.get("heartbeat_at"),
        "current_cell_id": execution.get("current_cell_id"),
        "current_child_execution_id": execution.get("current_child_execution_id"),
        "total_cells": execution.get("total_cells", len(selected_cell_ids)),
        "completed_cells": execution.get("completed_cells", 0),
        "executed": execution.get("executed", 0),
        "failed": execution.get("failed", 0),
        "failed_cell_ids": list(execution.get("failed_cell_ids") or []),
        "duration_ms": execution.get("duration_ms"),
        "cancellation_reason": execution.get("cancellation_reason"),
        "error": execution.get("error"),
        "last_output_preview": execution.get("last_output_preview"),
        "last_output_type": execution.get("last_output_type"),
        "last_output_at": execution.get("last_output_at"),
        "summary": execution.get("summary"),
        "artifacts": execution.get("artifacts") or (
            _extract_artifacts_from_payload(
                _SESSION_STATE.get_artifacts(
                    kernel_id=str(kernel_id),
                    execution_id=str(execution_id) if execution_id is not None else None,
                    session_id=resolve_session_id(session_id),
                )
            )
            if kernel_id and execution_id
            else []
        ),
        "cells": cells,
        "events": events,
    }
    return _apply_recovery_fields(execution, payload)


def _should_attempt_hard_reset(exc: Exception) -> bool:
    payload = exc.payload if isinstance(exc, BridgeError) and isinstance(exc.payload, dict) else {}
    message = str(payload.get("message") or exc).lower()
    code = str(payload.get("error_code") or payload.get("code") or "").lower()
    return (
        "threads can only be started once" in message
        or code in {"notebook_reset_kernel_failed", "kernel_reset_failed"}
    )


def _build_execution_error(raw_message: dict[str, Any], *, operation: str) -> dict[str, Any]:
    code = str(raw_message.get("error_code") or "CELL_EXECUTION_ERROR")
    message = str(raw_message.get("message") or raw_message.get("error") or "Execution error")
    if code in {"kernel_lock_timeout", "cell_execution_timeout"}:
        code = "BACKEND_EXECUTION_TIMEOUT"
    elif code == "execution_cancelled" or message.strip().lower() == "keyboardinterrupt":
        code = "EXECUTION_CANCELLED"
    return _make_error(
        code,
        message,
        cause=raw_message.get("traceback"),
        retryable=code in {"RPC_WAIT_TIMEOUT", "BACKEND_EXECUTION_TIMEOUT", "KERNEL_STATE_ERROR", "EXECUTION_CANCELLED"},
        kernel_id=raw_message.get("kernel_id"),
        cell_id=raw_message.get("cell_id"),
        notebook_path=raw_message.get("path"),
        operation=operation,
        execution_id=raw_message.get("execution_id"),
    )


async def _read_notebook(bridge: InspyroBridge, path: str) -> dict[str, Any]:
    """Lee y parsea un notebook .ipynb desde el filesystem."""
    normalized_path = _normalize_notebook_path(path)
    result = await bridge.rest_get("/api/files/read", params={"path": normalized_path})
    content = result.get("content")
    if isinstance(content, dict):
        return _normalize_notebook_cell_types(content)
    if isinstance(content, str):
        try:
            return _normalize_notebook_cell_types(json.loads(content))
        except json.JSONDecodeError as exc:
            if content.startswith("\ufeff"):
                try:
                    return _normalize_notebook_cell_types(json.loads(content.lstrip("\ufeff")))
                except json.JSONDecodeError as second_exc:
                    _raise_typed_error(
                        "NOTEBOOK_ENCODING_ERROR",
                        f"Notebook con BOM o encoding invalido: {normalized_path}",
                        cause=str(second_exc),
                        retryable=False,
                        notebook_path=normalized_path,
                        operation="read_notebook",
                    )
            _raise_typed_error(
                "NOTEBOOK_PARSE_ERROR",
                f"No se pudo parsear el notebook: {normalized_path}",
                cause=str(exc),
                retryable=False,
                notebook_path=normalized_path,
                operation="read_notebook",
            )
    _raise_typed_error(
        "NOTEBOOK_PARSE_ERROR",
        f"Contenido inesperado al leer notebook {normalized_path}",
        cause={"content_type": type(content).__name__},
        retryable=False,
        notebook_path=normalized_path,
        operation="read_notebook",
    )


async def _write_notebook(bridge: InspyroBridge, path: str, notebook: dict[str, Any]) -> None:
    """Escribe un notebook .ipynb al filesystem."""
    normalized_path = _normalize_notebook_path(path)
    await bridge.rest_post(
        "/api/files/write",
        json_data={"path": normalized_path, "content": notebook},
    )


def _cell_listing(
    cells: list[dict[str, Any]],
    *,
    include_source_preview: bool = True,
    include_source: bool = False,
    include_outputs: bool = False,
    output_limit_chars: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
    max_source_preview_chars: int = _DEFAULT_SOURCE_PREVIEW_CHARS,
    max_cells: int | None = None,
) -> list[dict[str, Any]]:
    listed: list[dict[str, Any]] = []
    for index, cell in enumerate(cells):
        if max_cells is not None and len(listed) >= max_cells:
            break
        listed.append(
            _serialize_cell(
                cell,
                order=index,
                include_source_preview=include_source_preview,
                include_source=include_source,
                include_outputs=include_outputs,
                output_limit_chars=output_limit_chars,
                max_source_preview_chars=max_source_preview_chars,
            )
        )
    return listed


def _find_cell(cells: list[dict[str, Any]], cell_id: str) -> tuple[int, dict[str, Any]]:
    for index, cell in enumerate(cells):
        if cell.get("id") == cell_id:
            return index, cell
    raise BridgeError(
        f"Celda '{cell_id}' no encontrada.",
        payload=_make_error(
            "CELL_NOT_FOUND",
            f"Celda '{cell_id}' no encontrada.",
            cell_id=cell_id,
            operation="find_cell",
            retryable=False,
        ),
    )


def _normalize_requested_cell(cell: Any, *, index: int) -> dict[str, Any]:
    if not isinstance(cell, dict):
        _raise_typed_error(
            "INVALID_NOTEBOOK_CELLS",
            f"cells[{index}] debe ser un objeto con `cell_type`, `source` y `cell_id` opcional.",
            operation="notebook_sync_cells",
            extra={"cell_index": index},
        )
    cell_type = str(cell.get("cell_type") or "code").strip().lower() or "code"
    if cell_type not in _INSPYRO_CELL_TYPES:
        _raise_typed_error(
            "INVALID_NOTEBOOK_CELLS",
            f"cells[{index}].cell_type debe ser `code`, `markdown` o `docx`.",
            operation="notebook_sync_cells",
            extra={"cell_index": index, "cell_type": cell_type},
        )
    if cell_type == "code" and _should_emit_docx(_source_to_text(cell.get("source", ""))):
        cell_type = "docx"
    raw_cell_id = str(cell.get("cell_id") or "").strip()
    return {
        "cell_type": cell_type,
        "source": _source_to_text(cell.get("source", "")),
        "cell_id": raw_cell_id or None,
    }


def _ensure_notebook_cell_ids(notebook_payload: dict[str, Any]) -> None:
    cells = list(notebook_payload.get("cells") or [])
    seen_ids: set[str] = set()
    for cell in cells:
        cell_id = str(cell.get("id") or "").strip()
        if not cell_id or cell_id in seen_ids:
            while True:
                cell_id = str(uuid.uuid4())[:8]
                if cell_id not in seen_ids:
                    break
            cell["id"] = cell_id
        seen_ids.add(cell_id)
        cell_type = _normalize_cell_type(cell.get("cell_type"))
        if cell_type == "code" and _should_emit_docx(_source_to_text(cell.get("source", ""))):
            cell_type = "docx"
        cell["cell_type"] = cell_type
        metadata = cell.get("metadata")
        if isinstance(metadata, dict):
            metadata.setdefault("inspyro_id", cell_id)


def _strip_code_cell_runtime_state(cell: dict[str, Any]) -> dict[str, Any]:
    stripped = copy.deepcopy(cell)
    if _normalize_cell_type(stripped.get("cell_type")) not in _RUNNABLE_CELL_TYPES:
        return stripped

    stripped["outputs"] = []
    stripped["execution_count"] = None

    metadata = stripped.get("metadata")
    if isinstance(metadata, dict):
        cleaned_metadata = {
            key: value
            for key, value in metadata.items()
            if key not in _RUNTIME_METADATA_KEYS
        }
        stripped["metadata"] = cleaned_metadata
    return stripped


def _strip_notebook_runtime_state(notebook_payload: dict[str, Any]) -> dict[str, Any]:
    stripped = copy.deepcopy(notebook_payload)
    stripped["cells"] = [
        _strip_code_cell_runtime_state(cell)
        if isinstance(cell, dict)
        else cell
        for cell in list(stripped.get("cells") or [])
    ]
    _ensure_notebook_cell_ids(stripped)
    return stripped


def _build_new_cell(cell_id: str, *, cell_type: str, source: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": cell_id,
        "cell_type": cell_type,
        "source": source,
        "metadata": {"inspyro_id": cell_id},
    }
    if cell_type in _RUNNABLE_CELL_TYPES:
        payload["outputs"] = []
        payload["execution_count"] = None
    return payload


def _prepare_synced_cells(
    notebook_payload: dict[str, Any],
    requested_cells: list[dict[str, Any]],
    *,
    preserve_outputs: bool = False,
) -> dict[str, Any]:
    _ensure_notebook_cell_ids(notebook_payload)
    existing_cells = list(notebook_payload.get("cells") or [])
    existing_by_id = {
        str(cell.get("id") or ""): cell
        for cell in existing_cells
        if str(cell.get("id") or "").strip()
    }
    seen_requested_ids: set[str] = set()
    synced_cells: list[dict[str, Any]] = []
    created_cell_ids: list[str] = []
    reused_cell_ids: list[str] = []
    modified_cell_ids: list[str] = []

    for index, raw_cell in enumerate(requested_cells):
        requested = _normalize_requested_cell(raw_cell, index=index)
        requested_id = requested["cell_id"]
        if requested_id and requested_id in seen_requested_ids:
            _raise_typed_error(
                "INVALID_NOTEBOOK_CELLS",
                f"cells[{index}].cell_id '{requested_id}' esta duplicado dentro del payload.",
                operation="notebook_sync_cells",
                extra={"cell_index": index, "cell_id": requested_id},
            )

        if requested_id and requested_id in existing_by_id:
            existing_cell = existing_by_id[requested_id]
            updated_cell = copy.deepcopy(existing_cell)
            previous_type = _normalize_cell_type(existing_cell.get("cell_type") or "code")
            previous_source = _source_to_text(existing_cell.get("source", ""))
            updated_cell["cell_type"] = requested["cell_type"]
            updated_cell["source"] = requested["source"]
            metadata = updated_cell.get("metadata")
            if isinstance(metadata, dict):
                metadata.setdefault("inspyro_id", requested_id)
            elif metadata is None:
                updated_cell["metadata"] = {"inspyro_id": requested_id}

            changed = previous_type != requested["cell_type"] or previous_source != requested["source"]
            if requested["cell_type"] in _RUNNABLE_CELL_TYPES:
                if previous_type not in _RUNNABLE_CELL_TYPES:
                    updated_cell["outputs"] = []
                    updated_cell["execution_count"] = None
                elif changed and not preserve_outputs:
                    updated_cell["outputs"] = []
                    updated_cell["execution_count"] = None
                else:
                    updated_cell.setdefault("outputs", [])
                    updated_cell.setdefault("execution_count", None)
            else:
                updated_cell.pop("outputs", None)
                updated_cell.pop("execution_count", None)

            if changed:
                modified_cell_ids.append(requested_id)
            synced_cells.append(updated_cell)
            reused_cell_ids.append(requested_id)
            seen_requested_ids.add(requested_id)
            continue

        new_cell_id = requested_id
        if not new_cell_id:
            while True:
                candidate = str(uuid.uuid4())[:8]
                if candidate not in seen_requested_ids and candidate not in existing_by_id:
                    new_cell_id = candidate
                    break
        elif new_cell_id in seen_requested_ids:
            _raise_typed_error(
                "INVALID_NOTEBOOK_CELLS",
                f"cells[{index}].cell_id '{new_cell_id}' esta duplicado dentro del payload.",
                operation="notebook_sync_cells",
                extra={"cell_index": index, "cell_id": new_cell_id},
            )

        synced_cells.append(
            _build_new_cell(
                new_cell_id,
                cell_type=requested["cell_type"],
                source=requested["source"],
            )
        )
        created_cell_ids.append(new_cell_id)
        seen_requested_ids.add(new_cell_id)

    deleted_cell_ids = [
        str(cell.get("id") or "")
        for cell in existing_cells
        if str(cell.get("id") or "") not in seen_requested_ids
    ]

    return {
        "cells": synced_cells,
        "created_cell_ids": created_cell_ids,
        "reused_cell_ids": reused_cell_ids,
        "modified_cell_ids": modified_cell_ids,
        "deleted_cell_ids": deleted_cell_ids,
    }


def _build_execution_payload(messages: list[dict[str, Any]]) -> dict[str, Any]:
    final = next((msg for msg in messages if msg.get("type") == "notebook_cell_executed"), None)
    terminal_error = next(
        (
            msg for msg in reversed(messages)
            if msg.get("type") in {"notebook_cell_error", "notebook_error", "mcp_notebook_error"}
        ),
        None,
    )
    status = "executed" if final else "error"
    payload = {
        "status": status,
        "outputs": _format_outputs(messages),
        "execution_count": (final or {}).get("execution_count"),
        "variables": (final or {}).get("variables", {}),
        "has_error": terminal_error is not None,
        "raw": final or terminal_error or {},
        "error": _build_execution_error(terminal_error, operation="execute_cell") if terminal_error else None,
    }
    return _apply_recovery_fields(final or terminal_error or {}, payload)


def _build_notebook_resource(
    *,
    notebook_path: str | None = None,
    kernel_id: str | None = None,
    cell_id: str | None = None,
    execution_id: str | None = None,
    session_id: str | None = None,
) -> dict[str, str]:
    resolved_path = notebook_path or (
        _SESSION_STATE.get_notebook_path(kernel_id, session_id=resolve_session_id(session_id))
        if kernel_id else None
    )
    resource: dict[str, str] = {}
    if resolved_path:
        normalized_path = _normalize_notebook_path(resolved_path)
        resource["path"] = normalized_path
        resource["notebook_path"] = normalized_path
    if kernel_id:
        resource["kernel_id"] = str(kernel_id)
    if cell_id:
        resource["cell_id"] = str(cell_id)
    if execution_id:
        resource["execution_id"] = str(execution_id)
    return resource


def _resolve_registered_kernel_id(notebook_path: str | None, *, session_id: str | None = None) -> str | None:
    if not notebook_path:
        return None
    return _SESSION_STATE.get_kernel_id(notebook_path, session_id=resolve_session_id(session_id))


async def _resolve_cell_source(
    bridge: InspyroBridge,
    *,
    kernel_id: str,
    cell_id: str,
    source: str | None,
    session_id: str | None = None,
) -> str:
    if source is not None:
        return _source_to_text(source)

    notebook_path = _SESSION_STATE.get_notebook_path(kernel_id, session_id=resolve_session_id(session_id))
    if not notebook_path:
        _raise_typed_error(
            "CELL_SOURCE_REQUIRED",
            "No hay notebook registrado para este kernel y no se proporciono `source`.",
            kernel_id=kernel_id,
            cell_id=cell_id,
            operation="execute_cell",
        )

    notebook_payload = await _read_notebook(bridge, notebook_path)
    _, cell = _find_cell(notebook_payload.get("cells", []), cell_id)
    return _source_to_text(cell.get("source", ""))


async def _resolve_cell_source_and_type(
    bridge: InspyroBridge,
    *,
    kernel_id: str,
    cell_id: str,
    source: str | None,
    session_id: str | None = None,
) -> tuple[str, str]:
    resolved_session_id = resolve_session_id(session_id)
    notebook_path = _SESSION_STATE.get_notebook_path(kernel_id, session_id=resolved_session_id)
    if notebook_path:
        notebook_payload = await _read_notebook(bridge, notebook_path)
        _, cell = _find_cell(notebook_payload.get("cells", []), cell_id)
        cell_type = _normalize_cell_type(cell.get("cell_type"))
        source_text = _source_to_text(source) if source is not None else _source_to_text(cell.get("source", ""))
        if cell_type == "code" and _should_emit_docx(source_text):
            cell_type = "docx"
        return source_text, cell_type
    if source is None:
        _raise_typed_error(
            "CELL_SOURCE_REQUIRED",
            "No hay notebook registrado para este kernel y no se proporciono `source`.",
            kernel_id=kernel_id,
            cell_id=cell_id,
            operation="execute_cell",
        )
    source_text = _source_to_text(source)
    return source_text, ("docx" if _should_emit_docx(source_text) else "code")


async def _emit_kernel_runtime_message(
    message_type: str,
    *,
    kernel_id: str,
    notebook_path: str | None = None,
    execution_id: str | None = None,
    extra_payload: dict[str, Any] | None = None,
) -> None:
    resource = _build_notebook_resource(
        notebook_path=notebook_path,
        kernel_id=kernel_id,
        execution_id=execution_id,
    )
    target_path = resource.get("notebook_path") or resource.get("path")
    if target_path:
        await emit_open_resource(target_path, focus_view="notebook", resource=resource)
    payload = {
        "type": message_type,
        "kernel_id": kernel_id,
    }
    if target_path:
        payload["path"] = target_path
        payload["notebook_path"] = target_path
    if execution_id:
        payload["execution_id"] = execution_id
    if extra_payload:
        payload.update(extra_payload)
    await emit_notebook_runtime_message(payload, resource=resource)


def _extract_artifacts_from_payload(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []

    sources = [payload]
    raw_payload = payload.get("raw")
    if isinstance(raw_payload, dict):
        sources.append(raw_payload)

    artifacts: list[dict[str, Any]] = []
    seen_kinds: set[str] = set()

    for source in sources:
        docx_ref = source.get("docx_ref")
        docx_token = source.get("docx_file_token")
        docx_hash = source.get("docx_hash")
        docx_file_b64 = source.get("docx_file_b64")
        docx_file_name = source.get("docx_file_name")
        docx_size_bytes = source.get("docx_size_bytes")
        if "docx" not in seen_kinds and (docx_ref or docx_token or docx_hash or docx_file_b64):
            artifacts.append(
                {
                    "kind": "docx",
                    "ref": docx_ref,
                    "docx_ref": docx_ref,
                    "token": docx_token,
                    "docx_hash": docx_hash,
                    "docx_file_b64": docx_file_b64,
                    "docx_file_name": docx_file_name,
                    "docx_size_bytes": docx_size_bytes,
                }
            )
            seen_kinds.add("docx")

        pdf_ref = source.get("pdf_ref")
        pdf_token = source.get("pdf_file_token")
        pdf_hash = source.get("pdf_hash")
        pdf_file_b64 = source.get("pdf_file_b64")
        pdf_file_name = source.get("pdf_file_name")
        pdf_size_bytes = source.get("pdf_size_bytes")
        if "pdf" not in seen_kinds and (pdf_ref or pdf_token or pdf_hash or pdf_file_b64):
            artifacts.append(
                {
                    "kind": "pdf",
                    "ref": pdf_ref,
                    "pdf_ref": pdf_ref,
                    "token": pdf_token,
                    "pdf_hash": pdf_hash,
                    "pdf_file_b64": pdf_file_b64,
                    "pdf_file_name": pdf_file_name,
                    "pdf_size_bytes": pdf_size_bytes,
                }
            )
            seen_kinds.add("pdf")

    return [
        {key: value for key, value in artifact.items() if value is not None}
        for artifact in artifacts
    ]


async def _emit_artifact_updates(payload: Any, *, resource: dict[str, Any]) -> None:
    for artifact in _extract_artifacts_from_payload(payload):
        await emit_artifact_update(artifact, resource=resource)


def _track_background_task(
    task: asyncio.Task[None],
    *,
    kernel_id: str | None,
    session_id: str | None = None,
) -> None:
    _LATE_RUNTIME_TASKS[task] = (
        resolve_session_id(session_id),
        str(kernel_id or "").strip() or None,
    )

    def _cleanup(done_task: asyncio.Task[None]) -> None:
        _LATE_RUNTIME_TASKS.pop(done_task, None)
        if done_task.cancelled():
            return
        try:
            done_task.result()
        except Exception:  # pragma: no cover - defensive logging for detached tasks
            logger.exception("Late execution relay task failed")

    task.add_done_callback(_cleanup)


async def _cancel_late_runtime_tasks_for_kernel(
    kernel_id: str,
    *,
    session_id: str | None = None,
) -> None:
    resolved_kernel_id = str(kernel_id or "").strip()
    if not resolved_kernel_id:
        return

    target = (resolve_session_id(session_id), resolved_kernel_id)
    tasks = [task for task, meta in list(_LATE_RUNTIME_TASKS.items()) if meta == target]
    for task in tasks:
        if not task.done():
            task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def _relay_late_execution_messages(
    *,
    queue: asyncio.Queue[dict[str, Any]],
    unregister: Callable[[], None],
    resource: dict[str, Any],
    timeout: int,
    session_id: str | None = None,
) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max(timeout, 1)
    terminal_seen = False

    try:
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return

            message = await asyncio.wait_for(queue.get(), timeout=remaining)
            message_type = str(message.get("type") or "")
            if message_type == "__bridge_disconnected__":
                return

            if not terminal_seen:
                if message_type in _TERMINAL_RUNTIME_MESSAGE_TYPES:
                    terminal_seen = True
                continue

            if message_type not in _LATE_RUNTIME_MESSAGE_TYPES:
                continue

            artifact_message = dict(message)
            if resource.get("kernel_id"):
                artifact_message.setdefault("kernel_id", resource["kernel_id"])
            if resource.get("cell_id"):
                artifact_message.setdefault("cell_id", resource["cell_id"])
            if resource.get("execution_id"):
                artifact_message.setdefault("execution_id", resource["execution_id"])
            if message_type in {"notebook_docx_update", "notebook_pdf_ready"}:
                _SESSION_STATE.record_artifacts(artifact_message, session_id=session_id)

            await emit_notebook_runtime_message(message, resource=resource)
            if message_type == "notebook_docx_update":
                await _emit_artifact_updates(message, resource=resource)
                continue
            if message_type == "notebook_pdf_ready":
                await _emit_artifact_updates(message, resource=resource)
                return
    except asyncio.TimeoutError:
        return
    finally:
        unregister()


async def _execute_cell_request(
    bridge: InspyroBridge,
    *,
    kernel_id: str,
    cell_id: str,
    source: str,
    timeout: int,
    execution_id: str | None = None,
    emit_docx: bool | None = None,
    cell_type: str | None = None,
    skip_pdf: bool = False,
    on_message: Callable[[dict[str, Any]], Awaitable[None] | None] | None = None,
    session_id: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source_text = _source_to_text(source)
    resolved_execution_id = execution_id or f"mcp_exec_{uuid.uuid4().hex}"
    resolved_cell_type = _normalize_cell_type(cell_type)
    if emit_docx is None:
        resolved_emit_docx = resolved_cell_type == "docx" or _should_emit_docx(source_text)
    else:
        resolved_emit_docx = bool(emit_docx)
    resolved_execution_timeout = max(float(timeout), 1.0)
    request_payload = {
        "kernel_id": kernel_id,
        "cell_id": cell_id,
        "source": source_text,
        "execution_id": resolved_execution_id,
        "execution_timeout_s": resolved_execution_timeout,
        "emit_docx": resolved_emit_docx,
        "cell_type": resolved_cell_type,
        "skip_pdf": bool(skip_pdf),
    }
    try:
        messages = await bridge.ws_request_multi(
            "notebook_execute_cell",
            request_payload,
            collect_types=[
                "notebook_stream",
                "notebook_execute_result",
                "notebook_display_data",
                "notebook_update_display_data",
                "notebook_clear_output",
                "notebook_comm_open",
                "notebook_comm_msg",
                "notebook_comm_close",
            ],
            terminal_types=["notebook_cell_executed"],
            error_types=["notebook_cell_error", "notebook_error"],
            on_message=on_message,
            timeout=max(int(resolved_execution_timeout) + 5, 6),
        )
        return messages, _build_execution_payload(messages)
    except BridgeError as exc:
        messages = list(exc.messages or [])
        if exc.payload:
            messages.append(exc.payload)
        return messages, _build_execution_payload(messages)
    except TimeoutError as exc:
        error_payload = _make_error(
            "RPC_WAIT_TIMEOUT",
            str(exc),
            retryable=True,
            kernel_id=kernel_id,
            cell_id=cell_id,
            operation="execute_cell",
            execution_id=resolved_execution_id,
        )
        messages = [error_payload]
        return messages, _build_execution_payload(messages)
    except ConnectionError as exc:
        recovered = await _recover_execution_after_disconnect(
            kernel_id=kernel_id,
            cell_id=cell_id,
            execution_id=resolved_execution_id,
            timeout=max(int(resolved_execution_timeout), 1),
            session_id=session_id,
        )
        if recovered is not None:
            return recovered
        error_payload = _make_error(
            "KERNEL_STATE_ERROR",
            str(exc),
            retryable=True,
            kernel_id=kernel_id,
            cell_id=cell_id,
            operation="execute_cell",
            execution_id=resolved_execution_id,
        )
        messages = [error_payload]
        return messages, _build_execution_payload(messages)


def _persist_execution_result(
    notebook: dict[str, Any],
    *,
    cell_id: str,
    source: str,
    execution_result: dict[str, Any],
) -> dict[str, Any]:
    if not bool(execution_result.get("persist_runtime_state", True)):
        return notebook
    cells = notebook.get("cells", [])
    try:
        _, cell = _find_cell(cells, cell_id)
    except BridgeError:
        return notebook

    cell["source"] = source
    raw = execution_result.get("raw", {})
    if execution_result.get("status") == "executed":
        cell["outputs"] = list(raw.get("outputs", []))
        cell["execution_count"] = raw.get("execution_count")
    return notebook


def _select_code_cells(
    cells: list[dict[str, Any]],
    *,
    cell_ids: Optional[list[str]] = None,
    until_cell_id: str | None = None,
    max_cells: int | None = None,
    include_docx: bool = True,
) -> list[dict[str, Any]]:
    code_cells = [cell for cell in cells if _normalize_cell_type(cell.get("cell_type")) in _RUNNABLE_CELL_TYPES]

    if until_cell_id:
        selected: list[dict[str, Any]] = []
        found_until = False
        for cell in code_cells:
            selected.append(cell)
            if str(cell.get("id") or "") == until_cell_id:
                found_until = True
                break
        if not found_until:
            _raise_typed_error(
                "CELL_NOT_FOUND",
                f"Celda '{until_cell_id}' no encontrada para execute_until.",
                cell_id=until_cell_id,
                operation="execute_until",
            )
        code_cells = selected

    if cell_ids:
        requested = {str(cell_id) for cell_id in cell_ids}
        code_cells = [cell for cell in code_cells if str(cell.get("id") or "") in requested]
        found = {str(cell.get("id") or "") for cell in code_cells}
        missing = sorted(requested - found)
        if missing:
            _raise_typed_error(
                "CELL_NOT_FOUND",
                f"Celda(s) no encontradas: {', '.join(missing)}",
                operation="select_code_cells",
                extra={"missing_cell_ids": missing},
            )

    runnable = [
        cell
        for cell in code_cells
        if _source_to_text(cell.get("source", "")).strip()
        and _is_runnable_cell(cell, include_docx=include_docx)
    ]
    if max_cells is not None:
        runnable = runnable[: max(0, int(max_cells))]
    return runnable


def _collect_skipped_docx_cell_ids(
    cells: list[dict[str, Any]],
    *,
    cell_ids: Optional[list[str]] = None,
    until_cell_id: str | None = None,
    max_cells: int | None = None,
) -> list[str]:
    selected = _select_code_cells(
        cells,
        cell_ids=cell_ids,
        until_cell_id=until_cell_id,
        max_cells=max_cells,
        include_docx=True,
    )
    return [
        str(cell.get("id") or "")
        for cell in selected
        if _is_docx_cell(cell)
    ]


def _summarize_execution_result(
    cell_result: dict[str, Any],
    *,
    cell_id: str,
    source: str | None = None,
    include_outputs: bool = False,
    include_variables: bool = False,
    include_source: bool = False,
    output_limit_chars: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
) -> dict[str, Any]:
    raw = cell_result.get("raw", {}) or {}
    summary = {
        "cell_id": cell_id,
        "status": "failed" if cell_result.get("has_error") else str(cell_result.get("status") or "executed"),
        "has_error": bool(cell_result.get("has_error")),
        "execution_count": cell_result.get("execution_count"),
        "output_count": len(cell_result.get("outputs") or []),
        "child_execution_id": raw.get("execution_id"),
        "artifacts": _extract_artifacts_from_payload(cell_result),
    }
    if source is not None:
        if include_source:
            summary["source"] = _source_to_text(source)
        else:
            summary["source_preview"] = _source_preview(source)
    if include_outputs:
        summary["outputs"] = _sanitize_outputs(
            cell_result.get("outputs") or [],
            limit=output_limit_chars,
        )
    if include_variables:
        summary["variables"] = _filter_variables(
            cell_result.get("variables") or {},
            include_runtime=False,
            limit=output_limit_chars,
        )
    if cell_result.get("error"):
        summary["error"] = cell_result.get("error")
    return _apply_recovery_fields(cell_result, summary)


def _record_execution_artifact_state(
    *,
    kernel_id: str,
    cell_id: str,
    public_execution_id: str,
    cell_result: dict[str, Any],
    session_id: str | None = None,
) -> None:
    resolved_session_id = resolve_session_id(session_id)
    raw_message = cell_result.get("raw")
    if not isinstance(raw_message, dict):
        return

    child_execution_id = str(raw_message.get("execution_id") or "").strip()
    if child_execution_id and child_execution_id != public_execution_id:
        _SESSION_STATE.register_artifact_alias(
            kernel_id,
            execution_id=child_execution_id,
            alias_execution_id=public_execution_id,
            session_id=resolved_session_id,
        )

    artifact_message = dict(raw_message)
    artifact_message.setdefault("kernel_id", kernel_id)
    artifact_message.setdefault("cell_id", cell_id)
    artifact_message.setdefault("execution_id", child_execution_id or public_execution_id)
    _SESSION_STATE.record_artifacts(artifact_message, session_id=resolved_session_id)


def _artifact_kind_ready(payload: Any, kind: str) -> bool:
    if not isinstance(payload, dict):
        return False
    if kind == "docx":
        return any(
            payload.get(field)
            for field in ("docx_ref", "docx_download_url", "docx_file_token", "docx_artifact_id", "docx_file_b64", "docx_hash")
        )
    if kind == "pdf":
        return any(
            payload.get(field)
            for field in ("pdf_ref", "pdf_file_token", "pdf_file_b64", "pdf_hash")
        )
    return False


async def _wait_for_execution_artifact(
    *,
    kernel_id: str,
    execution_id: str | None,
    kind: str,
    session_id: str | None = None,
    timeout_s: float | None = None,
    minimum_updated_at: float | None = None,
) -> dict[str, Any] | None:
    resolved_execution_id = str(execution_id or "").strip()
    if not kernel_id or not resolved_execution_id:
        return None

    effective_timeout = max(0.0, float(timeout_s if timeout_s is not None else _BATCH_ARTIFACT_WAIT_TIMEOUT_S))
    if effective_timeout <= 0:
        return None

    resolved_session_id = resolve_session_id(session_id)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + effective_timeout

    while True:
        artifacts = _SESSION_STATE.get_artifacts(
            kernel_id=kernel_id,
            execution_id=resolved_execution_id,
            session_id=resolved_session_id,
        )
        if (
            isinstance(artifacts, dict)
            and _artifact_kind_ready(artifacts, kind)
            and (
                minimum_updated_at is None
                or float(artifacts.get("updated_at") or 0.0) >= minimum_updated_at
            )
        ):
            return artifacts

        remaining = deadline - loop.time()
        if remaining <= 0:
            return None
        await asyncio.sleep(min(_BATCH_ARTIFACT_WAIT_POLL_S, remaining))


def _build_recovered_artifact_terminal_message(
    *,
    kernel_id: str,
    cell_id: str,
    execution_id: str,
    artifact: dict[str, Any],
) -> dict[str, Any]:
    payload = {
        "type": "notebook_cell_executed",
        "kernel_id": kernel_id,
        "cell_id": cell_id,
        "execution_id": execution_id,
        "execution_count": None,
        "outputs": [],
        "variables": {},
        "recovered_after_disconnect": True,
        "recovery_reason": "artifact_after_ws_disconnect",
        "outputs_degraded": True,
        "variables_degraded": True,
    }
    return _merge_artifact_fields(payload, artifact)


async def _recover_execution_after_disconnect(
    *,
    kernel_id: str,
    cell_id: str,
    execution_id: str,
    timeout: int,
    session_id: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    resolved_session_id = resolve_session_id(session_id)
    recovery = _SESSION_STATE.get_execution_recovery(execution_id, session_id=resolved_session_id) or {}
    terminal_message = recovery.get("terminal_message")
    if isinstance(terminal_message, dict) and str(terminal_message.get("type") or "") in _TERMINAL_RUNTIME_MESSAGE_TYPES:
        recovered_terminal = dict(terminal_message)
        recovered_terminal.setdefault("kernel_id", kernel_id)
        recovered_terminal.setdefault("cell_id", cell_id)
        recovered_terminal.setdefault("execution_id", execution_id)
        recovered_terminal.setdefault("recovered_after_disconnect", True)
        recovered_terminal.setdefault("recovery_reason", "terminal_after_ws_disconnect")
        started_at = _resolve_execution_started_at(execution_id, session_id=resolved_session_id)
        artifact = await _wait_for_execution_artifact(
            kernel_id=kernel_id,
            execution_id=execution_id,
            kind="docx",
            session_id=resolved_session_id,
            timeout_s=0.0,
            minimum_updated_at=started_at,
        )
        recovered_terminal = _merge_artifact_fields(recovered_terminal, artifact)
        messages = [recovered_terminal]
        return messages, _build_execution_payload(messages)

    started_at = _resolve_execution_started_at(execution_id, session_id=resolved_session_id)
    recovery_timeout_s = min(float(max(timeout, 1)), _BATCH_ARTIFACT_WAIT_TIMEOUT_S or float(max(timeout, 1)))
    artifact = await _wait_for_execution_artifact(
        kernel_id=kernel_id,
        execution_id=execution_id,
        kind="docx",
        session_id=resolved_session_id,
        timeout_s=recovery_timeout_s,
        minimum_updated_at=started_at,
    )
    if artifact is None:
        artifact = await _wait_for_execution_artifact(
            kernel_id=kernel_id,
            execution_id=execution_id,
            kind="pdf",
            session_id=resolved_session_id,
            timeout_s=recovery_timeout_s,
            minimum_updated_at=started_at,
        )
    if not isinstance(artifact, dict):
        return None

    recovered_raw = _build_recovered_artifact_terminal_message(
        kernel_id=kernel_id,
        cell_id=cell_id,
        execution_id=execution_id,
        artifact=artifact,
    )
    messages = [recovered_raw]
    execution_result = {
        "status": "executed",
        "outputs": [],
        "execution_count": None,
        "variables": {},
        "has_error": False,
        "raw": recovered_raw,
        "error": None,
        "persist_runtime_state": False,
    }
    _apply_recovery_fields(recovered_raw, execution_result)
    return messages, execution_result


def _execution_task_registry(session_id: str | None = None) -> dict[str, asyncio.Task[dict[str, Any]]]:
    return _BACKGROUND_EXECUTION_TASKS.setdefault(resolve_session_id(session_id), {})


def _track_execution_task(
    execution_id: str,
    task: asyncio.Task[dict[str, Any]],
    *,
    session_id: str | None = None,
) -> None:
    session_id = resolve_session_id(session_id)
    registry = _execution_task_registry(session_id)
    registry[execution_id] = task

    def _cleanup(done_task: asyncio.Task[dict[str, Any]]) -> None:
        registry.pop(execution_id, None)
        current = _SESSION_STATE.get_execution(execution_id, session_id=session_id) or {}
        if done_task.cancelled():
            _SESSION_STATE.upsert_execution(
                execution_id,
                {
                    "status": "cancelled",
                    "cancellation_reason": "user_cancelled",
                    "completed_at": _now_ts(),
                    "current_child_execution_id": None,
                },
                session_id=session_id,
            )
            kernel_id = current.get("kernel_id")
            if kernel_id:
                _SESSION_STATE.set_kernel_state(
                    str(kernel_id),
                    "idle",
                    notebook_path=current.get("notebook_path"),
                    execution_id=execution_id,
                    session_id=session_id,
                )
            return
        try:
            done_task.result()
        except Exception as exc:  # pragma: no cover - defensive logging for detached tasks
            logger.exception("Background execution task failed: %s", exc)
            error_payload = _error_from_exception(
                exc,
                operation="background_execution",
                kernel_id=current.get("kernel_id"),
                notebook_path=current.get("notebook_path"),
                execution_id=execution_id,
            )
            _SESSION_STATE.upsert_execution(
                execution_id,
                {
                    "status": "failed",
                    "error": error_payload,
                    "completed_at": _now_ts(),
                    "current_child_execution_id": None,
                },
                session_id=session_id,
            )
            kernel_id = current.get("kernel_id")
            if kernel_id:
                _SESSION_STATE.set_kernel_state(
                    str(kernel_id),
                    "error",
                    notebook_path=current.get("notebook_path"),
                    error=error_payload,
                    execution_id=execution_id,
                    session_id=session_id,
                )

    task.add_done_callback(_cleanup)


async def _cancel_execution_tasks_for_kernel(
    kernel_id: str,
    *,
    session_id: str | None = None,
) -> None:
    resolved_kernel_id = str(kernel_id or "").strip()
    if not resolved_kernel_id:
        return

    registry = _execution_task_registry(session_id)
    tasks: list[asyncio.Task[dict[str, Any]]] = []
    for execution_id, task in list(registry.items()):
        execution = _SESSION_STATE.get_execution(execution_id, session_id=session_id) or {}
        if str(execution.get("kernel_id") or "").strip() != resolved_kernel_id:
            continue
        registry.pop(execution_id, None)
        if not task.done():
            task.cancel()
        tasks.append(task)
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def _cancel_kernel_runtime_tasks(
    kernel_id: str,
    *,
    session_id: str | None = None,
) -> None:
    await _cancel_late_runtime_tasks_for_kernel(kernel_id, session_id=session_id)
    await _cancel_execution_tasks_for_kernel(kernel_id, session_id=session_id)


async def _resolve_workdir(
    bridge: InspyroBridge,
    notebook_path: str | None = None,
) -> str:
    if notebook_path:
        expanded = _normalize_notebook_path(notebook_path)
        if expanded.lower().endswith(".ipynb"):
            return os.path.dirname(expanded)
        return expanded

    try:
        info = await bridge.rest_get("/api/system/info")
    except Exception:
        return os.getcwd()
    return str(
        info.get("workspace_path")
        or info.get("active_workspace")
        or info.get("workspace_root")
        or os.getcwd()
    )


async def _pulse_batch_execution_heartbeat(
    *,
    execution_id: str,
    kernel_id: str,
    notebook_path: str,
    cell_id: str,
    interval_s: float = 2.0,
    session_id: str | None = None,
) -> None:
    """Mantiene visible el progreso batch mientras una celda larga sigue ejecutándose."""
    if interval_s <= 0:
        return

    resolved_session_id = resolve_session_id(session_id)
    try:
        while True:
            await asyncio.sleep(interval_s)
            execution = _SESSION_STATE.get_execution(execution_id, session_id=resolved_session_id) or {}
            if execution.get("status") != "running":
                return
            if str(execution.get("current_cell_id") or "") != str(cell_id):
                return
            _SESSION_STATE.upsert_execution(
                execution_id,
                {
                    "kernel_id": kernel_id,
                    "notebook_path": notebook_path,
                    "current_cell_id": cell_id,
                    "heartbeat_at": _now_ts(),
                },
                session_id=resolved_session_id,
            )
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # pragma: no cover - solo diagnóstico
        logger.debug("Batch heartbeat pulse failed for %s: %s", execution_id, exc)


async def _run_batch_execution(
    *,
    bridge: InspyroBridge,
    kernel_id: str,
    notebook_path: str,
    selected_cells: list[dict[str, Any]],
    timeout_per_cell: int,
    execution_id: str,
    include_outputs: bool,
    include_variables: bool,
    include_source: bool,
    output_limit_chars: int,
    return_outputs_for: Optional[list[str]],
    stop_on_error: bool,
    operation: str,
    background: bool = False,
    skipped_docx_cell_ids: Optional[list[str]] = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    resolved_session_id = resolve_session_id(session_id)
    normalized_path = _normalize_notebook_path(notebook_path)
    selected_ids = [str(cell.get("id") or "") for cell in selected_cells]
    started_at = _now_ts()
    started_perf = time.perf_counter()
    failed_cell_ids: list[str] = []
    executed = 0
    failed = 0
    cell_results: dict[str, Any] = {}
    last_error: dict[str, Any] | None = None
    last_child_execution_id: str | None = None
    last_artifacts: list[dict[str, Any]] = []
    recovered_after_disconnect = False
    recovery_reasons: set[str] = set()
    skipped_docx_cell_ids = list(skipped_docx_cell_ids or [])

    _SESSION_STATE.upsert_execution(
        execution_id,
        {
            "execution_id": execution_id,
            "kind": operation,
            "kernel_id": kernel_id,
            "notebook_path": normalized_path,
            "status": "running",
            "started_at": started_at,
            "heartbeat_at": started_at,
            "selected_cell_ids": selected_ids,
            "skipped_docx_cell_ids": skipped_docx_cell_ids,
            "total_cells": len(selected_cells),
            "completed_cells": 0,
            "executed": 0,
            "failed": 0,
            "failed_cell_ids": [],
            "background": background,
        },
        session_id=resolved_session_id,
    )
    _SESSION_STATE.append_execution_event(
        execution_id,
        {
            "phase": "started",
            "operation": operation,
            "kernel_id": kernel_id,
            "notebook_path": normalized_path,
            "total_cells": len(selected_cells),
        },
        session_id=resolved_session_id,
    )
    _SESSION_STATE.set_kernel_state(
        kernel_id,
        "running",
        notebook_path=normalized_path,
        execution_id=execution_id,
        session_id=resolved_session_id,
    )
    total_cells = max(1, len(selected_cells))
    await report_progress(0, total_cells, f"{operation}: starting")
    await log_info(
        f"MCP batch execution started for {os.path.basename(normalized_path) or normalized_path} "
        f"with {len(selected_cells)} cells."
    )

    try:
        batch_emit_docx = any(
            _is_docx_cell(cell) or _should_emit_docx(_source_to_text(cell.get("source", "")))
            for cell in selected_cells
        )
        last_runnable_cell_id = selected_ids[-1] if selected_ids else ""

        for order, cell in enumerate(selected_cells):
            cell_id = str(cell.get("id") or "unknown")
            source_text = _source_to_text(cell.get("source", ""))
            cell_started_perf = time.perf_counter()
            child_execution_id = f"mcp_exec_{uuid.uuid4().hex}"

            _SESSION_STATE.update_execution_cell(
                execution_id,
                cell_id,
                status="running",
                order=order,
                session_id=resolved_session_id,
            )
            _SESSION_STATE.upsert_execution(
                execution_id,
                {
                    "current_cell_id": cell_id,
                    "current_child_execution_id": child_execution_id,
                    "completed_cells": order,
                    "heartbeat_at": _now_ts(),
                },
                session_id=resolved_session_id,
            )
            _SESSION_STATE.append_execution_event(
                execution_id,
                {
                    "phase": "cell_started",
                    "cell_id": cell_id,
                    "order": order,
                },
                session_id=resolved_session_id,
            )

            heartbeat_task = asyncio.create_task(
                _pulse_batch_execution_heartbeat(
                    execution_id=execution_id,
                    kernel_id=kernel_id,
                    notebook_path=normalized_path,
                    cell_id=cell_id,
                    session_id=resolved_session_id,
                )
            )
            try:
                cell_result = await _execute_cell_impl(
                    bridge=bridge,
                    kernel_id=kernel_id,
                    cell_id=cell_id,
                    source=source_text,
                    timeout=timeout_per_cell,
                    emit_open=False,
                    emit_snapshot_before_runtime=False,
                    emit_docx=batch_emit_docx,
                    cell_type=_normalize_cell_type(cell.get("cell_type")),
                    skip_pdf=bool(last_runnable_cell_id) and cell_id != last_runnable_cell_id,
                    execution_id_override=child_execution_id,
                    artifact_alias_execution_id=execution_id,
                    session_id=resolved_session_id,
                )
            finally:
                heartbeat_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await heartbeat_task

            _record_execution_artifact_state(
                kernel_id=kernel_id,
                cell_id=cell_id,
                public_execution_id=execution_id,
                cell_result=cell_result,
                session_id=resolved_session_id,
            )

            cell_duration_ms = int((time.perf_counter() - cell_started_perf) * 1000)
            if cell_result.get("has_error"):
                failed += 1
                failed_cell_ids.append(cell_id)
                cell_status = "failed"
                if cell_result.get("error"):
                    last_error = cell_result.get("error")
            else:
                executed += 1
                cell_status = "completed"

            cell_summary = _summarize_execution_result(
                cell_result,
                cell_id=cell_id,
                source=source_text,
                include_outputs=(
                    include_outputs
                    or cell_result.get("has_error")
                    or (return_outputs_for is not None and cell_id in return_outputs_for)
                ),
                include_variables=include_variables,
                include_source=include_source,
                output_limit_chars=output_limit_chars,
            )
            cell_summary["duration_ms"] = cell_duration_ms
            if cell_summary.get("recovered_after_disconnect"):
                recovered_after_disconnect = True
                recovery_reason = str(cell_summary.get("recovery_reason") or "").strip()
                if recovery_reason:
                    recovery_reasons.add(recovery_reason)
            child_execution_id = str(cell_summary.get("child_execution_id") or "").strip() or None
            if child_execution_id:
                last_child_execution_id = child_execution_id
            if cell_summary.get("artifacts"):
                last_artifacts = copy.deepcopy(cell_summary["artifacts"])
            if include_outputs or return_outputs_for is not None or cell_result.get("has_error"):
                cell_results[cell_id] = cell_summary

            _SESSION_STATE.update_execution_cell(
                execution_id,
                cell_id,
                status=cell_status,
                result=cell_summary,
                duration_ms=cell_duration_ms,
                order=order,
                session_id=resolved_session_id,
            )
            _SESSION_STATE.upsert_execution(
                execution_id,
                {
                    "completed_cells": order + 1,
                    "executed": executed,
                    "failed": failed,
                    "failed_cell_ids": list(failed_cell_ids),
                    "current_child_execution_id": None,
                    "heartbeat_at": _now_ts(),
                },
                session_id=resolved_session_id,
            )
            _SESSION_STATE.append_execution_event(
                execution_id,
                {
                    "phase": "cell_failed" if cell_result.get("has_error") else "cell_completed",
                    "cell_id": cell_id,
                    "order": order,
                    "duration_ms": cell_duration_ms,
                },
                session_id=resolved_session_id,
            )
            await report_progress(order + 1, total_cells, f"{operation}: {cell_status} {cell_id}")

            if stop_on_error and cell_result.get("has_error"):
                break
    except Exception as exc:
        duration_ms = int((time.perf_counter() - started_perf) * 1000)
        error_payload = _error_from_exception(
            exc,
            operation=operation,
            kernel_id=kernel_id,
            notebook_path=normalized_path,
            execution_id=execution_id,
        )
        _SESSION_STATE.upsert_execution(
            execution_id,
            {
                "status": "failed",
                "completed_at": _now_ts(),
                "duration_ms": duration_ms,
                "executed": executed,
                "failed": max(1, failed),
                "failed_cell_ids": list(failed_cell_ids),
                "skipped_docx_cell_ids": skipped_docx_cell_ids,
                "current_cell_id": None,
                "current_child_execution_id": None,
                "error": error_payload,
                "summary": {
                    "total_cells": len(selected_cells),
                    "executed": executed,
                    "failed": max(1, failed),
                    "failed_cell_ids": list(failed_cell_ids),
                    "skipped_docx_cell_ids": skipped_docx_cell_ids,
                    "duration_ms": duration_ms,
                },
            },
            session_id=resolved_session_id,
        )
        _SESSION_STATE.append_execution_event(
            execution_id,
            {
                "phase": "failed",
                "duration_ms": duration_ms,
                "error": error_payload,
            },
            session_id=resolved_session_id,
        )
        _SESSION_STATE.set_kernel_state(
            kernel_id,
            "error",
            notebook_path=normalized_path,
            error=error_payload,
            execution_id=execution_id,
            session_id=resolved_session_id,
        )
        await report_progress(max(executed + failed, 1), total_cells, f"{operation}: failed")
        raise

    duration_ms = int((time.perf_counter() - started_perf) * 1000)
    status = "completed"
    if failed and stop_on_error:
        status = "failed"
    elif failed:
        status = "completed_with_errors"

    if batch_emit_docx and status != "failed":
        awaited_artifacts = await _wait_for_execution_artifact(
            kernel_id=kernel_id,
            execution_id=execution_id,
            kind="docx",
            session_id=resolved_session_id,
        )
        awaited_artifact_list = _extract_artifacts_from_payload(awaited_artifacts)
        if awaited_artifact_list:
            last_artifacts = awaited_artifact_list

    final_summary = {
        "execution_id": execution_id,
        "status": status,
        "path": normalized_path,
        "kernel_id": kernel_id,
        "total_cells": len(selected_cells),
        "selected_cell_ids": selected_ids,
        "executed": executed,
        "failed": failed,
        "failed_cell_ids": failed_cell_ids,
        "skipped_docx_cell_ids": skipped_docx_cell_ids,
        "duration_ms": duration_ms,
        "cell_results": cell_results,
        "child_execution_id": last_child_execution_id,
        "artifacts": last_artifacts,
    }
    if recovered_after_disconnect:
        final_summary["recovered_after_disconnect"] = True
        if len(recovery_reasons) == 1:
            final_summary["recovery_reason"] = next(iter(recovery_reasons))

    execution_summary = {
        "status": status,
        "completed_at": _now_ts(),
        "duration_ms": duration_ms,
        "executed": executed,
        "failed": failed,
        "failed_cell_ids": list(failed_cell_ids),
        "skipped_docx_cell_ids": skipped_docx_cell_ids,
        "current_cell_id": None,
        "current_child_execution_id": None,
        "artifacts": last_artifacts,
        "summary": {
            "total_cells": len(selected_cells),
            "executed": executed,
            "failed": failed,
            "failed_cell_ids": list(failed_cell_ids),
            "skipped_docx_cell_ids": skipped_docx_cell_ids,
            "duration_ms": duration_ms,
        },
        "error": last_error,
    }
    if recovered_after_disconnect:
        execution_summary["recovered_after_disconnect"] = True
        if len(recovery_reasons) == 1:
            execution_summary["recovery_reason"] = next(iter(recovery_reasons))
    _SESSION_STATE.upsert_execution(execution_id, execution_summary, session_id=resolved_session_id)
    _SESSION_STATE.append_execution_event(
        execution_id,
        {
            "phase": "completed",
            "status": status,
            "duration_ms": duration_ms,
        },
        session_id=resolved_session_id,
    )
    _SESSION_STATE.set_kernel_state(
        kernel_id,
        "idle",
        notebook_path=normalized_path,
        error=last_error,
        execution_id=execution_id,
        session_id=resolved_session_id,
    )
    await report_progress(total_cells, total_cells, f"{operation}: {status}")
    return final_summary


async def _execute_cell_impl(
    *,
    bridge: InspyroBridge,
    kernel_id: str,
    cell_id: str,
    source: str,
    timeout: int = _DEFAULT_CELL_TIMEOUT,
    emit_open: bool = True,
    emit_snapshot_before_runtime: bool = True,
    emit_docx: bool | None = None,
    cell_type: str | None = None,
    skip_pdf: bool = False,
    execution_id_override: str | None = None,
    artifact_alias_execution_id: str | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    resolved_session_id = resolve_session_id(session_id)
    notebook_path = _SESSION_STATE.get_notebook_path(kernel_id, session_id=resolved_session_id)
    source_text = _source_to_text(source)
    execution_id = execution_id_override or f"mcp_exec_{uuid.uuid4().hex}"
    canonical_artifact_execution_id = str(artifact_alias_execution_id or "").strip() or None
    if canonical_artifact_execution_id and canonical_artifact_execution_id != execution_id:
        _SESSION_STATE.register_artifact_alias(
            kernel_id,
            execution_id=execution_id,
            alias_execution_id=canonical_artifact_execution_id,
            session_id=resolved_session_id,
        )
    resource = _build_notebook_resource(
        notebook_path=notebook_path,
        kernel_id=kernel_id,
        cell_id=cell_id,
        execution_id=execution_id,
        session_id=resolved_session_id,
    )

    notebook_payload = None
    source_changed = False
    if notebook_path:
        notebook_payload = await _read_notebook(bridge, notebook_path)
        try:
            _, cell = _find_cell(notebook_payload.get("cells", []), cell_id)
            current_source = _source_to_text(cell.get("source", ""))
            source_changed = current_source != source_text
            if source_changed:
                cell["source"] = source_text
                await _write_notebook(bridge, notebook_path, notebook_payload)
        except BridgeError:
            notebook_payload = None

    if emit_open and notebook_path:
        await emit_open_resource(notebook_path, focus_view="notebook", resource=resource)

    if emit_snapshot_before_runtime and notebook_path and notebook_payload is not None and source_changed:
        await emit_notebook_snapshot(
            notebook_path,
            notebook_payload,
            kernel_id=kernel_id,
            focus_cell_id=cell_id,
        )

    async def _forward_runtime_message(message: dict[str, Any]) -> None:
        _SESSION_STATE.observe_execution_message(message, session_id=resolved_session_id)
        if canonical_artifact_execution_id and canonical_artifact_execution_id != str(message.get("execution_id") or ""):
            aliased_message = dict(message)
            aliased_message["execution_id"] = canonical_artifact_execution_id
            aliased_message.setdefault("kernel_id", kernel_id)
            aliased_message.setdefault("cell_id", cell_id)
            if notebook_path:
                aliased_message.setdefault("path", notebook_path)
                aliased_message.setdefault("notebook_path", notebook_path)
            _SESSION_STATE.observe_execution_message(
                aliased_message,
                session_id=resolved_session_id,
            )
        await emit_notebook_runtime_message(message, resource=resource)

    late_queue, unregister_late_queue = bridge.register_execution_observer(execution_id)
    try:
        messages, execution_result = await _execute_cell_request(
            bridge,
            kernel_id=kernel_id,
            cell_id=cell_id,
            source=source_text,
            timeout=timeout,
            execution_id=execution_id,
            emit_docx=emit_docx,
            cell_type=cell_type,
            skip_pdf=skip_pdf,
            on_message=_forward_runtime_message,
            session_id=resolved_session_id,
        )
    except Exception:
        unregister_late_queue()
        raise
    raw_message = execution_result.get("raw")
    if isinstance(raw_message, dict):
        _record_execution_artifact_state(
            kernel_id=kernel_id,
            cell_id=cell_id,
            public_execution_id=execution_id,
            cell_result=execution_result,
            session_id=resolved_session_id,
        )
        if raw_message.get("pdf_converting"):
            late_timeout = max(timeout, 90)
            relay_task = asyncio.create_task(
                _relay_late_execution_messages(
                    queue=late_queue,
                    unregister=unregister_late_queue,
                    resource=resource,
                    timeout=late_timeout,
                    session_id=resolved_session_id,
                )
            )
            _track_background_task(
                relay_task,
                kernel_id=resource.get("kernel_id"),
                session_id=resolved_session_id,
            )
        else:
            unregister_late_queue()
    else:
        unregister_late_queue()

    if notebook_path and notebook_payload is not None:
        persisted = _persist_execution_result(
            notebook_payload,
            cell_id=cell_id,
            source=source_text,
            execution_result=execution_result,
        )
        await _write_notebook(bridge, notebook_path, persisted)

    execution_result["path"] = notebook_path
    execution_result["messages"] = messages
    await _emit_artifact_updates(execution_result, resource=resource)
    return execution_result


@mcp_activity_tool("notebook")
async def notebook_create(
    path: str,
    name: str = "Untitled.ipynb",
    cells: Optional[list[dict[str, Any]]] = None,
    reuse_if_loaded: bool = False,
    close_others: bool = False,
    include_source_preview: bool = True,
    include_outputs: bool = False,
    max_source_preview_chars: int = _DEFAULT_SOURCE_PREVIEW_CHARS,
    output_limit_chars: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
) -> dict:
    """Cuando usar: crear un notebook nuevo gestionado por MCP.

    Prerrequisitos: `path` debe apuntar a un directorio del workspace.
    Resultado: devuelve `kernel_id`, `path`, conteo de celdas y listado inicial.
    Siguiente tool tipica: `notebook_sync_cells`, `execute_all_cells` o `notebook_save`.
    """
    session_id = _ensure_stateful_notebook_sessions("notebook_create", notebook_path=path)
    bridge = _get_bridge(session_id)
    notebook_dir = _normalize_notebook_path(path)
    notebook_path = _normalize_notebook_path(os.path.join(notebook_dir, name))
    existing_kernel_id = _SESSION_STATE.get_kernel_id(notebook_path, session_id=session_id) if reuse_if_loaded else None
    existing_status = (
        _SESSION_STATE.get_kernel_status(existing_kernel_id, session_id=session_id)
        if existing_kernel_id
        else {}
    )
    result: dict[str, Any]
    reused_kernel = False
    closed_kernel_ids: list[str] = []
    if existing_kernel_id and existing_status.get("state") != "disconnected":
        result = {"type": "notebook_created", "kernel_id": existing_kernel_id}
        reused_kernel = True
    else:
        result = await bridge.ws_request(
            "notebook_create",
            {"path": notebook_dir},
            success_types={"notebook_created"},
            error_types={"notebook_error"},
            timeout=15,
        )

    notebook_payload = result.get("notebook") or {"cells": [], "metadata": {}, "nbformat": 4, "nbformat_minor": 4}
    sync_summary: dict[str, Any] | None = None
    if cells is not None:
        sync_summary = _prepare_synced_cells(
            notebook_payload,
            list(cells),
            preserve_outputs=False,
        )
        notebook_payload["cells"] = sync_summary["cells"]
    await _write_notebook(bridge, notebook_path, notebook_payload)

    kernel_id = str(result.get("kernel_id") or "")
    _SESSION_STATE.register_notebook(kernel_id, notebook_path, session_id=session_id)
    if close_others:
        closed_kernel_ids = await _close_other_session_notebooks(kernel_id, session_id=session_id)

    cells = notebook_payload.get("cells", [])
    await emit_open_resource(notebook_path, focus_view="notebook")
    await emit_notebook_snapshot(notebook_path, notebook_payload, kernel_id=kernel_id)
    return {
        "status": "created",
        "kernel_id": kernel_id,
        "path": notebook_path,
        "cell_count": len(cells),
        "kernel_session": "reused" if reused_kernel else "created",
        "reused_kernel": reused_kernel,
        "closed_kernel_ids": closed_kernel_ids,
        "cells": _cell_listing(
            cells,
            include_source_preview=include_source_preview,
            include_source=False,
            include_outputs=include_outputs,
            output_limit_chars=output_limit_chars,
            max_source_preview_chars=max_source_preview_chars,
        ),
        "sync_summary": sync_summary,
        "raw": result,
    }


@mcp_activity_tool("notebook")
async def notebook_load(
    path: str,
    reuse_if_loaded: bool = False,
    close_others: bool = False,
    include_source_preview: bool = True,
    include_outputs: bool = False,
    include_source: bool = False,
    max_source_preview_chars: int = _DEFAULT_SOURCE_PREVIEW_CHARS,
    output_limit_chars: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
    max_cells: Optional[int] = None,
) -> dict:
    """Cuando usar: reabrir un `.ipynb` existente dentro de una sesion MCP.

    Prerrequisitos: `path` debe existir y apuntar a un notebook valido.
    Resultado: devuelve `kernel_id`, `path`, celdas cargadas y deja la sesion lista para ejecutar.
    Siguiente tool tipica: `notebook_sync_cells`, `execute_cell`, `execute_all_cells` o `get_document_docx`.
    """
    session_id = _ensure_stateful_notebook_sessions("notebook_load", notebook_path=path)
    bridge = _get_bridge(session_id)
    notebook_path = _normalize_notebook_path(path)
    notebook_payload = await _read_notebook(bridge, notebook_path)
    kernel_load_payload = _strip_notebook_runtime_state(notebook_payload)
    existing_kernel_id = _SESSION_STATE.get_kernel_id(notebook_path, session_id=session_id) if reuse_if_loaded else None
    existing_status = (
        _SESSION_STATE.get_kernel_status(existing_kernel_id, session_id=session_id)
        if existing_kernel_id
        else {}
    )
    result: dict[str, Any]
    reused_kernel = False
    closed_kernel_ids: list[str] = []
    if existing_kernel_id and existing_status.get("state") != "disconnected":
        result = {
            "type": "notebook_loaded",
            "kernel_id": existing_kernel_id,
            "notebook": kernel_load_payload,
        }
        reused_kernel = True
    else:
        result = await bridge.ws_request(
            "notebook_load",
            {"path": notebook_path, "content": kernel_load_payload},
            success_types={"notebook_loaded"},
            error_types={"notebook_error"},
            timeout=30,
        )

    kernel_id = str(result.get("kernel_id") or "")
    _SESSION_STATE.register_notebook(kernel_id, notebook_path, session_id=session_id)
    if close_others:
        closed_kernel_ids = await _close_other_session_notebooks(kernel_id, session_id=session_id)
    loaded_notebook = result.get("notebook") or kernel_load_payload
    cells = notebook_payload.get("cells", [])
    await emit_open_resource(notebook_path, focus_view="notebook")
    await emit_notebook_snapshot(notebook_path, loaded_notebook, kernel_id=kernel_id)
    return {
        "status": "loaded",
        "kernel_id": kernel_id,
        "path": notebook_path,
        "cell_count": len(cells),
        "kernel_session": "reused" if reused_kernel else "created",
        "reused_kernel": reused_kernel,
        "closed_kernel_ids": closed_kernel_ids,
        "cells": _cell_listing(
            cells,
            include_source_preview=include_source_preview,
            include_source=include_source,
            include_outputs=include_outputs,
            output_limit_chars=output_limit_chars,
            max_source_preview_chars=max_source_preview_chars,
            max_cells=max_cells,
        ),
        "raw": result,
    }


@mcp_activity_tool("notebook")
async def list_session_notebooks() -> dict:
    """Cuando usar: inspeccionar los notebooks/kernels vivos dentro de la sesion MCP actual.

    Prerrequisitos: ninguno; en `stateless-http` devuelve advertencia porque la sesion no persiste.
    Resultado: lista `kernel_id`, `notebook_path`, `state`, `active` y `last_execution_id` por notebook.
    Siguiente tool tipica: `execute_all_cells`, `notebook_load`, `close_session_notebook` o `shutdown_kernel`.
    """
    session_id = resolve_session_id()
    return _session_notebooks_payload(session_id=session_id)


@mcp_activity_tool("notebook")
async def notebook_sync_cells(
    notebook_path: str,
    cells: list[dict[str, Any]],
    preserve_outputs: bool = False,
) -> dict:
    """Cuando usar: sincronizar el notebook exacto deseado en una sola llamada.

    Prerrequisitos: `notebook_path` debe existir y `cells` debe describir el orden final.
    Resultado: sincroniza inserciones, borrados y reorder, reutiliza `cell_id` cuando existe
    y devuelve el listado final lightweight del notebook.
    Siguiente tool tipica: `execute_cell`, `execute_all_cells` o `notebook_save`.
    """
    bridge = InspyroBridge.get()
    normalized_path = _normalize_notebook_path(notebook_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)
    sync_summary = _prepare_synced_cells(
        notebook_payload,
        list(cells),
        preserve_outputs=preserve_outputs,
    )
    notebook_payload["cells"] = sync_summary["cells"]
    await _write_notebook(bridge, normalized_path, notebook_payload)

    kernel_id = _resolve_registered_kernel_id(normalized_path)
    resource = _build_notebook_resource(
        notebook_path=normalized_path,
        kernel_id=kernel_id,
    )
    await emit_open_resource(normalized_path, focus_view="notebook", resource=resource)
    await emit_notebook_snapshot(
        normalized_path,
        notebook_payload,
        kernel_id=kernel_id,
    )
    return {
        "status": "synced",
        "path": normalized_path,
        "kernel_id": kernel_id,
        "cell_count": len(notebook_payload.get("cells", [])),
        "created_cell_ids": sync_summary["created_cell_ids"],
        "reused_cell_ids": sync_summary["reused_cell_ids"],
        "modified_cell_ids": sync_summary["modified_cell_ids"],
        "deleted_cell_ids": sync_summary["deleted_cell_ids"],
        "cells": _cell_listing(notebook_payload.get("cells", [])),
    }


async def create_kernel(notebook_path: Optional[str] = None) -> dict:
    """Cuando usar: crear un kernel MCP sin depender de `notebook_load`.

    Prerrequisitos: opcionalmente puedes dar `notebook_path` para fijar cwd.
    Resultado: devuelve `kernel_id`, cwd efectivo y deja el kernel registrado localmente.
    Siguiente tool tipica: `attach_kernel`, `execute_cell` o `kernel_status`.
    """
    _ensure_stateful_notebook_sessions("create_kernel", notebook_path=notebook_path)
    session_id = resolve_session_id()
    bridge = _get_bridge(session_id)
    workdir = await _resolve_workdir(bridge, notebook_path)
    result = await bridge.ws_request(
        "notebook_create",
        {"path": workdir, "cwd": workdir},
        success_types={"notebook_created"},
        error_types={"notebook_error"},
        timeout=15,
    )
    kernel_id = str(result.get("kernel_id") or "")
    if not kernel_id:
        _raise_typed_error(
            "KERNEL_STATE_ERROR",
            "El backend no devolvio un kernel_id al crear el kernel.",
            retryable=True,
            operation="create_kernel",
        )
    _SESSION_STATE.register_kernel(kernel_id, notebook_path=notebook_path, state="idle")
    return {
        "status": "created",
        "kernel_id": kernel_id,
        "cwd": workdir,
        "notebook_path": _normalize_notebook_path(notebook_path) if notebook_path else None,
        "kernel_session": "created",
        "reused_kernel": False,
    }


async def attach_kernel(kernel_id: str, notebook_path: str) -> dict:
    """Cuando usar: asociar un `kernel_id` existente a un notebook en disco.

    Prerrequisitos: el notebook debe existir y `kernel_id` debe ser usable por el backend.
    Resultado: registra la sesion MCP local y expone snapshot/celdas del notebook.
    Siguiente tool tipica: `execute_cell`, `execute_all_cells` o `kernel_status`.
    """
    _ensure_stateful_notebook_sessions(
        "attach_kernel",
        kernel_id=kernel_id,
        notebook_path=notebook_path,
    )
    bridge = InspyroBridge.get()
    normalized_path = _normalize_notebook_path(notebook_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)
    _SESSION_STATE.register_notebook(kernel_id, normalized_path)
    _SESSION_STATE.set_kernel_state(kernel_id, "idle", notebook_path=normalized_path)
    await emit_open_resource(normalized_path, focus_view="notebook")
    await emit_notebook_snapshot(normalized_path, notebook_payload, kernel_id=kernel_id)
    return {
        "status": "attached",
        "kernel_id": kernel_id,
        "path": normalized_path,
        "cell_count": len(notebook_payload.get("cells", [])),
    }


@mcp_activity_tool("notebook")
async def list_cells(
    notebook_path: str,
    pattern: Optional[str] = None,
    type: Optional[str] = None,
    executed_only: bool = False,
    include_source_preview: bool = True,
    include_outputs: bool = False,
    max_source_preview_chars: int = _DEFAULT_SOURCE_PREVIEW_CHARS,
    output_limit_chars: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
    max_cells: Optional[int] = None,
) -> dict:
    """Cuando usar: inspeccionar celdas de un notebook sin cargar source completo."""
    bridge = InspyroBridge.get()
    normalized_path = _normalize_notebook_path(notebook_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)
    cells = notebook_payload.get("cells", [])
    filtered: list[dict[str, Any]] = []
    pattern_lower = pattern.lower() if pattern else None

    for index, cell in enumerate(cells):
        cell_type = str(cell.get("cell_type") or "code")
        if type and cell_type != type:
            continue
        if executed_only and cell.get("execution_count") is None:
            continue
        source_text = _source_to_text(cell.get("source", ""))
        if pattern_lower and pattern_lower not in source_text.lower():
            continue
        filtered.append(
            _serialize_cell(
                cell,
                order=index,
                include_source_preview=include_source_preview,
                include_source=False,
                include_outputs=include_outputs,
                output_limit_chars=output_limit_chars,
                max_source_preview_chars=max_source_preview_chars,
            )
        )
        if max_cells is not None and len(filtered) >= max_cells:
            break

    return {
        "status": "ok",
        "path": normalized_path,
        "cell_count": len(filtered),
        "cells": filtered,
    }


@mcp_activity_tool("notebook")
async def get_cell(
    notebook_path: str,
    cell_id: str,
    include_source: bool = True,
    include_outputs: bool = False,
    output_limit_chars: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
) -> dict:
    """Cuando usar: recuperar una celda puntual con source/outputs bajo demanda."""
    bridge = InspyroBridge.get()
    normalized_path = _normalize_notebook_path(notebook_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)
    index, cell = _find_cell(notebook_payload.get("cells", []), cell_id)
    return {
        "status": "ok",
        "path": normalized_path,
        "cell": _serialize_cell(
            cell,
            order=index,
            include_source_preview=True,
            include_source=include_source,
            include_outputs=include_outputs,
            output_limit_chars=output_limit_chars,
        ),
    }


@mcp_activity_tool("notebook")
async def find_in_notebook(
    notebook_path: str,
    pattern: str,
    regex: bool = False,
    case_sensitive: bool = False,
) -> dict:
    """Cuando usar: buscar texto o regex dentro de un notebook."""
    bridge = InspyroBridge.get()
    normalized_path = _normalize_notebook_path(notebook_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)
    cells = notebook_payload.get("cells", [])
    matches: list[dict[str, Any]] = []

    if regex:
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            compiled = re.compile(pattern, flags)
        except re.error as exc:
            _raise_typed_error(
                "INVALID_PATTERN",
                f"Regex invalido para find_in_notebook: {pattern}",
                cause=str(exc),
                notebook_path=normalized_path,
                operation="find_in_notebook",
            )
        matcher = lambda text: list(compiled.finditer(text))
    else:
        needle = pattern if case_sensitive else pattern.lower()

        def matcher(text: str) -> list[Any]:
            haystack = text if case_sensitive else text.lower()
            count = haystack.count(needle)
            return [needle] * count

    for index, cell in enumerate(cells):
        source_text = _source_to_text(cell.get("source", ""))
        found = matcher(source_text)
        if not found:
            continue
        matches.append(
            {
                "cell_id": cell.get("id"),
                "type": cell.get("cell_type", "code"),
                "order": index,
                "match_count": len(found),
                "source_preview": _source_preview(source_text),
            }
        )

    return {
        "status": "ok",
        "path": normalized_path,
        "pattern": pattern,
        "regex": regex,
        "case_sensitive": case_sensitive,
        "match_count": sum(match["match_count"] for match in matches),
        "matches": matches,
    }


async def kernel_status(kernel_id: str, *, session_id: str | None = None) -> dict:
    """Cuando usar: consultar el estado local del kernel MCP asociado a notebooks."""
    status = _SESSION_STATE.get_kernel_status(kernel_id, session_id=resolve_session_id(session_id))
    return {
        "status": "ok",
        "kernel_id": status.get("kernel_id") or kernel_id,
        "state": status.get("state", "disconnected"),
        "active": bool(status.get("active", False)),
        "path": status.get("notebook_path"),
        "updated_at": status.get("updated_at"),
        "created_at": status.get("created_at"),
        "last_execution_id": status.get("last_execution_id"),
        "last_error": status.get("last_error"),
    }


async def execution_status(
    execution_id: str,
    include_failed_outputs: bool = False,
    *,
    session_id: str | None = None,
) -> dict:
    """Cuando usar: hacer polling de una ejecucion batch o de una celda ya disparada."""
    resolved_session_id = resolve_session_id(session_id)
    execution = _SESSION_STATE.get_execution(execution_id, session_id=resolved_session_id)
    if not execution:
        _raise_typed_error(
            "EXECUTION_NOT_FOUND",
            f"Ejecucion '{execution_id}' no encontrada.",
            execution_id=execution_id,
            operation="execution_status",
        )

    task = _execution_task_registry(resolved_session_id).get(execution_id)
    task_state = "unknown"
    if task is None:
        task_state = "detached"
    elif task.cancelled():
        task_state = "cancelled"
    elif task.done():
        task_state = "completed"
    else:
        task_state = "running"

    payload = _serialize_execution_status(
        execution,
        include_failed_outputs=include_failed_outputs,
        session_id=resolved_session_id,
    )
    execution_state = payload.pop("status", "unknown")
    payload["status"] = "ok"
    payload["execution_status"] = execution_state
    payload["task_state"] = task_state
    return payload


def _resolve_execution_state_or_raise(run_id: str, *, session_id: str | None = None) -> dict[str, Any]:
    execution = _SESSION_STATE.get_execution(run_id, session_id=resolve_session_id(session_id))
    if not execution:
        _raise_typed_error(
            "EXECUTION_NOT_FOUND",
            f"Ejecucion '{run_id}' no encontrada.",
            execution_id=run_id,
            operation="get_run_status",
        )
    return execution


def _resolve_resume_cell_ids(
    execution: dict[str, Any],
    *,
    retry_failed: bool,
) -> list[str]:
    selected_cell_ids = [str(cell_id) for cell_id in execution.get("selected_cell_ids") or []]
    failed_cell_ids = {str(cell_id) for cell_id in execution.get("failed_cell_ids") or []}
    cell_statuses = execution.get("cell_statuses") or {}
    resumable: list[str] = []
    for cell_id in selected_cell_ids:
        status_payload = dict(cell_statuses.get(cell_id) or {})
        status = str(status_payload.get("status") or "pending").strip().lower()
        if status == "completed":
            continue
        if status == "failed" and not retry_failed:
            continue
        resumable.append(cell_id)
    if retry_failed:
        for cell_id in selected_cell_ids:
            if cell_id in failed_cell_ids and cell_id not in resumable:
                resumable.append(cell_id)
    return resumable


@mcp_activity_tool("notebook")
async def get_kernel_status(kernel_id: str) -> dict:
    """Cuando usar: consultar el estado operativo actual del kernel asociado al notebook."""
    session_id = _ensure_stateful_notebook_sessions("get_kernel_status", kernel_id=kernel_id)
    return await kernel_status(kernel_id, session_id=session_id)


@mcp_activity_tool("notebook")
async def get_run_status(run_id: str, include_failed_outputs: bool = False) -> dict:
    """Cuando usar: hacer polling del estado de una corrida larga expuesta por MCP."""
    session_id = _ensure_stateful_notebook_sessions("get_run_status", execution_id=run_id)
    payload = await execution_status(run_id, include_failed_outputs=include_failed_outputs, session_id=session_id)
    payload["run_id"] = run_id
    payload["execution_id"] = run_id
    return payload


@mcp_activity_tool("notebook")
async def cancel_run(run_id: str) -> dict:
    """Cuando usar: cancelar una corrida pública identificada por `run_id` sin destruir el notebook."""
    session_id = _ensure_stateful_notebook_sessions("cancel_run", execution_id=run_id)
    execution = _resolve_execution_state_or_raise(run_id, session_id=session_id)
    execution_status_value = str(execution.get("status") or "unknown")
    kernel_id = str(execution.get("kernel_id") or "").strip()
    notebook_path = execution.get("notebook_path")
    if execution_status_value in {"completed", "completed_with_errors", "failed", "cancelled"}:
        return {
            "status": "already_finished",
            "run_id": run_id,
            "execution_id": run_id,
            "kernel_id": kernel_id or None,
            "path": notebook_path,
            "execution_status": execution_status_value,
            "already_finished": True,
        }
    if not kernel_id:
        _raise_typed_error(
            "MISSING_NOTEBOOK_SESSION",
            "La corrida no tiene un `kernel_id` asociado. Recarga el notebook con `notebook_load(path)` antes de cancelar.",
            execution_id=run_id,
            notebook_path=notebook_path,
            operation="cancel_run",
        )

    target_execution_id = str(execution.get("current_child_execution_id") or run_id).strip() or run_id
    bridge = InspyroBridge.get()
    cancellation_raw = await bridge.ws_request(
        "notebook_cancel_execution",
        {
            "kernel_id": kernel_id,
            "execution_id": target_execution_id,
        },
        success_types={"notebook_execution_cancelled"},
        error_types={"notebook_error"},
        timeout=15,
    )

    task = _execution_task_registry(session_id).get(run_id)
    if task is not None and not task.done():
        task.cancel()
        with contextlib.suppress(Exception):
            await asyncio.gather(task, return_exceptions=True)

    _SESSION_STATE.upsert_execution(
        run_id,
        {
            "status": "cancelled",
            "cancellation_reason": "user_cancelled",
            "completed_at": _now_ts(),
            "current_child_execution_id": None,
        },
        session_id=session_id,
    )
    _SESSION_STATE.append_execution_event(
        run_id,
        {
            "phase": "cancelled",
            "reason": "user_cancelled",
            "requested_child_execution_id": target_execution_id,
        },
        session_id=session_id,
    )
    _SESSION_STATE.set_kernel_state(
        kernel_id,
        "idle",
        notebook_path=notebook_path,
        execution_id=run_id,
        session_id=session_id,
    )
    return {
        "status": "cancelled",
        "run_id": run_id,
        "execution_id": run_id,
        "kernel_id": kernel_id,
        "path": notebook_path,
        "requested_child_execution_id": target_execution_id,
        "raw": cancellation_raw,
    }


@mcp_activity_tool("notebook")
async def resume_run(
    run_id: str,
    retry_failed: bool = False,
    timeout_per_cell: int = _DEFAULT_CELL_TIMEOUT,
) -> dict:
    """Cuando usar: reanudar una corrida previa desde celdas pendientes o fallidas."""
    session_id = _ensure_stateful_notebook_sessions("resume_run", execution_id=run_id)
    execution = _resolve_execution_state_or_raise(run_id, session_id=session_id)
    execution_status_value = str(execution.get("status") or "unknown")
    if execution_status_value == "running":
        _raise_typed_error(
            "RUN_ALREADY_ACTIVE",
            f"La corrida '{run_id}' sigue activa. Usa `get_run_status` para polling o `cancel_run` para detenerla antes de reanudar.",
            execution_id=run_id,
            operation="resume_run",
        )

    kernel_id = str(execution.get("kernel_id") or "").strip()
    notebook_path = str(execution.get("notebook_path") or "").strip()
    kernel_state = _SESSION_STATE.get_kernel_status(kernel_id, session_id=session_id) if kernel_id else {}
    if not kernel_id or not notebook_path or kernel_state.get("state") == "disconnected":
        _raise_typed_error(
            "RUN_RESUME_REQUIRES_NOTEBOOK_LOAD",
            "El kernel original ya no esta disponible. Ejecuta `notebook_load(path)` antes de reanudar esta corrida.",
            kernel_id=kernel_id or None,
            notebook_path=notebook_path or None,
            execution_id=run_id,
            operation="resume_run",
            retryable=True,
        )

    resumable_cell_ids = _resolve_resume_cell_ids(execution, retry_failed=retry_failed)
    if not resumable_cell_ids:
        return {
            "status": "nothing_to_resume",
            "run_id": run_id,
            "execution_id": run_id,
            "kernel_id": kernel_id,
            "path": notebook_path,
            "retry_failed": retry_failed,
            "resumable_cell_ids": [],
        }

    resumed = await execute_cells(
        kernel_id=kernel_id,
        notebook_path=notebook_path,
        cell_ids=resumable_cell_ids,
        stop_on_error=False,
        timeout_per_cell=timeout_per_cell,
        background=True,
    )
    resumed["resumed_from_run_id"] = run_id
    resumed["retry_failed"] = retry_failed
    resumed["resumable_cell_ids"] = resumable_cell_ids
    return resumed


@mcp_activity_tool("notebook")
async def notebook_save(kernel_id: str, path: Optional[str] = None) -> dict:
    """Cuando usar: persistir o duplicar en disco un notebook ya gestionado por MCP.

    Prerrequisitos: `kernel_id` debe venir de `notebook_create` o `notebook_load`.
    Resultado: devuelve `path` guardado y, si aplica, `source_path`.
    Siguiente tool tipica: `execute_all_cells`, `get_document_docx` o `shutdown_kernel`.
    """
    session_id = _ensure_stateful_notebook_sessions("notebook_save", kernel_id=kernel_id, notebook_path=path)
    bridge = _get_bridge(session_id)
    source_path = _SESSION_STATE.get_notebook_path(kernel_id, session_id=session_id)
    if not source_path:
        _raise_typed_error(
            "MISSING_NOTEBOOK_SESSION",
            "No hay notebook gestionado para este kernel. Carga o crea un notebook antes de guardar.",
            kernel_id=kernel_id,
            operation="notebook_save",
        )

    target_path = _normalize_notebook_path(path or source_path)
    notebook_payload = await _read_notebook(bridge, source_path)
    if target_path != source_path:
        await _write_notebook(bridge, target_path, notebook_payload)
        _SESSION_STATE.register_notebook(kernel_id, target_path, session_id=session_id)
        resource = _build_notebook_resource(
            notebook_path=target_path,
            kernel_id=kernel_id,
        )
        await emit_open_resource(target_path, focus_view="notebook", resource=resource)
        await emit_notebook_snapshot(
            target_path,
            notebook_payload,
            kernel_id=kernel_id,
        )

    return {
        "status": "saved",
        "kernel_id": kernel_id,
        "path": target_path,
        "source_path": source_path,
    }


@mcp_activity_tool("notebook")
async def execute_cell(
    kernel_id: str,
    cell_id: str,
    source: Optional[str] = None,
    timeout: int = _DEFAULT_CELL_TIMEOUT,
    include_outputs: bool = True,
    include_variables: bool = False,
    include_source: bool = False,
    output_limit_chars: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
    include_docx: bool = True,
) -> dict:
    """Cuando usar: probar o rerunear una sola celda del notebook.

    Prerrequisitos: necesitas `kernel_id` y `cell_id`. `source` es opcional: si no se envia,
    MCP ejecuta el contenido persistido de la celda actual. Si la celda usa DOCX, la exportacion
    se detecta sola. El default de `timeout` es `600` segundos; si la celda reinicia apps externas
    o usa COM/Word/SAP2000, suele convenir subirlo a `600` o `900`.
    Resultado: devuelve estado, outputs, variables, metadata de ejecucion y artefactos DOCX/PDF si se generaron.
    Siguiente tool tipica: `get_variables`, `get_document_docx`, `get_document_pdf` o `notebook_save`.
    """
    session_id = _ensure_stateful_notebook_sessions("execute_cell", kernel_id=kernel_id)
    bridge = _get_bridge(session_id)
    execution_id = f"mcp_exec_{uuid.uuid4().hex}"
    notebook_path = _SESSION_STATE.get_notebook_path(kernel_id, session_id=session_id)
    started_at = _now_ts()
    started_perf = time.perf_counter()
    _SESSION_STATE.upsert_execution(
        execution_id,
        {
            "execution_id": execution_id,
            "kind": "execute_cell",
            "kernel_id": kernel_id,
            "notebook_path": notebook_path,
            "status": "running",
            "started_at": started_at,
            "heartbeat_at": started_at,
            "selected_cell_ids": [cell_id],
            "total_cells": 1,
            "completed_cells": 0,
            "current_child_execution_id": execution_id,
            "background": False,
        },
        session_id=session_id,
    )
    _SESSION_STATE.set_kernel_state(
        kernel_id,
        "running",
        notebook_path=notebook_path,
        execution_id=execution_id,
        session_id=session_id,
    )
    await report_progress(0, 1, f"execute_cell: starting {cell_id}")
    await log_info(f"MCP execute_cell started for {cell_id}.")
    try:
        async with _serialized_kernel_execution(kernel_id, session_id=session_id):
            resolved_source, resolved_cell_type = await _resolve_cell_source_and_type(
                bridge,
                kernel_id=kernel_id,
                cell_id=cell_id,
                source=source,
                session_id=session_id,
            )
            if not include_docx and resolved_cell_type == "docx":
                duration_ms = int((time.perf_counter() - started_perf) * 1000)
                summary = {
                    "cell_id": cell_id,
                    "status": "skipped",
                    "has_error": False,
                    "execution_count": None,
                    "output_count": 0,
                    "cell_type": resolved_cell_type,
                    "duration_ms": duration_ms,
                    "skipped_reason": "docx_disabled",
                }
                if include_source:
                    summary["source"] = resolved_source
                else:
                    summary["source_preview"] = _source_preview(resolved_source)
                execution_summary = {
                    "status": "skipped",
                    "completed_at": _now_ts(),
                    "duration_ms": duration_ms,
                    "completed_cells": 0,
                    "executed": 0,
                    "failed": 0,
                    "failed_cell_ids": [],
                    "skipped_docx_cell_ids": [cell_id],
                    "current_child_execution_id": None,
                    "artifacts": [],
                    "summary": {
                        "total_cells": 1,
                        "executed": 0,
                        "failed": 0,
                        "failed_cell_ids": [],
                        "skipped_docx_cell_ids": [cell_id],
                        "duration_ms": duration_ms,
                    },
                }
                _SESSION_STATE.update_execution_cell(
                    execution_id,
                    cell_id,
                    status="skipped",
                    result=summary,
                    duration_ms=duration_ms,
                    order=0,
                    session_id=session_id,
                )
                _SESSION_STATE.upsert_execution(
                    execution_id,
                    execution_summary,
                    session_id=session_id,
                )
                _SESSION_STATE.append_execution_event(
                    execution_id,
                    {
                        "phase": "skipped",
                        "status": "skipped",
                        "cell_id": cell_id,
                        "duration_ms": duration_ms,
                        "reason": "docx_disabled",
                    },
                    session_id=session_id,
                )
                _SESSION_STATE.set_kernel_state(
                    kernel_id,
                    "idle",
                    notebook_path=notebook_path,
                    execution_id=execution_id,
                    session_id=session_id,
                )
                await report_progress(1, 1, f"execute_cell: skipped {cell_id}")
                return {
                    "status": "skipped",
                    "run_id": execution_id,
                    "execution_id": execution_id,
                    "kernel_id": kernel_id,
                    "path": notebook_path,
                    "cell": summary,
                    "artifacts": [],
                    "skipped_docx_cell_ids": [cell_id],
                }
            cell_result = await _execute_cell_impl(
                bridge=bridge,
                kernel_id=kernel_id,
                cell_id=cell_id,
                source=resolved_source,
                timeout=timeout,
                emit_open=True,
                emit_snapshot_before_runtime=True,
                emit_docx=True if resolved_cell_type == "docx" else None,
                cell_type=resolved_cell_type,
                execution_id_override=execution_id,
                session_id=session_id,
            )
    except Exception as exc:
        duration_ms = int((time.perf_counter() - started_perf) * 1000)
        error_payload = _error_from_exception(
            exc,
            operation="execute_cell",
            kernel_id=kernel_id,
            cell_id=cell_id,
            notebook_path=notebook_path,
            execution_id=execution_id,
        )
        _SESSION_STATE.update_execution_cell(
            execution_id,
            cell_id,
            status="failed",
            duration_ms=duration_ms,
            order=0,
            session_id=session_id,
        )
        _SESSION_STATE.upsert_execution(
            execution_id,
            {
                "status": "failed",
                "completed_at": _now_ts(),
                "duration_ms": duration_ms,
                "completed_cells": 0,
                "executed": 0,
                "failed": 1,
                "failed_cell_ids": [cell_id],
                "current_child_execution_id": None,
                "error": error_payload,
                "summary": {
                    "total_cells": 1,
                    "executed": 0,
                    "failed": 1,
                    "failed_cell_ids": [cell_id],
                    "duration_ms": duration_ms,
                },
            },
            session_id=session_id,
        )
        _SESSION_STATE.append_execution_event(
            execution_id,
            {
                "phase": "failed",
                "status": "failed",
                "cell_id": cell_id,
                "duration_ms": duration_ms,
                "error": error_payload,
            },
            session_id=session_id,
        )
        _SESSION_STATE.set_kernel_state(
            kernel_id,
            "error",
            notebook_path=notebook_path,
            execution_id=execution_id,
            error=error_payload,
            session_id=session_id,
        )
        await report_progress(1, 1, f"execute_cell: failed {cell_id}")
        raise

    duration_ms = int((time.perf_counter() - started_perf) * 1000)
    summary = _summarize_execution_result(
        cell_result,
        cell_id=cell_id,
        source=resolved_source,
        include_outputs=include_outputs,
        include_variables=include_variables,
        include_source=include_source,
        output_limit_chars=output_limit_chars,
    )
    summary["duration_ms"] = duration_ms
    execution_summary = {
        "status": "failed" if cell_result.get("has_error") else "completed",
        "completed_at": _now_ts(),
        "duration_ms": duration_ms,
        "completed_cells": 1,
        "executed": 0 if cell_result.get("has_error") else 1,
        "failed": 1 if cell_result.get("has_error") else 0,
        "failed_cell_ids": [cell_id] if cell_result.get("has_error") else [],
        "current_child_execution_id": None,
        "artifacts": summary.get("artifacts", []),
        "error": cell_result.get("error"),
        "summary": {
            "total_cells": 1,
            "executed": 0 if cell_result.get("has_error") else 1,
            "failed": 1 if cell_result.get("has_error") else 0,
            "failed_cell_ids": [cell_id] if cell_result.get("has_error") else [],
            "duration_ms": duration_ms,
        },
    }
    _apply_recovery_fields(cell_result, execution_summary)
    _SESSION_STATE.update_execution_cell(
        execution_id,
        cell_id,
        status="failed" if cell_result.get("has_error") else "completed",
        result=summary,
        duration_ms=duration_ms,
        order=0,
        session_id=session_id,
    )
    _SESSION_STATE.upsert_execution(
        execution_id,
        execution_summary,
        session_id=session_id,
    )
    _SESSION_STATE.append_execution_event(
        execution_id,
        {
            "phase": "completed",
            "status": "failed" if cell_result.get("has_error") else "completed",
            "cell_id": cell_id,
            "duration_ms": duration_ms,
        },
        session_id=session_id,
    )
    _SESSION_STATE.set_kernel_state(
        kernel_id,
        "idle",
        notebook_path=notebook_path,
        execution_id=execution_id,
        error=cell_result.get("error") if cell_result.get("has_error") else None,
        session_id=session_id,
    )
    await report_progress(1, 1, f"execute_cell: completed {cell_id}")
    response = {
        "status": str(cell_result.get("status") or "error"),
        "run_id": execution_id,
        "execution_id": execution_id,
        "kernel_id": kernel_id,
        "path": cell_result.get("path"),
        "cell": summary,
        "artifacts": summary.get("artifacts", []),
        "error": cell_result.get("error"),
    }
    return _apply_recovery_fields(cell_result, response)


@mcp_activity_tool("notebook")
async def execute_all_cells(
    kernel_id: str,
    notebook_path: str,
    cell_ids: Optional[list[str]] = None,
    return_outputs_for: Optional[list[str]] = None,
    timeout_per_cell: int = _DEFAULT_CELL_TIMEOUT,
    include_outputs: bool = False,
    include_variables: bool = False,
    include_source: bool = False,
    output_limit_chars: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
    max_cells: Optional[int] = None,
    background: bool = False,
    include_docx: bool = True,
) -> dict:
    """Cuando usar: materializar un notebook completo o un subconjunto de sus celdas.

    Prerrequisitos: necesitas `kernel_id` valido y `notebook_path` persistido. El default de `timeout_per_cell` es `600` segundos; si el batch contiene celdas largas, reinicios de apps externas o automatizacion COM, para SAP2000/Word pesado suele convenir `600` o `900`.
    Resultado: con `background=false` devuelve estado global, cantidad ejecutada/fallida y outputs por `cell_id` cuando se solicitan; con `background=true` devuelve rapido `status="started"` + `run_id`.
    Siguiente tool tipica: `get_run_status`, `resume_run`, `cancel_run`, `notebook_save`, `get_document_docx`, `get_document_pdf` o `shutdown_kernel`.
    """
    session_id = _ensure_stateful_notebook_sessions(
        "execute_all_cells",
        kernel_id=kernel_id,
        notebook_path=notebook_path,
    )
    bridge = _get_bridge(session_id)
    normalized_path = _normalize_notebook_path(notebook_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)
    _SESSION_STATE.register_notebook(kernel_id, normalized_path, session_id=session_id)
    await emit_open_resource(
        normalized_path,
        focus_view="notebook",
        resource=_build_notebook_resource(
            notebook_path=normalized_path,
            kernel_id=kernel_id,
        ),
    )
    selected_cells = _select_code_cells(
        notebook_payload.get("cells", []),
        cell_ids=cell_ids,
        max_cells=max_cells,
        include_docx=include_docx,
    )
    skipped_docx_cell_ids = [] if include_docx else _collect_skipped_docx_cell_ids(
        notebook_payload.get("cells", []),
        cell_ids=cell_ids,
        max_cells=max_cells,
    )
    execution_id = f"mcp_batch_{uuid.uuid4().hex}"

    async def _runner() -> dict[str, Any]:
        async with _serialized_kernel_execution(kernel_id, session_id=session_id):
            result = await _run_batch_execution(
                bridge=bridge,
                kernel_id=kernel_id,
                notebook_path=normalized_path,
                selected_cells=selected_cells,
                timeout_per_cell=timeout_per_cell,
                execution_id=execution_id,
                include_outputs=include_outputs,
                include_variables=include_variables,
                include_source=include_source,
                output_limit_chars=output_limit_chars,
                return_outputs_for=return_outputs_for,
                stop_on_error=False,
                operation="execute_all_cells",
                background=background,
                skipped_docx_cell_ids=skipped_docx_cell_ids,
                session_id=session_id,
            )
        return {
            "status": result["status"],
            "run_id": execution_id,
            "execution_id": execution_id,
            "path": normalized_path,
            "kernel_id": kernel_id,
            "total_cells": result["total_cells"],
            "executed": result["executed"],
            "failed": result["failed"],
            "failed_cell_ids": result["failed_cell_ids"],
            "skipped_docx_cell_ids": skipped_docx_cell_ids,
            "duration_ms": result["duration_ms"],
            "outputs": result["cell_results"],
            "artifacts": result.get("artifacts", []),
            "child_execution_id": result.get("child_execution_id"),
            "summary": {
                "executed": result["executed"],
                "failed": result["failed"],
                "failed_cell_ids": result["failed_cell_ids"],
                "skipped_docx_cell_ids": skipped_docx_cell_ids,
                "duration_ms": result["duration_ms"],
            },
        }

    if background:
        _SESSION_STATE.upsert_execution(
            execution_id,
            {
                "execution_id": execution_id,
                "kind": "execute_all_cells",
                "kernel_id": kernel_id,
                "notebook_path": normalized_path,
                "status": "running",
                "started_at": _now_ts(),
                "heartbeat_at": _now_ts(),
                "selected_cell_ids": [str(cell.get("id") or "") for cell in selected_cells],
                "skipped_docx_cell_ids": skipped_docx_cell_ids,
                "total_cells": len(selected_cells),
                "completed_cells": 0,
                "background": True,
            },
        )
        task = asyncio.create_task(_runner())
        _track_execution_task(execution_id, task, session_id=session_id)
        return {
            "status": "started",
            "run_id": execution_id,
            "execution_id": execution_id,
            "path": normalized_path,
            "kernel_id": kernel_id,
            "total_cells": len(selected_cells),
            "skipped_docx_cell_ids": skipped_docx_cell_ids,
        }

    return await _runner()


async def execute_cells(
    kernel_id: str,
    notebook_path: str,
    cell_ids: list[str],
    stop_on_error: bool = True,
    timeout_per_cell: int = _DEFAULT_CELL_TIMEOUT,
    include_outputs: bool = False,
    include_variables: bool = False,
    include_source: bool = False,
    output_limit_chars: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
    background: bool = False,
) -> dict:
    """Cuando usar: ejecutar solo una lista explicita de celdas en orden notebook.

    Prerrequisitos: necesitas `kernel_id`, `notebook_path` y `cell_ids` validos. El default de `timeout_per_cell` es `600` segundos; si alguna celda reinicia apps externas o usa COM/Word/SAP2000, `600` o `900` puede ser razonable en esos casos.
    Resultado: devuelve estado global, celdas ejecutadas/fallidas y outputs cuando se solicitan.
    Siguiente tool tipica: `execution_status`, `notebook_save` o `get_document_docx`.
    """
    session_id = _ensure_stateful_notebook_sessions(
        "execute_cells",
        kernel_id=kernel_id,
        notebook_path=notebook_path,
    )
    bridge = _get_bridge(session_id)
    normalized_path = _normalize_notebook_path(notebook_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)
    _SESSION_STATE.register_notebook(kernel_id, normalized_path, session_id=session_id)
    await emit_open_resource(
        normalized_path,
        focus_view="notebook",
        resource=_build_notebook_resource(
            notebook_path=normalized_path,
            kernel_id=kernel_id,
        ),
    )
    selected_cells = _select_code_cells(
        notebook_payload.get("cells", []),
        cell_ids=cell_ids,
    )
    execution_id = f"mcp_batch_{uuid.uuid4().hex}"

    async def _runner() -> dict[str, Any]:
        async with _serialized_kernel_execution(kernel_id, session_id=session_id):
            result = await _run_batch_execution(
                bridge=bridge,
                kernel_id=kernel_id,
                notebook_path=normalized_path,
                selected_cells=selected_cells,
                timeout_per_cell=timeout_per_cell,
                execution_id=execution_id,
                include_outputs=include_outputs,
                include_variables=include_variables,
                include_source=include_source,
                output_limit_chars=output_limit_chars,
                return_outputs_for=list(cell_ids),
                stop_on_error=stop_on_error,
                operation="execute_cells",
                background=background,
                session_id=session_id,
            )
        return {
            "status": result["status"],
            "run_id": execution_id,
            "execution_id": execution_id,
            "path": normalized_path,
            "kernel_id": kernel_id,
            "total_cells": result["total_cells"],
            "executed": result["executed"],
            "failed": result["failed"],
            "failed_cell_ids": result["failed_cell_ids"],
            "duration_ms": result["duration_ms"],
            "outputs": result["cell_results"],
            "artifacts": result.get("artifacts", []),
            "child_execution_id": result.get("child_execution_id"),
            "summary": {
                "executed": result["executed"],
                "failed": result["failed"],
                "failed_cell_ids": result["failed_cell_ids"],
                "duration_ms": result["duration_ms"],
            },
        }

    if background:
        _SESSION_STATE.upsert_execution(
            execution_id,
            {
                "execution_id": execution_id,
                "kind": "execute_cells",
                "kernel_id": kernel_id,
                "notebook_path": normalized_path,
                "status": "running",
                "started_at": _now_ts(),
                "heartbeat_at": _now_ts(),
                "selected_cell_ids": [str(cell.get("id") or "") for cell in selected_cells],
                "total_cells": len(selected_cells),
                "completed_cells": 0,
                "background": True,
            },
        )
        task = asyncio.create_task(_runner())
        _track_execution_task(execution_id, task, session_id=session_id)
        return {
            "status": "started",
            "run_id": execution_id,
            "execution_id": execution_id,
            "path": normalized_path,
            "kernel_id": kernel_id,
            "total_cells": len(selected_cells),
        }

    return await _runner()


async def execute_until(
    kernel_id: str,
    notebook_path: str,
    cell_id: str,
    stop_on_error: bool = True,
    timeout_per_cell: int = _DEFAULT_CELL_TIMEOUT,
    include_outputs: bool = False,
    include_variables: bool = False,
    include_source: bool = False,
    output_limit_chars: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
    background: bool = False,
) -> dict:
    """Cuando usar: ejecutar celdas de arriba hacia abajo hasta una celda objetivo inclusive.

    Prerrequisitos: necesitas `kernel_id`, `notebook_path` y `cell_id` objetivo valido. El default de `timeout_per_cell` es `600` segundos; ajustalo si el tramo incluye celdas largas, reinicios de apps externas o automatizacion COM/Word/SAP2000.
    Resultado: devuelve estado global, celdas ejecutadas/fallidas y outputs cuando se solicitan.
    Siguiente tool tipica: `execution_status`, `notebook_save` o `get_document_pdf`.
    """
    session_id = _ensure_stateful_notebook_sessions(
        "execute_until",
        kernel_id=kernel_id,
        notebook_path=notebook_path,
    )
    bridge = _get_bridge(session_id)
    normalized_path = _normalize_notebook_path(notebook_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)
    _SESSION_STATE.register_notebook(kernel_id, normalized_path, session_id=session_id)
    await emit_open_resource(
        normalized_path,
        focus_view="notebook",
        resource=_build_notebook_resource(
            notebook_path=normalized_path,
            kernel_id=kernel_id,
        ),
    )
    selected_cells = _select_code_cells(
        notebook_payload.get("cells", []),
        until_cell_id=cell_id,
    )
    execution_id = f"mcp_batch_{uuid.uuid4().hex}"

    async def _runner() -> dict[str, Any]:
        async with _serialized_kernel_execution(kernel_id, session_id=session_id):
            result = await _run_batch_execution(
                bridge=bridge,
                kernel_id=kernel_id,
                notebook_path=normalized_path,
                selected_cells=selected_cells,
                timeout_per_cell=timeout_per_cell,
                execution_id=execution_id,
                include_outputs=include_outputs,
                include_variables=include_variables,
                include_source=include_source,
                output_limit_chars=output_limit_chars,
                return_outputs_for=[str(cell.get("id") or "") for cell in selected_cells],
                stop_on_error=stop_on_error,
                operation="execute_until",
                background=background,
                session_id=session_id,
            )
        return {
            "status": result["status"],
            "run_id": execution_id,
            "execution_id": execution_id,
            "path": normalized_path,
            "kernel_id": kernel_id,
            "total_cells": result["total_cells"],
            "executed": result["executed"],
            "failed": result["failed"],
            "failed_cell_ids": result["failed_cell_ids"],
            "duration_ms": result["duration_ms"],
            "outputs": result["cell_results"],
            "artifacts": result.get("artifacts", []),
            "child_execution_id": result.get("child_execution_id"),
            "summary": {
                "executed": result["executed"],
                "failed": result["failed"],
                "failed_cell_ids": result["failed_cell_ids"],
                "duration_ms": result["duration_ms"],
            },
        }

    if background:
        _SESSION_STATE.upsert_execution(
            execution_id,
            {
                "execution_id": execution_id,
                "kind": "execute_until",
                "kernel_id": kernel_id,
                "notebook_path": normalized_path,
                "status": "running",
                "started_at": _now_ts(),
                "heartbeat_at": _now_ts(),
                "selected_cell_ids": [str(cell.get("id") or "") for cell in selected_cells],
                "total_cells": len(selected_cells),
                "completed_cells": 0,
                "background": True,
            },
        )
        task = asyncio.create_task(_runner())
        _track_execution_task(execution_id, task, session_id=session_id)
        return {
            "status": "started",
            "run_id": execution_id,
            "execution_id": execution_id,
            "path": normalized_path,
            "kernel_id": kernel_id,
            "total_cells": len(selected_cells),
        }

    return await _runner()


async def add_cell(
    notebook_path: str,
    source: str,
    cell_type: str = "code",
    position: int = -1,
) -> dict:
    """Cuando usar: insertar una celda nueva en un notebook ya existente.

    Prerrequisitos: `notebook_path` debe existir; `cell_type` suele ser `code`, `markdown` o `docx`.
    Resultado: devuelve `cell_id`, posicion resuelta y total de celdas.
    Siguiente tool tipica: `edit_cell`, `move_cell` o `execute_cell`.
    """
    bridge = InspyroBridge.get()
    normalized_path = _normalize_notebook_path(notebook_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)

    cell_id = str(uuid.uuid4())[:8]
    resolved_cell_type = _normalize_cell_type(cell_type)
    new_cell: dict[str, Any] = {
        "id": cell_id,
        "cell_type": resolved_cell_type,
        "source": _source_to_text(source),
        "metadata": {},
    }
    if resolved_cell_type in _RUNNABLE_CELL_TYPES:
        new_cell["outputs"] = []
        new_cell["execution_count"] = None

    cells = notebook_payload.get("cells", [])
    if position < 0 or position >= len(cells):
        cells.append(new_cell)
        resolved_position = len(cells) - 1
    else:
        cells.insert(position, new_cell)
        resolved_position = position

    notebook_payload["cells"] = cells
    await _write_notebook(bridge, normalized_path, notebook_payload)
    kernel_id = _resolve_registered_kernel_id(normalized_path, session_id=session_id)
    resource = _build_notebook_resource(
        notebook_path=normalized_path,
        kernel_id=kernel_id,
        cell_id=cell_id,
    )
    await emit_open_resource(normalized_path, focus_view="notebook", resource=resource)
    await emit_notebook_snapshot(
        normalized_path,
        notebook_payload,
        kernel_id=kernel_id,
        focus_cell_id=cell_id,
    )

    return {
        "status": "added",
        "path": normalized_path,
        "cell_id": cell_id,
        "cell_type": cell_type,
        "position": resolved_position,
        "total_cells": len(cells),
    }


async def delete_cell(notebook_path: str, cell_id: str) -> dict:
    """Cuando usar: quitar una celda especifica del notebook.

    Prerrequisitos: `notebook_path` debe existir y `cell_id` debe ser vigente.
    Resultado: devuelve confirmacion, `cell_id` eliminado y nuevo total de celdas.
    Siguiente tool tipica: `add_cell`, `notebook_save` o `execute_all_cells`.
    """
    bridge = InspyroBridge.get()
    normalized_path = _normalize_notebook_path(notebook_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)

    cells = notebook_payload.get("cells", [])
    deleted_index, _ = _find_cell(cells, cell_id)
    notebook_payload["cells"] = [cell for cell in cells if cell.get("id") != cell_id]

    await _write_notebook(bridge, normalized_path, notebook_payload)
    kernel_id = _resolve_registered_kernel_id(normalized_path)
    resource = _build_notebook_resource(
        notebook_path=normalized_path,
        kernel_id=kernel_id,
        cell_id=cell_id,
    )
    await emit_open_resource(normalized_path, focus_view="notebook", resource=resource)
    next_focus_id = None
    remaining_cells = notebook_payload["cells"]
    if remaining_cells:
        next_focus_index = min(deleted_index, len(remaining_cells) - 1)
        next_focus_id = remaining_cells[next_focus_index].get("id")
    await emit_notebook_snapshot(
        normalized_path,
        notebook_payload,
        kernel_id=kernel_id,
        focus_cell_id=next_focus_id,
    )
    return {
        "status": "deleted",
        "path": normalized_path,
        "cell_id": cell_id,
        "total_cells": len(notebook_payload["cells"]),
    }


async def edit_cell(notebook_path: str, cell_id: str, source: str) -> dict:
    """Cuando usar: reemplazar por completo el contenido de una celda existente.

    Prerrequisitos: `notebook_path` y `cell_id` deben corresponder al notebook actual.
    Resultado: devuelve confirmacion y conserva el notebook listo para ejecutar.
    Siguiente tool tipica: `execute_cell`, `execute_all_cells` o `notebook_save`.
    """
    bridge = InspyroBridge.get()
    normalized_path = _normalize_notebook_path(notebook_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)

    _, cell = _find_cell(notebook_payload.get("cells", []), cell_id)
    cell["source"] = _source_to_text(source)
    await _write_notebook(bridge, normalized_path, notebook_payload)
    kernel_id = _resolve_registered_kernel_id(normalized_path)
    resource = _build_notebook_resource(
        notebook_path=normalized_path,
        kernel_id=kernel_id,
        cell_id=cell_id,
    )
    await emit_open_resource(normalized_path, focus_view="notebook", resource=resource)
    await emit_notebook_snapshot(
        normalized_path,
        notebook_payload,
        kernel_id=kernel_id,
        focus_cell_id=cell_id,
    )

    return {"status": "edited", "path": normalized_path, "cell_id": cell_id}


async def move_cell(
    kernel_id: str,
    cell_id: str,
    position: int,
    notebook_path: Optional[str] = None,
) -> dict:
    """Cuando usar: cambiar el orden de una celda y mantenerlo sincronizado en runtime.

    Prerrequisitos: `kernel_id` debe estar asociado al notebook o debes proveer `notebook_path`.
    Resultado: devuelve posicion previa/nueva y deja el orden persistido y reflejado en runtime.
    Siguiente tool tipica: `execute_all_cells` o `notebook_save`.
    """
    bridge = InspyroBridge.get()
    resolved_path = notebook_path or _SESSION_STATE.get_notebook_path(kernel_id)
    if not resolved_path:
        _raise_typed_error(
            "MISSING_NOTEBOOK_SESSION",
            "No hay notebook gestionado para este kernel. Provee notebook_path o carga el notebook primero.",
            kernel_id=kernel_id,
            operation="move_cell",
        )

    normalized_path = _normalize_notebook_path(resolved_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)
    cells = notebook_payload.get("cells", [])
    current_index, cell = _find_cell(cells, cell_id)

    moved_cell = cells.pop(current_index)
    bounded_position = max(0, min(position, len(cells)))
    cells.insert(bounded_position, moved_cell)
    notebook_payload["cells"] = cells
    await _write_notebook(bridge, normalized_path, notebook_payload)

    result = await bridge.ws_request(
        "notebook_set_order",
        {
            "kernel_id": kernel_id,
            "order": [cell_data.get("id") for cell_data in cells],
        },
        success_types={"notebook_order_set"},
        error_types={"notebook_error"},
        timeout=30,
    )
    resource = _build_notebook_resource(
        notebook_path=normalized_path,
        kernel_id=kernel_id,
        cell_id=cell_id,
    )
    await emit_open_resource(normalized_path, focus_view="notebook", resource=resource)
    await emit_notebook_snapshot(
        normalized_path,
        notebook_payload,
        kernel_id=kernel_id,
        focus_cell_id=cell_id,
    )
    await _emit_artifact_updates({"raw": result}, resource=resource)

    return {
        "status": "moved",
        "path": normalized_path,
        "cell_id": cell_id,
        "previous_position": current_index,
        "new_position": bounded_position,
    }


async def _hard_reset_kernel_session(
    bridge: InspyroBridge,
    *,
    kernel_id: str,
    notebook_path: str,
) -> dict[str, Any]:
    normalized_path = _normalize_notebook_path(notebook_path)
    notebook_payload = await _read_notebook(bridge, normalized_path)
    kernel_load_payload = _strip_notebook_runtime_state(notebook_payload)
    load_requests = [
        {
            "path": normalized_path,
            "content": kernel_load_payload,
            "previous_kernel_id": kernel_id,
        },
        {
            "path": normalized_path,
            "content": kernel_load_payload,
        },
    ]
    result: dict[str, Any] | None = None
    last_exc: Exception | None = None
    for index, load_request in enumerate(load_requests):
        try:
            result = await bridge.ws_request(
                "notebook_load",
                load_request,
                success_types={"notebook_loaded"},
                error_types={"notebook_error"},
                timeout=_DEFAULT_RESET_TIMEOUT,
            )
            break
        except Exception as exc:
            last_exc = exc
            should_retry_without_previous = (
                index == 0
                and isinstance(exc, TimeoutError)
                and bool(load_request.get("previous_kernel_id"))
            )
            if not should_retry_without_previous:
                raise
            logger.warning(
                "Hard reset notebook_load timed out while recycling kernel %s; retrying without previous_kernel_id",
                kernel_id,
            )
    if result is None:
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("Hard reset notebook_load did not return a result.")
    new_kernel_id = str(result.get("kernel_id") or "")
    if not new_kernel_id:
        _raise_typed_error(
            "KERNEL_RESET_FAILED",
            "El backend no devolvio un kernel_id al reconstruir la sesion del notebook.",
            kernel_id=kernel_id,
            notebook_path=normalized_path,
            operation="reset_kernel",
            retryable=True,
        )
    if new_kernel_id != kernel_id:
        _SESSION_STATE.unregister_kernel(kernel_id)
        _drop_kernel_execution_lock(kernel_id)
    _SESSION_STATE.register_notebook(new_kernel_id, normalized_path)
    _SESSION_STATE.set_kernel_state(new_kernel_id, "idle", notebook_path=normalized_path)
    loaded_notebook = result.get("notebook") or kernel_load_payload
    await emit_open_resource(
        normalized_path,
        focus_view="notebook",
        resource=_build_notebook_resource(
            notebook_path=normalized_path,
            kernel_id=new_kernel_id,
        ),
    )
    await emit_notebook_snapshot(
        normalized_path,
        loaded_notebook,
        kernel_id=new_kernel_id,
    )
    return {
        "status": "reset",
        "kernel_id": new_kernel_id,
        "previous_kernel_id": kernel_id,
        "path": normalized_path,
        "hard": True,
        "kernel_session": "recreated",
        "reused_kernel": new_kernel_id == kernel_id,
    }


async def _shutdown_kernel_impl(kernel_id: str, *, session_id: str | None = None) -> dict[str, Any]:
    resolved_session_id = resolve_session_id(session_id)
    bridge = _get_bridge(resolved_session_id)
    notebook_path = _SESSION_STATE.get_notebook_path(kernel_id, session_id=resolved_session_id)
    await _cancel_kernel_runtime_tasks(kernel_id, session_id=resolved_session_id)
    result = await bridge.ws_request(
        "notebook_shutdown_kernel",
        {"kernel_id": kernel_id},
        success_types={"notebook_kernel_shutdown"},
        error_types={"notebook_error"},
        timeout=30,
    )
    await _emit_kernel_runtime_message(
        "notebook_kernel_shutdown",
        kernel_id=kernel_id,
        notebook_path=notebook_path,
    )
    _SESSION_STATE.unregister_kernel(kernel_id, session_id=resolved_session_id)
    _drop_kernel_execution_lock(kernel_id, session_id=resolved_session_id)
    return {"status": "shutdown", "kernel_id": kernel_id, "path": notebook_path, "raw": result}


@mcp_activity_tool("notebook")
async def reset_kernel(kernel_id: str, hard: bool = False) -> dict:
    """Cuando usar: limpiar el estado runtime completo de un notebook.

    Prerrequisitos: `kernel_id` valido.
    Resultado: devuelve confirmacion de reinicio.
    Siguiente tool tipica: `execute_cell`, `execute_all_cells` o `notebook_load`.
    """
    session_id = _ensure_stateful_notebook_sessions("reset_kernel", kernel_id=kernel_id)
    bridge = _get_bridge(session_id)
    notebook_path = _SESSION_STATE.get_notebook_path(kernel_id, session_id=session_id)
    current_status = _SESSION_STATE.get_kernel_status(kernel_id, session_id=session_id)
    if current_status.get("state") == "disconnected":
        return {
            "status": "reset",
            "kernel_id": kernel_id,
            "path": notebook_path,
            "hard": hard,
            "idempotent": True,
            "kernel_session": "disconnected",
            "reused_kernel": False,
        }

    await _cancel_kernel_runtime_tasks(kernel_id, session_id=session_id)

    if hard and notebook_path:
        return await _hard_reset_kernel_session(
            bridge,
            kernel_id=kernel_id,
            notebook_path=notebook_path,
        )

    try:
        result = await bridge.ws_request(
            "notebook_reset_kernel",
            {"kernel_id": kernel_id},
            success_types={"notebook_kernel_reset"},
            error_types={"notebook_error"},
            timeout=_DEFAULT_RESET_TIMEOUT,
        )
    except Exception as exc:
        if notebook_path and (isinstance(exc, TimeoutError) or _should_attempt_hard_reset(exc)):
            return await _hard_reset_kernel_session(
                bridge,
                kernel_id=kernel_id,
                notebook_path=notebook_path,
            )
        error_payload = _error_from_exception(
            exc,
            operation="reset_kernel",
            kernel_id=kernel_id,
            notebook_path=notebook_path,
        )
        _SESSION_STATE.set_kernel_state(
            kernel_id,
            "error",
            notebook_path=notebook_path,
            error=error_payload,
            session_id=session_id,
        )
        _raise_typed_error(
            "KERNEL_RESET_FAILED",
            f"No se pudo resetear el kernel '{kernel_id}'.",
            cause=error_payload.get("message"),
            retryable=bool(error_payload.get("retryable")),
            kernel_id=kernel_id,
            notebook_path=notebook_path,
            operation="reset_kernel",
            extra={"backend_error": error_payload},
        )

    _SESSION_STATE.set_kernel_state(
        kernel_id,
        "idle",
        notebook_path=notebook_path,
        execution_id=current_status.get("last_execution_id"),
        session_id=session_id,
    )
    await _emit_kernel_runtime_message(
        "notebook_kernel_reset",
        kernel_id=kernel_id,
        notebook_path=notebook_path,
        execution_id=current_status.get("last_execution_id"),
    )
    return {
        "status": "reset",
        "kernel_id": kernel_id,
        "path": notebook_path,
        "hard": False,
        "kernel_session": "reused",
        "reused_kernel": True,
        "raw": result,
    }


@mcp_activity_tool("notebook")
async def interrupt_kernel(kernel_id: str) -> dict:
    """Cuando usar: cortar una ejecucion larga sin destruir la sesion notebook.

    Prerrequisitos: `kernel_id` valido y una ejecucion potencialmente en curso.
    Resultado: devuelve confirmacion de interrupcion.
    Siguiente tool tipica: `execute_cell`, `execute_all_cells` o `reset_kernel`.
    """
    session_id = _ensure_stateful_notebook_sessions("interrupt_kernel", kernel_id=kernel_id)
    bridge = _get_bridge(session_id)
    notebook_path = _SESSION_STATE.get_notebook_path(kernel_id, session_id=session_id)
    current_status = _SESSION_STATE.get_kernel_status(kernel_id, session_id=session_id)
    execution_id = str(current_status.get("last_execution_id") or "").strip() or None
    result = await bridge.ws_request(
        "notebook_interrupt_kernel",
        {"kernel_id": kernel_id},
        success_types={"notebook_kernel_interrupted"},
        error_types={"notebook_error"},
        timeout=10,
    )
    if execution_id:
        _SESSION_STATE.upsert_execution(
            execution_id,
            {
                "status": "cancelled",
                "cancellation_reason": "user_cancelled",
                "completed_at": _now_ts(),
            },
            session_id=session_id,
        )
        _SESSION_STATE.append_execution_event(
            execution_id,
            {
                "phase": "cancelled",
                "reason": "user_cancelled",
            },
            session_id=session_id,
        )
    _SESSION_STATE.set_kernel_state(
        kernel_id,
        "idle",
        notebook_path=notebook_path,
        execution_id=execution_id,
        session_id=session_id,
    )
    await _emit_kernel_runtime_message(
        "notebook_kernel_interrupted",
        kernel_id=kernel_id,
        notebook_path=notebook_path,
        execution_id=execution_id,
    )
    return {"status": "interrupted", "kernel_id": kernel_id, "path": notebook_path, "raw": result}


@mcp_activity_tool("notebook")
async def shutdown_kernel(kernel_id: str) -> dict:
    """Cuando usar: cerrar una sesion notebook gestionada por MCP.

    Prerrequisitos: `kernel_id` valido.
    Resultado: devuelve confirmacion y elimina el estado MCP asociado a ese kernel.
    Siguiente tool tipica: `notebook_load` o `notebook_create` si quieres reanudar trabajo.
    """
    session_id = _ensure_stateful_notebook_sessions("shutdown_kernel", kernel_id=kernel_id)
    return await _shutdown_kernel_impl(kernel_id, session_id=session_id)


@mcp_activity_tool("notebook")
async def close_session_notebook(kernel_id: str) -> dict:
    """Cuando usar: cerrar explicitamente un notebook vivo dentro de la sesion MCP actual.

    Prerrequisitos: `kernel_id` debe existir en la sesion MCP actual.
    Resultado: cierra el kernel, limpia el registro local y devuelve confirmacion compacta.
    Siguiente tool tipica: `list_session_notebooks`, `notebook_load` o `notebook_create`.
    """
    session_id = _ensure_stateful_notebook_sessions("close_session_notebook", kernel_id=kernel_id)
    result = await _shutdown_kernel_impl(kernel_id, session_id=session_id)
    result["status"] = "closed"
    result["shutdown_status"] = "shutdown"
    return result


@mcp_activity_tool("notebook")
async def get_variables(
    kernel_id: str,
    cell_id: str,
    source: str = "",
    include_runtime: bool = False,
    output_limit_chars: int = _DEFAULT_OUTPUT_LIMIT_CHARS,
) -> dict:
    """Cuando usar: inspeccionar variables visibles del kernel sin depender del frontend.

    Prerrequisitos: `kernel_id` y `cell_id` validos; `source` es opcional y puede ser minimo.
    Resultado: devuelve `variables` observadas y metadata cruda de la captura.
    Siguiente tool tipica: `edit_cell`, `execute_cell` o una tool de analisis.
    """
    session_id = _ensure_stateful_notebook_sessions("get_variables", kernel_id=kernel_id)
    bridge = _get_bridge(session_id)
    async with _serialized_kernel_execution(kernel_id, session_id=session_id):
        _, execution_result = await _execute_cell_request(
            bridge,
            kernel_id=kernel_id,
            cell_id=cell_id,
            source=_source_to_text(source) or "pass  # variable capture",
            timeout=15,
            session_id=session_id,
        )
    return {
        "status": "ok" if not execution_result.get("has_error") else "error",
        "kernel_id": kernel_id,
        "cell_id": cell_id,
        "variables": _filter_variables(
            execution_result.get("variables", {}) or {},
            include_runtime=include_runtime,
            limit=output_limit_chars,
        ),
        "raw": execution_result.get("raw", {}),
        "error": execution_result.get("error"),
    }
