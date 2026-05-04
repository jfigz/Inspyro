from __future__ import annotations

import asyncio

import pytest

from app.core import state


class _FakeWebSocket:
    pass


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    state._connection_kernels.clear()
    state._active_execution_by_kernel.clear()
    state._cancelled_executions_by_kernel.clear()
    state._pending_disconnect_cleanup.clear()

    shutdown_calls: list[str] = []

    class _FakeKernelManager:
        async def shutdown_kernel(self, kernel_id: str) -> None:
            shutdown_calls.append(kernel_id)

    monkeypatch.setattr(state, "jupyter_kernel_manager", _FakeKernelManager())
    monkeypatch.setattr(state.template_storage, "delete_template", lambda kernel_id: None)
    monkeypatch.setattr(state.template_preview, "clear_preview_cache", lambda kernel_id: None)
    monkeypatch.setattr(state.template_service, "cleanup_kernel_processes", lambda kernel_id: None)
    monkeypatch.setattr(state, "clear_kernel_runtime_state", lambda kernel_id: None)
    monkeypatch.setattr(state, "cleanup_inline_builders", lambda: None)
    monkeypatch.setattr(state, "KERNEL_DISCONNECT_GRACE_S", 0.05)

    yield shutdown_calls

    for task in list(state._pending_disconnect_cleanup.values()):
        task.cancel()
    state._pending_disconnect_cleanup.clear()
    state._connection_kernels.clear()
    state._active_execution_by_kernel.clear()
    state._cancelled_executions_by_kernel.clear()


@pytest.mark.asyncio
async def test_disconnect_schedules_cleanup_instead_of_immediate_shutdown(_reset_state):
    shutdown_calls = _reset_state
    websocket = _FakeWebSocket()

    await state.track_kernel_for_connection(websocket, "kernel-1")
    payload = await state.cleanup_notebook_connection(websocket)

    assert payload["scheduled_cleanup_kernel_ids"] == ["kernel-1"]
    assert shutdown_calls == []

    await asyncio.sleep(0.12)

    assert shutdown_calls == ["kernel-1"]


@pytest.mark.asyncio
async def test_reconnect_cancels_pending_disconnect_cleanup(_reset_state):
    shutdown_calls = _reset_state
    first_websocket = _FakeWebSocket()
    second_websocket = _FakeWebSocket()

    await state.track_kernel_for_connection(first_websocket, "kernel-1")
    await state.cleanup_notebook_connection(first_websocket)
    await asyncio.sleep(0.02)
    await state.track_kernel_for_connection(second_websocket, "kernel-1")
    await asyncio.sleep(0.12)

    assert shutdown_calls == []


@pytest.mark.asyncio
async def test_bind_kernel_to_connection_reassigns_kernel_ownership():
    first_websocket = _FakeWebSocket()
    second_websocket = _FakeWebSocket()

    await state.track_kernel_for_connection(first_websocket, "kernel-1")
    await state.bind_kernel_to_connection(second_websocket, "kernel-1")

    assert "kernel-1" not in state._connection_kernels.get(id(first_websocket), set())
    assert "kernel-1" in state._connection_kernels.get(id(second_websocket), set())


@pytest.mark.asyncio
async def test_active_execution_defers_disconnect_cleanup_until_execution_finishes(_reset_state):
    shutdown_calls = _reset_state
    websocket = _FakeWebSocket()

    await state.track_kernel_for_connection(websocket, "kernel-1")
    await state.mark_execution_started("kernel-1", "exec-1")
    await state.cleanup_notebook_connection(websocket)

    await asyncio.sleep(0.12)
    assert shutdown_calls == []

    await state.mark_execution_finished("kernel-1", "exec-1")
    await asyncio.sleep(0.12)

    assert shutdown_calls == ["kernel-1"]


@pytest.mark.asyncio
async def test_cancel_without_execution_id_targets_running_execution_not_queued():
    await state.mark_execution_running("kernel-1", "exec-running")
    await state.mark_execution_queued("kernel-1", "exec-queued")

    cancelled_execution_id = await state.cancel_kernel_execution("kernel-1", None)

    assert cancelled_execution_id == "exec-running"
    assert await state.is_execution_cancelled("kernel-1", "exec-running") is True
    assert await state.is_execution_cancelled("kernel-1", "exec-queued") is False
