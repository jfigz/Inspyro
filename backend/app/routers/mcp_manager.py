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

    port = int(os.getenv("INSPYRO_MCP_PORT", "8100"))
    return {
        "status": "running" if running else "stopped",
        "pid": _mcp_process.pid if running else None,
        "port": port,
        "uptime_seconds": uptime,
        "url": f"http://127.0.0.1:{port}/mcp" if running else None,
        "log_lines": len(_mcp_log_buffer),
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
        return {"status": "already_running", "pid": _mcp_process.pid}

    _mcp_log_buffer.clear()
    _mcp_log_buffer.append("[system] Iniciando servidor MCP...")
    _mcp_log_buffer.append(f"[system] Python: {_VENV_PYTHON}")
    _mcp_log_buffer.append(f"[system] CWD: {_BACKEND_DIR}")

    port = int(os.getenv("INSPYRO_MCP_PORT", "8100"))
    _free_port(port)

    try:
        # Flags de creación en Windows para evitar abrir consola visible
        creation_flags = 0
        if sys.platform == "win32":
            creation_flags = subprocess.CREATE_NO_WINDOW

        _mcp_process = subprocess.Popen(
            [_VENV_PYTHON, "-m", "mcp_server"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(_BACKEND_DIR),
            creationflags=creation_flags,
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
            "port": int(os.getenv("INSPYRO_MCP_PORT", "8100")),
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
