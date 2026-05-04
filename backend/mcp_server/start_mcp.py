"""Inspyro MCP Server - entrypoint script."""

from __future__ import annotations

import argparse
import os
import sys
import time

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

_BACKEND_PROBE_INTERVAL_SEC = 0.5


def _wants_stdio(argv: list[str]) -> bool:
    return "--stdio" in argv


def _stderr_print(*parts: object) -> None:
    print(*parts, file=sys.stderr)


def _parse_start_args(argv: list[str]) -> tuple[argparse.Namespace, list[str]]:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument(
        "--wait-for-backend",
        type=float,
        default=None,
        help="Espera/reintento antes de fallar si el backend aun no responde.",
    )
    return parser.parse_known_args(argv)


def _check_dependencies(*, silent: bool = False) -> bool:
    """Verify MCP runtime dependencies."""
    missing = []
    try:
        import fastmcp  # noqa: F401
    except ImportError:
        missing.append("fastmcp[tasks]>=3.0.0")
    try:
        from fastmcp.server import tasks as _fastmcp_tasks  # noqa: F401
    except ImportError:
        missing.append("fastmcp[tasks]>=3.0.0")
    try:
        import httpx  # noqa: F401
    except ImportError:
        missing.append("httpx>=0.27.0")
    try:
        import websockets  # noqa: F401
    except ImportError:
        missing.append("websockets>=13.0")
    try:
        import mcp  # noqa: F401
    except ImportError:
        missing.append("mcp[cli]>=1.9.0")

    if missing:
        _stderr_print("Missing MCP dependencies:", ", ".join(missing))
        _stderr_print(
            "Install with: pip install -r backend/mcp_server/requirements-mcp.txt"
        )
        return False
    return True


def _check_backend(*, silent: bool = False, wait_seconds: float | None = None) -> bool:
    """Verify the Inspyro backend health endpoint with optional retry."""
    import urllib.error
    import urllib.request

    from mcp_server import config

    url = f"{config.BACKEND_URL}/health"
    wait_seconds = config.MCP_WAIT_FOR_BACKEND_SEC if wait_seconds is None else wait_seconds
    wait_seconds = max(0.0, float(wait_seconds))
    deadline = time.monotonic() + wait_seconds
    waiting_logged = False

    while True:
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status == 200:
                    if not silent:
                        _stderr_print(f"Backend Inspyro available at {config.BACKEND_URL}")
                    return True
        except (urllib.error.URLError, OSError):
            pass

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break

        if not waiting_logged:
            _stderr_print(
                f"Waiting up to {wait_seconds:g}s for backend Inspyro at {config.BACKEND_URL}..."
            )
            waiting_logged = True
        time.sleep(min(_BACKEND_PROBE_INTERVAL_SEC, remaining))

    wait_note = f" Waited {wait_seconds:g}s before giving up." if wait_seconds > 0 else ""
    _stderr_print(
        f"Backend Inspyro is not responding at {config.BACKEND_URL}.{wait_note} "
        r"Start it first with: .\restart_inspyro.ps1"
    )
    return False


def main(argv: list[str] | None = None) -> None:
    """Entry point for standalone MCP startup."""
    argv = list(sys.argv[1:] if argv is None else argv)
    start_args, server_args = _parse_start_args(argv)
    stdio = _wants_stdio(server_args)

    if not _check_dependencies(silent=stdio):
        raise SystemExit(1)
    if not _check_backend(silent=stdio, wait_seconds=start_args.wait_for_backend):
        raise SystemExit(1)

    from mcp_server.server import main as server_main

    server_main(server_args)


if __name__ == "__main__":
    main()
