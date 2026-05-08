"""Configuracion del servidor MCP de Inspyro.

Variables de entorno soportadas:
- INSPYRO_MCP_PORT:                 Puerto del servidor MCP (default: 8100)
- INSPYRO_MCP_HOST:                 Host del servidor MCP (default: 127.0.0.1)
- INSPYRO_MCP_JSON_RESPONSE:        Fuerza respuestas JSON HTTP (default: false)
- INSPYRO_MCP_STATELESS_HTTP:       Crea una sesion HTTP nueva por request (default: false)
- INSPYRO_MCP_WAIT_FOR_BACKEND_SEC: Espera/reintento del backend antes de fallar (default: 0)
- INSPYRO_MCP_MASK_ERROR_DETAILS:   Oculta detalles internos de error hacia clientes MCP (default: false)
- INSPYRO_BACKEND_URL:              URL base del backend Inspyro (default: http://127.0.0.1:8000)
- INSPYRO_BACKEND_WS_URL:           URL WebSocket global del backend (default: ws://127.0.0.1:8000/ws)
- INSPYRO_BACKEND_NOTEBOOK_WS_URL:  URL WebSocket notebook-first (default: ws://127.0.0.1:8000/ws/notebook)
- INSPYRO_MCP_LOG_LEVEL:            Nivel de logging (default: INFO)
- INSPYRO_MCP_WS_TIMEOUT:           Timeout para operaciones WS en segundos (default: 60)
- INSPYRO_MCP_REST_TIMEOUT:         Timeout para operaciones REST en segundos (default: 30)
- INSPYRO_MCP_CELL_TIMEOUT:         Timeout por defecto de ejecucion de celda MCP (default: 600)
- INSPYRO_MCP_LIST_PAGE_SIZE:       Tamano por defecto para listados MCP paginables (default: 50)
- INSPYRO_MCP_MAX_DOCX_BYTES:       Tamano maximo inline permitido para DOCX (default: 50MB)
- INSPYRO_MCP_DEFAULT_PROFILE:      Perfil de visibilidad MCP por defecto (default: authoring)
"""

from __future__ import annotations

import os


def _get_bool_env(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# MCP server
MCP_HOST: str = os.environ.get("INSPYRO_MCP_HOST", "127.0.0.1")
MCP_PORT: int = int(os.environ.get("INSPYRO_MCP_PORT", "8100"))
MCP_LOG_LEVEL: str = os.environ.get("INSPYRO_MCP_LOG_LEVEL", "INFO").upper()
MCP_JSON_RESPONSE: bool = _get_bool_env("INSPYRO_MCP_JSON_RESPONSE", False)
MCP_STATELESS_HTTP: bool = _get_bool_env("INSPYRO_MCP_STATELESS_HTTP", False)
MCP_RUNTIME_TRANSPORT: str = "streamable-http"
MCP_RUNTIME_STATELESS_HTTP: bool = MCP_STATELESS_HTTP
MCP_WAIT_FOR_BACKEND_SEC: float = max(
    0.0,
    float(os.environ.get("INSPYRO_MCP_WAIT_FOR_BACKEND_SEC", "0")),
)
MCP_MASK_ERROR_DETAILS: bool = _get_bool_env("INSPYRO_MCP_MASK_ERROR_DETAILS", False)
MCP_LIST_PAGE_SIZE: int = max(10, int(os.environ.get("INSPYRO_MCP_LIST_PAGE_SIZE", "50")))
MCP_DEFAULT_PROFILE: str = os.environ.get("INSPYRO_MCP_DEFAULT_PROFILE", "authoring").strip().lower() or "authoring"

# Inspyro backend
BACKEND_URL: str = os.environ.get("INSPYRO_BACKEND_URL", "http://127.0.0.1:8000")
BACKEND_WS_URL: str = os.environ.get("INSPYRO_BACKEND_WS_URL", "ws://127.0.0.1:8000/ws")


def _default_notebook_ws_url() -> str:
    explicit = os.environ.get("INSPYRO_BACKEND_NOTEBOOK_WS_URL")
    if explicit:
        return explicit
    stripped = BACKEND_WS_URL.rstrip("/")
    if stripped.endswith("/ws"):
        return f"{stripped}/notebook"
    return BACKEND_WS_URL


BACKEND_NOTEBOOK_WS_URL: str = _default_notebook_ws_url()

# Timeouts
WS_TIMEOUT: int = int(os.environ.get("INSPYRO_MCP_WS_TIMEOUT", "60"))
REST_TIMEOUT: int = int(os.environ.get("INSPYRO_MCP_REST_TIMEOUT", "30"))
CELL_EXECUTION_TIMEOUT: int = int(os.environ.get("INSPYRO_MCP_CELL_TIMEOUT", "600"))

# Limits
MAX_PDF_SIZE_BYTES: int = int(
    os.environ.get("INSPYRO_MCP_MAX_PDF_BYTES", str(50 * 1024 * 1024))
)  # 50MB
MAX_DOCX_SIZE_BYTES: int = int(
    os.environ.get("INSPYRO_MCP_MAX_DOCX_BYTES", str(50 * 1024 * 1024))
)  # 50MB


def set_runtime_transport(*, transport: str, stateless_http: bool | None = None) -> None:
    """Persist the active MCP transport/runtime flags for tool-time checks."""
    global MCP_RUNTIME_TRANSPORT, MCP_RUNTIME_STATELESS_HTTP

    normalized_transport = str(transport or "streamable-http").strip() or "streamable-http"
    MCP_RUNTIME_TRANSPORT = normalized_transport
    if stateless_http is not None:
        MCP_RUNTIME_STATELESS_HTTP = bool(stateless_http)


def notebook_session_mode() -> str:
    if MCP_RUNTIME_TRANSPORT == "stdio":
        return "stdio"
    if MCP_RUNTIME_STATELESS_HTTP:
        return "stateless-http"
    return "stateful-http"


def notebook_session_mode_payload() -> dict[str, object]:
    mode = notebook_session_mode()
    return {
        "mcp_transport": MCP_RUNTIME_TRANSPORT,
        "mcp_stateless_http": MCP_RUNTIME_STATELESS_HTTP,
        "notebook_session_mode": mode,
        "notebook_sessions_supported": mode != "stateless-http",
    }
