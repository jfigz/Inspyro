import base64
import html
import mimetypes
import os
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, Response

from app.services.docx_artifacts import (
    DOCX_ARTIFACT_RETENTION_DAYS,
    get_docx_delivery_file,
    get_docx_artifact,
    get_docx_quality_summary,
    get_docx_provenance,
    get_docx_workbench_resource,
    get_docx_workbench_result,
    get_latest_docx_artifact,
    list_docx_artifacts,
    reset_docx_artifacts,
    resolve_docx_provenance,
    store_docx_quality_summary,
    store_docx_workbench_result,
)
from app.services.docx_downloads import DOCX_MIME_TYPE, get_docx_file
from app.services.docx_quality.audit import audit_docx_bytes
from app.services.docx_quality.publish import clean_docx_bytes
from app.services.docx_quality.render import render_docx_page_png
from app.services.docx_quality.workbench import run_workbench_operation
from app.services.docx_render_cache import get_docx_render_resource
from app.services.docx_sanitizer import sanitize_docx_bytes_for_delivery
from app.services.notebook_service import notebook_last_docx_b64

router = APIRouter(prefix="/api/docx", tags=["docx"])

DOCX_NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}


def _build_docx_binary_response(data: bytes, *, filename: str) -> Response:
    return Response(
        content=data,
        media_type=DOCX_MIME_TYPE,
        headers={
            **DOCX_NO_CACHE_HEADERS,
            "Content-Disposition": f'attachment; filename="{filename or "inspyro_document.docx"}"',
        },
    )


def _resolve_artifact_for_quality(
    *,
    artifact_id: str | None = None,
    source_path: str | None = None,
    kernel_id: str | None = None,
) -> dict:
    info = None
    if artifact_id:
        info = get_docx_artifact(artifact_id)
    elif source_path or kernel_id:
        info = get_latest_docx_artifact(source_path=source_path, kernel_id=kernel_id)
    if not info:
        raise HTTPException(status_code=404, detail="DOCX no disponible para calidad")
    return info


def _read_delivery_docx_bytes(info: dict) -> bytes:
    delivery_info = get_docx_delivery_file(info)
    if delivery_info and delivery_info.get("path"):
        return Path(str(delivery_info["path"])).read_bytes()
    raw_path = info.get("path")
    if raw_path:
        return sanitize_docx_bytes_for_delivery(Path(str(raw_path)).read_bytes())
    raise HTTPException(status_code=404, detail="DOCX no disponible para calidad")


@router.get("/download")
async def download_docx(
    token: str | None = Query(default=None, min_length=10),
    artifact_id: str | None = Query(default=None, min_length=8),
    source_path: str | None = Query(default=None),
    kernel_id: str | None = Query(default=None),
):
    info = None
    prefer_delivery_file = False
    if artifact_id:
        info = get_docx_artifact(artifact_id)
        prefer_delivery_file = True
    elif token:
        info = get_docx_file(token)
    elif source_path or kernel_id:
        info = get_latest_docx_artifact(source_path=source_path, kernel_id=kernel_id)
        prefer_delivery_file = True

    if info:
        if prefer_delivery_file:
            delivery_info = get_docx_delivery_file(info)
            if delivery_info:
                return _build_docx_binary_response(
                    Path(str(delivery_info["path"])).read_bytes(),
                    filename=delivery_info.get("filename") or info.get("filename") or "inspyro_document.docx",
                )

        raw_bytes = Path(str(info["path"])).read_bytes()
        return _build_docx_binary_response(
            sanitize_docx_bytes_for_delivery(raw_bytes),
            filename=info.get("filename") or "inspyro_document.docx",
        )

    if kernel_id:
        docx_b64 = notebook_last_docx_b64.get(kernel_id)
        if docx_b64:
            data = sanitize_docx_bytes_for_delivery(base64.b64decode(docx_b64))
            return _build_docx_binary_response(
                data,
                filename="inspyro_document.docx",
            )

    raise HTTPException(status_code=404, detail="DOCX no disponible o expirado")


