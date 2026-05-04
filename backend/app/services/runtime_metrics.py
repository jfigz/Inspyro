"""Runtime metrics shared by websocket dispatcher and notebook handlers."""

from __future__ import annotations

import threading
from collections import defaultdict, deque
from typing import Any

_LOCK = threading.Lock()

_WS_PAYLOAD_IN_TOTAL = 0
_WS_PAYLOAD_OUT_TOTAL = 0
_WS_PAYLOAD_IN_MAX = 0
_WS_PAYLOAD_OUT_MAX = 0

_QUEUE_DEPTH_CURRENT: dict[str, int] = {"work": 0, "preview": 0}
_QUEUE_DEPTH_MAX: dict[str, int] = {"work": 0, "preview": 0}
_QUEUE_MAXSIZE: dict[str, int] = {"work": 0, "preview": 0}
_QUEUE_ENQUEUED_TOTAL: dict[str, int] = {"work": 0, "preview": 0}
_QUEUE_DEQUEUED_TOTAL: dict[str, int] = {"work": 0, "preview": 0}
_QUEUE_FULL_TOTAL: dict[str, int] = {"work": 0, "preview": 0}
_QUEUE_WAIT_MS: dict[str, deque[float]] = {
    "work": deque(maxlen=512),
    "preview": deque(maxlen=512),
}

_OUTGOING_QUEUE_DEPTH_BY_CONNECTION: dict[int, int] = {}
_OUTGOING_QUEUE_MAXSIZE_BY_CONNECTION: dict[int, int] = {}
_OUTGOING_QUEUE_ENQUEUED_TOTAL = 0
_OUTGOING_QUEUE_DEQUEUED_TOTAL = 0
_OUTGOING_QUEUE_FULL_TOTAL = 0
_OUTGOING_QUEUE_DEPTH_MAX = 0
_OUTGOING_QUEUE_WAIT_MS = deque(maxlen=512)

_KERNEL_LOCK_WAIT_MS = deque(maxlen=1024)
_TEMPLATE_HANDLER_MS: dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=512))
_TEMPLATE_HANDLER_CALLS: dict[str, int] = defaultdict(int)

_UNIT_NORMALIZATION_FAILURES = 0
_UNIT_CONVERSION_FAILURES_BY_CODE: dict[str, int] = defaultdict(int)
_QUANTITY_SERIALIZATION_FALLBACKS = 0


def _safe_queue_type(queue_type: str) -> str:
    return queue_type if queue_type in {"work", "preview"} else "work"


def _quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    data = sorted(values)
    pos = (len(data) - 1) * q
    lower = int(pos)
    upper = min(lower + 1, len(data) - 1)
    if lower == upper:
        return float(data[lower])
    frac = pos - lower
    return float(data[lower] + (data[upper] - data[lower]) * frac)


def record_ws_incoming_payload(size_bytes: int) -> None:
    global _WS_PAYLOAD_IN_TOTAL, _WS_PAYLOAD_IN_MAX
    if size_bytes < 0:
        return
    with _LOCK:
        _WS_PAYLOAD_IN_TOTAL += int(size_bytes)
        if size_bytes > _WS_PAYLOAD_IN_MAX:
            _WS_PAYLOAD_IN_MAX = int(size_bytes)


def record_ws_outgoing_payload(size_bytes: int) -> None:
    global _WS_PAYLOAD_OUT_TOTAL, _WS_PAYLOAD_OUT_MAX
    if size_bytes < 0:
        return
    with _LOCK:
        _WS_PAYLOAD_OUT_TOTAL += int(size_bytes)
        if size_bytes > _WS_PAYLOAD_OUT_MAX:
            _WS_PAYLOAD_OUT_MAX = int(size_bytes)


def record_queue_enqueued(queue_type: str, depth: int, maxsize: int) -> None:
    qt = _safe_queue_type(queue_type)
    with _LOCK:
        _QUEUE_ENQUEUED_TOTAL[qt] += 1
        _QUEUE_DEPTH_CURRENT[qt] = max(0, int(depth))
        _QUEUE_MAXSIZE[qt] = max(0, int(maxsize))
        if depth > _QUEUE_DEPTH_MAX[qt]:
            _QUEUE_DEPTH_MAX[qt] = int(depth)


