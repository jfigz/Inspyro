from __future__ import annotations

import asyncio
from pathlib import Path
from queue import Empty as QueueEmpty
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import jupyter_kernel as jupyter_kernel_module
from app.services.jupyter_kernel import JupyterKernelManager, KernelSession


class _FakeShellChannel:
    def __init__(self, reply: dict) -> None:
        self._reply = reply
        self._sent = False

    async def get_msg(self, timeout=None) -> dict:
        if not self._sent:
            self._sent = True
            return self._reply
        raise asyncio.TimeoutError()


class _StreamThenBrokenIopubChannel:
    def __init__(self, parent_msg_id: str) -> None:
        self.parent_msg_id = parent_msg_id
        self._calls = 0

    async def get_msg(self, timeout=None) -> dict:
        self._calls += 1
        if self._calls == 1:
            return {
                "parent_header": {"msg_id": self.parent_msg_id},
                "msg_type": "stream",
                "content": {"name": "stdout", "text": "ok\n"},
            }
        raise RuntimeError()


class _IdleIopubChannel:
    def __init__(self, parent_msg_id: str) -> None:
        self.parent_msg_id = parent_msg_id
        self._sent = False

    async def get_msg(self, timeout=None) -> dict:
        if not self._sent:
            self._sent = True
            return {
                "parent_header": {"msg_id": self.parent_msg_id},
                "msg_type": "status",
                "content": {"execution_state": "idle"},
            }
        raise asyncio.TimeoutError()


class _UnparentedIdleIopubChannel:
    def __init__(self) -> None:
        self._sent = False

    async def get_msg(self, timeout=None) -> dict:
        if not self._sent:
            self._sent = True
            return {
                "parent_header": {},
                "msg_type": "status",
                "content": {"execution_state": "idle"},
            }
        raise asyncio.TimeoutError()


class _EmptyThenIdleIopubChannel:
    def __init__(self, parent_msg_id: str) -> None:
        self.parent_msg_id = parent_msg_id
        self._calls = 0

    async def get_msg(self, timeout=None) -> dict:
        self._calls += 1
        if self._calls == 1:
            raise QueueEmpty()
        if self._calls == 2:
            return {
                "parent_header": {"msg_id": self.parent_msg_id},
                "msg_type": "status",
                "content": {"execution_state": "idle"},
            }
        raise asyncio.TimeoutError()


class _FakeClient:
    def __init__(self, *, parent_msg_id: str, shell_channel, iopub_channel) -> None:
        self._parent_msg_id = parent_msg_id
        self.shell_channel = shell_channel
        self.iopub_channel = iopub_channel

    def execute(self, *args, **kwargs) -> str:
        return self._parent_msg_id


class _RestartTrackingClient(_FakeClient):
    def __init__(self, *, parent_msg_id: str) -> None:
        super().__init__(
            parent_msg_id=parent_msg_id,
            shell_channel=_FakeShellChannel(
                {
                    "parent_header": {"msg_id": parent_msg_id},
                    "msg_type": "execute_reply",
                    "content": {"execution_count": 1},
                }
            ),
            iopub_channel=_IdleIopubChannel(parent_msg_id),
        )
        self.started = 0
        self.stopped = 0

    def start_channels(self) -> None:
        self.started += 1

    def stop_channels(self) -> None:
        self.stopped += 1


class _RestartTrackingManager:
    def __init__(self, new_client: _RestartTrackingClient) -> None:
        self.new_client = new_client
        self.restart_calls: list[bool] = []

    async def restart_kernel(self, now: bool = False) -> None:
        self.restart_calls.append(now)

    def client(self) -> _RestartTrackingClient:
        return self.new_client


class _StartupRetryClient:
    def __init__(self, parent_msg_id: str) -> None:
        self.parent_msg_id = parent_msg_id
        self.started = 0
        self.stopped = 0

    def start_channels(self) -> None:
        self.started += 1

    def stop_channels(self) -> None:
        self.stopped += 1

    def execute(self, *args, **kwargs) -> str:
        return self.parent_msg_id


