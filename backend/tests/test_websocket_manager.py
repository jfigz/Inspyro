import asyncio
import json
import os
import sys

import pytest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import runtime_metrics
from app.services.websocket_manager import ConnectionManager


class _SharedSendTracker:
    def __init__(self):
        self.active = 0
        self.max_active = 0

    def begin(self) -> None:
        self.active += 1
        if self.active > self.max_active:
            self.max_active = self.active

    def end(self) -> None:
        self.active = max(0, self.active - 1)


class _FakeWebSocket:
    def __init__(self, *, send_delay: float = 0.0, block_event: asyncio.Event | None = None, tracker: _SharedSendTracker | None = None):
        self.accepted = False
        self.sent_texts: list[str] = []
        self.send_delay = send_delay
        self.block_event = block_event
        self.tracker = tracker
        self.active_sends = 0
        self.max_active_sends = 0
        self.closed_calls: list[tuple[int | None, str | None]] = []
        self.send_started = asyncio.Event()

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code=None, reason=None) -> None:
        self.closed_calls.append((code, reason))

    async def send_text(self, payload: str) -> None:
        self.active_sends += 1
        if self.active_sends > self.max_active_sends:
            self.max_active_sends = self.active_sends
        if self.tracker is not None:
            self.tracker.begin()
        self.send_started.set()
        try:
            if self.block_event is not None:
                await self.block_event.wait()
            if self.send_delay > 0:
                await asyncio.sleep(self.send_delay)
            self.sent_texts.append(payload)
        finally:
            self.active_sends = max(0, self.active_sends - 1)
            if self.tracker is not None:
                self.tracker.end()


async def _wait_for(predicate, *, timeout: float = 1.0, interval: float = 0.01) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return
        await asyncio.sleep(interval)
    raise AssertionError("Timed out waiting for condition")


@pytest.mark.asyncio
async def test_send_personal_message_sanitizes_non_finite_numbers():
    manager = ConnectionManager()
    websocket = _FakeWebSocket()
    await manager.connect(websocket)

    try:
        ok = await manager.send_personal_message(
            {
                "type": "notebook_cell_executed",
                "cell_id": "cell-10",
                "variables": {
                    "df_result": {
                        "type": "DataFrame",
                        "preview": [
                            {"z": 10.14, "disp": float("nan")},
                            {"z": 18.0, "disp": float("inf")},
                        ],
                    }
                },
                "execution_states": [
                    {
                        "variables": {
                            "angulo": {"value": float("-inf"), "repr": "-inf"},
                        }
                    }
                ],
            },
            websocket,
        )

        assert ok is True
        await _wait_for(lambda: len(websocket.sent_texts) == 1)

        encoded = websocket.sent_texts[-1]
        assert "NaN" not in encoded
        assert "Infinity" not in encoded

        payload = json.loads(encoded)
        preview = payload["variables"]["df_result"]["preview"]
        assert preview[0]["disp"] is None
        assert preview[1]["disp"] is None
        assert payload["execution_states"][0]["variables"]["angulo"]["value"] is None
    finally:
        await manager.disconnect(websocket)


@pytest.mark.asyncio
async def test_broadcast_sanitizes_non_finite_numbers_for_all_connections():
    manager = ConnectionManager()
    ws_a = _FakeWebSocket()
    ws_b = _FakeWebSocket()
    await manager.connect(ws_a)
    await manager.connect(ws_b)

    try:
        sent = await manager.broadcast(
            {
                "type": "notebook_progress_update",
                "progress": {"fraction": float("nan"), "eta_seconds": float("inf")},
            }
        )

        assert sent == 2
        await _wait_for(lambda: len(ws_a.sent_texts) == 1 and len(ws_b.sent_texts) == 1)

        payload = json.loads(ws_a.sent_texts[0])
        assert payload["progress"]["fraction"] is None
        assert payload["progress"]["eta_seconds"] is None
    finally:
        await manager.disconnect(ws_a)
        await manager.disconnect(ws_b)


@pytest.mark.asyncio
async def test_send_personal_message_serializes_concurrent_writes_for_single_connection():
    manager = ConnectionManager()
    websocket = _FakeWebSocket(send_delay=0.05)
    await manager.connect(websocket)

    try:
        await asyncio.gather(
            manager.send_personal_message({"type": "notebook_stream", "sequence": 1}, websocket),
            manager.send_personal_message({"type": "notebook_progress_update", "sequence": 2}, websocket),
            manager.send_personal_message({"type": "notebook_docx_update", "sequence": 3}, websocket),
            manager.send_personal_message({"type": "notebook_pdf_ready", "sequence": 4}, websocket),
        )

        await _wait_for(lambda: len(websocket.sent_texts) == 4, timeout=2.0)

        assert websocket.max_active_sends == 1
        payload_types = [json.loads(payload)["type"] for payload in websocket.sent_texts]
        assert payload_types == [
            "notebook_stream",
            "notebook_progress_update",
            "notebook_docx_update",
            "notebook_pdf_ready",
        ]
    finally:
        await manager.disconnect(websocket)


@pytest.mark.asyncio
async def test_separate_connections_can_drain_in_parallel():
    manager = ConnectionManager()
    tracker = _SharedSendTracker()
    ws_a = _FakeWebSocket(send_delay=0.05, tracker=tracker)
    ws_b = _FakeWebSocket(send_delay=0.05, tracker=tracker)
    await manager.connect(ws_a)
    await manager.connect(ws_b)

    try:
        await asyncio.gather(
            manager.send_personal_message({"type": "notebook_stream", "path": "A", "sequence": 1}, ws_a),
            manager.send_personal_message({"type": "notebook_docx_update", "path": "A", "sequence": 2}, ws_a),
            manager.send_personal_message({"type": "notebook_stream", "path": "B", "sequence": 1}, ws_b),
            manager.send_personal_message({"type": "notebook_pdf_ready", "path": "B", "sequence": 2}, ws_b),
        )

        await _wait_for(lambda: len(ws_a.sent_texts) == 2 and len(ws_b.sent_texts) == 2, timeout=2.0)

        assert ws_a.max_active_sends == 1
        assert ws_b.max_active_sends == 1
        assert tracker.max_active >= 2
    finally:
        await manager.disconnect(ws_a)
        await manager.disconnect(ws_b)


@pytest.mark.asyncio
async def test_outgoing_queue_saturation_disconnects_connection_to_protect_notebooks():
    metrics_before = runtime_metrics.snapshot_metrics()
    manager = ConnectionManager(outgoing_queue_maxsize=1)
    gate = asyncio.Event()
    websocket = _FakeWebSocket(block_event=gate)
    await manager.connect(websocket)

    try:
        assert await manager.send_personal_message({"type": "notebook_stream", "sequence": 1}, websocket) is True
        await _wait_for(lambda: websocket.send_started.is_set())

        assert await manager.send_personal_message({"type": "notebook_docx_update", "sequence": 2}, websocket) is True
        assert await manager.send_personal_message({"type": "notebook_pdf_ready", "sequence": 3}, websocket) is False

        await _wait_for(lambda: len(websocket.closed_calls) == 1)

        assert manager.connection_count == 0
        close_code, close_reason = websocket.closed_calls[0]
        assert close_code == 1013
        assert close_reason == "outgoing_queue_saturated"

        metrics_after = runtime_metrics.snapshot_metrics()
        assert metrics_after["ws_outgoing_queue_full_total"] >= metrics_before["ws_outgoing_queue_full_total"] + 1
    finally:
        gate.set()
        await manager.disconnect(websocket)