@router.get("/quality")
async def get_docx_quality(
    artifact_id: str = Query(..., min_length=8),
):
    summary = get_docx_quality_summary(artifact_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Calidad DOCX no disponible")
    return JSONResponse(content=summary, headers=DOCX_NO_CACHE_HEADERS)


@router.post("/quality/run")
async def run_docx_quality(payload: dict | None = Body(default=None)):
    request_payload = payload or {}
    info = _resolve_artifact_for_quality(
        artifact_id=request_payload.get("artifact_id"),
        source_path=request_payload.get("source_path"),
        kernel_id=request_payload.get("kernel_id"),
    )
    docx_bytes = _read_delivery_docx_bytes(info)
    summary = audit_docx_bytes(
        docx_bytes,
        artifact_id=info.get("artifact_id"),
        profile=str(request_payload.get("profile") or "quick"),
    )
    stored = store_docx_quality_summary(str(info["artifact_id"]), summary)
    return JSONResponse(content=stored, headers=DOCX_NO_CACHE_HEADERS)


def _attach_variant_resource_uri(stored: dict) -> dict:
    variant = stored.get("variant") if isinstance(stored.get("variant"), dict) else None
    resources = stored.get("resources") if isinstance(stored.get("resources"), list) else []
    if variant:
        filename = str(variant.get("filename") or "")
        for resource in resources:
            if isinstance(resource, dict) and resource.get("name") == filename:
                variant["resource_uri"] = resource.get("resource_uri")
                break
    return stored


@router.post("/workbench/run")
async def run_docx_workbench(payload: dict | None = Body(default=None)):
    request_payload = payload or {}
    operation = str(request_payload.get("operation") or "audit").strip().lower()
    info = _resolve_artifact_for_quality(
        artifact_id=request_payload.get("artifact_id"),
        source_path=request_payload.get("source_path"),
        kernel_id=request_payload.get("kernel_id"),
    )
    docx_bytes = _read_delivery_docx_bytes(info)

    compare_bytes = None
    if operation == "diff":
        compare_info = _resolve_artifact_for_quality(
            artifact_id=request_payload.get("compare_artifact_id") or request_payload.get("right_artifact_id"),
            source_path=request_payload.get("compare_source_path"),
            kernel_id=request_payload.get("compare_kernel_id"),
        )
        compare_bytes = _read_delivery_docx_bytes(compare_info)

    try:
        result, resources = run_workbench_operation(
            docx_bytes,
            operation=operation,
            payload=request_payload,
            artifact=info,
            compare_docx_bytes=compare_bytes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"No se pudo ejecutar Workbench DOCX: {exc}") from exc

    if operation == "audit" and isinstance(result.get("summary"), dict):
        store_docx_quality_summary(str(info["artifact_id"]), result["summary"])

    stored = store_docx_workbench_result(str(info["artifact_id"]), result, resources=resources)
    return JSONResponse(content=_attach_variant_resource_uri(stored), headers=DOCX_NO_CACHE_HEADERS)


@router.get("/workbench/result")
async def get_docx_workbench_result_route(
    workbench_id: str = Query(..., min_length=8),
):
    result = get_docx_workbench_result(workbench_id)
    if not result:
        raise HTTPException(status_code=404, detail="Resultado Workbench DOCX no disponible")
    return JSONResponse(content=result, headers=DOCX_NO_CACHE_HEADERS)


@router.get("/workbench/resource")
async def get_docx_workbench_resource_route(
    workbench_id: str = Query(..., min_length=8),
    name: str = Query(..., min_length=1),
):
    resource = get_docx_workbench_resource(workbench_id, name)
    if not resource:
        raise HTTPException(status_code=404, detail="Recurso Workbench DOCX no disponible")
    media_type = mimetypes.guess_type(str(resource.get("name") or ""))[0] or "application/octet-stream"
    headers = {
        **DOCX_NO_CACHE_HEADERS,
        "Content-Disposition": f'attachment; filename="{resource.get("name") or "docx-workbench-resource"}"',
    }
    return Response(content=resource["bytes"], media_type=media_type, headers=headers)


@router.get("/render/resource")
async def get_docx_render_resource_route(
    render_id: str = Query(..., min_length=8),
    name: str = Query(..., min_length=1),
):
    resource = get_docx_render_resource(render_id, name)
    if not resource:
        raise HTTPException(status_code=404, detail="Recurso visual DOCX no disponible")
    media_type = mimetypes.guess_type(str(resource.get("name") or ""))[0] or "application/octet-stream"
    headers = {
        **DOCX_NO_CACHE_HEADERS,
        "Content-Disposition": f'attachment; filename="{resource.get("name") or "docx-render-resource"}"',
    }
    return Response(content=resource["bytes"], media_type=media_type, headers=headers)


@router.get("/diff")
async def diff_docx_versions(
    artifact_id: str = Query(..., min_length=8),
    compare_artifact_id: str = Query(..., min_length=8),
):
    info = _resolve_artifact_for_quality(artifact_id=artifact_id)
    compare_info = _resolve_artifact_for_quality(artifact_id=compare_artifact_id)
    try:
        result, resources = run_workbench_operation(
            _read_delivery_docx_bytes(info),
            operation="diff",
            payload={"artifact_id": artifact_id, "compare_artifact_id": compare_artifact_id},
            artifact=info,
            compare_docx_bytes=_read_delivery_docx_bytes(compare_info),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    stored = store_docx_workbench_result(str(info["artifact_id"]), result, resources=resources)
    return JSONResponse(content=stored, headers=DOCX_NO_CACHE_HEADERS)


@router.get("/quality/render")
async def render_docx_quality_page(
    artifact_id: str = Query(..., min_length=8),
    page: int = Query(default=1, ge=1),
):
    info = _resolve_artifact_for_quality(artifact_id=artifact_id)
    docx_bytes = _read_delivery_docx_bytes(info)
    try:
        png_bytes, meta = render_docx_page_png(
            docx_bytes,
            page=page,
            artifact_id=str(info.get("artifact_id") or ""),
            binary_hash=str(info.get("binary_hash") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"No se pudo renderizar DOCX: {exc}") from exc
    headers = {
        **DOCX_NO_CACHE_HEADERS,
        "X-Inspyro-Docx-Page": str(meta.get("page") or page),
        "X-Inspyro-Docx-Page-Count": str(meta.get("page_count") or ""),
        "X-Inspyro-Docx-Render-Cached": "1" if meta.get("cached") else "0",
        "X-Inspyro-Docx-Render-Id": str(meta.get("render_id") or ""),
    }
    return Response(content=png_bytes, media_type="image/png", headers=headers)


@router.post("/quality/clean")
async def clean_docx_quality(payload: dict | None = Body(default=None)):
    request_payload = payload or {}
    info = _resolve_artifact_for_quality(
        artifact_id=request_payload.get("artifact_id"),
        source_path=request_payload.get("source_path"),
        kernel_id=request_payload.get("kernel_id"),
    )
    docx_bytes = _read_delivery_docx_bytes(info)
    tracked_changes = str(request_payload.get("tracked_changes") or "accept").strip().lower()
    if tracked_changes not in {"accept", "reject", "preserve"}:
        raise HTTPException(status_code=400, detail="tracked_changes debe ser accept, reject o preserve")
    cleaned, _stats = clean_docx_bytes(
        docx_bytes,
        scrub_metadata=bool(request_payload.get("scrub_metadata", True)),
        strip_comments=bool(request_payload.get("strip_comments", True)),
        tracked_changes=tracked_changes,
    )
    filename = str(info.get("filename") or "inspyro_document.docx")
    if filename.lower().endswith(".docx"):
        filename = f"{filename[:-5]}-clean.docx"
    else:
        filename = f"{filename}-clean.docx"
    return _build_docx_binary_response(cleaned, filename=filename)


@router.get("/provenance")
async def get_docx_provenance_manifest(
    artifact_id: str = Query(..., min_length=8),
):
    manifest = get_docx_provenance(artifact_id)
    if not manifest:
        raise HTTPException(status_code=404, detail="Provenance DOCX no disponible o expirada")
    return JSONResponse(content=manifest, headers=DOCX_NO_CACHE_HEADERS)


def _format_location_label(item: dict, *, exact: bool = False) -> str:
    file_key = "exact_file_path" if exact else "file_path"
    notebook_key = "exact_notebook_cell_id" if exact else "notebook_cell_id"
    line_key = "exact_line" if exact else "line"
    if item.get(file_key):
        return f"{item.get(file_key)}:{item.get(line_key)}"
    if item.get(notebook_key):
        return f"Celda {item.get(notebook_key)}, línea {item.get(line_key)}"
    return "Ubicación no disponible"


def _serialize_resolved_provenance(resolved: dict) -> dict:
    item = resolved.get("item") or {}
    return {
        "artifact_id": resolved.get("artifact_id"),
        "docx_provenance_open_url": resolved.get("docx_provenance_open_url"),
        "location_label": _format_location_label(item, exact=False),
        "exact_location_label": _format_location_label(item, exact=True),
        "item": item,
    }


@router.get("/provenance/open")
async def open_docx_provenance(
    provenance_id: str = Query(..., min_length=8),
    response_format: str | None = Query(default=None, alias="format"),
):
    resolved = resolve_docx_provenance(provenance_id)
    if not resolved:
        raise HTTPException(status_code=404, detail="Provenance DOCX no encontrada o expirada")

    resolved_payload = _serialize_resolved_provenance(resolved)
    if str(response_format or "").strip().lower() == "json":
        return JSONResponse(content=resolved_payload, headers=DOCX_NO_CACHE_HEADERS)

    item = resolved_payload.get("item") or {}
    location_label = resolved_payload.get("location_label")
    exact_location_label = resolved_payload.get("exact_location_label")
    user_stack = list(item.get("user_stack") or [])
    stack_html = "".join(
        f"<li><code>{html.escape(str(frame.get('file_path') or frame.get('notebook_cell_id') or 'unknown'))}:{html.escape(str(frame.get('line') or '?'))}</code></li>"
        for frame in user_stack[:8]
    )

    page_html = f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Procedencia DOCX</title>
  <style>
    body {{ font-family: "Segoe UI", sans-serif; background: #10151c; color: #eef2f7; margin: 0; padding: 24px; }}
    .card {{ max-width: 780px; margin: 0 auto; border: 1px solid #2b3442; border-radius: 14px; padding: 20px 22px; background: #161d27; }}
    .label {{ color: #8da2ba; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }}
    .value {{ margin: 6px 0 16px; font-size: 15px; line-height: 1.5; word-break: break-word; }}
    .title {{ font-size: 24px; margin: 0 0 18px; }}
    code {{ color: #d7e3f3; }}
    ul {{ margin: 0; padding-left: 18px; }}
  </style>
</head>
<body>
  <div class="card">
    <h1 class="title">Procedencia del documento</h1>
    <div class="label">Callsite</div>
    <div class="value"><code>{html.escape(str(location_label))}</code></div>
    <div class="label">Línea exacta</div>
    <div class="value"><code>{html.escape(str(exact_location_label))}</code></div>
    <div class="label">API DOCX</div>
    <div class="value"><code>{html.escape(str(item.get('api_name') or 'desconocida'))}</code></div>
    <div class="label">Precisión</div>
    <div class="value">{html.escape(str(item.get('precision') or 'unknown'))}</div>
    <div class="label">Vista previa</div>
    <div class="value">{html.escape(str(item.get('text_preview') or 'Sin vista previa disponible.'))}</div>
    <div class="label">Stack usuario</div>
    <div class="value"><ul>{stack_html or '<li>Sin stack disponible.</li>'}</ul></div>
  </div>
</body>
</html>"""
    return HTMLResponse(content=page_html, headers=DOCX_NO_CACHE_HEADERS)


@router.get("/history")
async def get_docx_history(
    source_path: str | None = Query(default=None),
    kernel_id: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
):
    if not source_path and not kernel_id:
        raise HTTPException(status_code=400, detail="source_path o kernel_id requerido")

    items = list_docx_artifacts(source_path=source_path, kernel_id=kernel_id, limit=limit)
    return JSONResponse(
        content={
            "items": [
                {
                    "artifact_id": item["artifact_id"],
                    "created_at": item["created_at"],
                    "docx_hash": item["docx_hash"],
                    "source_kind": item["source_kind"],
                    "source_path": item.get("source_path"),
                    "kernel_id": item.get("kernel_id"),
                    "execution_id": item.get("execution_id"),
                    "filename": item["filename"],
                    "size_bytes": item["size_bytes"],
                    "workspace_path": item.get("workspace_path"),
                    "workspace_relpath": item.get("workspace_relpath"),
                    "workspace_warning": item.get("workspace_warning"),
                    "docx_is_empty": bool(item.get("docx_is_empty")),
                    "docx_warning": item.get("docx_warning"),
                    "docx_quality_status": item.get("docx_quality_status"),
                    "docx_quality_score": item.get("docx_quality_score"),
                    "docx_quality_counts": item.get("docx_quality_counts"),
                    "docx_render_status": item.get("docx_render_status"),
                    "docx_render_page_count": item.get("docx_render_page_count"),
                    "docx_render_cached_pages": item.get("docx_render_cached_pages"),
                    "docx_render_renderer": item.get("docx_render_renderer"),
                    "docx_provenance_available": bool(item.get("docx_provenance_available")),
                    "docx_provenance_ref": item.get("docx_provenance_ref"),
                    "download_url": item["download_url"],
                    "ref": item["ref"],
                }
                for item in items
            ],
            "retention_days": DOCX_ARTIFACT_RETENTION_DAYS,
        },
        headers=DOCX_NO_CACHE_HEADERS,
    )


@router.post("/test/reset")
async def reset_docx_history_for_tests(payload: dict | None = Body(default=None)):
    if os.getenv("INSPYRO_TEST_MODE") != "1":
        raise HTTPException(status_code=404, detail="Not Found")

    request_payload = payload or {}
    removed = reset_docx_artifacts(
        source_path=request_payload.get("source_path"),
        kernel_id=request_payload.get("kernel_id"),
    )
    return {
        "status": "ok",
        "removed": removed,
    }
