"""Tools MCP - Templates: gestion de plantillas DOCX."""

from __future__ import annotations

import logging
import os
from typing import Any

from ..activity import mcp_activity_tool
from ..bridge import BridgeError, InspyroBridge
from ..mirror import emit_open_resource, emit_template_snapshot
from ..session_state import McpSessionState

logger = logging.getLogger("inspyro.mcp.tools.templates")
_SESSION_STATE = McpSessionState.get()


def _normalize_local_path(path: str) -> str:
    normalized = os.path.abspath(os.path.expanduser(path))
    if not os.path.isfile(normalized):
        raise BridgeError(
            f"Template file not found: {path}",
            payload={"type": "template_error", "error_code": "template_not_found", "path": path},
        )
    if not normalized.lower().endswith(".docx"):
        raise BridgeError(
            "Only .docx template files are supported",
            payload={
                "type": "template_error",
                "error_code": "invalid_template_extension",
                "path": normalized,
            },
        )
    return normalized


@mcp_activity_tool("templates")
async def upload_template(kernel_id: str, file_path: str) -> dict:
    """Cuando usar: adjuntar una plantilla `.docx` local al notebook activo.

    Prerrequisitos: `kernel_id` valido y `file_path` local existente con extension `.docx`.
    Resultado: devuelve `status`, `template_token` y metadata basica de la plantilla adjunta.
    Siguiente tool tipica: `get_template_info`, `update_template_style` o `execute_all_cells`.
    """
    bridge = InspyroBridge.get()
    normalized_path = _normalize_local_path(file_path)

    with open(normalized_path, "rb") as handle:
        docx_bytes = handle.read()

    if not docx_bytes:
        raise BridgeError(
            f"Template file is empty: {normalized_path}",
            payload={
                "type": "template_error",
                "error_code": "empty_template_file",
                "path": normalized_path,
            },
        )

    upload_result = await bridge.rest_post_files(
        "/api/templates/upload",
        files={
            "file": (
                os.path.basename(normalized_path),
                docx_bytes,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    template_token = upload_result.get("template_token")
    if not template_token:
        raise BridgeError(
            "Template upload did not return template_token",
            payload={"type": "template_error", "error_code": "missing_template_token", "raw": upload_result},
        )

    result = await bridge.ws_request(
        "template_attach",
        {"kernel_id": kernel_id, "template_token": template_token},
        success_types={"template_uploaded"},
        error_types={"template_error"},
        timeout=30,
    )
    template = result.get("template")
    _SESSION_STATE.record_template(
        kernel_id,
        template,
        template_token=result.get("template_token", template_token),
    )
    notebook_path = _SESSION_STATE.get_notebook_path(kernel_id)
    if notebook_path:
        await emit_open_resource(notebook_path, focus_view="docx", resource={"kernel_id": kernel_id})
    await emit_template_snapshot(
        kernel_id=kernel_id,
        notebook_path=notebook_path,
        template=template,
        template_token=result.get("template_token", template_token),
    )
    return {
        "status": "attached",
        "kernel_id": kernel_id,
        "template_token": result.get("template_token", template_token),
        "template": template,
        "template_binding": result.get("template_binding"),
        "raw": result,
    }


@mcp_activity_tool("templates")
async def get_template_info(kernel_id: str) -> dict:
    """Cuando usar: inspeccionar la plantilla actualmente adjunta a un kernel.

    Prerrequisitos: `kernel_id` valido con o sin plantilla activa.
    Resultado: devuelve `template` y metadata cruda de backend.
    Siguiente tool tipica: `update_template_style`, `delete_template` o `execute_all_cells`.
    """
    bridge = InspyroBridge.get()
    result = await bridge.ws_request(
        "template_get",
        {"kernel_id": kernel_id},
        success_types={"template_info"},
        error_types={"template_error"},
        timeout=15,
    )
    template = result.get("template")
    if template is None:
        _SESSION_STATE.clear_template(kernel_id)
    else:
        _SESSION_STATE.record_template(
            kernel_id,
            template,
            template_token=result.get("template_token"),
        )
    return {
        "status": "ok",
        "kernel_id": kernel_id,
        "template": template,
        "template_binding": result.get("template_binding"),
        "raw": result,
    }


@mcp_activity_tool("templates")
async def bind_template_to_notebook(kernel_id: str, path: str | None = None, template_json_path: str | None = None) -> dict:
    """Cuando usar: vincular la plantilla activa del kernel al `.ipynb` como JSON portable.

    Prerrequisitos: `kernel_id` valido con plantilla activa; `path` puede omitirse si el kernel ya
    esta registrado por `notebook_create`/`notebook_load`.
    Resultado: escribe `<notebook_stem>.inspyro-template.json`, parchea metadata del notebook y
    devuelve `template_binding` con estado `bound`.
    Siguiente tool tipica: `notebook_load`, `update_template_style` o `execute_all_cells`.
    """
    bridge = InspyroBridge.get()
    notebook_path = path or _SESSION_STATE.get_notebook_path(kernel_id)
    if not notebook_path:
        raise BridgeError(
            "No notebook path registered for this kernel; pass path explicitly",
            payload={
                "type": "template_error",
                "error_code": "missing_notebook_path",
                "kernel_id": kernel_id,
            },
        )

    payload: dict[str, Any] = {
        "kernel_id": kernel_id,
        "notebook_path": notebook_path,
    }
    if template_json_path:
        payload["template_json_path"] = template_json_path

    result = await bridge.rest_post("/api/templates/bind", json_data=payload)
    template = result.get("template_binding", {}).get("template")
    if template is None:
        template = (result.get("raw") or {}).get("template")
    if template is not None:
        _SESSION_STATE.record_template(kernel_id, template)
    _SESSION_STATE.register_notebook(kernel_id, result.get("template_binding", {}).get("notebook_path") or notebook_path)

    notebook_result_path = result.get("template_binding", {}).get("notebook_path") or notebook_path
    await emit_open_resource(notebook_result_path, focus_view="docx", resource={"kernel_id": kernel_id})
    await emit_template_snapshot(
        kernel_id=kernel_id,
        notebook_path=notebook_result_path,
        template=template,
        template_token=None,
    )
    return {
        "status": "bound",
        "kernel_id": kernel_id,
        "path": notebook_result_path,
        "binding": result.get("binding"),
        "template_binding": result.get("template_binding"),
        "notebook": result.get("notebook"),
        "raw": result,
    }


@mcp_activity_tool("templates")
async def delete_template(kernel_id: str) -> dict:
    """Cuando usar: quitar la plantilla activa de un notebook gestionado por MCP.

    Prerrequisitos: `kernel_id` valido.
    Resultado: devuelve confirmacion de borrado y si realmente existia plantilla.
    Siguiente tool tipica: `upload_template` o `execute_all_cells`.
    """
    bridge = InspyroBridge.get()
    result = await bridge.ws_request(
        "template_delete",
        {"kernel_id": kernel_id},
        success_types={"template_deleted"},
        error_types={"template_error"},
        timeout=15,
    )
    _SESSION_STATE.clear_template(kernel_id)
    notebook_path = _SESSION_STATE.get_notebook_path(kernel_id)
    if notebook_path:
        await emit_open_resource(notebook_path, focus_view="docx", resource={"kernel_id": kernel_id})
    await emit_template_snapshot(
        kernel_id=kernel_id,
        notebook_path=notebook_path,
        template=None,
        template_token=None,
    )
    return {
        "status": "deleted",
        "kernel_id": kernel_id,
        "was_deleted": bool(result.get("was_deleted")),
        "raw": result,
    }


@mcp_activity_tool("templates")
async def update_template_style(kernel_id: str, style_name: str, updates: dict) -> dict:
    """Cuando usar: modificar un estilo dentro de la plantilla activa.

    Prerrequisitos: `kernel_id` valido, plantilla adjunta y `style_name` existente o soportado.
    Resultado: devuelve `template` actualizado y metadata cruda de backend.
    Siguiente tool tipica: `get_template_info`, `execute_cell` o `execute_all_cells`.
    """
    bridge = InspyroBridge.get()
    result = await bridge.ws_request(
        "template_update_style",
        {
            "kernel_id": kernel_id,
            "style_name": style_name,
            "updates": updates,
        },
        success_types={"template_style_updated"},
        error_types={"template_error"},
        timeout=30,
    )
    template = result.get("template")
    _SESSION_STATE.record_template(
        kernel_id,
        template,
        template_token=result.get("template_token"),
    )
    notebook_path = _SESSION_STATE.get_notebook_path(kernel_id)
    if notebook_path:
        await emit_open_resource(notebook_path, focus_view="docx", resource={"kernel_id": kernel_id})
    await emit_template_snapshot(
        kernel_id=kernel_id,
        notebook_path=notebook_path,
        template=template,
        template_token=None,
    )
    return {
        "status": "updated",
        "kernel_id": kernel_id,
        "style_name": style_name,
        "template": template,
        "template_binding": result.get("template_binding"),
        "raw": result,
    }
