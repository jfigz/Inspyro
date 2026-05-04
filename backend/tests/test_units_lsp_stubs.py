# -*- coding: utf-8 -*-
"""Tests de Fase 3 para stubs LSP de unidades de ingenieria."""

import asyncio
import os
import sys
from pathlib import Path
import subprocess


# Permite imports desde backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.lsp_bridge import LSPBridge


def test_inspyro_units_stub_exists() -> None:
    stub_path = Path(__file__).resolve().parents[1] / "stubs" / "inspyro_units.pyi"
    assert stub_path.exists()


def test_inspyro_units_stub_is_valid_python_syntax() -> None:
    stub_path = Path(__file__).resolve().parents[1] / "stubs" / "inspyro_units.pyi"
    source = stub_path.read_text(encoding="utf-8")
    compile(source, str(stub_path), "exec")


def test_lsp_bridge_build_extra_paths_normalizes_and_deduplicates() -> None:
    backend_stubs = str((LSPBridge._BACKEND_DIR / "stubs").resolve())
    paths = LSPBridge.build_extra_paths(["stubs", backend_stubs, "stubs"])

    assert backend_stubs in paths
    assert paths[0] == backend_stubs
    assert len(paths) == len(set(paths))


def test_lsp_bridge_start_uses_blocking_subprocess_launch(monkeypatch) -> None:
    class _DummyProcess:
        def __init__(self) -> None:
            self.pid = 12345
            self.stdin = object()
            self.stdout = object()
            self.stderr = None

        def poll(self):
            return None

        def terminate(self) -> None:
            return None

        def wait(self, timeout=None) -> int:
            return 0

    calls: list[tuple[list[str], dict]] = []

    def fake_popen(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return _DummyProcess()

    async def fake_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    async def _run() -> None:
        bridge = LSPBridge()
        started = await bridge.start()
        assert started is True
        assert calls
        _cmd, kwargs = calls[0]
        assert kwargs["stdin"] == subprocess.PIPE
        assert kwargs["stdout"] == subprocess.PIPE
        assert kwargs["stderr"] == subprocess.PIPE
        assert kwargs["cwd"] == str(LSPBridge._BACKEND_DIR)
        await bridge.stop()

    asyncio.run(_run())
