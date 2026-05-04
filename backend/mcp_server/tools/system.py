"""Tools MCP - System: informacion del sistema, salud y metricas."""

from __future__ import annotations

import logging
from typing import Any
from typing import TypedDict

from .. import config
from ..activity import mcp_activity_tool
from ..bridge import InspyroBridge
from ..runtime import get_session_profile, set_session_profile

logger = logging.getLogger("inspyro.mcp.tools.system")

_COMPONENT_PROFILES = {
    "all": {"profile:core", "profile:authoring", "profile:analysis", "profile:files", "profile:admin"},
    "authoring": {"profile:core", "profile:authoring"},
    "core": {"profile:core"},
    "analysis": {"profile:core", "profile:analysis"},
    "files": {"profile:core", "profile:files"},
    "admin": {"profile:core", "profile:admin"},
}


class ComponentProfileResult(TypedDict, total=False):
    status: str
    profile: str
    available_profiles: list[str]
    supported: bool
    default_profile: str


def _normalize_pdf_status(health_payload: Any, pdf_payload: Any) -> dict[str, Any]:
    health = health_payload if isinstance(health_payload, dict) else {}
    pdf_status = pdf_payload if isinstance(pdf_payload, dict) else {}
    word_available = bool(pdf_status.get("word_available"))
    libreoffice_available = bool(pdf_status.get("pdf_available")) or bool(pdf_status.get("soffice_path"))
    conversion_available = word_available or libreoffice_available
    preferred_engine = None
    if word_available:
        preferred_engine = "word"
    elif libreoffice_available:
        preferred_engine = "libreoffice"
    return {
        "conversion_available": conversion_available,
        "word_available": word_available,
        "libreoffice_available": libreoffice_available,
        "preferred_engine": preferred_engine,
        "last_error_kind": (
            pdf_status.get("last_error_kind")
            or health.get("last_error_kind")
            or pdf_status.get("pdf_conversion_error_kind")
        ),
        "last_error_message": (
            pdf_status.get("last_error_message")
            or health.get("last_error_message")
            or pdf_status.get("word_error")
            or pdf_status.get("error")
        ),
    }


async def _load_pdf_status(bridge: InspyroBridge) -> dict[str, Any]:
    health_payload = await bridge.rest_get("/health")
    try:
        pdf_payload = await bridge.rest_get("/pdf-status")
    except Exception:
        pdf_payload = {}
    return _normalize_pdf_status(health_payload, pdf_payload)


@mcp_activity_tool("system")
async def get_system_info() -> dict:
    """Obtiene informacion del entorno y workspace de Inspyro.

    Cuando usar: al iniciar una sesion MCP para descubrir el workspace real y
    validar el entorno disponible antes de crear o cargar archivos.
    Prerrequisitos: backend Inspyro saludable y bridge REST conectado.
    Resultado: payload del sistema normalizado, con `workspace_path` como campo
    canonico para clientes IA y `workspace_root` como alias compatible.
    Siguiente tool tipica: `list_files`, `notebook_create` o `notebook_load`.
    """
    bridge = InspyroBridge.get()
    payload = await bridge.rest_get("/api/system/info")
    if not isinstance(payload, dict):
        return payload

    workspace_path = (
        payload.get("workspace_path")
        or payload.get("workspace_root")
        or payload.get("workspace")
    )
    if workspace_path:
        payload.setdefault("workspace_path", workspace_path)
        payload.setdefault("workspace_root", workspace_path)
    payload.setdefault("component_profile", await get_session_profile(config.MCP_DEFAULT_PROFILE))
    payload.setdefault("default_component_profile", config.MCP_DEFAULT_PROFILE)
    payload.update(config.notebook_session_mode_payload())
    payload["pdf_status"] = await _load_pdf_status(bridge)
    return payload


@mcp_activity_tool("system")
async def get_health() -> dict:
    """Verifica el estado de salud del backend Inspyro.

    Cuando usar: antes de una sesion MCP o cuando sospechas fallos de backend.
    Prerrequisitos: acceso REST al backend local.
    Resultado: estado de salud, conversion PDF y metadatos operativos.
    Siguiente tool tipica: `get_system_info` o la tool de trabajo afectada.
    """
    bridge = InspyroBridge.get()
    payload = await bridge.rest_get("/health")
    if not isinstance(payload, dict):
        return payload
    try:
        pdf_payload = await bridge.rest_get("/pdf-status")
    except Exception:
        pdf_payload = {}
    payload["pdf_status"] = _normalize_pdf_status(payload, pdf_payload)
    payload.update(config.notebook_session_mode_payload())
    return payload


@mcp_activity_tool("system")
async def get_metrics() -> dict:
    """Obtiene metricas detalladas del backend.

    Cuando usar: diagnostico u observabilidad de rendimiento.
    Prerrequisitos: backend saludable y acceso REST activo.
    Resultado: payload de metricas del backend sin mutar estado.
    Siguiente tool tipica: `get_health` o analisis manual del cliente.
    """
    bridge = InspyroBridge.get()
    return await bridge.rest_get("/metrics")


@mcp_activity_tool("system")
async def list_component_profiles() -> ComponentProfileResult:
    """List available MCP visibility profiles for the current session."""
    return {
        "status": "ok",
        "profile": await get_session_profile(config.MCP_DEFAULT_PROFILE),
        "available_profiles": sorted(_COMPONENT_PROFILES.keys()),
        "default_profile": config.MCP_DEFAULT_PROFILE,
        "supported": True,
    }


@mcp_activity_tool("system")
async def set_component_profile(profile: str = "authoring") -> ComponentProfileResult:
    """Apply a tag-based MCP visibility profile to the current session."""
    normalized = str(profile or "authoring").strip().lower() or "authoring"
    if normalized not in _COMPONENT_PROFILES:
        return {
            "status": "invalid_profile",
            "profile": normalized,
            "available_profiles": sorted(_COMPONENT_PROFILES.keys()),
            "default_profile": config.MCP_DEFAULT_PROFILE,
            "supported": True,
        }

    applied = await set_session_profile(normalized, _COMPONENT_PROFILES[normalized])
    return {
        "status": "ok" if applied else "unsupported",
        "profile": normalized,
        "available_profiles": sorted(_COMPONENT_PROFILES.keys()),
        "default_profile": config.MCP_DEFAULT_PROFILE,
        "supported": applied,
    }