def _build_session(client: _FakeClient) -> KernelSession:
    return KernelSession(
        kernel_id="kernel-test",
        manager=SimpleNamespace(),
        client=client,
        execute_lock=asyncio.Lock(),
    )


@pytest.mark.asyncio
async def test_execute_cell_locked_returns_after_iopub_error_with_diagnostics():
    parent_msg_id = "msg-stream"
    client = _FakeClient(
        parent_msg_id=parent_msg_id,
        shell_channel=_FakeShellChannel(
            {
                "parent_header": {"msg_id": parent_msg_id},
                "msg_type": "execute_reply",
                "content": {"execution_count": 7},
            }
        ),
        iopub_channel=_StreamThenBrokenIopubChannel(parent_msg_id),
    )
    manager = JupyterKernelManager()

    outputs, execution_count, variables, extras = await manager._execute_cell_locked(
        session=_build_session(client),
        code="print(1)",
        capture_variables=False,
    )

    assert execution_count == 7
    assert variables == {}
    assert outputs == [{"output_type": "stream", "name": "stdout", "text": "ok\n"}]
    assert extras["execution_diagnostics"]["iopub_error"] == "RuntimeError"
    assert extras["execution_diagnostics"]["idle_missing"] is True


@pytest.mark.asyncio
async def test_execute_cell_locked_treats_empty_iopub_reads_as_benign():
    parent_msg_id = "msg-empty"
    client = _FakeClient(
        parent_msg_id=parent_msg_id,
        shell_channel=_FakeShellChannel(
            {
                "parent_header": {"msg_id": parent_msg_id},
                "msg_type": "execute_reply",
                "content": {"execution_count": 4},
            }
        ),
        iopub_channel=_EmptyThenIdleIopubChannel(parent_msg_id),
    )
    manager = JupyterKernelManager()

    outputs, execution_count, variables, extras = await manager._execute_cell_locked(
        session=_build_session(client),
        code="print(1)",
        capture_variables=False,
    )

    assert outputs == []
    assert execution_count == 4
    assert variables == {}
    assert extras["performance_data"] == {}
    assert extras.get("execution_diagnostics") is None


@pytest.mark.asyncio
async def test_wait_for_idle_accepts_unparented_idle_status():
    parent_msg_id = "msg-unparented-idle"
    client = _FakeClient(
        parent_msg_id=parent_msg_id,
        shell_channel=_FakeShellChannel({}),
        iopub_channel=_UnparentedIdleIopubChannel(),
    )
    manager = JupyterKernelManager()

    assert await manager._wait_for_idle(client, parent_msg_id=parent_msg_id, timeout=1) is True


@pytest.mark.asyncio
async def test_execute_cell_locked_uses_last_snapshot_when_variable_capture_times_out(monkeypatch):
    parent_msg_id = "msg-vars"
    client = _FakeClient(
        parent_msg_id=parent_msg_id,
        shell_channel=_FakeShellChannel(
            {
                "parent_header": {"msg_id": parent_msg_id},
                "msg_type": "execute_reply",
                "content": {"execution_count": 11},
            }
        ),
        iopub_channel=_IdleIopubChannel(parent_msg_id),
    )
    manager = JupyterKernelManager()
    session = _build_session(client)
    session.last_variables = {"foo": {"type": "int", "repr": "1"}}
    session.last_extras = {
        "performance_data": {"cached": True},
        "execution_states": [{"cached": True}],
    }

    async def _timeout_capture(*args, **kwargs):
        raise asyncio.TimeoutError()

    monkeypatch.setattr(manager, "_capture_variables_summary", _timeout_capture)
    monkeypatch.setattr(jupyter_kernel_module, "VARIABLE_CAPTURE_RETRY_COUNT", 0)
    monkeypatch.setattr(jupyter_kernel_module, "VARIABLE_CAPTURE_RETRY_DELAY", 0.0)

    outputs, execution_count, variables, extras = await manager._execute_cell_locked(
        session=session,
        code="foo = 2",
        capture_variables=True,
    )

    assert outputs == []
    assert execution_count == 11
    assert variables == session.last_variables
    assert extras["performance_data"] == {"cached": True}
    assert extras["execution_states"] == [{"cached": True}]
    assert extras["variables_snapshot_fallback"] is True
    assert extras["variables_snapshot_degraded"] is True
    assert extras["execution_diagnostics"]["variables_capture_timeout"] is True
    assert extras["execution_diagnostics"]["variables_capture_degraded"] is True
    assert extras["execution_diagnostics"]["variables_capture_error"] == "timeout"


