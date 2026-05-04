"""Session-scoped MCP state for notebook sessions and artifacts."""

from __future__ import annotations

import copy
import json
import os
import threading
import time
from typing import Any, Optional

from .runtime import resolve_session_id

_ARTIFACT_FIELDS = {
    "docx_file_b64",
    "docx_file_token",
    "docx_artifact_id",
    "docx_download_url",
    "docx_ref",
    "docx_file_name",
    "docx_size_bytes",
    "docx_inline",
    "docx_store_error",
    "docx_hash",
    "docx_binary_hash",
    "docx_warnings",
    "docx_error",
    "pdf_file_b64",
    "pdf_file_token",
    "pdf_ref",
    "pdf_file_name",
    "pdf_size_bytes",
    "pdf_inline",
    "pdf_store_error",
    "pdf_hash",
    "pdf_from_cache",
    "pdf_attempted",
    "pdf_converting",
    "pdf_conversion_error",
    "pdf_conversion_error_kind",
    "pdf_conversion_stdout",
    "pdf_conversion_stderr",
    "pdf_conversion_ms",
    "status",
    "message",
}

_RUNTIME_EVIDENCE_MESSAGE_TYPES = {
    "notebook_stream",
    "notebook_execute_result",
    "notebook_display_data",
    "notebook_update_display_data",
    "notebook_clear_output",
    "notebook_progress_update",
    "notebook_docx_update",
    "notebook_pdf_ready",
    "notebook_cell_executed",
    "notebook_cell_error",
    "notebook_error",
}

_TERMINAL_RUNTIME_MESSAGE_TYPES = {
    "notebook_cell_executed",
    "notebook_cell_error",
    "notebook_error",
}

_BINARY_RUNTIME_FIELDS = {
    "docx_file_b64",
    "pdf_file_b64",
}

_OUTPUT_PREVIEW_LIMIT = 240


def _normalize_path(path: str) -> str:
    return os.path.normcase(os.path.abspath(os.path.expanduser(path)))


def _normalize_key(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _copy_runtime_message(message: dict[str, Any]) -> dict[str, Any]:
    payload = copy.deepcopy(message)
    for field in _BINARY_RUNTIME_FIELDS:
        payload.pop(field, None)
    return payload


def _truncate_text(value: Any, limit: int = _OUTPUT_PREVIEW_LIMIT) -> str:
    text = str(value or "")
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 3)].rstrip()}..."


def _compact_json(value: Any, limit: int = _OUTPUT_PREVIEW_LIMIT) -> str:
    try:
        serialized = json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        serialized = repr(value)
    return _truncate_text(serialized, limit)


def _extract_output_preview(message: dict[str, Any]) -> tuple[str | None, str | None]:
    message_type = str(message.get("type") or "")
    if message_type == "notebook_clear_output":
        return "", "clear_output"
    if message_type == "notebook_stream":
        content = message.get("content") or {}
        text = content.get("text")
        if text is None:
            text = message.get("text", "")
        preview = _truncate_text(text)
        return preview, "stream"
    if message_type in {"notebook_execute_result", "notebook_display_data", "notebook_update_display_data"}:
        content = message.get("content") or {}
        data = content.get("data") if isinstance(content, dict) else None
        preview_source = data if data is not None else content
        return _compact_json(preview_source), message_type
    return None, None