def record_queue_dequeued(queue_type: str, depth: int, wait_ms: float | None = None) -> None:
    qt = _safe_queue_type(queue_type)
    with _LOCK:
        _QUEUE_DEQUEUED_TOTAL[qt] += 1
        _QUEUE_DEPTH_CURRENT[qt] = max(0, int(depth))
        if wait_ms is not None:
            _QUEUE_WAIT_MS[qt].append(float(max(0.0, wait_ms)))


def record_queue_full(queue_type: str, maxsize: int) -> None:
    qt = _safe_queue_type(queue_type)
    with _LOCK:
        _QUEUE_FULL_TOTAL[qt] += 1
        _QUEUE_MAXSIZE[qt] = max(0, int(maxsize))


def _record_outgoing_depth_locked(connection_id: int, depth: int, maxsize: int | None = None) -> None:
    global _OUTGOING_QUEUE_DEPTH_MAX
    _OUTGOING_QUEUE_DEPTH_BY_CONNECTION[int(connection_id)] = max(0, int(depth))
    if maxsize is not None:
        _OUTGOING_QUEUE_MAXSIZE_BY_CONNECTION[int(connection_id)] = max(0, int(maxsize))
    total_depth = sum(_OUTGOING_QUEUE_DEPTH_BY_CONNECTION.values())
    if total_depth > _OUTGOING_QUEUE_DEPTH_MAX:
        _OUTGOING_QUEUE_DEPTH_MAX = total_depth


def record_outgoing_queue_enqueued(connection_id: int, depth: int, maxsize: int) -> None:
    global _OUTGOING_QUEUE_ENQUEUED_TOTAL
    with _LOCK:
        _OUTGOING_QUEUE_ENQUEUED_TOTAL += 1
        _record_outgoing_depth_locked(connection_id, depth, maxsize)


def record_outgoing_queue_dequeued(connection_id: int, depth: int, wait_ms: float | None = None) -> None:
    global _OUTGOING_QUEUE_DEQUEUED_TOTAL
    with _LOCK:
        _OUTGOING_QUEUE_DEQUEUED_TOTAL += 1
        _record_outgoing_depth_locked(connection_id, depth)
        if wait_ms is not None:
            _OUTGOING_QUEUE_WAIT_MS.append(float(max(0.0, wait_ms)))


def record_outgoing_queue_full(connection_id: int, maxsize: int) -> None:
    global _OUTGOING_QUEUE_FULL_TOTAL
    with _LOCK:
        _OUTGOING_QUEUE_FULL_TOTAL += 1
        _OUTGOING_QUEUE_MAXSIZE_BY_CONNECTION[int(connection_id)] = max(0, int(maxsize))


def clear_outgoing_queue_connection(connection_id: int) -> None:
    with _LOCK:
        _OUTGOING_QUEUE_DEPTH_BY_CONNECTION.pop(int(connection_id), None)
        _OUTGOING_QUEUE_MAXSIZE_BY_CONNECTION.pop(int(connection_id), None)


def record_kernel_lock_wait(wait_ms: float) -> None:
    with _LOCK:
        _KERNEL_LOCK_WAIT_MS.append(float(max(0.0, wait_ms)))


def record_template_handler_duration(handler_name: str, duration_ms: float) -> None:
    key = handler_name or "unknown"
    with _LOCK:
        _TEMPLATE_HANDLER_CALLS[key] += 1
        _TEMPLATE_HANDLER_MS[key].append(float(max(0.0, duration_ms)))


def record_unit_normalization_failure() -> None:
    global _UNIT_NORMALIZATION_FAILURES
    with _LOCK:
        _UNIT_NORMALIZATION_FAILURES += 1


def record_unit_conversion_failure(error_code: str) -> None:
    key = (error_code or "unknown").strip() or "unknown"
    with _LOCK:
        _UNIT_CONVERSION_FAILURES_BY_CODE[key] += 1


def record_quantity_serialization_fallback() -> None:
    global _QUANTITY_SERIALIZATION_FALLBACKS
    with _LOCK:
        _QUANTITY_SERIALIZATION_FALLBACKS += 1


