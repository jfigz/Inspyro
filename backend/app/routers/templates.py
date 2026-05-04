from __future__ import annotations

import base64
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.core.security import is_path_safe
from app.services.template import storage as template_storage
from app.services.template_tokens import store_template_bytes

router = APIRouter(prefix="/api/templates", tags=["templates"])

TEMPLATE_UPLOAD_MAX_BYTES = int(os.getenv("INSPYRO_TEMPLATE_UPLOAD_MAX_BYTES", str(20 * 1024 * 1024)))
TEMPLATE_EXPORT_SCHEMA_VERSION = "1.1"


class TemplateTokenizeRequest(BaseModel):
    path: str


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
    template = template_storage.get_template(kernel_id)
    if not template:
        raise HTTPException(status_code=404, detail="No hay plantilla activa para ese kernel")

    docx_path = template_storage.get_template_docx_path(kernel_id)
    if not docx_path:
        raise HTTPException(status_code=404, detail="No se encontro el DOCX persistido de la plantilla")

    path = Path(docx_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="No se encontro el archivo DOCX exportable")

    try:
        docx_bytes = path.read_bytes()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"No se pudo leer la plantilla: {exc}") from exc

    if not docx_bytes:
        raise HTTPException(status_code=500, detail="El DOCX persistido de la plantilla esta vacio")

    return {
        "schema_version": TEMPLATE_EXPORT_SCHEMA_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "kernel_id": kernel_id,
        "template": template,
        "docx_base64": base64.b64encode(docx_bytes).decode("ascii"),
        "file_name": path.name,
    }
