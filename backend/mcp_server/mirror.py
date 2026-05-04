from __future__ import annotations

from datetime import datetime, timezone
import logging
import os
from typing import Any
import uuid

from .activity import get_current_activity_context
from .bridge import InspyroBridge

logger = logging.getLogger("inspyro.mcp.mirror")

_RESOURCE_KEYS = ("path", "notebook_path", "kernel_id", "cell_id", "execution_id")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_path(value: Any) -> str | None:
    text = _normalize_text(value)
    if not text:
        return None
    return os.path.abspath(os.path.expanduser(text))


def _normalize_resource(resource: dict[str, Any] | None) -> dict[str, str]:
    normalized: dict[str, str] = {}
    if not isinstance(resource, dict):
        return normalized
    for key in _RESOURCE_KEYS:
        value = _normalize_text(resource.get(key))
        if value:
            normalized[key] = value
    return normalized


class McpMirrorReporter:
    _instance: "McpMirrorReporter | None" = None

    @classmethod
    def get(cls) -> "McpMirrorReporter":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def report(self, event: dict[str, Any]) -> None:
        bridge = InspyroBridge.get()
        try:
            await bridge.rest_post("/api/mcp/mirror-events", json_data=event)
        except Exception as exc:  # pragma: no cover - best effort reporting
            logger.debug("MCP mirror event dropped: %s", exc)


async def emit_mirror_event(
    action: str,
    *,
    resource: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
    run_id: str | None = None,
    tool_name: str | None = None,
    tool_group: str | None = None,
    step_id: str | None = None,
) -> None:
    context = get_current_activity_context()
    normalized_resource = _normalize_resource(resource)
    reporter = McpMirrorReporter.get()
    event = {
        "run_id": run_id or context.get("run_id") or f"mcp_run_{uuid.uuid4().hex[:12]}",
        "step_id": step_id or f"mcp_mirror_{uuid.uuid4().hex[:12]}",
        "tool_name": tool_name or context.get("tool_name") or "unknown_tool",
        "tool_group": tool_group or context.get("tool_group") or "system",
        "action": action,
        "resource": normalized_resource,
        "payload": payload or {},
        "ts": _now_iso(),
    }
    await reporter.report(event)


async def emit_open_resource(
    path: str,
    *,
    focus_view: str = "notebook",
    resource: dict[str, Any] | None = None,
) -> None:
    normalized_path = _normalize_path(path)
    if not normalized_path:
        return
    base_resource = {"path": normalized_path, **(resource or {})}
    if normalized_path.lower().endswith(".ipynb"):
        base_resource.setdefault("notebook_path", normalized_path)
    await emit_mirror_event(
        "open_resource",
        resource=base_resource,
        payload={
            "path": normalized_path,
            "focus_view": focus_view,
        },
    )


async def emit_notebook_snapshot(
    notebook_path: str,
    notebook: dict[str, Any],
    *,
    kernel_id: str | None = None,
    focus_cell_id: str | None = None,
    execution_id: str | None = None,
) -> None:
    normalized_path = _normalize_path(notebook_path)
    if not normalized_path:
        return
    resource = {
        "path": normalized_path,
        "notebook_path": normalized_path,
        "kernel_id": kernel_id,
        "execution_id": execution_id,
        "cell_id": focus_cell_id,
    }
    payload = {
        "path": normalized_path,
        "notebook": notebook,
    }
    if kernel_id:
        payload["kernel_id"] = kernel_id
    if focus_cell_id:
        payload["focus_cell_id"] = focus_cell_id
    if execution_id:
        payload["execution_id"] = execution_id
    await emit_mirror_event("notebook_snapshot", resource=resource, payload=payload)


async def emit_notebook_runtime_message(
    message: dict[str, Any],
    *,
    resource: dict[str, Any] | None = None,
) -> None:
    runtime_resource = dict(resource or {})
    for key in _RESOURCE_KEYS:
        value = message.get(key)
        if value is not None and key not in runtime_resource:
            runtime_resource[key] = value
    await emit_mirror_event(
        "notebook_runtime_message",
        resource=runtime_resource,
        payload=message,
    )


async def emit_template_snapshot(
    *,
    kernel_id: str,
    notebook_path: str | None,
    template: dict[str, Any] | None,
    template_token: str | None = None,
) -> None:
    resource = {
        "kernel_id": kernel_id,
        "notebook_path": notebook_path,
        "path": notebook_path,
    }
    payload = {
        "kernel_id": kernel_id,
        "notebook_path": notebook_path,
        "template": template,
    }
    if template_token:
        payload["template_token"] = template_token
    await emit_mirror_event("template_snapshot", resource=resource, payload=payload)


async def emit_artifact_update(
    artifact: dict[str, Any],
    *,
    resource: dict[str, Any] | None = None,
) -> None:
    if not artifact:
        return
    await emit_mirror_event("artifact_update", resource=resource, payload=artifact)


async def emit_file_mutation(
    *,
    mutation: str,
    path: str | None = None,
    old_path: str | None = None,
    new_path: str | None = None,
    is_directory: bool = False,
    file_kind: str = "unknown",
    resource: dict[str, Any] | None = None,
) -> None:
    normalized_old_path = _normalize_path(old_path)
    normalized_new_path = _normalize_path(new_path)
    normalized_path = _normalize_path(path) or normalized_new_path or normalized_old_path
    if not normalized_path:
        return

    base_resource = {"path": normalized_path, **(resource or {})}
    notebook_path = None
    for candidate in (normalized_new_path, normalized_path, normalized_old_path):
        if candidate and candidate.lower().endswith(".ipynb"):
            notebook_path = candidate
            break
    if notebook_path:
        base_resource.setdefault("notebook_path", notebook_path)

    payload: dict[str, Any] = {
        "mutation": _normalize_text(mutation) or "write",
        "path": normalized_path,
        "is_directory": bool(is_directory),
        "file_kind": _normalize_text(file_kind) or "unknown",
    }
    if normalized_old_path:
        payload["old_path"] = normalized_old_path
    if normalized_new_path:
        payload["new_path"] = normalized_new_path
    if notebook_path:
        payload["notebook_path"] = notebook_path

    await emit_mirror_event("file_mutation", resource=base_resource, payload=payload)