@pytest.mark.asyncio
async def test_execute_cell_locked_forwards_custom_execution_timeout(monkeypatch):
    parent_msg_id = "msg-timeout"
    client = _FakeClient(
        parent_msg_id=parent_msg_id,
        shell_channel=_FakeShellChannel(
            {
                "parent_header": {"msg_id": parent_msg_id},
                "msg_type": "execute_reply",
                "content": {"execution_count": 3},
            }
        ),
        iopub_channel=_IdleIopubChannel(parent_msg_id),
    )
    manager = JupyterKernelManager()
    observed: dict[str, float] = {}

    async def _spy_wait_for_execute_reply(kc, msg_id, timeout=0):
        observed["reply_timeout"] = timeout
        return {
            "parent_header": {"msg_id": msg_id},
            "msg_type": "execute_reply",
            "content": {"execution_count": 3},
        }

    async def _spy_collect_iopub_outputs(kc, msg_id, outputs, display_id_to_index, timeout=0, on_iopub=None):
        observed["iopub_timeout"] = timeout
        return {}

    monkeypatch.setattr(manager, "_wait_for_execute_reply", _spy_wait_for_execute_reply)
    monkeypatch.setattr(manager, "_collect_iopub_outputs", _spy_collect_iopub_outputs)

    outputs, execution_count, variables, extras = await manager._execute_cell_locked(
        session=_build_session(client),
        code="print(1)",
        capture_variables=False,
        execution_timeout=42,
    )

    assert outputs == []
    assert execution_count == 3
    assert variables == {}
    assert extras["performance_data"] == {}
    assert observed == {"reply_timeout": 42.0, "iopub_timeout": 42.0}


@pytest.mark.asyncio
async def test_execute_cell_locked_cancels_iopub_task_when_execute_reply_times_out(monkeypatch):
    parent_msg_id = "msg-timeout-cancel"
    client = _FakeClient(
        parent_msg_id=parent_msg_id,
        shell_channel=_FakeShellChannel(
            {
                "parent_header": {"msg_id": parent_msg_id},
                "msg_type": "execute_reply",
                "content": {"execution_count": 0},
            }
        ),
        iopub_channel=_IdleIopubChannel(parent_msg_id),
    )
    manager = JupyterKernelManager()
    iopub_cancelled = asyncio.Event()

    async def _timeout_wait_for_execute_reply(kc, msg_id, timeout=0):
        raise TimeoutError("Timeout esperando execute_reply")

    async def _pending_collect_iopub_outputs(kc, msg_id, outputs, display_id_to_index, timeout=0, on_iopub=None):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            iopub_cancelled.set()
            raise

    monkeypatch.setattr(manager, "_wait_for_execute_reply", _timeout_wait_for_execute_reply)
    monkeypatch.setattr(manager, "_collect_iopub_outputs", _pending_collect_iopub_outputs)

    with pytest.raises(TimeoutError, match="execute_reply"):
        await manager._execute_cell_locked(
            session=_build_session(client),
            code="print(1)",
            capture_variables=False,
            execution_timeout=1,
        )

    assert iopub_cancelled.is_set() is True


