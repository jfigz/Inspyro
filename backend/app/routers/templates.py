from __future__ import annotations

import asyncio
import os
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.core.security import is_path_safe
from app.services import template_binding, template_service
from app.services.template_tokens import store_template_bytes

router = APIRouter(prefix="/api/templates", tags=["templates"])

TEMPLATE_UPLOAD_MAX_BYTES = int(os.getenv("INSPYRO_TEMPLATE_UPLOAD_MAX_BYTES", str(20 * 1024 * 1024)))
TEMPLATE_EXPORT_SCHEMA_VERSION = "1.1"


class TemplateTokenizeRequest(BaseModel):
    path: str


class TemplateBindRequest(BaseModel):
    kernel_id: str
    notebook_path: str
    notebook: dict | None = None
    template_json_path: str | None = None


class TemplateSamplePreviewRenderRequest(BaseModel):
    kernel_id: str | None = None
    preview_key: str
    docx_base64: str
    force_refresh: bool = False


class TemplateSamplePreviewOpenRequest(BaseModel):
    filename: str | None = None
    docx_base64: str


def _raise_template_binding_error(exc: template_binding.TemplateBindingError) -> None:
    raise HTTPException(
        status_code=exc.status_code,
        detail={
            "message": str(exc),
            "error_code": exc.code,
        },
    ) from exc


@router.post("/upload")
async def upload_template(file: UploadFile = File(...)):
    filename = file.filename or "template.docx"
    if not filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="Solo se permiten archivos .docx")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Archivo vacio")
    if len(data) > TEMPLATE_UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Archivo demasiado grande. Maximo permitido: {TEMPLATE_UPLOAD_MAX_BYTES} bytes",
        )

    stored = store_template_bytes(data, filename=filename)
    return {
        "template_token": stored["template_token"],
        "size_bytes": stored["size_bytes"],
        "sha256": stored["sha256"],
    }


@router.post("/tokenize")
async def tokenize_template_path(request_data: TemplateTokenizeRequest):
    requested_path = request_data.path.strip()
    if not requested_path:
        raise HTTPException(status_code=400, detail="Path requerido")

    resolved = Path(requested_path).expanduser().resolve()
    if not is_path_safe(str(resolved)):
        raise HTTPException(status_code=403, detail="Acceso denegado a esta plantilla")
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    if resolved.suffix.lower() != ".docx":
        raise HTTPException(status_code=400, detail="Solo se permiten archivos .docx")

    data = resolved.read_bytes()
    if not data:
        raise HTTPException(status_code=400, detail="Archivo vacio")
    if len(data) > TEMPLATE_UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Archivo demasiado grande. Maximo permitido: {TEMPLATE_UPLOAD_MAX_BYTES} bytes",
        )

    stored = store_template_bytes(data, filename=resolved.name)
    return {
        "template_token": stored["template_token"],
        "size_bytes": stored["size_bytes"],
        "sha256": stored["sha256"],
        "file_name": resolved.name,
        "path": str(resolved),
    }


@router.get("/export")
async def export_template(kernel_id: str = Query(..., min_length=1)):
    try:
        return template_binding.build_template_export_package(kernel_id)
    except template_binding.TemplateBindingError as exc:
        _raise_template_binding_error(exc)


@router.post("/sample-preview/render-word")
async def render_sample_preview_with_word(request_data: TemplateSamplePreviewRenderRequest):
    try:
        return await asyncio.to_thread(
            template_service.render_sample_preview_docx_with_word,
            request_data.kernel_id or "template-editor",
            request_data.preview_key,
            request_data.docx_base64,
            request_data.force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc), "error_code": "invalid_sample_docx"}) from exc


@router.post("/sample-preview/open-default")
async def open_sample_preview_with_default_app(request_data: TemplateSamplePreviewOpenRequest):
    try:
        docx_path = await asyncio.to_thread(
            template_service.save_sample_preview_docx,
            request_data.filename or "template-preview.docx",
            request_data.docx_base64,
        )
        open_result = await asyncio.to_thread(template_service.open_path_with_default_application, docx_path)
        return {
            "success": True,
            "path": str(docx_path),
            "open_result": open_result,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc), "error_code": "invalid_sample_docx"}) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"message": f"No se pudo abrir el DOCX de ejemplo: {exc}", "error_code": "open_default_failed"},
        ) from exc


@router.post("/bind")
async def bind_template_to_notebook(request_data: TemplateBindRequest):
    try:
        return await template_binding.bind_active_template_to_notebook(
            kernel_id=request_data.kernel_id,
            notebook_path=request_data.notebook_path,
            notebook=request_data.notebook,
            template_json_path=request_data.template_json_path,
        )
    except template_binding.TemplateBindingError as exc:
        _raise_template_binding_error(exc)
