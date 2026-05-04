from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
import uuid

_ALLOWED_ACTIONS = {
    "open_resource",
    "notebook_snapshot",
    "notebook_runtime_message",
    "template_snapshot",
    "artifact_update",
    "file_mutation",
    "mirror_conflict",
}
_RESOURCE_KEYS = ("path", "notebook_path", "kernel_id", "cell_id", "execution_id")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_resource(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    resource: dict[str, str] = {}
    for key in _RESOURCE_KEYS:
        normalized = _normalize_text(value.get(key))
        if normalized:
            resource[key] = normalized
    return resource


def _normalize_payload(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return deepcopy(value)


def _maybe_notebook_path(path: str | None) -> str | None:
    normalized = _normalize_text(path)
    if not normalized:
        return None
    if normalized.replace("\\", "/").lower().endswith(".ipynb"):
        return normalized
    return None


def normalize_mcp_mirror_event(payload: dict[str, Any]) -> dict[str, Any]:
    action = _normalize_text(payload.get("action"))
    if action not in _ALLOWED_ACTIONS:
        action = "open_resource"

    resource = _normalize_resource(payload.get("resource"))
    normalized_payload = _normalize_payload(payload.get("payload"))

    candidate_path = (
        _normalize_text(normalized_payload.get("path"))
        or _normalize_text(normalized_payload.get("new_path"))
        or _normalize_text(normalized_payload.get("old_path"))
    )
    candidate_notebook_path = _normalize_text(normalized_payload.get("notebook_path"))
    if candidate_path and "path" not in resource:
        resource["path"] = candidate_path
    if candidate_notebook_path and "notebook_path" not in resource:
        resource["notebook_path"] = candidate_notebook_path

    if action in {"notebook_snapshot", "file_mutation"} and "notebook_path" not in resource:
        notebook_candidate = _maybe_notebook_path(candidate_notebook_path or candidate_path)
        if notebook_candidate:
            resource["notebook_path"] = notebook_candidate

    event = {
        "step_id": _normalize_text(payload.get("step_id")) or f"mcp_mirror_{uuid.uuid4().hex[:12]}",
        "run_id": _normalize_text(payload.get("run_id")) or f"mcp_run_{uuid.uuid4().hex[:12]}",
        "tool_name": _normalize_text(payload.get("tool_name")) or "unknown_tool",
        "tool_group": _normalize_text(payload.get("tool_group")) or "system",
        "action": action,
        "resource": resource,
        "payload": normalized_payload,
        "ts": _normalize_text(payload.get("ts")) or _now_iso(),
    }
    return event