class _SessionBucket:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._notebook_path_by_kernel: dict[str, str] = {}
        self._kernel_by_notebook_path: dict[str, str] = {}
        self._kernel_meta: dict[str, dict[str, Any]] = {}
        self._template_by_kernel: dict[str, dict[str, Any]] = {}
        self._artifacts_by_kernel: dict[str, dict[str, Any]] = {}
        self._artifacts_by_execution: dict[str, dict[str, dict[str, Any]]] = {}
        self._artifact_canonical_by_kernel: dict[str, dict[str, str]] = {}
        self._executions: dict[str, dict[str, Any]] = {}

    def clear(self) -> None:
        with self._lock:
            self._notebook_path_by_kernel.clear()
            self._kernel_by_notebook_path.clear()
            self._kernel_meta.clear()
            self._template_by_kernel.clear()
            self._artifacts_by_kernel.clear()
            self._artifacts_by_execution.clear()
            self._artifact_canonical_by_kernel.clear()
            self._executions.clear()

    def _resolve_artifact_canonical_execution(
        self,
        kernel_id: str,
        execution_id: Optional[str],
    ) -> Optional[str]:
        normalized_execution = _normalize_key(execution_id)
        if normalized_execution is None:
            return None

        aliases = self._artifact_canonical_by_kernel.get(kernel_id) or {}
        canonical = normalized_execution
        seen: set[str] = set()
        while canonical in aliases and canonical not in seen:
            seen.add(canonical)
            canonical = aliases[canonical]
        return canonical

    def _artifact_execution_targets(
        self,
        kernel_id: str,
        execution_id: Optional[str],
    ) -> tuple[Optional[str], list[str]]:
        normalized_execution = _normalize_key(execution_id)
        canonical = self._resolve_artifact_canonical_execution(kernel_id, normalized_execution)
        targets: list[str] = []
        if normalized_execution is not None:
            targets.append(normalized_execution)
        if canonical is not None and canonical not in targets:
            targets.append(canonical)
        return canonical, targets

    def register_kernel(
        self,
        kernel_id: str,
        *,
        notebook_path: Optional[str] = None,
        state: str = "idle",
    ) -> None:
        normalized_kernel = _normalize_key(kernel_id)
        if normalized_kernel is None:
            raise ValueError("kernel_id requerido")

        now = time.time()
        normalized_path = _normalize_path(notebook_path) if notebook_path else None
        with self._lock:
            meta = self._kernel_meta.setdefault(
                normalized_kernel,
                {
                    "kernel_id": normalized_kernel,
                    "created_at": now,
                },
            )
            meta["state"] = state
            meta["updated_at"] = now
            meta["active"] = state != "disconnected"
            if normalized_path:
                meta["notebook_path"] = normalized_path
            if "last_error" not in meta:
                meta["last_error"] = None

    def register_notebook(self, kernel_id: str, notebook_path: str) -> str:
        normalized_kernel = _normalize_key(kernel_id)
        if normalized_kernel is None:
            raise ValueError("kernel_id requerido")
        normalized_path = _normalize_path(notebook_path)
        with self._lock:
            self.register_kernel(normalized_kernel, notebook_path=normalized_path, state="idle")
            previous_path = self._notebook_path_by_kernel.get(normalized_kernel)
            if previous_path and previous_path != normalized_path:
                self._kernel_by_notebook_path.pop(previous_path, None)
            previous_kernel = self._kernel_by_notebook_path.get(normalized_path)
            if previous_kernel and previous_kernel != normalized_kernel:
                self._notebook_path_by_kernel.pop(previous_kernel, None)
            self._notebook_path_by_kernel[normalized_kernel] = normalized_path
            self._kernel_by_notebook_path[normalized_path] = normalized_kernel
        return normalized_path

    def set_kernel_state(
        self,
        kernel_id: str,
        state: str,
        *,
        notebook_path: Optional[str] = None,
        error: Optional[dict[str, Any]] = None,
        execution_id: Optional[str] = None,
    ) -> None:
        normalized_kernel = _normalize_key(kernel_id)
        if normalized_kernel is None:
            return

        now = time.time()
        normalized_path = _normalize_path(notebook_path) if notebook_path else None
        with self._lock:
            meta = self._kernel_meta.setdefault(
                normalized_kernel,
                {
                    "kernel_id": normalized_kernel,
                    "created_at": now,
                },
            )
            meta["state"] = state
            meta["updated_at"] = now
            meta["active"] = state != "disconnected"
            if normalized_path:
                meta["notebook_path"] = normalized_path
            if error is not None:
                meta["last_error"] = copy.deepcopy(error)
            elif state != "error":
                meta["last_error"] = None
            if execution_id is not None:
                meta["last_execution_id"] = str(execution_id)

    def get_kernel_status(self, kernel_id: str) -> dict[str, Any]:
        normalized_kernel = _normalize_key(kernel_id)
        if normalized_kernel is None:
            return {
                "kernel_id": "",
                "state": "disconnected",
                "active": False,
                "updated_at": time.time(),
            }

        with self._lock:
            meta = copy.deepcopy(self._kernel_meta.get(normalized_kernel) or {})
            notebook_path = self._notebook_path_by_kernel.get(normalized_kernel)

        if notebook_path:
            meta.setdefault("notebook_path", notebook_path)
        if not meta:
            return {
                "kernel_id": normalized_kernel,
                "state": "disconnected",
                "active": False,
                "updated_at": time.time(),
            }
        return meta

    def get_notebook_path(self, kernel_id: str) -> Optional[str]:
        normalized_kernel = _normalize_key(kernel_id)
        if normalized_kernel is None:
            return None
        with self._lock:
            return self._notebook_path_by_kernel.get(normalized_kernel)

    def get_kernel_id(self, notebook_path: str) -> Optional[str]:
        normalized_path = _normalize_path(notebook_path)
        with self._lock:
            return self._kernel_by_notebook_path.get(normalized_path)

    def list_kernel_ids(self) -> list[str]:
        with self._lock:
            return sorted(self._kernel_meta.keys())

    def list_notebook_paths(self) -> list[str]:
        with self._lock:
            return sorted(self._kernel_by_notebook_path.keys())

    def list_notebook_sessions(self) -> list[dict[str, Any]]:
        with self._lock:
            kernel_ids = sorted(set(self._kernel_meta.keys()) | set(self._notebook_path_by_kernel.keys()))
            sessions: list[dict[str, Any]] = []
            for kernel_id in kernel_ids:
                meta = copy.deepcopy(self._kernel_meta.get(kernel_id) or {})
                if str(meta.get("state") or "").strip().lower() == "disconnected":
                    continue
                notebook_path = meta.get("notebook_path") or self._notebook_path_by_kernel.get(kernel_id)
                if not notebook_path:
                    continue
                sessions.append(
                    {
                        "kernel_id": kernel_id,
                        "notebook_path": notebook_path,
                        "state": meta.get("state", "idle"),
                        "active": bool(meta.get("active", meta.get("state") != "disconnected")),
                        "last_execution_id": meta.get("last_execution_id"),
                        "last_error": meta.get("last_error"),
                        "created_at": meta.get("created_at"),
                        "updated_at": meta.get("updated_at"),
                    }
                )
            return sessions

    def unregister_kernel(self, kernel_id: str, *, clear_artifacts: bool = True) -> None:
        normalized_kernel = _normalize_key(kernel_id)
        if normalized_kernel is None:
            return
        with self._lock:
            notebook_path = self._notebook_path_by_kernel.pop(normalized_kernel, None)
            if notebook_path:
                self._kernel_by_notebook_path.pop(notebook_path, None)
            self.set_kernel_state(normalized_kernel, "disconnected", notebook_path=notebook_path)
            self._template_by_kernel.pop(normalized_kernel, None)
            if clear_artifacts:
                self._artifacts_by_kernel.pop(normalized_kernel, None)
                self._artifacts_by_execution.pop(normalized_kernel, None)
                self._artifact_canonical_by_kernel.pop(normalized_kernel, None)
            execution_ids = [
                execution_id
                for execution_id, payload in self._executions.items()
                if _normalize_key((payload or {}).get("kernel_id")) == normalized_kernel
            ]
            for execution_id in execution_ids:
                self._executions.pop(execution_id, None)

    def register_artifact_alias(
        self,
        kernel_id: str,
        *,
        execution_id: str,
        alias_execution_id: str,
    ) -> None:
        normalized_kernel = _normalize_key(kernel_id)
        normalized_execution = _normalize_key(execution_id)
        normalized_alias = _normalize_key(alias_execution_id)
        if (
            normalized_kernel is None
            or normalized_execution is None
            or normalized_alias is None
            or normalized_execution == normalized_alias
        ):
            return
        with self._lock:
            aliases = self._artifact_canonical_by_kernel.setdefault(normalized_kernel, {})
            canonical_alias = self._resolve_artifact_canonical_execution(normalized_kernel, normalized_alias)
            resolved_alias = canonical_alias or normalized_alias
            aliases[normalized_execution] = resolved_alias

            per_execution = self._artifacts_by_execution.setdefault(normalized_kernel, {})
            source_payload = per_execution.get(normalized_execution)
            if source_payload:
                aliased_payload = per_execution.setdefault(resolved_alias, {})
                aliased_payload.update(copy.deepcopy(source_payload))
                aliased_payload["kernel_id"] = normalized_kernel
                aliased_payload["execution_id"] = resolved_alias

                current_execution = _normalize_key(
                    (self._kernel_meta.get(normalized_kernel) or {}).get("last_execution_id")
                )
                if current_execution == resolved_alias:
                    latest = self._artifacts_by_kernel.setdefault(normalized_kernel, {})
                    latest.update(copy.deepcopy(source_payload))
                    latest["kernel_id"] = normalized_kernel
                    latest["execution_id"] = resolved_alias
                    latest["updated_at"] = source_payload.get("updated_at", time.time())
                    latest["last_message_type"] = source_payload.get("last_message_type")

    def record_template(
        self,
        kernel_id: str,
        template: Any,
        *,
        template_token: Optional[str] = None,
    ) -> None:
        normalized_kernel = _normalize_key(kernel_id)
        if normalized_kernel is None:
            return
        with self._lock:
            payload = self._template_by_kernel.setdefault(normalized_kernel, {})
            payload["kernel_id"] = normalized_kernel
            payload["template"] = copy.deepcopy(template)
            if template_token is not None:
                payload["template_token"] = template_token
            payload["updated_at"] = time.time()

    def clear_template(self, kernel_id: str) -> None:
        normalized_kernel = _normalize_key(kernel_id)
        if normalized_kernel is None:
            return
        with self._lock:
            self._template_by_kernel.pop(normalized_kernel, None)

    def get_template(self, kernel_id: str) -> Optional[dict[str, Any]]:
        normalized_kernel = _normalize_key(kernel_id)
        if normalized_kernel is None:
            return None
        with self._lock:
            payload = self._template_by_kernel.get(normalized_kernel)
            return copy.deepcopy(payload) if payload else None

    def list_template_styles(self, kernel_id: str | None = None) -> list[str]:
        normalized_kernel = _normalize_key(kernel_id)
        with self._lock:
            templates: list[dict[str, Any]] = []
            if normalized_kernel is not None:
                payload = self._template_by_kernel.get(normalized_kernel)
                if payload:
                    templates.append(payload)
            else:
                templates.extend(self._template_by_kernel.values())

        styles: list[str] = []
        seen: set[str] = set()
        for payload in templates:
            template = payload.get("template")
            if not isinstance(template, dict):
                continue
            raw_styles = template.get("styles")
            if not isinstance(raw_styles, list):
                continue
            for style in raw_styles:
                if isinstance(style, dict):
                    candidate = style.get("name") or style.get("style_name") or style.get("id")
                else:
                    candidate = style
                text = str(candidate or "").strip()
                if not text or text in seen:
                    continue
                seen.add(text)
                styles.append(text)
        return sorted(styles)

    def record_artifacts(self, message: dict[str, Any]) -> None:
        kernel_id = _normalize_key(message.get("kernel_id"))
        if kernel_id is None:
            return

        execution_id = _normalize_key(message.get("execution_id"))
        message_type = str(message.get("type") or "")
        payload = {
            key: value
            for key, value in message.items()
            if key in _ARTIFACT_FIELDS and value is not None
        }
        if not payload and message_type not in {
            "notebook_cell_executed",
            "notebook_pdf_ready",
            "pdf_reconverted",
        }:
            return

        now = time.time()
        with self._lock:
            meta = self._kernel_meta.get(kernel_id) or {}
            if str(meta.get("state") or "") == "disconnected":
                return

            canonical_execution, target_execution_ids = self._artifact_execution_targets(kernel_id, execution_id)
            current_execution = _normalize_key(meta.get("last_execution_id"))
            allow_latest = (
                execution_id is None
                or current_execution is None
                or execution_id == current_execution
                or canonical_execution == current_execution
            )
            if allow_latest:
                latest = self._artifacts_by_kernel.setdefault(kernel_id, {})
                latest.update(payload)
                latest["kernel_id"] = kernel_id
                if canonical_execution is not None:
                    latest["execution_id"] = canonical_execution
                elif execution_id is not None:
                    latest["execution_id"] = execution_id
                latest["updated_at"] = now
                latest["last_message_type"] = message_type

            if target_execution_ids:
                per_execution = self._artifacts_by_execution.setdefault(kernel_id, {})
                for target_execution_id in target_execution_ids:
                    execution_payload = per_execution.setdefault(target_execution_id, {})
                    execution_payload.update(payload)
                    execution_payload["kernel_id"] = kernel_id
                    execution_payload["execution_id"] = target_execution_id
                    execution_payload["updated_at"] = now
                    execution_payload["last_message_type"] = message_type

    def observe_execution_message(self, message: dict[str, Any]) -> None:
        self.record_artifacts(message)
        self.record_runtime_message(message)

    def record_runtime_message(self, message: dict[str, Any]) -> None:
        execution_id = _normalize_key(message.get("execution_id"))
        if execution_id is None:
            return

        message_type = str(message.get("type") or "")
        if message_type not in _RUNTIME_EVIDENCE_MESSAGE_TYPES:
            return

        now = time.time()
        runtime_message = _copy_runtime_message(message)
        kernel_id = _normalize_key(message.get("kernel_id"))
        cell_id = _normalize_key(message.get("cell_id"))
        notebook_path = _normalize_key(message.get("path")) or _normalize_key(message.get("notebook_path"))
        output_preview, output_kind = _extract_output_preview(message)
        with self._lock:
            current = self._executions.setdefault(
                execution_id,
                {
                    "execution_id": execution_id,
                    "events": [],
                    "cell_statuses": {},
                    "cell_results": {},
                    "created_at": now,
                },
            )
            recovery = current.setdefault("runtime_recovery", {})
            recovery["last_message_type"] = message_type
            recovery["last_message_at"] = now
            recovery["last_message"] = runtime_message
            recovery["observed_disconnect_recovery"] = True
            if message_type in _TERMINAL_RUNTIME_MESSAGE_TYPES:
                recovery["terminal_message_type"] = message_type
                recovery["terminal_message_at"] = now
                recovery["terminal_message"] = runtime_message
            if kernel_id is not None:
                current.setdefault("kernel_id", kernel_id)
            if cell_id is not None:
                current.setdefault("cell_id", cell_id)
                if message_type == "notebook_progress_update":
                    current["current_cell_id"] = cell_id
            if notebook_path is not None:
                current.setdefault("notebook_path", notebook_path)
            effective_cell_id = cell_id or _normalize_key(current.get("current_cell_id"))
            if effective_cell_id is not None:
                cell_status = current.setdefault("cell_statuses", {}).setdefault(effective_cell_id, {})
                cell_status.setdefault("cell_id", effective_cell_id)
                cell_status["updated_at"] = now
            else:
                cell_status = None
            if message_type == "notebook_progress_update":
                progress_scope = _normalize_key(message.get("progress_scope"))
                if progress_scope is not None:
                    current["progress_scope"] = progress_scope
                progress_stage = _normalize_key(message.get("progress_stage"))
                if progress_stage is not None:
                    current["progress_stage"] = progress_stage
                progress_status = _normalize_key(message.get("progress_status"))
                if progress_status is not None:
                    current["progress_status"] = progress_status
                progress_percent = message.get("progress_percent")
                if progress_percent is not None:
                    current["progress_percent"] = progress_percent
            if output_preview is not None:
                current["last_output_preview"] = output_preview
                current["last_output_type"] = output_kind
                current["last_output_at"] = now
                if cell_status is not None:
                    cell_status["last_output_preview"] = output_preview
                    cell_status["last_output_type"] = output_kind
                    cell_status["last_output_at"] = now
            elif message_type == "notebook_clear_output":
                current["last_output_preview"] = ""
                current["last_output_type"] = "clear_output"
                current["last_output_at"] = now
                if cell_status is not None:
                    cell_status["last_output_preview"] = ""
                    cell_status["last_output_type"] = "clear_output"
                    cell_status["last_output_at"] = now
            current["updated_at"] = now
            current["heartbeat_at"] = now

    def get_execution_recovery(self, execution_id: str) -> Optional[dict[str, Any]]:
        normalized_execution = _normalize_key(execution_id)
        if normalized_execution is None:
            return None

        with self._lock:
            execution = self._executions.get(normalized_execution) or {}
            recovery = execution.get("runtime_recovery")
            return copy.deepcopy(recovery) if isinstance(recovery, dict) else None

    def get_artifacts(
        self,
        *,
        kernel_id: str,
        execution_id: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        normalized_kernel = _normalize_key(kernel_id)
        if normalized_kernel is None:
            return None
        normalized_execution = _normalize_key(execution_id)

        with self._lock:
            if normalized_execution is not None:
                per_execution = self._artifacts_by_execution.get(normalized_kernel, {})
                execution_artifacts = per_execution.get(normalized_execution)
                if not execution_artifacts:
                    canonical_execution = self._resolve_artifact_canonical_execution(
                        normalized_kernel,
                        normalized_execution,
                    )
                    if canonical_execution is not None:
                        execution_artifacts = per_execution.get(canonical_execution)
                if execution_artifacts:
                    return copy.deepcopy(execution_artifacts)
                current_execution = _normalize_key(
                    (self._kernel_meta.get(normalized_kernel) or {}).get("last_execution_id")
                )
                if normalized_execution == current_execution:
                    artifacts = self._artifacts_by_kernel.get(normalized_kernel)
                    if artifacts:
                        return copy.deepcopy(artifacts)
            artifacts = self._artifacts_by_kernel.get(normalized_kernel)
            return copy.deepcopy(artifacts) if artifacts else None

    def upsert_execution(self, execution_id: str, payload: dict[str, Any]) -> None:
        normalized_execution = _normalize_key(execution_id)
        if normalized_execution is None:
            return

        now = time.time()
        with self._lock:
            current = self._executions.setdefault(
                normalized_execution,
                {
                    "execution_id": normalized_execution,
                    "events": [],
                    "cell_statuses": {},
                    "cell_results": {},
                    "created_at": now,
                },
            )
            for key, value in payload.items():
                if key in {"events", "cell_statuses", "cell_results"} and isinstance(value, dict):
                    current.setdefault(key, {})
                    current[key].update(copy.deepcopy(value))
                else:
                    current[key] = copy.deepcopy(value)
            current["updated_at"] = now
            current.setdefault("heartbeat_at", now)

    def append_execution_event(self, execution_id: str, event: dict[str, Any], *, max_events: int = 200) -> None:
        normalized_execution = _normalize_key(execution_id)
        if normalized_execution is None:
            return

        now = time.time()
        event_payload = copy.deepcopy(event)
        event_payload.setdefault("ts", now)
        with self._lock:
            current = self._executions.setdefault(
                normalized_execution,
                {
                    "execution_id": normalized_execution,
                    "events": [],
                    "cell_statuses": {},
                    "cell_results": {},
                    "created_at": now,
                },
            )
            events = current.setdefault("events", [])
            events.append(event_payload)
            if len(events) > max_events:
                del events[:-max_events]
            current["updated_at"] = now
            current["heartbeat_at"] = now

    def update_execution_cell(
        self,
        execution_id: str,
        cell_id: str,
        *,
        status: Optional[str] = None,
        result: Optional[dict[str, Any]] = None,
        duration_ms: Optional[int] = None,
        order: Optional[int] = None,
    ) -> None:
        normalized_execution = _normalize_key(execution_id)
        normalized_cell = _normalize_key(cell_id)
        if normalized_execution is None or normalized_cell is None:
            return

        now = time.time()
        with self._lock:
            current = self._executions.setdefault(
                normalized_execution,
                {
                    "execution_id": normalized_execution,
                    "events": [],
                    "cell_statuses": {},
                    "cell_results": {},
                    "created_at": now,
                },
            )
            cell_statuses = current.setdefault("cell_statuses", {})
            current_status = copy.deepcopy(cell_statuses.get(normalized_cell) or {})
            if status is not None:
                current_status["status"] = status
            if duration_ms is not None:
                current_status["duration_ms"] = duration_ms
            if order is not None:
                current_status["order"] = order
            current_status["updated_at"] = now
            cell_statuses[normalized_cell] = current_status
            if result is not None:
                current.setdefault("cell_results", {})
                current["cell_results"][normalized_cell] = copy.deepcopy(result)
            current["updated_at"] = now
            current["heartbeat_at"] = now

    def get_execution(self, execution_id: str) -> Optional[dict[str, Any]]:
        normalized_execution = _normalize_key(execution_id)
        if normalized_execution is None:
            return None

        with self._lock:
            execution = self._executions.get(normalized_execution)
            return copy.deepcopy(execution) if execution else None

    def list_execution_ids(self) -> list[str]:
        with self._lock:
            return sorted(self._executions.keys())


class McpSessionState:
    """Registry of session-scoped MCP state buckets."""

    _instance: Optional["McpSessionState"] = None

    def __init__(self) -> None:
        self._registry_lock = threading.RLock()
        self._sessions: dict[str, _SessionBucket] = {}

    @classmethod
    def get(cls) -> "McpSessionState":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _bucket(self, session_id: str | None = None, *, create: bool = True) -> Optional[_SessionBucket]:
        resolved = resolve_session_id(session_id)
        with self._registry_lock:
            bucket = self._sessions.get(resolved)
            if bucket is None and create:
                bucket = _SessionBucket()
                self._sessions[resolved] = bucket
            return bucket

    def resolve_known_session_id(
        self,
        session_id: str | None = None,
        *,
        allow_singleton_fallback: bool = False,
    ) -> Optional[str]:
        resolved = resolve_session_id(session_id)
        with self._registry_lock:
            if resolved in self._sessions:
                return resolved
            if allow_singleton_fallback and len(self._sessions) == 1:
                return next(iter(self._sessions))
            return None

    def clear(self, session_id: str | None = None) -> None:
        if session_id is None:
            with self._registry_lock:
                self._sessions.clear()
            return
        with self._registry_lock:
            self._sessions.pop(resolve_session_id(session_id), None)

    def register_kernel(self, kernel_id: str, *, notebook_path: Optional[str] = None, state: str = "idle", session_id: str | None = None) -> None:
        bucket = self._bucket(session_id)
        assert bucket is not None
        bucket.register_kernel(kernel_id, notebook_path=notebook_path, state=state)

    def register_notebook(self, kernel_id: str, notebook_path: str, session_id: str | None = None) -> str:
        bucket = self._bucket(session_id)
        assert bucket is not None
        return bucket.register_notebook(kernel_id, notebook_path)

    def set_kernel_state(
        self,
        kernel_id: str,
        state: str,
        *,
        notebook_path: Optional[str] = None,
        error: Optional[dict[str, Any]] = None,
        execution_id: Optional[str] = None,
        session_id: str | None = None,
    ) -> None:
        bucket = self._bucket(session_id)
        assert bucket is not None
        bucket.set_kernel_state(
            kernel_id,
            state,
            notebook_path=notebook_path,
            error=error,
            execution_id=execution_id,
        )

    def get_kernel_status(self, kernel_id: str, session_id: str | None = None) -> dict[str, Any]:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            normalized_kernel = _normalize_key(kernel_id) or ""
            return {
                "kernel_id": normalized_kernel,
                "state": "disconnected",
                "active": False,
                "updated_at": time.time(),
            }
        return bucket.get_kernel_status(kernel_id)

    def get_notebook_path(self, kernel_id: str, session_id: str | None = None) -> Optional[str]:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return None
        return bucket.get_notebook_path(kernel_id)

    def get_kernel_id(self, notebook_path: str, session_id: str | None = None) -> Optional[str]:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return None
        return bucket.get_kernel_id(notebook_path)

    def list_kernel_ids(self, session_id: str | None = None) -> list[str]:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return []
        return bucket.list_kernel_ids()

    def list_kernel_ids_any(self) -> list[str]:
        with self._registry_lock:
            buckets = list(self._sessions.values())
        values: set[str] = set()
        for bucket in buckets:
            values.update(bucket.list_kernel_ids())
        return sorted(values)

    def list_notebook_paths(self, session_id: str | None = None) -> list[str]:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return []
        return bucket.list_notebook_paths()

    def list_notebook_paths_any(self) -> list[str]:
        with self._registry_lock:
            values: set[str] = set()
            buckets = list(self._sessions.values())
        for bucket in buckets:
            values.update(bucket.list_notebook_paths())
        return sorted(values)

    def list_notebook_sessions(self, session_id: str | None = None) -> list[dict[str, Any]]:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return []
        return bucket.list_notebook_sessions()

    def unregister_kernel(self, kernel_id: str, *, clear_artifacts: bool = True, session_id: str | None = None) -> None:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return
        bucket.unregister_kernel(kernel_id, clear_artifacts=clear_artifacts)

    def record_template(
        self,
        kernel_id: str,
        template: Any,
        *,
        template_token: Optional[str] = None,
        session_id: str | None = None,
    ) -> None:
        bucket = self._bucket(session_id)
        assert bucket is not None
        bucket.record_template(kernel_id, template, template_token=template_token)

    def clear_template(self, kernel_id: str, session_id: str | None = None) -> None:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return
        bucket.clear_template(kernel_id)

    def get_template(self, kernel_id: str, session_id: str | None = None) -> Optional[dict[str, Any]]:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return None
        return bucket.get_template(kernel_id)

    def list_template_styles(self, kernel_id: str | None = None, session_id: str | None = None) -> list[str]:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return []
        return bucket.list_template_styles(kernel_id)

    def list_template_styles_any(self, kernel_id: str | None = None) -> list[str]:
        with self._registry_lock:
            buckets = list(self._sessions.values())
        values: set[str] = set()
        for bucket in buckets:
            values.update(bucket.list_template_styles(kernel_id))
        return sorted(values)

    def record_artifacts(self, message: dict[str, Any], session_id: str | None = None) -> None:
        bucket = self._bucket(session_id)
        assert bucket is not None
        bucket.record_artifacts(message)

    def observe_execution_message(self, message: dict[str, Any], session_id: str | None = None) -> None:
        bucket = self._bucket(session_id)
        assert bucket is not None
        bucket.observe_execution_message(message)

    def record_runtime_message(self, message: dict[str, Any], session_id: str | None = None) -> None:
        bucket = self._bucket(session_id)
        assert bucket is not None
        bucket.record_runtime_message(message)

    def register_artifact_alias(
        self,
        kernel_id: str,
        *,
        execution_id: str,
        alias_execution_id: str,
        session_id: str | None = None,
    ) -> None:
        bucket = self._bucket(session_id)
        assert bucket is not None
        bucket.register_artifact_alias(
            kernel_id,
            execution_id=execution_id,
            alias_execution_id=alias_execution_id,
        )

    def get_artifacts(
        self,
        *,
        kernel_id: str,
        execution_id: Optional[str] = None,
        session_id: str | None = None,
    ) -> Optional[dict[str, Any]]:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return None
        return bucket.get_artifacts(kernel_id=kernel_id, execution_id=execution_id)

    def upsert_execution(self, execution_id: str, payload: dict[str, Any], session_id: str | None = None) -> None:
        bucket = self._bucket(session_id)
        assert bucket is not None
        bucket.upsert_execution(execution_id, payload)

    def append_execution_event(
        self,
        execution_id: str,
        event: dict[str, Any],
        *,
        max_events: int = 200,
        session_id: str | None = None,
    ) -> None:
        bucket = self._bucket(session_id)
        assert bucket is not None
        bucket.append_execution_event(execution_id, event, max_events=max_events)

    def update_execution_cell(
        self,
        execution_id: str,
        cell_id: str,
        *,
        status: Optional[str] = None,
        result: Optional[dict[str, Any]] = None,
        duration_ms: Optional[int] = None,
        order: Optional[int] = None,
        session_id: str | None = None,
    ) -> None:
        bucket = self._bucket(session_id)
        assert bucket is not None
        bucket.update_execution_cell(
            execution_id,
            cell_id,
            status=status,
            result=result,
            duration_ms=duration_ms,
            order=order,
        )

    def get_execution(self, execution_id: str, session_id: str | None = None) -> Optional[dict[str, Any]]:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return None
        return bucket.get_execution(execution_id)

    def get_execution_recovery(self, execution_id: str, session_id: str | None = None) -> Optional[dict[str, Any]]:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return None
        return bucket.get_execution_recovery(execution_id)

    def list_execution_ids(self, session_id: str | None = None) -> list[str]:
        bucket = self._bucket(session_id, create=False)
        if bucket is None:
            return []
        return bucket.list_execution_ids()

    def list_execution_ids_any(self) -> list[str]:
        with self._registry_lock:
            buckets = list(self._sessions.values())
        values: set[str] = set()
        for bucket in buckets:
            values.update(bucket.list_execution_ids())
        return sorted(values)
