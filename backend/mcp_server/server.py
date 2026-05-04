"""Inspyro MCP Server - Punto de entrada principal.

Servidor MCP local que expone las capacidades de Inspyro a cualquier modelo de IA.
Usa FastMCP 3.0 con transporte Streamable HTTP + stdio.

Uso:
    python -m mcp_server.server                                  # Streamable HTTP en :8100
    python -m mcp_server.server --stdio                          # modo stdio para clientes CLI
    python -m mcp_server.server --json-response --stateless-http # HTTP amigable para clientes genericos
"""

from __future__ import annotations

import argparse
import logging
import sys
from contextlib import asynccontextmanager

from fastmcp import FastMCP

from . import config
from .bridge import InspyroBridge

logging.basicConfig(
    level=getattr(logging, config.MCP_LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("inspyro.mcp")


@asynccontextmanager
async def lifespan(server: FastMCP):
    """Prepara el runtime MCP y limpia bridges session-scoped al cerrar."""
    try:
        logger.info(
            "Servidor MCP Inspyro listo - backend en %s, MCP en :%s",
            config.BACKEND_URL,
            config.MCP_PORT,
        )
        yield
    finally:
        await InspyroBridge.disconnect_all()
        logger.info("Servidor MCP Inspyro cerrado.")


_server_kwargs = {
    "instructions": (
        "Inspyro es un IDE de ingenieria con notebooks Jupyter, generacion DOCX/PDF, "
        "grafos de dependencias, unidades de ingenieria y editor de templates. "
        "El perfil MCP por defecto es `authoring`: prioriza notebook, documentos, templates y unidades. "
        "Lee `inspyro://manifest` para descubrir perfiles, templates de resources y rutas recomendadas. "
        "Antes de usar cualquier tool que cambie estado, lee primero el resource "
        "`inspyro://guides/start-here` y luego el guide especifico de la tarea. "
        "Los guides MCP exponen todo lo necesario para operar sin acceso al repositorio. "
        "Para notebooks usa `inspyro://guides/notebook-workflow`; para DOCX usa "
        "`inspyro://guides/docx-quickstart` y `inspyro://guides/artifact-lifecycle`; "
        "para templates usa `inspyro://guides/template-workflow`; para analisis o unidades usa "
        "`inspyro://guides/analysis-units-workflow`; para errores usa "
        "`inspyro://guides/error-recovery`. Para notebooks, prefiere `notebook_load`, "
        "`notebook_sync_cells` y `notebook_save` sobre file tools genericos o JSON/nbformat, "
        "porque ese camino preserva mejor la semantica notebook-first de Inspyro. Usa `set_component_profile` solo si necesitas "
        "expandir la superficie hacia `analysis`, `files` o `admin`. El backend debe estar corriendo en localhost:8000 "
        "antes de usar las herramientas."
    ),
    "lifespan": lifespan,
    "list_page_size": config.MCP_LIST_PAGE_SIZE,
    "mask_error_details": config.MCP_MASK_ERROR_DETAILS,
}

try:
    mcp = FastMCP("inspyro", **_server_kwargs)
except TypeError:
    _server_kwargs.pop("list_page_size", None)
    _server_kwargs.pop("mask_error_details", None)
    mcp = FastMCP("inspyro", **_server_kwargs)

from .tools import analysis  # noqa: E402, F401
from .tools import documents  # noqa: E402, F401
from .tools import files  # noqa: E402, F401
from .tools import notebook  # noqa: E402, F401
from .tools import system  # noqa: E402, F401
from .tools import templates  # noqa: E402, F401
from .tools import units  # noqa: E402, F401
from .resources import inspyro_resources  # noqa: E402, F401
from .prompts import inspyro_prompts  # noqa: E402, F401
from . import completions  # noqa: E402


def _apply_default_profile() -> None:
    profile_tags = {
        "all": {"profile:core", "profile:authoring", "profile:analysis", "profile:files", "profile:admin"},
        "authoring": {"profile:core", "profile:authoring"},
        "core": {"profile:core"},
        "analysis": {"profile:core", "profile:analysis"},
        "files": {"profile:core", "profile:files"},
        "admin": {"profile:core", "profile:admin"},
    }
    tags = profile_tags.get(config.MCP_DEFAULT_PROFILE)
    if not tags:
        return
    try:
        mcp.enable(tags=tags, only=True, components={"tool"})
        try:
            mcp.enable(
                components={
                    "resource",
                    "template",
                    "prompt",
                }
            )
        except Exception:
            pass
        logger.info("Applied default MCP profile '%s'", config.MCP_DEFAULT_PROFILE)
    except TypeError:
        try:
            mcp.enable(tags=tags, only=True)
            logger.info("Applied default MCP profile '%s'", config.MCP_DEFAULT_PROFILE)
        except Exception as exc:
            logger.debug("Could not apply default MCP profile '%s': %s", config.MCP_DEFAULT_PROFILE, exc)
    except Exception as exc:
        logger.debug("Could not apply default MCP profile '%s': %s", config.MCP_DEFAULT_PROFILE, exc)


_apply_default_profile()
completions.register_completion_handler(mcp)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspyro MCP Server")
    parser.add_argument(
        "--stdio",
        action="store_true",
        help="Ejecutar en modo stdio (para clientes CLI)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=config.MCP_PORT,
        help=f"Puerto para Streamable HTTP (default: {config.MCP_PORT})",
    )
    parser.add_argument(
        "--host",
        type=str,
        default=config.MCP_HOST,
        help=f"Host para Streamable HTTP (default: {config.MCP_HOST})",
    )
    parser.add_argument(
        "--json-response",
        action=argparse.BooleanOptionalAction,
        default=config.MCP_JSON_RESPONSE,
        help="Responder HTTP en JSON puro en vez de SSE (default: env/config)",
    )
    parser.add_argument(
        "--stateless-http",
        action=argparse.BooleanOptionalAction,
        default=config.MCP_STATELESS_HTTP,
        help="Crear una sesion HTTP nueva por request (default: env/config)",
    )
    return parser


def main(argv: list[str] | None = None) -> None:
    """Punto de entrada CLI del servidor MCP."""
    args = _build_parser().parse_args(argv)

    if args.stdio:
        config.set_runtime_transport(transport="stdio", stateless_http=False)
        logger.info("Iniciando servidor MCP en modo stdio...")
        mcp.run(transport="stdio")
        return

    config.set_runtime_transport(
        transport="streamable-http",
        stateless_http=bool(args.stateless_http),
    )
    logger.info(
        "Iniciando servidor MCP en %s:%d (json_response=%s, stateless_http=%s)...",
        args.host,
        args.port,
        args.json_response,
        args.stateless_http,
    )
    mcp.run(
        transport="streamable-http",
        host=args.host,
        port=args.port,
        json_response=args.json_response,
        stateless_http=args.stateless_http,
    )


if __name__ == "__main__":
    main()
