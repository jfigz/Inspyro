"""Tools MCP - Files: gestión de archivos y workspace."""

from __future__ import annotations

import logging
import os

from ..activity import mcp_activity_tool
from ..bridge import BridgeError, InspyroBridge
from ..mirror import emit_file_mutation
from ..runtime import is_within_any_root, list_root_paths, select_default_root

logger = logging.getLogger("inspyro.mcp.tools.files")

_CODE_EXTENSIONS = {
    ".bat",
    ".cmd",
    ".css",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".jsx",
    ".mdx",
    ".ps1",
    ".py",
    ".sh",
    ".sql",
    ".toml",
    ".ts",
    ".tsx",
    ".xml",
    ".yaml",
    ".yml",
}
_TEXT_EXTENSIONS = {
    ".csv",
    ".log",
    ".md",
    ".rst",
    ".txt",
}


def _extract_workspace_root(payload: dict | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in ("active_workspace", "workspace_path", "workspace_root"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


async def _get_workspace_root(bridge: InspyroBridge) -> str:
    payload = await bridge.rest_get("/api/system/info")
    workspace_root = _extract_workspace_root(payload)
    if not workspace_root:
        raise BridgeError(
            "No se pudo resolver el workspace activo de Inspyro para la tool de archivos.",
            payload={"type": "mcp_file_error", "error_code": "missing_workspace_root"},
        )
    normalized_workspace = os.path.abspath(os.path.expanduser(workspace_root))
    client_roots = await list_root_paths()
    selected_root = select_default_root(normalized_workspace, client_roots)
    if client_roots and not selected_root:
        raise BridgeError(
            "El workspace activo de Inspyro no intersecta con los roots expuestos por el cliente MCP.",
            payload={
                "type": "mcp_file_error",
                "error_code": "workspace_outside_client_roots",
                "workspace_root": normalized_workspace,
                "client_roots": client_roots,
            },
        )
    return normalized_workspace


async def _get_default_workspace_root(bridge: InspyroBridge) -> str:
    workspace_root = await _get_workspace_root(bridge)
    client_roots = await list_root_paths()
    selected_root = select_default_root(workspace_root, client_roots)
    return selected_root or workspace_root


async def _resolve_workspace_path(bridge: InspyroBridge, path: str | None) -> str:
    client_roots = await list_root_paths()
    raw_path = "" if path is None else str(path).strip()
    if not raw_path or raw_path == ".":
        return await _get_default_workspace_root(bridge)

    expanded_path = os.path.expanduser(raw_path)
    if os.path.isabs(expanded_path):
        normalized_path = os.path.abspath(expanded_path)
    else:
        workspace_root = await _get_workspace_root(bridge)
        normalized_path = os.path.abspath(os.path.join(workspace_root, expanded_path))

    if client_roots and not is_within_any_root(normalized_path, client_roots):
        raise BridgeError(
            "La ruta solicitada queda fuera de los roots declarados por el cliente MCP.",
            payload={
                "type": "mcp_file_error",
                "error_code": "path_outside_client_roots",
                "path": normalized_path,
                "client_roots": client_roots,
            },
        )
    return normalized_path


async def _resolve_rename_target_path(
    bridge: InspyroBridge,
    *,
    old_path: str,
    new_path: str,
) -> tuple[str, str]:
    normalized_old = await _resolve_workspace_path(bridge, old_path)
    raw_new = str(new_path).strip()
    if not raw_new:
        raise BridgeError(
            "Nueva ruta invalida para rename_file",
            payload={"type": "mcp_file_error", "error_code": "invalid_rename_target"},
        )

    expanded_new = os.path.expanduser(raw_new)
    if os.path.isabs(expanded_new):
        normalized_new = os.path.abspath(expanded_new)
    else:
        new_dirname = os.path.dirname(expanded_new)
        if new_dirname in {"", "."}:
            normalized_new = os.path.abspath(
                os.path.join(os.path.dirname(normalized_old), os.path.basename(expanded_new))
            )
        else:
            workspace_root = await _get_workspace_root(bridge)
            normalized_new = os.path.abspath(os.path.join(workspace_root, expanded_new))

    return normalized_old, normalized_new


def _infer_file_kind(path: str, *, is_directory: bool = False) -> str:
    if is_directory:
        return "directory"
    suffix = os.path.splitext(str(path or "").lower())[1]
    if suffix == ".ipynb":
        return "notebook"
    if suffix in _CODE_EXTENSIONS:
        return "code"
    if suffix in _TEXT_EXTENSIONS:
        return "text"
    return "unknown"


@mcp_activity_tool("files")
async def list_files(path: str = ".", depth: int = 3) -> dict:
    """Lista el árbol de archivos y carpetas del workspace.

    Args:
        path: Ruta base a listar (default: raíz del proyecto).
        depth: Profundidad máxima del árbol (default: 3).

    Returns:
        dict con la estructura de archivos/carpetas.
    """
    bridge = InspyroBridge.get()
    normalized_path = await _resolve_workspace_path(bridge, path)
    return await bridge.rest_get("/api/files/tree", params={"path": normalized_path, "depth": depth})


@mcp_activity_tool("files")
async def read_file(path: str) -> dict:
    """Lee el contenido de un archivo.

    Args:
        path: Ruta al archivo a leer.

    Returns:
        dict con el contenido del archivo y metadata.
    """
    bridge = InspyroBridge.get()
    normalized_path = await _resolve_workspace_path(bridge, path)
    result = await bridge.rest_get("/api/files/read", params={"path": normalized_path})
    if isinstance(result, dict):
        result.setdefault("path", normalized_path)
    return result


@mcp_activity_tool("files")
async def write_file(path: str, content: str) -> dict:
    """Escribe contenido a un archivo (crea o sobreescribe).

    Args:
        path: Ruta al archivo.
        content: Contenido a escribir.

    Returns:
        dict con confirmación de escritura.
    """
    bridge = InspyroBridge.get()
    normalized_path = await _resolve_workspace_path(bridge, path)
    result = await bridge.rest_post("/api/files/write", json_data={"path": normalized_path, "content": content})
    await emit_file_mutation(
        mutation="write",
        path=normalized_path,
        is_directory=False,
        file_kind=_infer_file_kind(normalized_path),
    )
    if isinstance(result, dict):
        result.setdefault("path", normalized_path)
    return result


@mcp_activity_tool("files")
async def create_file(path: str, is_directory: bool = False) -> dict:
    """Crea un archivo vacío o una carpeta.

    Args:
        path: Ruta del archivo o carpeta a crear.
        is_directory: Si True, crea una carpeta (default: False).

    Returns:
        dict con confirmación de creación.
    """
    bridge = InspyroBridge.get()
    normalized_path = await _resolve_workspace_path(bridge, path)
    parent_path, name = os.path.split(normalized_path)
    if not parent_path or not name:
        raise BridgeError(
            f"Ruta invalida para crear archivo/carpeta: {path}",
            payload={"type": "mcp_file_error", "path": path, "error_code": "invalid_create_path"},
        )
    result = await bridge.rest_post(
        "/api/files/create",
        json_data={
            "path": parent_path,
            "name": name,
            "type": "folder" if is_directory else "file",
        },
    )
    await emit_file_mutation(
        mutation="create",
        path=normalized_path,
        is_directory=is_directory,
        file_kind=_infer_file_kind(normalized_path, is_directory=is_directory),
    )
    if isinstance(result, dict):
        result.setdefault("path", normalized_path)
    return result


@mcp_activity_tool("files")
async def delete_file(path: str) -> dict:
    """Elimina un archivo o carpeta.

    Args:
        path: Ruta del archivo o carpeta a eliminar.

    Returns:
        dict con confirmación de eliminación.
    """
    bridge = InspyroBridge.get()
    normalized_path = await _resolve_workspace_path(bridge, path)
    was_directory = os.path.isdir(normalized_path)
    result = await bridge.rest_delete("/api/files/delete", params={"path": normalized_path})
    await emit_file_mutation(
        mutation="delete",
        path=normalized_path,
        is_directory=was_directory,
        file_kind=_infer_file_kind(normalized_path, is_directory=was_directory),
    )
    if isinstance(result, dict):
        result.setdefault("path", normalized_path)
    return result


@mcp_activity_tool("files")
async def rename_file(old_path: str, new_path: str) -> dict:
    """Renombra un archivo o carpeta.

    Args:
        old_path: Ruta actual del archivo/carpeta.
        new_path: Nueva ruta del archivo/carpeta.

    Returns:
        dict con confirmación del renombrado.
    """
    bridge = InspyroBridge.get()
    normalized_old, normalized_new = await _resolve_rename_target_path(
        bridge,
        old_path=old_path,
        new_path=new_path,
    )
    was_directory = os.path.isdir(normalized_old)
    old_parent = os.path.dirname(normalized_old)
    new_parent = os.path.dirname(normalized_new)
    if old_parent != new_parent:
        raise BridgeError(
            "rename_file solo soporta cambios dentro del mismo directorio porque el backend expone rename por nombre.",
            payload={
                "type": "mcp_file_error",
                "old_path": normalized_old,
                "new_path": normalized_new,
                "error_code": "cross_directory_rename_not_supported",
            },
        )
    result = await bridge.rest_post(
        "/api/files/rename",
        json_data={"oldPath": normalized_old, "newName": os.path.basename(normalized_new)},
    )
    await emit_file_mutation(
        mutation="rename",
        path=normalized_new,
        old_path=normalized_old,
        new_path=normalized_new,
        is_directory=was_directory,
        file_kind=_infer_file_kind(normalized_new, is_directory=was_directory),
    )
    if isinstance(result, dict):
        result.setdefault("path", normalized_new)
        result.setdefault("newPath", normalized_new)
        result.setdefault("oldPath", normalized_old)
    return result
