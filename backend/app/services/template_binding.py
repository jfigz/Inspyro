"""Notebook-scoped portable template JSON bindings."""

from __future__ import annotations

import base64
import binascii
import copy
import json
import os
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.security import is_path_safe
from app.services import template_logic, template_service
from app.services.template import storage as template_storage

TEMPLATE_BINDING_METADATA_ROOT = "inspyro"
TEMPLATE_BINDING_METADATA_KEY = "template_binding"
TEMPLATE_BINDING_SCHEMA_VERSION = 1
TEMPLATE_BINDING_TYPE = "template_export_json"
TEMPLATE_BINDING_PATH_BASE = "notebook_dir"
TEMPLATE_EXPORT_SCHEMA_VERSION = "1.1"
TEMPLATE_JSON_SUFFIX = ".inspyro-template.json"
TEMPLATE_UPLOAD_MAX_BYTES = int(os.getenv("INSPYRO_TEMPLATE_UPLOAD_MAX_BYTES", str(20 * 1024 * 1024)))

_binding_lock = threading.RLock()
_kernel_bindings: dict[str, dict[str, Any]] = {}


class TemplateBindingError(Exception):
    def __init__(self, message: str, *, code: str = "template_binding_error", status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_notebook_path(notebook_path: str | os.PathLike[str] | None) -> Path:
    if not notebook_path or not str(notebook_path).strip():
        raise TemplateBindingError("notebook_path requerido", code="missing_notebook_path")
    try:
        resolved = Path(str(notebook_path)).expanduser().resolve()
    except OSError as exc:
        raise TemplateBindingError(f"Path de notebook invalido: {exc}", code="invalid_notebook_path") from exc
    if resolved.suffix.lower() != ".ipynb":
        raise TemplateBindingError("notebook_path debe apuntar a un .ipynb", code="invalid_notebook_extension")
    if not is_path_safe(str(resolved)):
        raise TemplateBindingError("Acceso denegado al notebook", code="notebook_path_denied", status_code=403)
    return resolved


def _assert_child_path(base_dir: Path, target: Path) -> None:
    try:
        if os.path.commonpath([str(base_dir), str(target)]) != str(base_dir):
            raise TemplateBindingError(
                "La ruta del template JSON debe quedar dentro del directorio del notebook",
                code="template_json_path_traversal",
                status_code=403,
            )
    except ValueError as exc:
        raise TemplateBindingError(
            "La ruta del template JSON debe compartir unidad con el notebook",
            code="template_json_path_traversal",
            status_code=403,
        ) from exc


def _resolve_template_json_path(
    notebook_path: Path,
    template_json_path: str | os.PathLike[str] | None = None,
) -> tuple[Path, str]:
    base_dir = notebook_path.parent.resolve()
    if template_json_path is None or not str(template_json_path).strip():
        target = base_dir / f"{notebook_path.stem}{TEMPLATE_JSON_SUFFIX}"
    else:
        raw = Path(str(template_json_path)).expanduser()
        target = raw.resolve() if raw.is_absolute() else (base_dir / raw).resolve()

    _assert_child_path(base_dir, target)
    if target.suffix.lower() != ".json":
        raise TemplateBindingError("El template vinculado debe ser un archivo .json", code="invalid_template_json_extension")
    if not is_path_safe(str(target)):
        raise TemplateBindingError("Acceso denegado al template JSON", code="template_json_path_denied", status_code=403)

    relpath = target.relative_to(base_dir).as_posix()
    return target, relpath


def build_template_binding(
    notebook_path: str | os.PathLike[str],
    template_json_path: str | os.PathLike[str] | None = None,
) -> tuple[dict[str, Any], Path]:
    resolved_notebook = _normalize_notebook_path(notebook_path)
    resolved_json, relpath = _resolve_template_json_path(resolved_notebook, template_json_path)
    return (
        {
            "schema_version": TEMPLATE_BINDING_SCHEMA_VERSION,
            "type": TEMPLATE_BINDING_TYPE,
            "path_base": TEMPLATE_BINDING_PATH_BASE,
            "path": relpath,
        },
        resolved_json,
    )


def get_notebook_template_binding(notebook: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(notebook, dict):
        return None
    metadata = notebook.get("metadata")
    if not isinstance(metadata, dict):
        return None
    inspyro_meta = metadata.get(TEMPLATE_BINDING_METADATA_ROOT)
    if not isinstance(inspyro_meta, dict):
        return None
    binding = inspyro_meta.get(TEMPLATE_BINDING_METADATA_KEY)
    return copy.deepcopy(binding) if isinstance(binding, dict) else None


def set_notebook_template_binding(notebook: dict[str, Any], binding: dict[str, Any]) -> dict[str, Any]:
    next_notebook = copy.deepcopy(notebook) if isinstance(notebook, dict) else {}
    metadata = next_notebook.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    inspyro_meta = metadata.get(TEMPLATE_BINDING_METADATA_ROOT)
    if not isinstance(inspyro_meta, dict):
        inspyro_meta = {}
    inspyro_meta[TEMPLATE_BINDING_METADATA_KEY] = copy.deepcopy(binding)
    metadata[TEMPLATE_BINDING_METADATA_ROOT] = inspyro_meta
    next_notebook["metadata"] = metadata
    return next_notebook


def resolve_bound_template_json_path(
    notebook_path: str | os.PathLike[str],
    binding: dict[str, Any],
) -> Path:
    resolved_notebook = _normalize_notebook_path(notebook_path)
    if not isinstance(binding, dict):
        raise TemplateBindingError("template_binding invalido", code="invalid_template_binding")
    if binding.get("type") != TEMPLATE_BINDING_TYPE:
        raise TemplateBindingError("template_binding.type no soportado", code="unsupported_template_binding_type")
    if binding.get("path_base") != TEMPLATE_BINDING_PATH_BASE:
        raise TemplateBindingError("template_binding.path_base no soportado", code="unsupported_template_binding_path_base")
    raw_path = str(binding.get("path") or "").strip()
    if not raw_path:
        raise TemplateBindingError("template_binding.path requerido", code="missing_template_binding_path")
    if Path(raw_path).is_absolute():
        raise TemplateBindingError("template_binding.path debe ser relativo", code="absolute_template_binding_path")
    resolved_json, _ = _resolve_template_json_path(resolved_notebook, raw_path)
    return resolved_json


def _read_notebook_payload(notebook_path: Path) -> dict[str, Any]:
    if not notebook_path.exists() or not notebook_path.is_file():
        raise TemplateBindingError("Notebook no encontrado", code="notebook_not_found", status_code=404)
    try:
        payload = json.loads(notebook_path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise TemplateBindingError(f"Notebook JSON invalido: {exc}", code="invalid_notebook_json") from exc
    except OSError as exc:
        raise TemplateBindingError(f"No se pudo leer el notebook: {exc}", code="notebook_read_failed", status_code=500) from exc
    if not isinstance(payload, dict):
        raise TemplateBindingError("Notebook JSON debe ser un objeto", code="invalid_notebook_payload")
    return payload


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError as exc:
        raise TemplateBindingError(f"No se pudo escribir {path}: {exc}", code="template_binding_write_failed", status_code=500) from exc


def _write_notebook_payload(notebook_path: Path, notebook_payload: dict[str, Any]) -> None:
    try:
        notebook_path.parent.mkdir(parents=True, exist_ok=True)
        notebook_path.write_text(json.dumps(notebook_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError as exc:
        raise TemplateBindingError(f"No se pudo escribir el notebook: {exc}", code="notebook_write_failed", status_code=500) from exc


def _decode_template_docx(docx_b64: Any) -> bytes:
    if not isinstance(docx_b64, str) or not docx_b64.strip():
        raise TemplateBindingError("docx_base64 requerido en template JSON", code="missing_docx_base64")
    try:
        docx_bytes = base64.b64decode(docx_b64.strip(), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise TemplateBindingError("docx_base64 invalido en template JSON", code="invalid_docx_base64") from exc
    if not docx_bytes:
        raise TemplateBindingError("El DOCX embebido en template JSON esta vacio", code="empty_docx_base64")
    if len(docx_bytes) > TEMPLATE_UPLOAD_MAX_BYTES:
        raise TemplateBindingError(
            f"Template JSON excede el maximo permitido: {len(docx_bytes)} bytes",
            code="template_json_too_large",
            status_code=413,
        )
    return docx_bytes


def _validate_template_export_package(payload: Any) -> tuple[dict[str, Any], bytes, dict[str, Any]]:
    if not isinstance(payload, dict):
        raise TemplateBindingError("Template JSON debe ser un objeto", code="invalid_template_json_payload")
    schema_version = str(payload.get("schema_version") or "").strip()
    if schema_version != TEMPLATE_EXPORT_SCHEMA_VERSION:
        raise TemplateBindingError(
            f"schema_version de template JSON no soportado: {schema_version or 'desconocido'}",
            code="unsupported_template_json_schema",
        )
    template_payload = payload.get("template")
    if not isinstance(template_payload, dict):
        raise TemplateBindingError("template requerido en template JSON", code="missing_template_payload")
    docx_bytes = _decode_template_docx(payload.get("docx_base64"))
    semantic_slots = payload.get("semantic_style_slots")
    if semantic_slots is None:
        semantic_slots = template_payload.get(template_service.SEMANTIC_STYLE_SLOTS_KEY)
    if semantic_slots is not None and not isinstance(semantic_slots, dict):
        raise TemplateBindingError("semantic_style_slots debe ser un objeto", code="invalid_semantic_style_slots")
    return payload, docx_bytes, copy.deepcopy(semantic_slots or {})


def _load_template_export_package(path: Path) -> tuple[dict[str, Any], bytes, dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError as exc:
        raise TemplateBindingError("Template JSON vinculado no existe", code="template_json_missing", status_code=404) from exc
    except json.JSONDecodeError as exc:
        raise TemplateBindingError(f"Template JSON corrupto: {exc}", code="invalid_template_json") from exc
    except OSError as exc:
        raise TemplateBindingError(f"No se pudo leer el template JSON: {exc}", code="template_json_read_failed", status_code=500) from exc
    return _validate_template_export_package(payload)


async def _apply_semantic_slots_to_kernel(kernel_id: str, semantic_slots: dict[str, Any]) -> dict[str, Any] | None:
    if not semantic_slots:
        return template_storage.get_template(kernel_id)
    updated_template = await template_service.run_template_executor(
        template_service.update_template_semantic_style_slots,
        kernel_id,
        semantic_slots,
    )
    template_path = template_storage.get_template_docx_path(kernel_id)
    if template_path:
        from app.routers.notebook_common import _get_kernel_lock, _timed_lock
        from app.services.jupyter_kernel import jupyter_kernel_manager

        if jupyter_kernel_manager is None:
            return updated_template
        lock = _get_kernel_lock(kernel_id)
        async with _timed_lock(lock):
            await jupyter_kernel_manager.execute_cell(
                kernel_id,
                template_logic.kernel_docx_set_template_code(
                    template_path,
                    (updated_template or {}).get(template_service.TABLE_STYLE_RUNTIME_DEFAULTS_KEY),
                    (updated_template or {}).get(template_service.BUILDER_REQUIRED_STYLE_DEFAULTS_KEY),
                    (updated_template or {}).get(template_service.SEMANTIC_STYLE_SLOTS_KEY),
                ),
                capture_variables=False,
            )
    return updated_template


async def apply_template_export_package_to_kernel(
    *,
    kernel_id: str,
    package: dict[str, Any],
    source_path: str | os.PathLike[str] | None = None,
) -> dict[str, Any]:
    _, docx_bytes, semantic_slots = _validate_template_export_package(package)
    template_payload = await template_logic.apply_template_bytes_to_kernel(kernel_id=kernel_id, docx_bytes=docx_bytes)
    if semantic_slots:
        updated_template = await _apply_semantic_slots_to_kernel(kernel_id, semantic_slots)
        if updated_template:
            template_payload = updated_template
    if isinstance(template_payload, dict):
        template_payload.setdefault("style_coverage", {})
        template_payload["style_coverage"] = template_payload.get("style_coverage") or {}
        if source_path:
            template_payload["source_path"] = str(source_path)
    return template_payload


def build_template_export_package(kernel_id: str, template: dict[str, Any] | None = None) -> dict[str, Any]:
    template_payload = copy.deepcopy(template if isinstance(template, dict) else template_storage.get_template(kernel_id))
    if not template_payload:
        raise TemplateBindingError("No hay plantilla activa para ese kernel", code="missing_active_template", status_code=404)

    docx_path = template_storage.get_template_docx_path(kernel_id)
    if not docx_path:
        raise TemplateBindingError("No se encontro el DOCX persistido de la plantilla", code="missing_template_docx", status_code=404)
    path = Path(docx_path)
    if not path.exists() or not path.is_file():
        raise TemplateBindingError("No se encontro el archivo DOCX exportable", code="missing_template_docx_file", status_code=404)
    try:
        docx_bytes = path.read_bytes()
    except OSError as exc:
        raise TemplateBindingError(f"No se pudo leer la plantilla: {exc}", code="template_docx_read_failed", status_code=500) from exc
    if not docx_bytes:
        raise TemplateBindingError("El DOCX persistido de la plantilla esta vacio", code="empty_template_docx", status_code=500)

    return {
        "schema_version": TEMPLATE_EXPORT_SCHEMA_VERSION,
        "exported_at": _utc_now(),
        "kernel_id": kernel_id,
        "template": template_payload,
        "docx_base64": base64.b64encode(docx_bytes).decode("ascii"),
        "file_name": path.name,
        "semantic_style_slots": copy.deepcopy(template_payload.get(template_service.SEMANTIC_STYLE_SLOTS_KEY) or {}),
    }


def _binding_status_payload(
    *,
    status: str,
    notebook_path: Path | None = None,
    binding: dict[str, Any] | None = None,
    template_json_path: Path | None = None,
    template: dict[str, Any] | None = None,
    message: str | None = None,
    error_code: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": status,
        "binding": copy.deepcopy(binding) if isinstance(binding, dict) else None,
        "path_base": TEMPLATE_BINDING_PATH_BASE,
    }
    if notebook_path is not None:
        payload["notebook_path"] = str(notebook_path)
    if template_json_path is not None:
        payload["template_json_path"] = str(template_json_path)
        payload["template_json_relpath"] = (
            template_json_path.relative_to(notebook_path.parent).as_posix()
            if notebook_path is not None
            else template_json_path.name
        )
        payload["exists"] = template_json_path.exists()
    if template is not None:
        payload["template"] = copy.deepcopy(template)
    if message:
        payload["message"] = message
    if error_code:
        payload["error_code"] = error_code
    return payload


def register_kernel_template_binding(
    kernel_id: str,
    notebook_path: str | os.PathLike[str],
    binding: dict[str, Any],
    status_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    resolved_notebook = _normalize_notebook_path(notebook_path)
    try:
        resolved_json = resolve_bound_template_json_path(resolved_notebook, binding)
    except TemplateBindingError:
        resolved_json = None
    status = status_payload or _binding_status_payload(
        status="bound",
        notebook_path=resolved_notebook,
        binding=binding,
        template_json_path=resolved_json,
    )
    with _binding_lock:
        _kernel_bindings[str(kernel_id)] = {
            "kernel_id": str(kernel_id),
            "notebook_path": str(resolved_notebook),
            "binding": copy.deepcopy(binding),
            "template_json_path": str(resolved_json) if resolved_json is not None else None,
            "status": copy.deepcopy(status),
            "updated_at": _utc_now(),
        }
    return status


def get_kernel_template_binding_status(kernel_id: str | None) -> dict[str, Any] | None:
    if not kernel_id:
        return None
    with _binding_lock:
        entry = _kernel_bindings.get(str(kernel_id))
        return copy.deepcopy(entry.get("status")) if entry else None


def clear_kernel_template_binding(kernel_id: str | None) -> None:
    if not kernel_id:
        return
    with _binding_lock:
        _kernel_bindings.pop(str(kernel_id), None)


def inspect_notebook_template_binding(
    notebook_path: str | os.PathLike[str],
    notebook: dict[str, Any] | None = None,
) -> dict[str, Any]:
    resolved_notebook = _normalize_notebook_path(notebook_path)
    notebook_payload = notebook if isinstance(notebook, dict) else None
    if notebook_payload is None and resolved_notebook.exists():
        notebook_payload = _read_notebook_payload(resolved_notebook)
    binding = get_notebook_template_binding(notebook_payload)
    if not binding:
        return _binding_status_payload(status="none", notebook_path=resolved_notebook)
    try:
        template_json_path = resolve_bound_template_json_path(resolved_notebook, binding)
        if not template_json_path.exists():
            return _binding_status_payload(
                status="missing",
                notebook_path=resolved_notebook,
                binding=binding,
                template_json_path=template_json_path,
                message="Template JSON vinculado no existe",
                error_code="template_json_missing",
            )
        _load_template_export_package(template_json_path)
        return _binding_status_payload(
            status="available",
            notebook_path=resolved_notebook,
            binding=binding,
            template_json_path=template_json_path,
        )
    except TemplateBindingError as exc:
        return _binding_status_payload(
            status="error",
            notebook_path=resolved_notebook,
            binding=binding,
            message=str(exc),
            error_code=exc.code,
        )


async def apply_notebook_template_binding_to_kernel(
    *,
    kernel_id: str,
    notebook_path: str | os.PathLike[str] | None,
    notebook: dict[str, Any] | None,
) -> dict[str, Any]:
    if not notebook_path:
        return _binding_status_payload(status="none")
    resolved_notebook = _normalize_notebook_path(notebook_path)
    if notebook is None and resolved_notebook.exists():
        try:
            notebook = _read_notebook_payload(resolved_notebook)
        except TemplateBindingError:
            notebook = None
    binding = get_notebook_template_binding(notebook)
    if not binding:
        clear_kernel_template_binding(kernel_id)
        return _binding_status_payload(status="none", notebook_path=resolved_notebook)
    try:
        template_json_path = resolve_bound_template_json_path(resolved_notebook, binding)
        if not template_json_path.exists():
            status = _binding_status_payload(
                status="missing",
                notebook_path=resolved_notebook,
                binding=binding,
                template_json_path=template_json_path,
                message="Template JSON vinculado no existe",
                error_code="template_json_missing",
            )
            register_kernel_template_binding(kernel_id, resolved_notebook, binding, status)
            return status
        package, _, _ = _load_template_export_package(template_json_path)
        template_payload = await apply_template_export_package_to_kernel(
            kernel_id=kernel_id,
            package=package,
            source_path=template_json_path,
        )
        status = _binding_status_payload(
            status="applied",
            notebook_path=resolved_notebook,
            binding=binding,
            template_json_path=template_json_path,
            template=template_payload,
            message="Template JSON aplicado al kernel",
        )
        register_kernel_template_binding(kernel_id, resolved_notebook, binding, status)
        return status
    except TemplateBindingError as exc:
        status = _binding_status_payload(
            status="error",
            notebook_path=resolved_notebook,
            binding=binding,
            message=str(exc),
            error_code=exc.code,
        )
        register_kernel_template_binding(kernel_id, resolved_notebook, binding, status)
        return status
    except Exception as exc:
        status = _binding_status_payload(
            status="error",
            notebook_path=resolved_notebook,
            binding=binding,
            message=str(exc),
            error_code="template_binding_apply_failed",
        )
        register_kernel_template_binding(kernel_id, resolved_notebook, binding, status)
        return status


def inherit_workspace_default_template_binding(
    notebook: dict[str, Any],
    notebook_path: str | os.PathLike[str] | None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    if not notebook_path or get_notebook_template_binding(notebook):
        return notebook, None
    resolved_notebook = _normalize_notebook_path(notebook_path)
    try:
        from app.services import workspace_service

        workspace_snapshot = workspace_service.get_workspace_snapshot()
        workspace_root_raw = workspace_snapshot.get("active_workspace") or workspace_snapshot.get("workspace_root")
        if not workspace_root_raw:
            return notebook, None
        workspace_root = Path(str(workspace_root_raw)).expanduser().resolve()
        _assert_child_path(workspace_root, resolved_notebook)
        default_json = workspace_root / ".inspyro" / "templates" / "default.inspyro-template.json"
        if not default_json.exists() or not default_json.is_file():
            return notebook, None
        _load_template_export_package(default_json)
        binding, target_json = build_template_binding(resolved_notebook)
        if not target_json.exists():
            target_json.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(default_json, target_json)
        next_notebook = set_notebook_template_binding(notebook, binding)
        status = _binding_status_payload(
            status="inherited",
            notebook_path=resolved_notebook,
            binding=binding,
            template_json_path=target_json,
            message="Template default del workspace copiado junto al notebook",
        )
        return next_notebook, status
    except Exception:
        return notebook, None


async def bind_active_template_to_notebook(
    *,
    kernel_id: str,
    notebook_path: str | os.PathLike[str],
    notebook: dict[str, Any] | None = None,
    template_json_path: str | os.PathLike[str] | None = None,
) -> dict[str, Any]:
    resolved_notebook = _normalize_notebook_path(notebook_path)
    notebook_payload = copy.deepcopy(notebook) if isinstance(notebook, dict) else _read_notebook_payload(resolved_notebook)
    binding, resolved_json = build_template_binding(resolved_notebook, template_json_path)
    package = build_template_export_package(kernel_id)
    _write_json(resolved_json, package)
    updated_notebook = set_notebook_template_binding(notebook_payload, binding)
    _write_notebook_payload(resolved_notebook, updated_notebook)
    status = _binding_status_payload(
        status="bound",
        notebook_path=resolved_notebook,
        binding=binding,
        template_json_path=resolved_json,
        template=package.get("template"),
        message="Template JSON vinculado al notebook",
    )
    register_kernel_template_binding(kernel_id, resolved_notebook, binding, status)
    return {
        "binding": binding,
        "notebook": updated_notebook,
        "template_binding": status,
    }


async def refresh_bound_template_export(
    kernel_id: str,
    *,
    template: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if not kernel_id:
        return None
    with _binding_lock:
        entry = copy.deepcopy(_kernel_bindings.get(str(kernel_id)))
    if not entry:
        try:
            from app.services.notebook_service import get_kernel_docx_source

            source_info = get_kernel_docx_source(kernel_id)
            source_path = source_info.get("source_path")
            if source_path:
                notebook_payload = _read_notebook_payload(_normalize_notebook_path(source_path))
                binding = get_notebook_template_binding(notebook_payload)
                if binding:
                    status = inspect_notebook_template_binding(source_path, notebook_payload)
                    if status.get("status") != "none":
                        register_kernel_template_binding(kernel_id, source_path, binding, status)
                        entry = {
                            "notebook_path": str(_normalize_notebook_path(source_path)),
                            "binding": binding,
                            "template_json_path": str(resolve_bound_template_json_path(source_path, binding)),
                        }
        except Exception:
            entry = None
    if not entry:
        return None

    try:
        notebook_path = _normalize_notebook_path(entry.get("notebook_path"))
        binding = entry.get("binding")
        template_json_path = resolve_bound_template_json_path(notebook_path, binding)
        package = build_template_export_package(kernel_id, template)
        _write_json(template_json_path, package)
        status = _binding_status_payload(
            status="updated",
            notebook_path=notebook_path,
            binding=binding,
            template_json_path=template_json_path,
            template=package.get("template"),
            message="Template JSON vinculado actualizado",
        )
        register_kernel_template_binding(kernel_id, notebook_path, binding, status)
        return status
    except TemplateBindingError as exc:
        status = _binding_status_payload(
            status="error",
            binding=entry.get("binding") if isinstance(entry, dict) else None,
            message=str(exc),
            error_code=exc.code,
        )
        with _binding_lock:
            if str(kernel_id) in _kernel_bindings:
                _kernel_bindings[str(kernel_id)]["status"] = copy.deepcopy(status)
        return status