def snapshot_metrics() -> dict[str, Any]:
    with _LOCK:
        queue_wait_work = list(_QUEUE_WAIT_MS["work"])
        queue_wait_preview = list(_QUEUE_WAIT_MS["preview"])
        kernel_wait = list(_KERNEL_LOCK_WAIT_MS)
        outgoing_wait = list(_OUTGOING_QUEUE_WAIT_MS)
        outgoing_depth_current = sum(_OUTGOING_QUEUE_DEPTH_BY_CONNECTION.values())
        outgoing_connections_with_backlog = sum(
            1
            for depth in _OUTGOING_QUEUE_DEPTH_BY_CONNECTION.values()
            if depth > 0
        )
        outgoing_queue_maxsize = max(_OUTGOING_QUEUE_MAXSIZE_BY_CONNECTION.values(), default=0)

        template_latency_summary: dict[str, dict[str, float | int | None]] = {}
        for handler_name, samples in _TEMPLATE_HANDLER_MS.items():
            sample_values = list(samples)
            template_latency_summary[handler_name] = {
                "calls": int(_TEMPLATE_HANDLER_CALLS.get(handler_name, 0)),
                "avg_ms": float(sum(sample_values) / len(sample_values)) if sample_values else None,
                "p95_ms": _quantile(sample_values, 0.95),
                "max_ms": max(sample_values) if sample_values else None,
            }

        return {
            "ws_payload_in_bytes_total": _WS_PAYLOAD_IN_TOTAL,
            "ws_payload_out_bytes_total": _WS_PAYLOAD_OUT_TOTAL,
            "ws_payload_in_max_bytes": _WS_PAYLOAD_IN_MAX,
            "ws_payload_out_max_bytes": _WS_PAYLOAD_OUT_MAX,
            "ws_work_queue_depth_current": _QUEUE_DEPTH_CURRENT["work"],
            "ws_preview_queue_depth_current": _QUEUE_DEPTH_CURRENT["preview"],
            "ws_work_queue_depth_max": _QUEUE_DEPTH_MAX["work"],
            "ws_preview_queue_depth_max": _QUEUE_DEPTH_MAX["preview"],
            "ws_work_queue_maxsize": _QUEUE_MAXSIZE["work"],
            "ws_preview_queue_maxsize": _QUEUE_MAXSIZE["preview"],
            "ws_work_queue_enqueued_total": _QUEUE_ENQUEUED_TOTAL["work"],
            "ws_preview_queue_enqueued_total": _QUEUE_ENQUEUED_TOTAL["preview"],
            "ws_work_queue_dequeued_total": _QUEUE_DEQUEUED_TOTAL["work"],
            "ws_preview_queue_dequeued_total": _QUEUE_DEQUEUED_TOTAL["preview"],
            "ws_work_queue_full_total": _QUEUE_FULL_TOTAL["work"],
            "ws_preview_queue_full_total": _QUEUE_FULL_TOTAL["preview"],
            "ws_work_queue_wait_p95_ms": _quantile(queue_wait_work, 0.95),
            "ws_preview_queue_wait_p95_ms": _quantile(queue_wait_preview, 0.95),
            "ws_outgoing_queue_depth_current": outgoing_depth_current,
            "ws_outgoing_queue_depth_max": _OUTGOING_QUEUE_DEPTH_MAX,
            "ws_outgoing_queue_maxsize": outgoing_queue_maxsize,
            "ws_outgoing_queue_connections_backlogged": outgoing_connections_with_backlog,
            "ws_outgoing_queue_enqueued_total": _OUTGOING_QUEUE_ENQUEUED_TOTAL,
            "ws_outgoing_queue_dequeued_total": _OUTGOING_QUEUE_DEQUEUED_TOTAL,
            "ws_outgoing_queue_full_total": _OUTGOING_QUEUE_FULL_TOTAL,
            "ws_outgoing_queue_wait_p95_ms": _quantile(outgoing_wait, 0.95),
            "kernel_lock_wait_samples": len(kernel_wait),
            "kernel_lock_wait_avg_ms": (sum(kernel_wait) / len(kernel_wait)) if kernel_wait else None,
            "kernel_lock_wait_p95_ms": _quantile(kernel_wait, 0.95),
            "kernel_lock_wait_max_ms": max(kernel_wait) if kernel_wait else None,
            "template_handler_latency": template_latency_summary,
            "unit_normalization_failures": _UNIT_NORMALIZATION_FAILURES,
            "unit_conversion_failures_by_code": dict(_UNIT_CONVERSION_FAILURES_BY_CODE),
            "quantity_serialization_fallbacks": _QUANTITY_SERIALIZATION_FALLBACKS,
        }
