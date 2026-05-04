"""Inspyro Backend API - Entry Point."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Awaitable, Callable, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.contracts import validate_ws_message_payload
from app.core.security import is_path_safe
from app.routers.docx import router as docx_router
from app.routers.files import router as files_router
from app.routers.lsp import router as lsp_router
from app.routers.pdf import router as pdf_router
from app.routers.templates import router as templates_router
from app.routers.units import router as units_router
from app.routers.mcp_manager import (
    router as mcp_manager_router,
    shutdown_mcp_process,
    get_mcp_server_snapshot,
)
from app.routers.word_live import router as word_live_router
from app.services import runtime_metrics, template_service, workspace_service
from app.services.home_compact import home_compact_store
from app.services.mcp_activity import mcp_activity_store
from app.services.file_watcher import workspace_fs_watcher
from app.services.dependency_service import DependencyService
from app.services.pdf_converter import (
    PDF_CONVERT_AVAILABLE as _PDF_CONVERT_AVAILABLE,
)
from app.services.pdf_converter import (
    get_cache_stats as _get_pdf_cache_stats,
)
from app.services.pdf_converter import (
    get_latency_quantiles as _latency_quantiles,
)
from app.services.pdf_converter import (
    get_service_info as _get_pdf_service_info,
)
from app.services.notebook_service import (
    NOTEBOOK_PDF_TIMEOUT_S as _NOTEBOOK_PDF_TIMEOUT_S,
)
from app.services.websocket_manager import WS_MAX_MESSAGE_SIZE, _ws_log, manager, notebook_manager

try:
    from app.services.jupyter_kernel import jupyter_kernel_manager
except ImportError:
    jupyter_kernel_manager = None

# App Setup
_BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _resolve_frontend_build_dir() -> Path | None:
    candidates: list[Path] = []
    explicit_dir = os.getenv("INSPYRO_FRONTEND_BUILD_DIR")
    if explicit_dir:
        candidates.append(Path(explicit_dir).expanduser())
    candidates.append(Path(_BACKEND_ROOT).parent / "frontend" / "build")

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except Exception:
            continue
        if (resolved / "index.html").exists():
            return resolved
    return None


def _backend_port() -> int:
    raw_port = os.getenv("INSPYRO_BACKEND_PORT") or os.getenv("PORT") or "8000"
    try:
        return int(raw_port)
    except ValueError:
        return 8000


_DESKTOP_MODE = _env_flag("INSPYRO_DESKTOP", default=False)
_SERVE_FRONTEND = _env_flag("INSPYRO_SERVE_FRONTEND", default=False)
_FRONTEND_BUILD_DIR = _resolve_frontend_build_dir() if _SERVE_FRONTEND else None
_FRONTEND_STATIC_DIR = _FRONTEND_BUILD_DIR / "static" if _FRONTEND_BUILD_DIR else None
_WORD_ADDIN_DIR = Path(_BACKEND_ROOT).parent / "word-addin"
_ENABLE_DEV_CORS = _env_flag("INSPYRO_ENABLE_DEV_CORS", default=not _SERVE_FRONTEND)
_FRONTEND_RESERVED_EXACT = {
    "api",
    "docs",
    "health",
    "metrics",
    "openapi.json",
    "pdf-status",
    "redoc",
    "static",
    "word-addin",
    "ws",
}
_FRONTEND_RESERVED_PREFIXES = ("api/", "docs/", "redoc/", "static/", "word-addin/", "ws/")


def _frontend_serving_ready() -> bool:
    return bool(_SERVE_FRONTEND and _FRONTEND_BUILD_DIR and (_FRONTEND_BUILD_DIR / "index.html").exists())


def _resolve_frontend_asset(relative_path: str) -> Path | None:
    if not _frontend_serving_ready() or not _FRONTEND_BUILD_DIR:
        return None

    normalized_path = relative_path.lstrip("/\\")
    if not normalized_path:
        return _FRONTEND_BUILD_DIR / "index.html"

    try:
        candidate = (_FRONTEND_BUILD_DIR / normalized_path).resolve()
        candidate.relative_to(_FRONTEND_BUILD_DIR)
    except Exception:
        return None

    return candidate if candidate.is_file() else None


class _UvicornNoiseFilter(logging.Filter):
    """Filtra mensajes ruidosos de uvicorn que no aportan valor en desarrollo."""

    _SUPPRESSED_FRAGMENTS = (
        "connection open",
        "connection closed",
        "hot-update.json",
        "hot-update.js",
    )

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(frag in msg for frag in self._SUPPRESSED_FRAGMENTS)


# Aplicar filtro a los loggers de uvicorn para reducir ruido
_noise_filter = _UvicornNoiseFilter()
for _logger_name in ("uvicorn.access", "uvicorn.error"):
    logging.getLogger(_logger_name).addFilter(_noise_filter)


@asynccontextmanager
async def _lifespan(_: FastAPI):
    try:
        await workspace_fs_watcher.start()
        yield
    finally:
        await workspace_fs_watcher.stop()
        await shutdown_mcp_process()
        if jupyter_kernel_manager:
            await jupyter_kernel_manager.shutdown_all_kernels()
        template_service.shutdown_template_executor()


app = FastAPI(title="Inspyro Backend", version="1.0.0", lifespan=_lifespan)

if _ENABLE_DEV_CORS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(files_router)
app.include_router(lsp_router)
app.include_router(docx_router)
app.include_router(pdf_router)
app.include_router(templates_router)
app.include_router(units_router)
app.include_router(mcp_manager_router)
app.include_router(word_live_router)

if _FRONTEND_STATIC_DIR and _FRONTEND_STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_FRONTEND_STATIC_DIR)), name="frontend-static")
if _WORD_ADDIN_DIR.exists():
    app.mount("/word-addin", StaticFiles(directory=str(_WORD_ADDIN_DIR)), name="word-addin")

# Service Initialization
try:
    _dependency_service = DependencyService()
    _dependency_analyzer_available = True
except Exception:
    _dependency_service = None
    _dependency_analyzer_available = False

_SOFFICE_PATH = shutil.which("soffice") or shutil.which("libreoffice")
if not _SOFFICE_PATH and os.name == "nt":
    for p in [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ]:
        if os.path.exists(p):
            _SOFFICE_PATH = p
            break


class WorkspaceSelectRequest(BaseModel):
    path: str
    create_if_missing: bool = False


class WorkspaceCreateRequest(BaseModel):
    name: str
    parent_path: str | None = None


def _available_drives() -> list[str]:
    if os.name == "nt":
        import ctypes

        drives = ctypes.windll.kernel32.GetLogicalDrives()
        available_drives = []
        for i in range(26):
            if drives & (1 << i):
                available_drives.append(f"{chr(65 + i)}:\\")
        return available_drives
    return ["/"]


def _system_info_payload() -> dict:
    backend_dir = Path(__file__).parent.resolve()
    stubs_dir = backend_dir / "stubs"
    workspace_payload = workspace_service.get_workspace_snapshot()
    return {
        "os_type": os.name,
        "platform": sys.platform,
        **workspace_payload,
        "stubs_path": str(stubs_dir) if stubs_dir.exists() else None,
        "user_home": os.path.expanduser("~"),
        "available_drives": _available_drives(),
    }


# Endpoints
@app.get("/")
async def root():
    if _frontend_serving_ready() and _FRONTEND_BUILD_DIR:
        return FileResponse(_FRONTEND_BUILD_DIR / "index.html")
    return {"message": "Inspyro Backend API"}


@app.get("/health")
async def health_check():
    p50, p95 = _latency_quantiles()
    ws_metrics = manager.get_metrics()
    notebook_ws_metrics = notebook_manager.get_metrics()
    return {
        "status": "healthy",
        "service": "inspyro-backend",
        "pdf_conversion_available": _PDF_CONVERT_AVAILABLE,
        "soffice_path": _SOFFICE_PATH,
        "pdf_latency_p50_ms": p50,
        "pdf_latency_p95_ms": p95,
        "ws_connections_active": ws_metrics.get("active", 0),
        "ws_connections_total": ws_metrics.get("total", 0),
        "notebook_ws_connections_active": notebook_ws_metrics.get("active", 0),
        "notebook_ws_connections_total": notebook_ws_metrics.get("total", 0),
        **_get_pdf_cache_stats(),
        **runtime_metrics.snapshot_metrics(),
        **template_service.get_template_executor_stats(),
    }


@app.get("/metrics")
async def metrics():
    p50, p95 = _latency_quantiles()
    ws_metrics = manager.get_metrics()
    notebook_ws_metrics = notebook_manager.get_metrics()
    return {
        "pdf_latency_p50_ms": p50,
        "pdf_latency_p95_ms": p95,
        "ws_connections_active": ws_metrics.get("active", 0),
        "ws_connections_total": ws_metrics.get("total", 0),
        "notebook_ws_connections_active": notebook_ws_metrics.get("active", 0),
        "notebook_ws_connections_total": notebook_ws_metrics.get("total", 0),
        **_get_pdf_cache_stats(),
        **runtime_metrics.snapshot_metrics(),
        **template_service.get_template_executor_stats(),
    }


@app.get("/pdf-status")
async def pdf_status():
    p50, p95 = _latency_quantiles()
    return {
        **_get_pdf_service_info(),
        "notebook_pdf_timeout_seconds": _NOTEBOOK_PDF_TIMEOUT_S,
        "pdf_latency_p50_ms": p50,
        "pdf_latency_p95_ms": p95,
        **_get_pdf_cache_stats(),
    }


@app.get("/api/system/info")
async def get_system_info():
    return _system_info_payload()


@app.get("/api/system/home-summary")
async def get_home_summary():
    activity_snapshot = await mcp_activity_store.snapshot(limit=50)
    return home_compact_store.build_home_summary(
        mcp_server=get_mcp_server_snapshot(),
        mcp_activity_snapshot=activity_snapshot,
    )


@app.post("/api/system/workspace")
async def set_active_workspace(request_data: WorkspaceSelectRequest):
    requested_path = request_data.path.strip()
    if not requested_path:
        raise HTTPException(status_code=400, detail="Path requerido")

    resolved = Path(requested_path).expanduser().resolve()
    if not is_path_safe(str(resolved)):
        raise HTTPException(status_code=403, detail="Acceso denegado a este directorio")

    try:
        snapshot = workspace_service.set_active_workspace(
            str(resolved),
            create_if_missing=request_data.create_if_missing,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Workspace no encontrado")
    except NotADirectoryError:
        raise HTTPException(status_code=400, detail="La ruta no es una carpeta")

    await workspace_fs_watcher.update_workspace(snapshot.get("active_workspace"))
    return {"success": True, **snapshot}


@app.post("/api/system/workspace/create")
async def create_workspace(request_data: WorkspaceCreateRequest):
    workspace_name = request_data.name.strip()
    if not workspace_name:
        raise HTTPException(status_code=400, detail="Nombre de workspace requerido")

    parent_path = request_data.parent_path or str(workspace_service.get_default_projects_root())
    resolved_parent = Path(parent_path).expanduser().resolve()
    if not is_path_safe(str(resolved_parent)):
        raise HTTPException(status_code=403, detail="Acceso denegado a este directorio")

    try:
        snapshot = workspace_service.create_workspace(
            workspace_name,
            parent_path=str(resolved_parent),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileExistsError:
        raise HTTPException(status_code=409, detail="Ya existe un workspace con ese nombre")

    await workspace_fs_watcher.update_workspace(snapshot.get("active_workspace"))
    return {"success": True, "created": True, **snapshot}


# -----------------------------------------------------------------------------
# WebSocket Handler Imports
# -----------------------------------------------------------------------------
from app.routers.analysis import (
    handle_analyze_load_envelope,
    handle_analyze_dependencies,
    handle_analyze_impact,
    handle_compare_scenarios,
    handle_optimize_design,
    handle_run_code_checks,
    handle_sensitivity_analyze,
    init_analysis_handlers,
)
from app.routers.notebook import (
    active_tasks,
    handle_cancel_code_execution,
    cleanup_notebook_connection,
    handle_code_execution,
    handle_force_reconvert_pdf,
    handle_notebook_attach_kernel,
    handle_notebook_cancel_execution,
    handle_notebook_comm_msg,
    handle_notebook_create,
    handle_notebook_delete_cell,
    handle_notebook_execute_cell,
    handle_notebook_interrupt_kernel,
    handle_notebook_load,
    handle_notebook_mdoc_clear,
    handle_notebook_move_cell,
    handle_notebook_reset_kernel,
    handle_notebook_save,
    handle_notebook_set_order,
    handle_notebook_shutdown_kernel,
    handle_reconvert_pdf,
    handle_template_apply_table_format,
    handle_template_attach,
    handle_template_create_style_from_table,
    handle_template_delete,
    handle_template_update_document_defaults,
    handle_template_get,
    handle_template_preview_cancel,
    handle_template_preview_style,
    handle_template_update_semantic_slots,
    handle_template_table_preview,
    handle_template_update_style,
    handle_template_upload,
)


# Initialize analysis handlers after all imports
init_analysis_handlers(
    manager=manager,
    dependency_service=_dependency_service,
    dependency_analyzer_available=_dependency_analyzer_available,
    jupyter_kernel_manager=jupyter_kernel_manager,
)


# Main Websocket
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    _ws_log("WS connection established")

    loop = asyncio.get_running_loop()
    background_tasks: set[asyncio.Task] = set()

    ws_worker_concurrency = max(1, int(os.getenv("INSPYRO_WS_WORKER_CONCURRENCY", "4")))
    ws_preview_concurrency = max(1, int(os.getenv("INSPYRO_WS_PREVIEW_CONCURRENCY", "2")))
    ws_work_queue_maxsize = max(1, int(os.getenv("INSPYRO_WS_WORK_QUEUE_MAXSIZE", "64")))
    ws_preview_queue_maxsize = max(1, int(os.getenv("INSPYRO_WS_PREVIEW_QUEUE_MAXSIZE", "32")))

    work_queue: asyncio.Queue[tuple[Callable[[dict, WebSocket], Awaitable[None]], dict, float]] = asyncio.Queue(
        maxsize=ws_work_queue_maxsize
    )
    preview_queue: asyncio.Queue[tuple[Callable[[dict, WebSocket], Awaitable[None]], dict, float]] = asyncio.Queue(
        maxsize=ws_preview_queue_maxsize
    )

    def _track_task(task: asyncio.Task) -> None:
        background_tasks.add(task)

        def _cleanup(done_task: asyncio.Task) -> None:
            background_tasks.discard(done_task)
            try:
                _ = done_task.exception()
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

        task.add_done_callback(_cleanup)

    async def _send_ws_error(
        message: str,
        *,
        error_code: str,
        details: Optional[dict] = None,
        request_id: Optional[str] = None,
    ) -> None:
        payload = {
            "type": "error",
            "message": message,
            "error_code": error_code,
        }
        if details is not None:
            payload["details"] = details
        if request_id is not None:
            payload["request_id"] = request_id
        await manager.send_personal_message(payload, websocket)

    async def _worker_loop(
        queue_type: str,
        queue: asyncio.Queue[tuple[Callable[[dict, WebSocket], Awaitable[None]], dict, float]],
        error_code: str,
    ) -> None:
        while True:
            handler, message, enqueued_at = await queue.get()
            wait_ms = max(0.0, (loop.time() - enqueued_at) * 1000.0)
            runtime_metrics.record_queue_dequeued(queue_type, queue.qsize(), wait_ms)
            request_id = message.get("request_id")
            msg_type = message.get("type")
            started = loop.time()
            try:
                await handler(message, websocket)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                await _send_ws_error(
                    f"Error procesando mensaje {message.get('type')}: {exc}",
                    error_code=error_code,
                    request_id=request_id if isinstance(request_id, str) else None,
                )
            finally:
                if isinstance(msg_type, str) and msg_type.startswith("template_"):
                    runtime_metrics.record_template_handler_duration(
                        msg_type,
                        max(0.0, (loop.time() - started) * 1000.0),
                    )
                queue.task_done()

    async def _enqueue_handler(
        queue_type: str,
        queue: asyncio.Queue[tuple[Callable[[dict, WebSocket], Awaitable[None]], dict, float]],
        handler: Callable[[dict, WebSocket], Awaitable[None]],
        message: dict,
    ) -> bool:
        request_id = message.get("request_id")
        if queue.full():
            runtime_metrics.record_queue_full(queue_type, queue.maxsize)
            await _send_ws_error(
                "Cola de conexion saturada",
                error_code="connection_queue_full",
                details={
                    "queue_type": queue_type,
                    "queue_maxsize": queue.maxsize,
                },
                request_id=request_id if isinstance(request_id, str) else None,
            )
            return False

        try:
            queue.put_nowait((handler, message, loop.time()))
        except asyncio.QueueFull:
            runtime_metrics.record_queue_full(queue_type, queue.maxsize)
            await _send_ws_error(
                "Cola de conexion saturada",
                error_code="connection_queue_full",
                details={
                    "queue_type": queue_type,
                    "queue_maxsize": queue.maxsize,
                },
                request_id=request_id if isinstance(request_id, str) else None,
            )
            return False

        runtime_metrics.record_queue_enqueued(queue_type, queue.qsize(), queue.maxsize)
        return True

    async def _cancel_background_tasks() -> None:
        for task in list(background_tasks):
            task.cancel()
        if background_tasks:
            await asyncio.gather(*list(background_tasks), return_exceptions=True)
        background_tasks.clear()

    direct_handlers: dict[str, Callable[[dict, WebSocket], Awaitable[None]]] = {
        "notebook_create": handle_notebook_create,
        "notebook_load": handle_notebook_load,
        "notebook_attach_kernel": handle_notebook_attach_kernel,
        "notebook_save": handle_notebook_save,
        "notebook_execute_cell": handle_notebook_execute_cell,
        "notebook_delete_cell": handle_notebook_delete_cell,
        "notebook_move_cell": handle_notebook_move_cell,
        "notebook_set_order": handle_notebook_set_order,
        "notebook_reset_kernel": handle_notebook_reset_kernel,
        "notebook_interrupt_kernel": handle_notebook_interrupt_kernel,
        "notebook_shutdown_kernel": handle_notebook_shutdown_kernel,
        "notebook_cancel_execution": handle_notebook_cancel_execution,
        "notebook_comm_msg": handle_notebook_comm_msg,
        "notebook_mdoc_clear": handle_notebook_mdoc_clear,
        "execute_code": handle_code_execution,
        "cancel_code_execution": handle_cancel_code_execution,
        "reconvert_pdf": handle_reconvert_pdf,
        "force_reconvert_pdf": handle_force_reconvert_pdf,
        "analyze_dependencies": handle_analyze_dependencies,
        "analyze_impact": handle_analyze_impact,
        "sensitivity_analyze": handle_sensitivity_analyze,
        "optimize_design": handle_optimize_design,
        "analyze_load_envelope": handle_analyze_load_envelope,
        "run_code_checks": handle_run_code_checks,
        "compare_scenarios": handle_compare_scenarios,
        "template_upload": handle_template_upload,
        "template_attach": handle_template_attach,
        "template_get": handle_template_get,
        "template_delete": handle_template_delete,
        "template_update_document_defaults": handle_template_update_document_defaults,
        "template_update_semantic_slots": handle_template_update_semantic_slots,
        "template_update_style": handle_template_update_style,
        "template_preview_cancel": handle_template_preview_cancel,
        "template_create_style_from_table": handle_template_create_style_from_table,
        "template_apply_table_format": handle_template_apply_table_format,
    }

    control_types = {
        "notebook_interrupt_kernel",
        "notebook_reset_kernel",
        "notebook_shutdown_kernel",
        "notebook_cancel_execution",
        "cancel_code_execution",
        "template_preview_cancel",
    }

    background_handlers: dict[str, Callable[[dict, WebSocket], Awaitable[None]]] = {
        "template_preview_style": handle_template_preview_style,
        "template_table_preview": handle_template_table_preview,
    }

    supported_types = set(direct_handlers.keys()) | set(background_handlers.keys()) | {"clear_mdoc", "ping"}

    for _ in range(ws_worker_concurrency):
        _track_task(asyncio.create_task(_worker_loop("work", work_queue, "work_handler_failed")))
    for _ in range(ws_preview_concurrency):
        _track_task(asyncio.create_task(_worker_loop("preview", preview_queue, "background_handler_failed")))

    try:
        while True:
            data = await websocket.receive_text()
            runtime_metrics.record_ws_incoming_payload(len(data.encode("utf-8")))

            if len(data) > WS_MAX_MESSAGE_SIZE:
                await _send_ws_error(
                    "Mensaje demasiado grande",
                    error_code="message_too_large",
                    details={"max_bytes": WS_MAX_MESSAGE_SIZE, "received_bytes": len(data)},
                )
                continue

            try:
                message = json.loads(data)
            except Exception as exc:
                await _send_ws_error(
                    "JSON invalido",
                    error_code="invalid_json",
                    details={"reason": str(exc)},
                )
                continue

            if not isinstance(message, dict):
                await _send_ws_error(
                    "Payload invalido: se esperaba objeto JSON",
                    error_code="invalid_payload",
                )
                continue

            msg_type = message.get("type")
            request_id = message.get("request_id")
            if not isinstance(msg_type, str) or not msg_type.strip():
                await _send_ws_error(
                    "Campo 'type' requerido",
                    error_code="missing_message_type",
                    request_id=request_id if isinstance(request_id, str) else None,
                )
                continue

            is_valid_payload, validation_errors = validate_ws_message_payload(msg_type, message)
            if not is_valid_payload:
                await _send_ws_error(
                    "Payload invalido para el tipo de mensaje",
                    error_code="invalid_message_payload",
                    details={
                        "message_type": msg_type,
                        "validation_errors": validation_errors,
                    },
                    request_id=request_id if isinstance(request_id, str) else None,
                )
                continue

            if msg_type == "ping":
                await manager.send_personal_message({"type": "pong"}, websocket)
                continue

            if msg_type == "clear_mdoc":
                await manager.send_personal_message({"type": "mdoc_cleared"}, websocket)
                continue

            background_handler = background_handlers.get(msg_type)
            if background_handler is not None:
                await _enqueue_handler("preview", preview_queue, background_handler, message)
                continue

            direct_handler = direct_handlers.get(msg_type)
            if direct_handler is not None:
                if msg_type in control_types:
                    started = loop.time()
                    await direct_handler(message, websocket)
                    if msg_type.startswith("template_"):
                        runtime_metrics.record_template_handler_duration(
                            msg_type,
                            max(0.0, (loop.time() - started) * 1000.0),
                        )
                else:
                    await _enqueue_handler("work", work_queue, direct_handler, message)
                continue

            await _send_ws_error(
                f"Tipo de mensaje no soportado: {msg_type}",
                error_code="unknown_message_type",
                details={"supported_types": sorted(supported_types)},
                request_id=request_id if isinstance(request_id, str) else None,
            )

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await _send_ws_error(
                f"Error interno del websocket: {exc}",
                error_code="websocket_internal_error",
            )
        except Exception:
            pass
    finally:
        await _cancel_background_tasks()
        await manager.disconnect(websocket)

        cid = id(websocket)
        active_run_ids = [
            run_id
            for run_id, entry in list(active_tasks.items())
            if isinstance(entry, dict) and entry.get("websocket_id") == cid
        ]
        for run_id in active_run_ids:
            entry = active_tasks.pop(run_id, None)
            task = entry.get("task") if isinstance(entry, dict) else None
            if task:
                try:
                    task.cancel()
                except Exception:
                    pass

        try:
            await cleanup_notebook_connection(websocket)
        except Exception:
            pass


@app.websocket("/ws/notebook")
async def notebook_websocket_endpoint(websocket: WebSocket):
    await notebook_manager.connect(websocket)
    _ws_log("Notebook WS connection established")

    loop = asyncio.get_running_loop()
    background_tasks: set[asyncio.Task] = set()

    ws_worker_concurrency = max(1, int(os.getenv("INSPYRO_NOTEBOOK_WS_WORKER_CONCURRENCY", os.getenv("INSPYRO_WS_WORKER_CONCURRENCY", "4"))))
    ws_preview_concurrency = max(1, int(os.getenv("INSPYRO_NOTEBOOK_WS_PREVIEW_CONCURRENCY", os.getenv("INSPYRO_WS_PREVIEW_CONCURRENCY", "2"))))
    ws_work_queue_maxsize = max(1, int(os.getenv("INSPYRO_NOTEBOOK_WS_WORK_QUEUE_MAXSIZE", os.getenv("INSPYRO_WS_WORK_QUEUE_MAXSIZE", "64"))))
    ws_preview_queue_maxsize = max(1, int(os.getenv("INSPYRO_NOTEBOOK_WS_PREVIEW_QUEUE_MAXSIZE", os.getenv("INSPYRO_WS_PREVIEW_QUEUE_MAXSIZE", "32"))))

    work_queue: asyncio.Queue[tuple[Callable[[dict, WebSocket], Awaitable[None]], dict, float]] = asyncio.Queue(
        maxsize=ws_work_queue_maxsize
    )
    preview_queue: asyncio.Queue[tuple[Callable[[dict, WebSocket], Awaitable[None]], dict, float]] = asyncio.Queue(
        maxsize=ws_preview_queue_maxsize
    )

    def _track_task(task: asyncio.Task) -> None:
        background_tasks.add(task)

        def _cleanup(done_task: asyncio.Task) -> None:
            background_tasks.discard(done_task)
            try:
                _ = done_task.exception()
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

        task.add_done_callback(_cleanup)

    async def _send_ws_error(
        message: str,
        *,
        error_code: str,
        details: Optional[dict] = None,
        request_id: Optional[str] = None,
    ) -> None:
        payload = {
            "type": "error",
            "message": message,
            "error_code": error_code,
        }
        if details is not None:
            payload["details"] = details
        if request_id is not None:
            payload["request_id"] = request_id
        await notebook_manager.send_personal_message(payload, websocket)

    async def _worker_loop(
        queue_type: str,
        queue: asyncio.Queue[tuple[Callable[[dict, WebSocket], Awaitable[None]], dict, float]],
        error_code: str,
    ) -> None:
        while True:
            handler, message, enqueued_at = await queue.get()
            wait_ms = max(0.0, (loop.time() - enqueued_at) * 1000.0)
            runtime_metrics.record_queue_dequeued(f"notebook_{queue_type}", queue.qsize(), wait_ms)
            request_id = message.get("request_id")
            msg_type = message.get("type")
            started = loop.time()
            try:
                await handler(message, websocket)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                await _send_ws_error(
                    f"Error procesando mensaje {message.get('type')}: {exc}",
                    error_code=error_code,
                    request_id=request_id if isinstance(request_id, str) else None,
                )
            finally:
                if isinstance(msg_type, str) and msg_type.startswith("template_"):
                    runtime_metrics.record_template_handler_duration(
                        msg_type,
                        max(0.0, (loop.time() - started) * 1000.0),
                    )
                queue.task_done()

    async def _enqueue_handler(
        queue_type: str,
        queue: asyncio.Queue[tuple[Callable[[dict, WebSocket], Awaitable[None]], dict, float]],
        handler: Callable[[dict, WebSocket], Awaitable[None]],
        message: dict,
    ) -> bool:
        request_id = message.get("request_id")
        queue_metric = f"notebook_{queue_type}"
        if queue.full():
            runtime_metrics.record_queue_full(queue_metric, queue.maxsize)
            await _send_ws_error(
                "Cola de conexion notebook saturada",
                error_code="connection_queue_full",
                details={
                    "queue_type": queue_metric,
                    "queue_maxsize": queue.maxsize,
                },
                request_id=request_id if isinstance(request_id, str) else None,
            )
            return False

        try:
            queue.put_nowait((handler, message, loop.time()))
        except asyncio.QueueFull:
            runtime_metrics.record_queue_full(queue_metric, queue.maxsize)
            await _send_ws_error(
                "Cola de conexion notebook saturada",
                error_code="connection_queue_full",
                details={
                    "queue_type": queue_metric,
                    "queue_maxsize": queue.maxsize,
                },
                request_id=request_id if isinstance(request_id, str) else None,
            )
            return False

        runtime_metrics.record_queue_enqueued(queue_metric, queue.qsize(), queue.maxsize)
        return True

    async def _cancel_background_tasks() -> None:
        for task in list(background_tasks):
            task.cancel()
        if background_tasks:
            await asyncio.gather(*list(background_tasks), return_exceptions=True)
        background_tasks.clear()

    direct_handlers: dict[str, Callable[[dict, WebSocket], Awaitable[None]]] = {
        "notebook_create": handle_notebook_create,
        "notebook_load": handle_notebook_load,
        "notebook_attach_kernel": handle_notebook_attach_kernel,
        "notebook_save": handle_notebook_save,
        "notebook_execute_cell": handle_notebook_execute_cell,
        "notebook_delete_cell": handle_notebook_delete_cell,
        "notebook_move_cell": handle_notebook_move_cell,
        "notebook_set_order": handle_notebook_set_order,
        "notebook_reset_kernel": handle_notebook_reset_kernel,
        "notebook_interrupt_kernel": handle_notebook_interrupt_kernel,
        "notebook_shutdown_kernel": handle_notebook_shutdown_kernel,
        "notebook_cancel_execution": handle_notebook_cancel_execution,
        "notebook_comm_msg": handle_notebook_comm_msg,
        "notebook_mdoc_clear": handle_notebook_mdoc_clear,
        "reconvert_pdf": handle_reconvert_pdf,
        "force_reconvert_pdf": handle_force_reconvert_pdf,
        "template_upload": handle_template_upload,
        "template_attach": handle_template_attach,
        "template_get": handle_template_get,
        "template_delete": handle_template_delete,
        "template_update_document_defaults": handle_template_update_document_defaults,
        "template_update_semantic_slots": handle_template_update_semantic_slots,
        "template_update_style": handle_template_update_style,
        "template_preview_cancel": handle_template_preview_cancel,
        "template_create_style_from_table": handle_template_create_style_from_table,
        "template_apply_table_format": handle_template_apply_table_format,
    }

    control_types = {
        "notebook_interrupt_kernel",
        "notebook_reset_kernel",
        "notebook_shutdown_kernel",
        "notebook_cancel_execution",
        "template_preview_cancel",
    }

    background_handlers: dict[str, Callable[[dict, WebSocket], Awaitable[None]]] = {
        "template_preview_style": handle_template_preview_style,
        "template_table_preview": handle_template_table_preview,
    }

    supported_types = set(direct_handlers.keys()) | set(background_handlers.keys()) | {"ping"}

    for _ in range(ws_worker_concurrency):
        _track_task(asyncio.create_task(_worker_loop("work", work_queue, "work_handler_failed")))
    for _ in range(ws_preview_concurrency):
        _track_task(asyncio.create_task(_worker_loop("preview", preview_queue, "background_handler_failed")))

    try:
        while True:
            data = await websocket.receive_text()
            runtime_metrics.record_ws_incoming_payload(len(data.encode("utf-8")))

            if len(data) > WS_MAX_MESSAGE_SIZE:
                await _send_ws_error(
                    "Mensaje demasiado grande",
                    error_code="message_too_large",
                    details={"max_bytes": WS_MAX_MESSAGE_SIZE, "received_bytes": len(data)},
                )
                continue

            try:
                message = json.loads(data)
            except Exception as exc:
                await _send_ws_error(
                    "JSON invalido",
                    error_code="invalid_json",
                    details={"reason": str(exc)},
                )
                continue

            if not isinstance(message, dict):
                await _send_ws_error(
                    "Payload invalido: se esperaba objeto JSON",
                    error_code="invalid_payload",
                )
                continue

            msg_type = message.get("type")
            request_id = message.get("request_id")
            if not isinstance(msg_type, str) or not msg_type.strip():
                await _send_ws_error(
                    "Campo 'type' requerido",
                    error_code="missing_message_type",
                    request_id=request_id if isinstance(request_id, str) else None,
                )
                continue

            is_valid_payload, validation_errors = validate_ws_message_payload(msg_type, message)
            if not is_valid_payload:
                await _send_ws_error(
                    "Payload invalido para el tipo de mensaje",
                    error_code="invalid_message_payload",
                    details={
                        "message_type": msg_type,
                        "validation_errors": validation_errors,
                    },
                    request_id=request_id if isinstance(request_id, str) else None,
                )
                continue

            if msg_type == "ping":
                await notebook_manager.send_personal_message({"type": "pong"}, websocket)
                continue

            background_handler = background_handlers.get(msg_type)
            if background_handler is not None:
                await _enqueue_handler("preview", preview_queue, background_handler, message)
                continue

            direct_handler = direct_handlers.get(msg_type)
            if direct_handler is not None:
                if msg_type in control_types:
                    started = loop.time()
                    await direct_handler(message, websocket)
                    if msg_type.startswith("template_"):
                        runtime_metrics.record_template_handler_duration(
                            msg_type,
                            max(0.0, (loop.time() - started) * 1000.0),
                        )
                else:
                    await _enqueue_handler("work", work_queue, direct_handler, message)
                continue

            await _send_ws_error(
                f"Tipo de mensaje no soportado: {msg_type}",
                error_code="unknown_message_type",
                details={"supported_types": sorted(supported_types)},
                request_id=request_id if isinstance(request_id, str) else None,
            )
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await _send_ws_error(
                f"Error interno del websocket: {exc}",
                error_code="websocket_internal_error",
            )
        except Exception:
            pass
    finally:
        await _cancel_background_tasks()
        await notebook_manager.disconnect(websocket)

        try:
            await cleanup_notebook_connection(websocket)
        except Exception:
            pass


@app.get("/{full_path:path}", include_in_schema=False)
async def frontend_spa(full_path: str):
    if not _frontend_serving_ready() or not _FRONTEND_BUILD_DIR:
        raise HTTPException(status_code=404, detail="Not Found")

    normalized_path = full_path.lstrip("/\\")
    if (
        normalized_path in _FRONTEND_RESERVED_EXACT
        or any(normalized_path.startswith(prefix) for prefix in _FRONTEND_RESERVED_PREFIXES)
    ):
        raise HTTPException(status_code=404, detail="Not Found")

    asset_path = _resolve_frontend_asset(normalized_path)
    if asset_path is not None:
        return FileResponse(asset_path)

    return FileResponse(_FRONTEND_BUILD_DIR / "index.html")

if __name__ == "__main__":
    reload_enabled = _env_flag("INSPYRO_DEV_RELOAD", default=not _DESKTOP_MODE)
    app_target = "main:app" if reload_enabled else app
    uvicorn.run(
        app_target,
        host=os.getenv("INSPYRO_BACKEND_HOST", "0.0.0.0"),
        port=_backend_port(),
        reload=reload_enabled,
        log_level="info",
    )