@pytest.mark.asyncio
async def test_session_readiness_health_check_restarts_once_before_execution(monkeypatch):
    parent_msg_id = "msg-health"
    client = _FakeClient(
        parent_msg_id=parent_msg_id,
        shell_channel=_FakeShellChannel(
            {
                "parent_header": {"msg_id": parent_msg_id},
                "msg_type": "execute_reply",
                "content": {"execution_count": 1},
            }
        ),
        iopub_channel=_IdleIopubChannel(parent_msg_id),
    )
    manager = JupyterKernelManager()
    session = _build_session(client)
    manager._sessions[session.kernel_id] = session
    idle_results = [False, True]
    restart_calls: list[str] = []

    async def _no_stale_messages(*args, **kwargs):
        return 0

    async def _execute_reply(*args, **kwargs):
        return {
            "parent_header": {"msg_id": parent_msg_id},
            "msg_type": "execute_reply",
            "content": {"execution_count": 1},
        }

    async def _idle_once_after_restart(*args, **kwargs):
        return idle_results.pop(0)

    async def _restart(kernel_id: str):
        restart_calls.append(kernel_id)

    monkeypatch.setattr(manager, "_drain_stale_channel_messages", _no_stale_messages)
    monkeypatch.setattr(manager, "_wait_for_execute_reply", _execute_reply)
    monkeypatch.setattr(manager, "_wait_for_idle", _idle_once_after_restart)
    monkeypatch.setattr(manager, "restart_kernel", _restart)

    await manager._ensure_session_ready_locked(session)

    assert restart_calls == ["kernel-test"]
    assert session.ready is True
    assert session.last_kernel_diagnostics["health_check_ready"] is True
    assert session.last_kernel_diagnostics["health_check_attempt"] == 2


@pytest.mark.asyncio
async def test_start_kernel_recreates_once_when_startup_idle_is_missing(monkeypatch):
    created_managers = []

    class _StartupRetryManager:
        def __init__(self, kernel_name: str = "python3") -> None:
            self.kernel_name = kernel_name
            self.kernel_id = f"kernel-start-{len(created_managers) + 1}"
            self.client_obj = _StartupRetryClient(f"msg-{len(created_managers) + 1}")
            self.shutdown_calls: list[bool] = []
            created_managers.append(self)

        async def start_kernel(self, **kwargs) -> None:
            return None

        async def shutdown_kernel(self, now: bool = False) -> None:
            self.shutdown_calls.append(now)

        def client(self) -> _StartupRetryClient:
            return self.client_obj

    manager = JupyterKernelManager()
    idle_results = [False, True]

    async def _idle_once_after_recreate(*args, **kwargs):
        return idle_results.pop(0)

    monkeypatch.setattr(jupyter_kernel_module, "AsyncKernelManager", _StartupRetryManager)
    monkeypatch.setattr(manager, "_wait_for_idle", _idle_once_after_recreate)

    kernel_id = await manager.start_kernel()

    assert kernel_id == "kernel-start-2"
    assert len(created_managers) == 2
    assert created_managers[0].client_obj.stopped == 1
    assert created_managers[0].shutdown_calls == [True]
    assert manager.get_kernel_diagnostics(kernel_id)["ready"] is True


@pytest.mark.asyncio
async def test_restart_kernel_recreates_the_client_instead_of_reusing_threads():
    manager = JupyterKernelManager()
    old_client = _RestartTrackingClient(parent_msg_id="msg-old")
    new_client = _RestartTrackingClient(parent_msg_id="msg-new")
    session = KernelSession(
        kernel_id="kernel-test",
        manager=_RestartTrackingManager(new_client),
        client=old_client,
        execute_lock=asyncio.Lock(),
    )
    manager._sessions["kernel-test"] = session

    await manager.restart_kernel("kernel-test")

    assert old_client.stopped == 1
    assert old_client.started == 0
    assert new_client.started == 1
    assert session.client is new_client
    assert session.manager.restart_calls == [True]
