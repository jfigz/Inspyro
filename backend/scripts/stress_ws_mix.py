"""Mixed websocket stress runner for Inspyro.

Scenarios include:
- notebook_execute_cell
- template_preview_style
- template_update_style
- force_reconvert_pdf
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

import websockets
try:
    from docx import Document
except ImportError:  # pragma: no cover - environment dependent
    Document = None


OPS = (
    "notebook_execute_cell",
    "template_preview_style",
    "template_update_style",
    "force_reconvert_pdf",
)


@dataclass
class Event:
    op: str
    latency_ms: float
    ok: bool
    response_type: str
    error_code: str | None = None


def build_operation_sequence(iterations: int) -> list[str]:
    sequence: list[str] = []
    for idx in range(max(0, iterations)):
        sequence.append(OPS[idx % len(OPS)])
    return sequence


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    if pct <= 0:
        return min(values)
    if pct >= 100:
        return max(values)
    sorted_values = sorted(values)
    rank = (pct / 100.0) * (len(sorted_values) - 1)
    low = int(rank)
    high = min(low + 1, len(sorted_values) - 1)
    weight = rank - low
    return (sorted_values[low] * (1.0 - weight)) + (sorted_values[high] * weight)


def summarize_events(events: list[Event]) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "totals": {"events": len(events), "ok": 0, "errors": 0},
        "operations": {},
    }
    for event in events:
        op_entry = summary["operations"].setdefault(
            event.op,
            {"count": 0, "ok": 0, "errors": 0, "latencies_ms": [], "p50_ms": None, "p95_ms": None},
        )
        op_entry["count"] += 1
        op_entry["latencies_ms"].append(event.latency_ms)
        if event.ok:
            op_entry["ok"] += 1
            summary["totals"]["ok"] += 1
        else:
            op_entry["errors"] += 1
            summary["totals"]["errors"] += 1

    for op_entry in summary["operations"].values():
        op_entry["p50_ms"] = percentile(op_entry["latencies_ms"], 50)
        op_entry["p95_ms"] = percentile(op_entry["latencies_ms"], 95)

    return summary


def build_template_b64() -> str:
    if Document is None:
        raise RuntimeError("python-docx is required to build stress template payloads")
    doc = Document()
    doc.add_paragraph("Inspyro stress template")
    stream = io.BytesIO()
    doc.save(stream)
    return base64.b64encode(stream.getvalue()).decode("ascii")


async def _send_json(ws, payload: dict[str, Any]) -> None:
    await ws.send(json.dumps(payload))


async def _wait_for_message(
    ws,
    *,
    predicate: Callable[[dict[str, Any]], bool],
    timeout_s: float,
) -> dict[str, Any]:
    deadline = asyncio.get_running_loop().time() + timeout_s
    while True:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise TimeoutError("timed out waiting for websocket response")
        raw = await asyncio.wait_for(ws.recv(), remaining)
        message = json.loads(raw)
        if predicate(message):
            return message


async def _bootstrap_kernel(ws, timeout_s: float) -> str:
    await _send_json(ws, {"type": "notebook_create"})
    created = await _wait_for_message(
        ws,
        predicate=lambda m: m.get("type") == "notebook_created" and bool(m.get("kernel_id")),
        timeout_s=timeout_s,
    )
    return str(created["kernel_id"])


async def _bootstrap_template(ws, kernel_id: str, template_b64: str, timeout_s: float) -> bool:
    request_id = f"tpl_boot_{uuid4().hex[:8]}"
    await _send_json(
        ws,
        {
            "type": "template_upload",
            "kernel_id": kernel_id,
            "docx_base64": template_b64,
            "request_id": request_id,
        },
    )
    response = await _wait_for_message(
        ws,
        predicate=lambda m: m.get("type") in {"template_uploaded", "template_error"} and m.get("request_id") == request_id,
        timeout_s=timeout_s,
    )
    return response.get("type") == "template_uploaded"


async def _run_operation(
    ws,
    *,
    op: str,
    kernel_id: str,
    worker_id: int,
    iter_idx: int,
    timeout_s: float,
) -> Event:
    started = time.perf_counter()
    if op == "notebook_execute_cell":
        execution_id = f"exec_{worker_id}_{iter_idx}_{uuid4().hex[:6]}"
        await _send_json(
            ws,
            {
                "type": "notebook_execute_cell",
                "kernel_id": kernel_id,
                "cell_id": f"stress_cell_{worker_id}_{iter_idx}",
                "source": [f"value = {iter_idx}", "print(value)"],
                "execution_id": execution_id,
                "emit_docx": True,
            },
        )
        response = await _wait_for_message(
            ws,
            predicate=lambda m: m.get("type") in {"notebook_cell_executed", "notebook_cell_error"}
            and m.get("execution_id") == execution_id,
            timeout_s=timeout_s,
        )
        ok = response.get("type") == "notebook_cell_executed"
    elif op == "template_preview_style":
        request_id = f"tpl_prev_{worker_id}_{iter_idx}_{uuid4().hex[:6]}"
        await _send_json(
            ws,
            {
                "type": "template_preview_style",
                "kernel_id": kernel_id,
                "style_name": "Normal",
                "style_props": {},
                "preview_key": f"stress_preview_{iter_idx % 3}",
                "request_id": request_id,
            },
        )
        response = await _wait_for_message(
            ws,
            predicate=lambda m: m.get("type") in {"template_preview_ready", "template_preview_error", "template_error"}
            and m.get("request_id") == request_id,
            timeout_s=timeout_s,
        )
        ok = response.get("type") == "template_preview_ready"
    elif op == "template_update_style":
        request_id = f"tpl_upd_{worker_id}_{iter_idx}_{uuid4().hex[:6]}"
        await _send_json(
            ws,
            {
                "type": "template_update_style",
                "kernel_id": kernel_id,
                "style_name": "Normal",
                "updates": {"font_size_pt": 10 + (iter_idx % 4)},
                "request_id": request_id,
            },
        )
        response = await _wait_for_message(
            ws,
            predicate=lambda m: m.get("type") in {"template_style_updated", "template_error"}
            and m.get("request_id") == request_id,
            timeout_s=timeout_s,
        )
        ok = response.get("type") == "template_style_updated"
    elif op == "force_reconvert_pdf":
        await _send_json(
            ws,
            {
                "type": "force_reconvert_pdf",
                "kernel_id": kernel_id,
            },
        )
        response = await _wait_for_message(
            ws,
            predicate=lambda m: m.get("type") == "pdf_reconverted" and m.get("kernel_id") == kernel_id,
            timeout_s=timeout_s,
        )
        ok = response.get("status") == "ok"
    else:
        raise ValueError(f"Unsupported operation: {op}")

    latency_ms = (time.perf_counter() - started) * 1000.0
    return Event(
        op=op,
        latency_ms=latency_ms,
        ok=bool(ok),
        response_type=str(response.get("type", "unknown")),
        error_code=response.get("error_code"),
    )


async def run_worker(
    *,
    worker_id: int,
    ws_url: str,
    timeout_s: float,
    iterations: int,
    sleep_ms: float,
    template_b64: str,
) -> list[Event]:
    events: list[Event] = []
    async with websockets.connect(ws_url, max_size=20 * 1024 * 1024) as ws:
        kernel_id = await _bootstrap_kernel(ws, timeout_s)
        template_ok = await _bootstrap_template(ws, kernel_id, template_b64, timeout_s)
        sequence = build_operation_sequence(iterations)
        for idx, op in enumerate(sequence):
            if op.startswith("template_") and not template_ok:
                continue
            try:
                event = await _run_operation(
                    ws,
                    op=op,
                    kernel_id=kernel_id,
                    worker_id=worker_id,
                    iter_idx=idx,
                    timeout_s=timeout_s,
                )
                events.append(event)
            except Exception as exc:  # noqa: BLE001
                events.append(
                    Event(
                        op=op,
                        latency_ms=0.0,
                        ok=False,
                        response_type="client_error",
                        error_code=type(exc).__name__,
                    )
                )
            if sleep_ms > 0:
                await asyncio.sleep(sleep_ms / 1000.0)

        await _send_json(ws, {"type": "notebook_shutdown_kernel", "kernel_id": kernel_id})
    return events


async def run_stress(
    *,
    ws_url: str,
    connections: int,
    iterations: int,
    timeout_s: float,
    sleep_ms: float,
) -> dict[str, Any]:
    template_b64 = build_template_b64()
    all_events: list[Event] = []
    workers = [
        run_worker(
            worker_id=idx,
            ws_url=ws_url,
            timeout_s=timeout_s,
            iterations=iterations,
            sleep_ms=sleep_ms,
            template_b64=template_b64,
        )
        for idx in range(connections)
    ]
    worker_results = await asyncio.gather(*workers)
    for worker_events in worker_results:
        all_events.extend(worker_events)
    return summarize_events(all_events)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run mixed websocket stress scenarios against Inspyro backend.")
    parser.add_argument("--ws-url", default="ws://localhost:8000/ws", help="WebSocket endpoint")
    parser.add_argument("--connections", type=int, default=5, help="Concurrent websocket clients")
    parser.add_argument("--iterations", type=int, default=20, help="Operations per client")
    parser.add_argument("--timeout-s", type=float, default=30.0, help="Per-operation timeout")
    parser.add_argument("--sleep-ms", type=float, default=0.0, help="Delay between operations")
    parser.add_argument("--out", type=str, default="", help="Optional JSON report output path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    started = time.perf_counter()
    report = asyncio.run(
        run_stress(
            ws_url=args.ws_url,
            connections=max(1, args.connections),
            iterations=max(1, args.iterations),
            timeout_s=max(1.0, args.timeout_s),
            sleep_ms=max(0.0, args.sleep_ms),
        )
    )
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    report["run"] = {
        "ws_url": args.ws_url,
        "connections": args.connections,
        "iterations": args.iterations,
        "timeout_s": args.timeout_s,
        "sleep_ms": args.sleep_ms,
        "elapsed_ms": elapsed_ms,
    }

    print(json.dumps(report, indent=2, ensure_ascii=False))

    if args.out:
        output_path = Path(args.out)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nReport written to: {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
