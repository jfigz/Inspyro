from __future__ import annotations

import asyncio
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mcp_server import runtime


class _SlowRootsContext:
    async def list_roots(self):
        await asyncio.sleep(10)


class _RootsContext:
    async def list_roots(self):
        return [
            {"uri": "file:///tmp/demo"},
            {"path": "C:/workspace/project"},
        ]


@pytest.mark.asyncio
async def test_list_root_paths_returns_empty_on_timeout(monkeypatch):
    monkeypatch.setattr(runtime, "get_current_context", lambda: _SlowRootsContext())
    monkeypatch.setattr(runtime, "ROOTS_REQUEST_TIMEOUT_S", 0.01)

    result = await runtime.list_root_paths()

    assert result == []


@pytest.mark.asyncio
async def test_list_root_paths_normalizes_roots(monkeypatch):
    monkeypatch.setattr(runtime, "get_current_context", lambda: _RootsContext())
    monkeypatch.setattr(runtime, "ROOTS_REQUEST_TIMEOUT_S", 0.5)

    result = await runtime.list_root_paths()

    assert any(path.lower().endswith("tmp\\demo") or path.lower().endswith("/tmp/demo") for path in result)
    assert any(path.lower().endswith("workspace\\project") or path.lower().endswith("workspace/project") for path in result)


def test_select_default_root_picks_deterministic_child_root():
    workspace_root = "C:/workspace/project"
    roots = [
        "C:/workspace/project/b",
        "C:/workspace/project/a",
    ]

    result = runtime.select_default_root(workspace_root, roots)

    assert result is not None
    assert result.lower().endswith("workspace\\project\\a") or result.lower().endswith("workspace/project/a")
