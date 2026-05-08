"""Router de filesystem para explorer y editor."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.security import is_hidden_name, is_path_safe, should_ignore
from app.services import workspace_service
from app.services.notebook_cell_kinds import (
    canonicalize_notebook_for_persistence,
    validate_persisted_notebook,
)

router = APIRouter(prefix="/api/files", tags=["files"])

READ_FILE_MAX_BYTES = int(os.getenv("INSPYRO_FILES_READ_MAX_BYTES", str(100 * 1024 * 1024)))
SEARCH_RESULT_LIMIT = 200


class WriteFileRequest(BaseModel):
    path: str
    content: str | dict[str, Any]


class CreateRequest(BaseModel):
    path: str
    name: str
    type: str = "file"  # "file" o "folder"


class RenameRequest(BaseModel):
    oldPath: str
    newName: str


class MoveRequest(BaseModel):
    sourcePath: str
    destinationPath: str


class CopyRequest(BaseModel):
    sourcePath: str
    destinationPath: str


class DuplicateRequest(BaseModel):
    sourcePath: str


class OpenDefaultRequest(BaseModel):
    path: str


def _resolve_path(raw_path: str | None) -> Path:
    if raw_path is None or not str(raw_path).strip():
        snapshot = workspace_service.get_workspace_snapshot()
        candidate = snapshot.get("active_workspace") or snapshot.get("workspace_root")
        if not candidate:
            raise HTTPException(status_code=400, detail="Path requerido")
        return Path(candidate).expanduser().resolve()
    return Path(str(raw_path)).expanduser().resolve()


def _ensure_safe_path(path: Path, *, must_exist: bool | None = None, expect_dir: bool | None = None) -> Path:
    resolved = path.expanduser().resolve()
    if not is_path_safe(str(resolved)):
        raise HTTPException(status_code=403, detail="Acceso denegado")
    if must_exist is True and not resolved.exists():
        raise HTTPException(status_code=404, detail="No encontrado")
    if must_exist is False and resolved.exists():
        raise HTTPException(status_code=409, detail="Ya existe un elemento con ese nombre")
    if expect_dir is True and resolved.exists() and not resolved.is_dir():
        raise HTTPException(status_code=400, detail="La ruta no es un directorio")
    if expect_dir is False and resolved.exists() and not resolved.is_file():
        raise HTTPException(status_code=400, detail="La ruta no es un archivo")
    return resolved


def _run_in_executor(func, *args):
    loop = asyncio.get_running_loop()
    return loop.run_in_executor(None, lambda: func(*args))


def _get_display_name(path: Path) -> str:
    return path.name or str(path)


def _is_writable(path: Path) -> bool:
    try:
        candidate = path if path.exists() else path.parent
        return os.access(candidate, os.W_OK)
    except OSError:
        return False


def _relative_path(path: Path, root_path: Path) -> str:
    try:
        relative = path.relative_to(root_path)
        return "." if str(relative) == "." else str(relative)
    except ValueError:
        try:
            return os.path.relpath(str(path), str(root_path))
        except ValueError:
            return str(path)


def _entry_sort_key(node: dict[str, Any]) -> tuple[int, str]:
    return (0 if node.get("isDirectory") else 1, node.get("name", "").lower())


def _directory_has_visible_children(path: Path, *, show_hidden: bool) -> bool:
    try:
        with os.scandir(path) as iterator:
            for entry in iterator:
                if should_ignore(entry.name, show_hidden=show_hidden):
                    continue
                return True
    except (PermissionError, FileNotFoundError, NotADirectoryError, OSError):
        return False
    return False


def _serialize_node(
    path: Path,
    root_path: Path,
    show_hidden: bool,
    max_depth: int,
    current_depth: int = 0,
) -> dict[str, Any] | None:
    if current_depth > max_depth:
        return None

    try:
        stat = path.stat()
    except OSError:
        return None

    is_directory = path.is_dir()
    node: dict[str, Any] = {
        "name": _get_display_name(path),
        "path": str(path),
        "isDirectory": is_directory,
        "modified": stat.st_mtime,
        "writable": _is_writable(path),
        "hidden": is_hidden_name(path.name),
        "symlink": path.is_symlink(),
        "relativePath": _relative_path(path, root_path),
    }

    if is_directory:
        children: list[dict[str, Any]] = []
        if current_depth < max_depth:
            try:
                with os.scandir(path) as iterator:
                    for entry in iterator:
                        if should_ignore(entry.name, show_hidden=show_hidden):
                            continue
                        child = _serialize_node(
                            Path(entry.path),
                            root_path,
                            show_hidden=show_hidden,
                            max_depth=max_depth,
                            current_depth=current_depth + 1,
                        )
                        if child:
                            children.append(child)
            except PermissionError:
                children = []

        node["children"] = sorted(children, key=_entry_sort_key)
        node["hasChildren"] = _directory_has_visible_children(path, show_hidden=show_hidden)
    else:
        node["size"] = stat.st_size
        node["extension"] = path.suffix.lower()
        node["children"] = None
        node["hasChildren"] = False

    return node


def _read_file_sync(path: Path) -> dict[str, Any]:
    if path.suffix.lower() == ".ipynb":
        with path.open("r", encoding="utf-8") as handle:
            content = json.load(handle)
        return {
            "path": str(path),
            "name": path.name,
            "type": "notebook",
            "content": content,
        }

    with path.open("r", encoding="utf-8") as handle:
        content = handle.read()
    return {
        "path": str(path),
        "name": path.name,
        "type": "text",
        "content": content,
    }


def _write_file_sync(path: Path, content: str | dict[str, Any]) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.suffix.lower() == ".ipynb" and isinstance(content, dict):
        content = canonicalize_notebook_for_persistence(content)
        validate_persisted_notebook(content)
        with path.open("w", encoding="utf-8") as handle:
            json.dump(content, handle, indent=2, ensure_ascii=False)
    else:
        with path.open("w", encoding="utf-8") as handle:
            handle.write(content if isinstance(content, str) else str(content))

    return {
        "success": True,
        "path": str(path),
        "message": "Archivo guardado correctamente",
    }


def _build_default_file_content(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext == ".py":
        return "# Nuevo archivo Python\n\n"
    if ext == ".ipynb":
        return json.dumps(
            {
                "cells": [
                    {
                        "cell_type": "code",
                        "execution_count": None,
                        "metadata": {},
                        "outputs": [],
                        "source": ["# Nuevo notebook\n"],
                    }
                ],
                "metadata": {
                    "kernelspec": {
                        "display_name": "Python 3",
                        "language": "python",
                        "name": "python3",
                    },
                    "language_info": {"name": "python", "version": "3.12.0"},
                },
                "nbformat": 4,
                "nbformat_minor": 4,
            },
            indent=2,
            ensure_ascii=False,
        )
    if ext == ".md":
        return "# Nuevo documento\n\n"
    if ext == ".json":
        return "{}\n"
    return ""


def _create_file_or_folder_sync(parent_path: Path, name: str, item_type: str) -> dict[str, Any]:
    target = parent_path / name
    if item_type == "folder":
        target.mkdir(parents=False, exist_ok=False)
    else:
        with target.open("w", encoding="utf-8") as handle:
            handle.write(_build_default_file_content(name))
    return {
        "success": True,
        "path": str(target),
        "type": item_type,
    }


def _delete_path_sync(path: Path) -> dict[str, Any]:
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()
    return {"success": True, "message": "Eliminado correctamente"}


def _is_same_or_descendant(parent: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(parent)
        return True
    except ValueError:
        return False


def _ensure_not_descendant_move(source: Path, destination: Path) -> None:
    if source.is_dir() and _is_same_or_descendant(source, destination):
        raise HTTPException(
            status_code=400,
            detail="No se puede mover una carpeta dentro de si misma o de un descendiente",
        )


def _move_path_sync(source_path: Path, destination_path: Path) -> dict[str, Any]:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source_path), str(destination_path))
    return {
        "success": True,
        "operation": "move",
        "oldPath": str(source_path),
        "newPath": str(destination_path),
    }


def _copy_path_sync(source_path: Path, destination_path: Path) -> dict[str, Any]:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    if source_path.is_dir():
        shutil.copytree(source_path, destination_path)
    else:
        shutil.copy2(source_path, destination_path)
    return {
        "success": True,
        "operation": "copy",
        "sourcePath": str(source_path),
        "path": str(destination_path),
    }


def _build_duplicate_path(source_path: Path) -> Path:
    stem = source_path.stem if source_path.is_file() else source_path.name
    suffix = source_path.suffix if source_path.is_file() else ""
    base_dir = source_path.parent

    candidate = base_dir / f"{stem} copy{suffix}"
    counter = 2
    while candidate.exists():
        candidate = base_dir / f"{stem} copy {counter}{suffix}"
        counter += 1
    return candidate


def _duplicate_path_sync(source_path: Path) -> dict[str, Any]:
    destination_path = _build_duplicate_path(source_path)
    return _copy_path_sync(source_path, destination_path)


def _open_with_default_app_sync(path: Path) -> dict[str, Any]:
    if sys.platform == "win32":
        startfile = getattr(os, "startfile", None)
        if startfile is None:
            raise RuntimeError("Apertura por aplicacion por defecto no disponible")
        startfile(str(path))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(
            ["open", str(path)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
    else:
        subprocess.Popen(
            ["xdg-open", str(path)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            start_new_session=True,
        )

    return {
        "success": True,
        "path": str(path),
        "method": "system_default",
    }


def _search_score(name: str, relative_path: str, query: str) -> int | None:
    lowered_name = name.lower()
    lowered_relative = relative_path.lower()
    lowered_query = query.lower()
    if lowered_name == lowered_query:
        return 400
    if lowered_name.startswith(lowered_query):
        return 300
    if lowered_query in lowered_name:
        return 200
    if lowered_query in lowered_relative:
        return 100
    return None


def _search_workspace_sync(root_path: Path, query: str, show_hidden: bool, limit: int) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []

    for current_root, dirs, files in os.walk(root_path, topdown=True):
        dirs[:] = [
            name
            for name in dirs
            if not should_ignore(name, show_hidden=show_hidden)
        ]

        visible_entries = dirs + [
            name
            for name in files
            if not should_ignore(name, show_hidden=show_hidden)
        ]

        for name in visible_entries:
            entry_path = Path(current_root) / name
            relative_path = _relative_path(entry_path, root_path)
            score = _search_score(name, relative_path, query)
            if score is None:
                continue

            is_directory = entry_path.is_dir()
            results.append(
                {
                    "path": str(entry_path),
                    "name": name,
                    "relativePath": relative_path,
                    "parentPath": str(entry_path.parent),
                    "isDirectory": is_directory,
                    "extension": "" if is_directory else entry_path.suffix.lower(),
                    "score": score,
                    "writable": _is_writable(entry_path),
                    "hidden": is_hidden_name(name),
                }
            )

    results.sort(
        key=lambda item: (
            -int(item["score"]),
            len(str(item["relativePath"])),
            str(item["relativePath"]).lower(),
        )
    )
    return results[:limit]


@router.get("/tree")
async def get_file_tree(
    path: str | None = None,
    depth: int = Query(default=1, ge=1, le=20),
    show_hidden: bool = Query(default=False),
):
    root_path = _ensure_safe_path(_resolve_path(path), must_exist=True, expect_dir=True)
    tree = await _run_in_executor(_serialize_node, root_path, root_path, show_hidden, depth, 0)
    if tree is None:
        raise HTTPException(status_code=404, detail="Directorio no encontrado")
    return tree


@router.get("/search")
async def search_files(
    query: str,
    path: str | None = None,
    limit: int = Query(default=50, ge=1, le=SEARCH_RESULT_LIMIT),
    show_hidden: bool = Query(default=False),
):
    trimmed_query = query.strip()
    if len(trimmed_query) < 2:
        raise HTTPException(status_code=400, detail="La busqueda requiere al menos 2 caracteres")

    root_path = _ensure_safe_path(_resolve_path(path), must_exist=True, expect_dir=True)
    return {
        "query": trimmed_query,
        "rootPath": str(root_path),
        "results": await _run_in_executor(_search_workspace_sync, root_path, trimmed_query, show_hidden, limit),
    }


@router.get("/read")
async def read_file(path: str):
    if not path:
        raise HTTPException(status_code=400, detail="Path requerido")

    file_path = _ensure_safe_path(_resolve_path(path), must_exist=True, expect_dir=False)
    if file_path.stat().st_size > READ_FILE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Archivo demasiado grande")

    try:
        return await _run_in_executor(_read_file_sync, file_path)
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="No se puede leer este tipo de archivo (binario)") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Archivo notebook corrupto") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error leyendo archivo: {exc}") from exc


@router.post("/write")
async def write_file(request_data: WriteFileRequest):
    if not request_data.path:
        raise HTTPException(status_code=400, detail="Path requerido")

    file_path = _ensure_safe_path(_resolve_path(request_data.path))
    try:
        return await _run_in_executor(_write_file_sync, file_path, request_data.content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error escribiendo archivo: {exc}") from exc


@router.post("/create")
async def create_file_or_folder(request_data: CreateRequest):
    parent_path = request_data.path.strip()
    name = request_data.name.strip()
    item_type = request_data.type.strip().lower()

    if not parent_path or not name:
        raise HTTPException(status_code=400, detail="Path y nombre requeridos")
    if item_type not in {"file", "folder"}:
        raise HTTPException(status_code=400, detail="Tipo invalido")

    parent_dir = _ensure_safe_path(_resolve_path(parent_path), must_exist=True, expect_dir=True)
    target_path = parent_dir / name
    _ensure_safe_path(target_path, must_exist=False)

    try:
        return await _run_in_executor(_create_file_or_folder_sync, parent_dir, name, item_type)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error creando {item_type}: {exc}") from exc


@router.delete("/delete")
async def delete_file_or_folder(path: str):
    if not path:
        raise HTTPException(status_code=400, detail="Path requerido")

    target_path = _ensure_safe_path(_resolve_path(path), must_exist=True)
    try:
        return await _run_in_executor(_delete_path_sync, target_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error eliminando: {exc}") from exc


@router.post("/rename")
async def rename_file_or_folder(request_data: RenameRequest):
    old_path = request_data.oldPath.strip()
    new_name = request_data.newName.strip()

    if not old_path or not new_name:
        raise HTTPException(status_code=400, detail="Path actual y nuevo nombre requeridos")

    source_path = _ensure_safe_path(_resolve_path(old_path), must_exist=True)
    destination_path = source_path.parent / new_name
    _ensure_safe_path(destination_path, must_exist=False)

    try:
        return await _run_in_executor(_move_path_sync, source_path, destination_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error renombrando: {exc}") from exc


@router.post("/move")
async def move_file_or_folder(request_data: MoveRequest):
    source_path = _ensure_safe_path(_resolve_path(request_data.sourcePath), must_exist=True)
    destination_path = _ensure_safe_path(_resolve_path(request_data.destinationPath), must_exist=False)
    _ensure_not_descendant_move(source_path, destination_path)

    try:
        return await _run_in_executor(_move_path_sync, source_path, destination_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error moviendo elemento: {exc}") from exc


@router.post("/copy")
async def copy_file_or_folder(request_data: CopyRequest):
    source_path = _ensure_safe_path(_resolve_path(request_data.sourcePath), must_exist=True)
    destination_path = _ensure_safe_path(_resolve_path(request_data.destinationPath), must_exist=False)
    if source_path.is_dir() and _is_same_or_descendant(source_path, destination_path):
        raise HTTPException(
            status_code=400,
            detail="No se puede copiar una carpeta dentro de si misma o de un descendiente",
        )

    try:
        return await _run_in_executor(_copy_path_sync, source_path, destination_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error copiando elemento: {exc}") from exc


@router.post("/duplicate")
async def duplicate_file_or_folder(request_data: DuplicateRequest):
    source_path = _ensure_safe_path(_resolve_path(request_data.sourcePath), must_exist=True)

    try:
        return await _run_in_executor(_duplicate_path_sync, source_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error duplicando elemento: {exc}") from exc


@router.post("/open-default")
async def open_file_with_default_application(request_data: OpenDefaultRequest):
    if not request_data.path:
        raise HTTPException(status_code=400, detail="Path requerido")

    file_path = _ensure_safe_path(_resolve_path(request_data.path), must_exist=True, expect_dir=False)

    try:
        return await _run_in_executor(_open_with_default_app_sync, file_path)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"No se pudo abrir con la aplicacion por defecto: {exc}",
        ) from exc
