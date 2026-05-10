"""Router FastAPI para gestionar el proceso del servidor MCP desde la UI.

Permite iniciar, detener y consultar el estado del servidor MCP
como subprocess del backend Inspyro.

Se usa subprocess.Popen (no asyncio.create_subprocess_exec) porque
en Windows el event loop de uvicorn no soporta subprocess transport.
"""

from __future__ import annotations

import collections
import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, Body, HTTPException, Query

from app.services.home_compact import home_compact_store
from app.services.mcp_activity import mcp_activity_store, normalize_mcp_activity_event
from app.services.mcp_mirror import normalize_mcp_mirror_event
from app.services.websocket_manager import manager as websocket_manager

logger = logging.getLogger("inspyro.mcp_manager")

router = APIRouter(prefix="/api/mcp", tags=["mcp"])

# ---------------------------------------------------------------------------
# Estado global del proceso MCP
# ---------------------------------------------------------------------------
_mcp_process: subprocess.Popen | None = None
_mcp_started_at: float | None = None
_mcp_log_buffer: collections.deque[str] = collections.deque(maxlen=200)
_reader_threads: list[threading.Thread] = []

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent  # backend/


def _find_venv_python() -> str:
    """Encuentra el ejecutable Python del venv."""
    backend_dir = Path(__file__).resolve().parent.parent.parent
    candidates = [
        backend_dir.parent / "venv_inspyro" / "Scripts" / "python.exe",
        backend_dir.parent / "venv_inspyro" / "bin" / "python",
        backend_dir.parent / ".venv" / "Scripts" / "python.exe",
        backend_dir.parent / ".venv" / "bin" / "python",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return sys.executable


_VENV_PYTHON = _find_venv_python()


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _connectable_host(host: str | None) -> str:
    normalized = (host or "").strip()
    if normalized in {"", "0.0.0.0", "::"}:
        return "127.0.0.1"
    return normalized


def _mcp_host() -> str:
    return os.getenv("INSPYRO_MCP_HOST", "127.0.0.1")


def _mcp_port() -> int:
    return _env_int("INSPYRO_MCP_PORT", 8100)


def _mcp_http_endpoint() -> str:
    host = _connectable_host(_mcp_host())
    return f"http://{host}:{_mcp_port()}/mcp"


def _backend_http_url() -> str:
    explicit = os.getenv("INSPYRO_BACKEND_URL")
    if explicit:
        return explicit.rstrip("/")

    host = _connectable_host(os.getenv("INSPYRO_BACKEND_HOST", "127.0.0.1"))
    port = _env_int("INSPYRO_BACKEND_PORT", _env_int("PORT", 8000))
    return f"http://{host}:{port}"


def _backend_ws_url(path: str, *, env_name: str | None = None) -> str:
    explicit = os.getenv(env_name) if env_name else None
    if explicit:
        return explicit.rstrip("/")

    backend_url = _backend_http_url()
    parsed = urlparse(backend_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    normalized_path = path if path.startswith("/") else f"/{path}"
    return urlunparse((scheme, parsed.netloc, normalized_path, "", "", ""))


def _mcp_backend_urls() -> dict[str, str]:
    return {
        "url": _backend_http_url(),
        "ws_url": _backend_ws_url("/ws", env_name="INSPYRO_BACKEND_WS_URL"),
        "notebook_ws_url": _backend_ws_url(
            "/ws/notebook",
            env_name="INSPYRO_BACKEND_NOTEBOOK_WS_URL",
        ),
    }


def _mcp_subprocess_env() -> dict[str, str]:
    """Entorno que hereda el servidor MCP lanzado desde el backend."""
    env = os.environ.copy()
    backend_urls = _mcp_backend_urls()
    env["INSPYRO_BACKEND_URL"] = backend_urls["url"]
    env["INSPYRO_BACKEND_WS_URL"] = backend_urls["ws_url"]
    env["INSPYRO_BACKEND_NOTEBOOK_WS_URL"] = backend_urls["notebook_ws_url"]
    env.setdefault("INSPYRO_MCP_HOST", _mcp_host())
    env.setdefault("INSPYRO_MCP_PORT", str(_mcp_port()))
    return env


def _mcp_configuration_snapshot() -> dict:
    host = _mcp_host()
    port = _mcp_port()
    http_endpoint = _mcp_http_endpoint()
    backend_urls = _mcp_backend_urls()
    normalized_host = (host or "").strip().lower()
    local_only = normalized_host in {"", "127.0.0.1", "localhost", "::1"}
    stateless_http = _env_bool("INSPYRO_MCP_STATELESS_HTTP")
    return {
        "host": host,
        "port": port,
        "http_endpoint": http_endpoint,
        "default_profile": os.getenv("INSPYRO_MCP_DEFAULT_PROFILE", "authoring"),
        "recommended_mode": "stateful-http",
        "local_only": local_only,
        "streamable_http": {
            "url": http_endpoint,
            "stateful": not stateless_http,
            "recommended": True,
            "json_response": _env_bool("INSPYRO_MCP_JSON_RESPONSE"),
            "stateless_http": stateless_http,
        },
        "stdio": {
            "command": _VENV_PYTHON,
            "args": ["-m", "mcp_server", "--stdio"],
            "cwd": str(_BACKEND_DIR),
        },
        "backend": backend_urls,
        "environment": {
            "INSPYRO_MCP_HOST": host,
            "INSPYRO_MCP_PORT": str(port),
            "INSPYRO_BACKEND_URL": backend_urls["url"],
            "INSPYRO_BACKEND_WS_URL": backend_urls["ws_url"],
            "INSPYRO_BACKEND_NOTEBOOK_WS_URL": backend_urls["notebook_ws_url"],
            "INSPYRO_MCP_DEFAULT_PROFILE": os.getenv("INSPYRO_MCP_DEFAULT_PROFILE", "authoring"),
        },
        "warnings": [
            "Mantener INSPYRO_MCP_HOST en 127.0.0.1 salvo que se agregue autenticacion y controles de red.",
            "Para notebooks usa stateful-http o stdio; stateless-http crea sesiones efimeras y no conserva kernels.",
            "Un cliente stdio lanza su propio proceso MCP; el boton de iniciar/detener solo controla el servicio HTTP local.",
        ],
    }


def _stream_reader_thread(stream, prefix: str) -> None:
    """Lee líneas del subprocess en un thread y las agrega al buffer circular."""
    try:
        for raw_line in stream:
            decoded = raw_line.decode("utf-8", errors="replace").rstrip()
            if decoded:
                _mcp_log_buffer.append(f"[{prefix}] {decoded}")
    except Exception as exc:
        _mcp_log_buffer.append(f"[{prefix}] reader error: {exc}")
    finally:
        try:
            stream.close()
        except Exception:
            pass


def _is_running() -> bool:
    """Verifica si el proceso MCP está corriendo."""
    if _mcp_process is None:
        return False
    return _mcp_process.poll() is None


def get_mcp_server_snapshot() -> dict:
    running = _is_running()
    uptime = None
    if running and _mcp_started_at:
        uptime = round(time.time() - _mcp_started_at, 1)

    return {
        "status": "running" if running else "stopped",
        "pid": _mcp_process.pid if running else None,
        "port": _mcp_port(),
        "uptime_seconds": uptime,
        "url": _mcp_http_endpoint() if running else None,
        "log_lines": len(_mcp_log_buffer),
        "configuration": _mcp_configuration_snapshot(),
    }


@router.get("/status")
async def mcp_status():
    """Estado actual del servidor MCP."""
    return get_mcp_server_snapshot()


def _free_port(port: int) -> None:
    """Libera el puerto matando procesos que lo estén usando."""
    try:
        if sys.platform == "win32":
            # Buscar PID que usa el puerto
            result = subprocess.run(
                ["netstat", "-ano"], capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.splitlines():
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.split()
                    pid = parts[-1]
                    if pid.isdigit() and int(pid) != os.getpid():
                        _mcp_log_buffer.append(f"[system] Liberando puerto {port} (PID {pid})...")
                        subprocess.run(
                            ["taskkill", "/F", "/PID", pid],
                            capture_output=True, timeout=5
                        )
                        time.sleep(0.5)
        else:
            result = subprocess.run(
                ["lsof", "-ti", f":{port}"], capture_output=True, text=True, timeout=5
            )
            for pid in result.stdout.strip().split():
                if pid.isdigit() and int(pid) != os.getpid():
                    _mcp_log_buffer.append(f"[system] Liberando puerto {port} (PID {pid})...")
                    subprocess.run(["kill", "-9", pid], capture_output=True, timeout=5)
                    time.sleep(0.5)
    except Exception as exc:
        _mcp_log_buffer.append(f"[system] Advertencia al liberar puerto: {exc}")


@router.post("/start")
async def mcp_start():
    """Inicia el servidor MCP como subprocess."""
    global _mcp_process, _mcp_started_at

    if _is_running():
        return {
            "status": "already_running",
            "pid": _mcp_process.pid,
            "configuration": _mcp_configuration_snapshot(),
        }

    _mcp_log_buffer.clear()
    _mcp_log_buffer.append("[system] Iniciando servidor MCP...")
    _mcp_log_buffer.append(f"[system] Python: {_VENV_PYTHON}")
    _mcp_log_buffer.append(f"[system] CWD: {_BACKEND_DIR}")

    port = _mcp_port()
    _free_port(port)

    try:
        # Flags de creación en Windows para evitar abrir consola visible
        creation_flags = 0
        if sys.platform == "win32":
            creation_flags = subprocess.CREATE_NO_WINDOW

        process_env = _mcp_subprocess_env()
        _mcp_log_buffer.append(f"[system] MCP endpoint: {_mcp_http_endpoint()}")
        _mcp_log_buffer.append(f"[system] Backend URL: {process_env['INSPYRO_BACKEND_URL']}")
        _mcp_log_buffer.append(f"[system] Backend WS: {process_env['INSPYRO_BACKEND_WS_URL']}")

        _mcp_process = subprocess.Popen(
            [_VENV_PYTHON, "-m", "mcp_server"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(_BACKEND_DIR),
            creationflags=creation_flags,
            env=process_env,
        )
        _mcp_started_at = time.time()

        # Threads para capturar stdout/stderr sin bloquear el event loop
        _reader_threads.clear()
        for stream, prefix in [(_mcp_process.stdout, "stdout"), (_mcp_process.stderr, "stderr")]:
            if stream:
                t = threading.Thread(target=_stream_reader_thread, args=(stream, prefix), daemon=True)
                t.start()
                _reader_threads.append(t)

        # Esperar brevemente para detectar crashes inmediatos
        time.sleep(1.5)

        if _mcp_process.poll() is not None:
            exit_code = _mcp_process.returncode
            _mcp_log_buffer.append(f"[system] MCP server terminó con código {exit_code}")
            _mcp_process = None
            _mcp_started_at = None
            return {
                "status": "error",
                "error": f"MCP server terminó inmediatamente (exit code: {exit_code})",
                "logs": list(_mcp_log_buffer),
            }

        _mcp_log_buffer.append(f"[system] MCP server iniciado (PID: {_mcp_process.pid})")
        logger.info("MCP server started, PID=%d", _mcp_process.pid)

        return {
            "status": "started",
            "pid": _mcp_process.pid,
            "port": _mcp_port(),
            "configuration": _mcp_configuration_snapshot(),
        }

    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        _mcp_log_buffer.append(f"[system] ERROR al iniciar MCP: {exc}")
        _mcp_log_buffer.append(f"[system] {tb}")
        logger.error("Failed to start MCP server: %s\n%s", exc, tb)
        return {"status": "error", "error": str(exc)}


@router.post("/stop")
async def mcp_stop():
    """Detiene el servidor MCP."""
    global _mcp_process, _mcp_started_at

    if not _is_running():
        return {"status": "already_stopped"}

    pid = _mcp_process.pid
    _mcp_log_buffer.append("[system] Deteniendo servidor MCP...")

    try:
        _mcp_process.terminate()
        try:
            _mcp_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _mcp_process.kill()
            _mcp_process.wait(timeout=3)

        _mcp_log_buffer.append(f"[system] MCP server detenido (PID: {pid})")
        logger.info("MCP server stopped, PID=%d", pid)

    except Exception as exc:
        _mcp_log_buffer.append(f"[system] ERROR al detener MCP: {exc}")
        logger.error("Failed to stop MCP server: %s", exc)

    _mcp_process = None
    _mcp_started_at = None

    return {"status": "stopped", "pid": pid}


@router.post("/restart")
async def mcp_restart():
    """Reinicia el servidor MCP y limpia estado efimero dependiente de la sesion."""
    stop_result = None
    if _is_running():
        stop_result = await mcp_stop()
    await mcp_activity_store.clear_active_runs()
    home_compact_store.clear_mcp_clients()
    start_result = await mcp_start()
    return {
        "status": "restarted" if stop_result is not None else start_result.get("status"),
        "stopped": stop_result,
        "started": start_result,
        "server": get_mcp_server_snapshot(),
    }


@router.get("/logs")
async def mcp_logs(last: int = 50):
    """Obtiene las últimas líneas de log del servidor MCP."""
    last = min(max(1, last), 200)
    lines = list(_mcp_log_buffer)
    return {
        "lines": lines[-last:],
        "total": len(lines),
    }


@router.post("/activity/events")
async def mcp_activity_events(payload: dict = Body(...)):
    """Registra un evento estructurado emitido por el servidor MCP."""
    event = normalize_mcp_activity_event(payload)
    event = home_compact_store.observe_mcp_activity_event(event)
    event, active_count = await mcp_activity_store.record_normalized_event(event)
    await websocket_manager.broadcast(
        {
            "type": "mcp_activity_event",
            **event,
            "active_count": active_count,
        }
    )
    return {
        "status": "accepted",
        "active_count": active_count,
        "event": event,
    }


@router.post("/client-heartbeat")
async def mcp_client_heartbeat(payload: dict = Body(...)):
    """Actualiza el ultimo heartbeat backend-visible de un cliente MCP."""
    try:
        client = home_compact_store.register_client_heartbeat(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "status": "accepted",
        "client": client,
        "mcp_clients": home_compact_store.snapshot_clients_grouped(),
    }


@router.post("/mirror-events")
async def mcp_mirror_events(payload: dict = Body(...)):
    """Difunde un evento granular de espejo MCP a la UI principal."""
    event = normalize_mcp_mirror_event(payload)
    await websocket_manager.broadcast(
        {
            "type": "mcp_mirror_event",
            **event,
        }
    )
    return {
        "status": "accepted",
        "event": event,
    }


@router.get("/activity")
async def mcp_activity(limit: int = Query(50, ge=1, le=300)):
    """Devuelve historial reciente y runs activos de actividad MCP."""
    snapshot = await mcp_activity_store.snapshot(limit=limit)
    snapshot["limit"] = limit
    snapshot["server_status"] = "running" if _is_running() else "stopped"
    return snapshot


async def shutdown_mcp_process() -> None:
    """Limpia el proceso MCP al detener el backend. Llamado desde lifespan."""
    if _is_running():
        logger.info("Shutting down MCP server on backend exit...")
        await mcp_stop()
