from __future__ import annotations

import asyncio
import uuid
from collections import deque
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

DEFAULT_HISTORY_LIMIT = 300
_ALLOWED_PHASES = {"started", "completed", "failed"}
_ALLOWED_STATUSES = {"running", "success", "error"}
_RESOURCE_KEYS = ("path", "notebook_path", "kernel_id", "cell_id", "execution_id")
_ARTIFACT_KEYS = ("kind", "token", "ref", "pdf_ref", "docx_ref", "pdf_hash", "docx_hash")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_phase(value: Any) -> str:
    phase = _normalize_text(value)
    if phase in _ALLOWED_PHASES:
        return phase
    return "started"


def _status_from_phase(phase: str) -> str:
    if phase == "completed":
        return "success"
    if phase == "failed":
        return "error"
    return "running"


def _normalize_status(value: Any, *, phase: str) -> str:
    status = _normalize_text(value)
    if status in _ALLOWED_STATUSES:
        return status
    return _status_from_phase(phase)


def _normalize_duration(value: Any) -> int | None:
    if value is None:
        return None
    try:
        duration = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(0, duration)


def _normalize_resource(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    resource: dict[str, str] = {}
    for key in _RESOURCE_KEYS:
        normalized = _normalize_text(value.get(key))
        if normalized:
            resource[key] = normalized
    return resource


def _normalize_artifact(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    artifact: dict[str, str] = {}
    for key in _ARTIFACT_KEYS:
        normalized = _normalize_text(value.get(key))
        if normalized:
            artifact[key] = normalized
    return artifact


def _normalize_ui_hints(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}

    hints: dict[str, Any] = {}
    if bool(value.get("refresh_workspace")):
        hints["refresh_workspace"] = True
    if bool(value.get("show_agent_execution")):
        hints["show_agent_execution"] = True
    if bool(value.get("refresh_preview")):
        hints["refresh_preview"] = True

    reload_path = _normalize_text(value.get("reload_path"))
    if reload_path:
        hints["reload_path"] = reload_path

    artifact = _normalize_artifact(value.get("artifact"))
    if artifact:
        hints["artifact"] = artifact

    return hints


def normalize_mcp_activity_event(payload: dict[str, Any]) -> dict[str, Any]:
    phase = _normalize_phase(payload.get("phase"))
    summary = _normalize_text(payload.get("summary")) or "MCP activity"
    event = {
        "event_id": _normalize_text(payload.get("event_id")) or f"mcp_evt_{uuid.uuid4().hex[:12]}",
        "run_id": _normalize_text(payload.get("run_id")) or f"mcp_run_{uuid.uuid4().hex[:12]}",
        "phase": phase,
        "status": _normalize_status(payload.get("status"), phase=phase),
        "tool_name": _normalize_text(payload.get("tool_name")) or "unknown_tool",
        "tool_group": _normalize_text(payload.get("tool_group")) or "system",
        "summary": summary,
        "ts": _normalize_text(payload.get("ts")) or _now_iso(),
        "resource": _normalize_resource(payload.get("resource")),
        "ui_hints": _normalize_ui_hints(payload.get("ui_hints")),
    }

    client_id = _normalize_text(payload.get("client_id"))
    if client_id:
        event["client_id"] = client_id

    client_label = _normalize_text(payload.get("client_label"))
    if client_label:
        event["client_label"] = client_label

    transport = _normalize_text(payload.get("transport"))
    if transport:
        event["transport"] = transport

    detail = _normalize_text(payload.get("detail"))
    if detail:
        event["detail"] = detail

    duration_ms = _normalize_duration(payload.get("duration_ms"))
    if duration_ms is not None:
        event["duration_ms"] = duration_ms

    error = _normalize_text(payload.get("error"))
    if error:
        event["error"] = error

    return event


class McpActivityStore:
    def __init__(self, *, max_events: int = DEFAULT_HISTORY_LIMIT) -> None:
        self._events: deque[dict[str, Any]] = deque(maxlen=max_events)
        self._active_runs: dict[str, dict[str, Any]] = {}
        self._tool_summary: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def record_event(self, payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
        event = normalize_mcp_activity_event(payload)
        return await self.record_normalized_event(event)

    async def record_normalized_event(self, event: dict[str, Any]) -> tuple[dict[str, Any], int]:
        async with self._lock:
            self._events.append(event)
            run_id = event["run_id"]
            if event["status"] == "running":
                self._active_runs[run_id] = event
            else:
                self._active_runs.pop(run_id, None)
            tool_name = event["tool_name"]
            summary = self._tool_summary.setdefault(
                tool_name,
                {
                    "tool_name": tool_name,
                    "tool_group": event["tool_group"],
                    "started": 0,
                    "completed": 0,
                    "failed": 0,
                    "last_seen": None,
                    "avg_duration_ms": None,
                    "_duration_total_ms": 0,
                    "_duration_count": 0,
                },
            )
            phase = event["phase"]
            if phase == "started":
                summary["started"] += 1
            elif phase == "completed":
                summary["completed"] += 1
            elif phase == "failed":
                summary["failed"] += 1
            duration_ms = event.get("duration_ms")
            if phase == "completed" and isinstance(duration_ms, int):
                summary["_duration_total_ms"] += duration_ms
                summary["_duration_count"] += 1
                summary["avg_duration_ms"] = int(
                    round(summary["_duration_total_ms"] / max(summary["_duration_count"], 1))
                )
            summary["last_seen"] = event["ts"]
            active_count = len(self._active_runs)
        return deepcopy(event), active_count

    async def snapshot(self, *, limit: int = 50) -> dict[str, Any]:
        bounded_limit = max(1, min(int(limit), self._events.maxlen or DEFAULT_HISTORY_LIMIT))
        async with self._lock:
            events = list(self._events)[-bounded_limit:]
            active_runs = list(self._active_runs.values())
            tool_summary = list(self._tool_summary.values())

        active_runs.sort(key=lambda item: item.get("ts", ""), reverse=True)
        tool_summary.sort(key=lambda item: item.get("tool_name", ""))
        return {
            "events": [deepcopy(item) for item in reversed(events)],
            "active_runs": [deepcopy(item) for item in active_runs],
            "active_count": len(active_runs),
            "tool_summary": [
                {
                    "tool_name": item["tool_name"],
                    "tool_group": item["tool_group"],
                    "started": item["started"],
                    "completed": item["completed"],
                    "failed": item["failed"],
                    "last_seen": item["last_seen"],
                    "avg_duration_ms": item["avg_duration_ms"],
                }
                for item in tool_summary
            ],
        }

    async def clear(self) -> None:
        async with self._lock:
            self._events.clear()
            self._active_runs.clear()
            self._tool_summary.clear()

    async def clear_active_runs(self) -> None:
        async with self._lock:
            self._active_runs.clear()


mcp_activity_store = McpActivityStore()
