"""Tools MCP - Documents: generacion, descarga y exportacion de DOCX/PDF."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional, TypedDict
from urllib.parse import parse_qs, urlparse

from .. import config
from ..activity import mcp_activity_tool
from ..bridge import BridgeError, InspyroBridge
from ..mirror import emit_artifact_update, emit_file_mutation, emit_open_resource
from ..runtime import build_artifact_resource_uri, build_portable_artifact_resource_uri
from ..session_state import McpSessionState
from . import files as file_tools

logger = logging.getLogger("inspyro.mcp.tools.documents")

_SESSION_STATE = McpSessionState.get()
_DEFAULT_FILENAMES = {
    "docx": "inspyro_document.docx",
    "pdf": "inspyro_document.pdf",
}
_CONTENT_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}
_FILE_SUFFIXES = {
    "docx": ".docx",
    "pdf": ".pdf",
}
_LONG_DOCUMENT_TIMEOUT_S = max(
    600,
    int(config.CELL_EXECUTION_TIMEOUT),
    int(config.WS_TIMEOUT),
    int(config.REST_TIMEOUT),
)
_ARTIFACT_WAIT_TIMEOUT_S = max(
    0.0,
    float(os.getenv("INSPYRO_MCP_ARTIFACT_WAIT_TIMEOUT", str(_LONG_DOCUMENT_TIMEOUT_S))),
)
_ARTIFACT_WAIT_POLL_S = 0.2
_QUALITY_DETAIL_LEVELS = {"compact", "findings", "full"}
_QUALITY_SOURCE_BY_SECTION = {
    "accessibility": "audit",
    "layout": "audit",
    "package": "audit",
    "fields": "fields",
    "styles": "styles",
    "publication": "publishing",
    "content_controls": "content_controls",
}
_WORKBENCH_RESOURCE_REST_PATH = "/api/docx/workbench/resource"


class DocumentHandleResult(TypedDict, total=False):
    status: str
    kernel_id: str
    execution_id: str | None
    size_bytes: int | None
    content_type: str
    token: str | None
    ref: str | None
    filename: str | None
    resource_uri: str
    portable_resource_uri: str | None
    resource_scope: str
    hash: str | None
    inline_content: bool
    inline_skipped_reason: str
    message: str
    pdf_base64: str
    docx_base64: str
    docx_quality: dict[str, Any]


def _default_filename(kind: str) -> str:
    return _DEFAULT_FILENAMES["pdf" if kind == "pdf" else "docx"]


def _content_type(kind: str) -> str:
    return _CONTENT_TYPES["pdf" if kind == "pdf" else "docx"]


def _file_suffix(kind: str) -> str:
    return _FILE_SUFFIXES["pdf" if kind == "pdf" else "docx"]


def _extract_token_from_ref(ref: Optional[str]) -> Optional[str]:
    if not ref:
        return None
    parsed = urlparse(ref)
    query = parse_qs(parsed.query)
    token_values = query.get("token") or []
    if token_values:
        token = str(token_values[0]).strip()
        return token or None
    return None


def _extract_query_value(ref: Optional[str], key: str) -> Optional[str]:
    if not ref:
        return None
    parsed = urlparse(ref)
    query = parse_qs(parsed.query)
    values = query.get(key) or []
    if values:
        value = str(values[0]).strip()
        return value or None
    return None


def _extract_docx_artifact_id(artifact: Optional[dict[str, Any]]) -> Optional[str]:
    if not artifact:
        return None
    direct_value = str(artifact.get("docx_artifact_id") or "").strip()
    if direct_value:
        return direct_value
    for ref_value in (artifact.get("docx_ref"), artifact.get("docx_download_url")):
        artifact_id = _extract_query_value(str(ref_value) if ref_value else None, "artifact_id")
        if artifact_id:
            return artifact_id
    return None


def _artifact_ref_for_kind(kind: str, artifact: Optional[dict[str, Any]]) -> Optional[str]:
    if not artifact:
        return None
    if kind == "docx":
        return str(artifact.get("docx_ref") or artifact.get("docx_download_url") or "").strip() or None
    return str(artifact.get("pdf_ref") or "").strip() or None


def _resolve_artifact(
    *,
    kernel_id: str,
    execution_id: Optional[str],
) -> Optional[dict[str, Any]]:
    return _SESSION_STATE.get_artifacts(kernel_id=kernel_id, execution_id=execution_id)


def _artifact_has_downloadable_content(kind: str, artifact: Optional[dict[str, Any]]) -> bool:
    if not artifact:
        return False
    if kind == "docx":
        return bool(
            artifact.get("docx_file_b64")
            or artifact.get("docx_file_token")
            or _extract_docx_artifact_id(artifact)
            or _artifact_ref_for_kind("docx", artifact)
        )
    return bool(
        artifact.get("pdf_file_b64")
        or artifact.get("pdf_file_token")
        or _artifact_ref_for_kind("pdf", artifact)
    )


def _resolve_artifact_for_kind(
    *,
    kind: str,
    kernel_id: str,
    execution_id: Optional[str],
) -> Optional[dict[str, Any]]:
    artifact = _resolve_artifact(kernel_id=kernel_id, execution_id=execution_id)
    if _artifact_has_downloadable_content(kind, artifact) or not execution_id:
        return artifact

    current_execution = str(_SESSION_STATE.get_kernel_status(kernel_id).get("last_execution_id") or "").strip()
    requested_execution = str(execution_id or "").strip()
    if requested_execution and requested_execution == current_execution:
        latest_artifact = _resolve_artifact(kernel_id=kernel_id, execution_id=None)
        if _artifact_has_downloadable_content(kind, latest_artifact):
            return latest_artifact
    return artifact


async def _wait_for_artifact_for_kind(
    *,
    kind: str,
    kernel_id: str,
    execution_id: Optional[str],
    timeout_s: float = _ARTIFACT_WAIT_TIMEOUT_S,
) -> Optional[dict[str, Any]]:
    artifact = _resolve_artifact_for_kind(
        kind=kind,
        kernel_id=kernel_id,
        execution_id=execution_id,
    )
    if _artifact_has_downloadable_content(kind, artifact):
        return artifact
    if timeout_s <= 0:
        return artifact

    requested_execution = str(execution_id or "").strip()
    current_execution = str(_SESSION_STATE.get_kernel_status(kernel_id).get("last_execution_id") or "").strip()
    should_wait = bool(requested_execution) and requested_execution == current_execution
    if not should_wait:
        return artifact

    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_s
    while loop.time() < deadline:
        await asyncio.sleep(_ARTIFACT_WAIT_POLL_S)
        artifact = _resolve_artifact_for_kind(
            kind=kind,
            kernel_id=kernel_id,
            execution_id=execution_id,
        )
        if _artifact_has_downloadable_content(kind, artifact):
            return artifact
    return artifact


async def _download_artifact_bytes(
    bridge: InspyroBridge,
    *,
    kind: str,
    artifact: Optional[dict[str, Any]],
    explicit_token: Optional[str] = None,
) -> tuple[bytes, Optional[str], Optional[str]]:
    inline_key = "pdf_file_b64" if kind == "pdf" else "docx_file_b64"
    token_key = "pdf_file_token" if kind == "pdf" else "docx_file_token"
    route = "/api/pdf/download" if kind == "pdf" else "/api/docx/download"

    if artifact and artifact.get(inline_key):
        b64_value = str(artifact[inline_key])
        return base64.b64decode(b64_value), artifact.get(token_key), _artifact_ref_for_kind(kind, artifact)

    ref_value = _artifact_ref_for_kind(kind, artifact)
    token = explicit_token or _extract_token_from_ref(ref_value) or (artifact or {}).get(token_key)
    artifact_id = _extract_docx_artifact_id(artifact) if kind == "docx" else None
    if not token:
        if kind == "docx" and artifact_id:
            content = await bridge.rest_get_bytes(
                route,
                params={"artifact_id": artifact_id},
            )
            ref = ref_value or f"{route}?artifact_id={artifact_id}"
            return content, None, ref
        raise BridgeError(
            f"No hay artefacto {kind.upper()} descargable asociado.",
            payload={"type": "mcp_document_error", "kind": kind, "error_code": "missing_artifact"},
        )

    content = await bridge.rest_get_bytes(
        route,
        params={"token": token, "inline": "0"} if kind == "pdf" else {"token": token},
    )
    ref = ref_value or f"{route}?token={token}"
    return content, token, ref


def _resolve_artifact_meta(
    kind: str,
    artifact: Optional[dict[str, Any]],
    explicit_token: Optional[str],
) -> tuple[Optional[str], Optional[str], Optional[int], Optional[str], Optional[str]]:
    token_key = "pdf_file_token" if kind == "pdf" else "docx_file_token"
    ref_key = "pdf_ref" if kind == "pdf" else "docx_ref"
    download_url_key = "docx_download_url" if kind == "docx" else None
    size_key = "pdf_size_bytes" if kind == "pdf" else "docx_size_bytes"
    hash_key = "pdf_hash" if kind == "pdf" else "docx_hash"
    filename_key = "pdf_file_name" if kind == "pdf" else "docx_file_name"
    ref = (artifact or {}).get(ref_key) or ((artifact or {}).get(download_url_key) if download_url_key else None)
    token = explicit_token or _extract_token_from_ref(ref) or (artifact or {}).get(token_key)
    if not token and kind == "docx":
        artifact_id = _extract_docx_artifact_id(artifact)
        ref = ref or (f"/api/docx/download?artifact_id={artifact_id}" if artifact_id else None)
    else:
        ref = ref or (f"/api/{kind}/download?token={token}" if token else None)
    size_bytes = (artifact or {}).get(size_key)
    hash_value = (artifact or {}).get(hash_key)
    filename = (artifact or {}).get(filename_key) or (None if not token else _default_filename(kind))
    return token, ref, size_bytes, hash_value, filename


def _should_inline(
    kind: str,
    *,
    inline_content: bool,
    size_bytes: Optional[int],
    max_inline_bytes: Optional[int],
) -> tuple[bool, Optional[str]]:
    if not inline_content:
        return False, None
    effective_limit = max_inline_bytes
    if effective_limit is None:
        effective_limit = config.MAX_PDF_SIZE_BYTES if kind == "pdf" else config.MAX_DOCX_SIZE_BYTES
    if size_bytes is not None and size_bytes > effective_limit:
        return False, f"{kind.upper()} exceeds inline size limit ({size_bytes} > {effective_limit})"
    return True, None


def _resource_handles(
    *,
    kind: str,
    kernel_id: str,
    execution_id: Optional[str],
    artifact: Optional[dict[str, Any]],
    explicit_token: Optional[str],
) -> dict[str, Any]:
    resolved_execution_id = execution_id or (artifact or {}).get("execution_id")
    token, ref, size_bytes, hash_value, filename = _resolve_artifact_meta(kind, artifact, explicit_token)
    portable_resource_uri = build_portable_artifact_resource_uri(kind, token) if token else None
    return {
        "execution_id": resolved_execution_id,
        "size_bytes": size_bytes,
        "token": token,
        "ref": ref,
        "filename": filename or _default_filename(kind),
        "resource_uri": build_artifact_resource_uri(kind, kernel_id, resolved_execution_id),
        "portable_resource_uri": portable_resource_uri,
        "resource_scope": "portable" if portable_resource_uri else "session",
        "hash": hash_value,
    }


def _wants_directory(raw_path: str, normalized_path: Path) -> bool:
    trimmed = str(raw_path or "").strip()
    if trimmed.endswith(("/", "\\")):
        return True
    return normalized_path.exists() and normalized_path.is_dir()


async def _resolve_export_target(
    bridge: InspyroBridge,
    *,
    raw_path: str,
    filename: str,
    kind: str,
) -> Path:
    normalized_path = Path(await file_tools._resolve_workspace_path(bridge, raw_path))
    target_path = normalized_path
    if _wants_directory(raw_path, normalized_path):
        target_path = normalized_path / (filename or _default_filename(kind))
    elif not target_path.suffix:
        target_path = target_path.with_suffix(_file_suffix(kind))
    normalized_target = await file_tools._resolve_workspace_path(bridge, str(target_path))
    return Path(normalized_target)


def _write_document_bytes(target_path: Path, content: bytes, *, overwrite: bool) -> tuple[str, bool]:
    existed_before = target_path.exists()
    if existed_before and target_path.is_dir():
        raise BridgeError(
            f"El destino {target_path} es un directorio, no un archivo exportable.",
            payload={"type": "mcp_document_error", "error_code": "export_target_is_directory", "path": str(target_path)},
        )
    if existed_before and not overwrite:
        raise BridgeError(
            f"El archivo destino ya existe: {target_path}",
            payload={"type": "mcp_document_error", "error_code": "export_destination_exists", "path": str(target_path)},
        )
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(content)
    return ("write" if existed_before else "create"), existed_before


def _ensure_document_target_writable(target_path: Path, *, overwrite: bool) -> None:
    if target_path.exists() and target_path.is_dir():
        raise BridgeError(
            f"El destino {target_path} es un directorio, no un archivo exportable.",
            payload={"type": "mcp_document_error", "error_code": "export_target_is_directory", "path": str(target_path)},
        )
    if target_path.exists() and not overwrite:
        raise BridgeError(
            f"El archivo destino ya existe: {target_path}",
            payload={"type": "mcp_document_error", "error_code": "export_destination_exists", "path": str(target_path)},
        )


def _normalize_quality_counts(raw_counts: Any) -> dict[str, int]:
    counts = raw_counts if isinstance(raw_counts, dict) else {}
    return {
        "error": int(counts.get("error") or 0),
        "warning": int(counts.get("warning") or 0),
        "info": int(counts.get("info") or 0),
    }


def _slug_code(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return normalized[:48] or "finding"


def _quality_source(section: str, raw: dict[str, Any]) -> str:
    source = str(raw.get("source") or "").strip()
    if source:
        return source
    return _QUALITY_SOURCE_BY_SECTION.get(section, "audit")


def _quality_location(raw: dict[str, Any]) -> str | None:
    explicit = raw.get("location")
    if explicit:
        return str(explicit)
    context = raw.get("context")
    if not isinstance(context, dict):
        return None
    parts: list[str] = []
    for key in ("part", "style", "placeholder", "name", "id", "page", "paragraph", "row", "column"):
        value = context.get(key)
        if value is not None and str(value).strip():
            parts.append(f"{key}={str(value).strip()[:120]}")
    text = context.get("text")
    if text:
        parts.append(f"text={str(text).strip()[:120]}")
    if context.get("from_level") is not None and context.get("to_level") is not None:
        parts.append(f"heading={context.get('from_level')}->{context.get('to_level')}")
    return "; ".join(parts) or None


def _quality_suggestion(section: str, message: str) -> str | None:
    lowered = message.lower()
    if "imagen sin texto alternativo" in lowered:
        return "Agrega texto alternativo o un titulo descriptivo a la imagen."
    if "tabla sin primera fila" in lowered:
        return "Marca la primera fila como encabezado de tabla en Word."
    if "placeholder de campo word" in lowered:
        return "Reemplaza el texto literal por un campo Word real o por contenido final antes de publicar."
    if "hiperv" in lowered:
        return "Usa un texto de enlace descriptivo y evita mostrar la URL cruda cuando no aporte valor."
    if "salto de jerarqu" in lowered:
        return "Ajusta los estilos de encabezado para no saltar niveles."
    if "formato directo" in lowered:
        return "Mueve el formato repetido a estilos de documento o plantilla."
    if "placeholders" in lowered and "{{" in lowered:
        return "Envuelve cada placeholder {{TAG}} en un control de contenido o reemplazalo por su valor final."
    if section == "publication":
        return "Genera una copia limpia antes de entregar si el documento conserva metadata, comentarios o redlines."
    return None


def _normalize_quality_finding(raw: Any) -> dict[str, Any]:
    item = raw if isinstance(raw, dict) else {"message": str(raw)}
    section = str(item.get("section") or "general").strip() or "general"
    message = str(item.get("message") or item.get("title") or "").strip()
    code = str(item.get("code") or item.get("type") or f"{section}.{_slug_code(message)}").strip()
    finding = {
        "severity": str(item.get("severity") or item.get("level") or "info").strip().lower() or "info",
        "section": section,
        "code": code,
        "message": message,
        "location": _quality_location(item),
        "suggestion": item.get("suggestion") or _quality_suggestion(section, message),
        "source": _quality_source(section, item),
    }
    return {key: value for key, value in finding.items() if value not in (None, "")}


def _normalize_quality_sections(raw_sections: Any) -> list[dict[str, Any]]:
    sections: list[Any]
    if isinstance(raw_sections, dict):
        sections = [
            {"id": key, **(value if isinstance(value, dict) else {"status": value})}
            for key, value in raw_sections.items()
        ]
    elif isinstance(raw_sections, list):
        sections = raw_sections
    else:
        sections = []

    normalized: list[dict[str, Any]] = []
    for raw in sections:
        if not isinstance(raw, dict):
            continue
        findings = raw.get("findings") if isinstance(raw.get("findings"), list) else []
        counts = _normalize_quality_counts(raw.get("counts"))
        if findings and not any(counts.values()):
            derived: dict[str, int] = {"error": 0, "warning": 0, "info": 0}
            for finding in findings:
                severity = str((finding or {}).get("severity") or "info").lower() if isinstance(finding, dict) else "info"
                if severity not in derived:
                    severity = "info"
                derived[severity] += 1
            counts = derived
        normalized.append(
            {
                "id": str(raw.get("id") or raw.get("section") or raw.get("name") or "general"),
                "status": str(raw.get("status") or "ok"),
                "findings_count": len(findings) if findings else int(raw.get("findings_count") or sum(counts.values())),
                "counts": counts,
            }
        )
    return normalized


def _normalize_detail_level(detail: str) -> str:
    normalized = str(detail or "findings").strip().lower()
    return normalized if normalized in _QUALITY_DETAIL_LEVELS else "findings"


def _normalize_max_findings(max_findings: int) -> int:
    try:
        return max(0, min(200, int(max_findings)))
    except (TypeError, ValueError):
        return 12


def _normalize_quality_summary(
    summary: dict[str, Any],
    *,
    detail: str,
    max_findings: int,
    artifact_id: Optional[str] = None,
) -> dict[str, Any]:
    detail_level = _normalize_detail_level(detail)
    finding_limit = _normalize_max_findings(max_findings)
    raw_findings = summary.get("findings") if isinstance(summary.get("findings"), list) else []
    normalized_findings = [_normalize_quality_finding(item) for item in raw_findings]
    if detail_level == "full":
        visible_findings = normalized_findings
    elif detail_level == "findings":
        visible_findings = normalized_findings[:finding_limit]
    else:
        visible_findings = []
    truncated = detail_level == "findings" and len(normalized_findings) > len(visible_findings)

    result: dict[str, Any] = {
        "status": "ok",
        "artifact_id": summary.get("artifact_id") or artifact_id,
        "quality_status": summary.get("quality_status") or summary.get("status") or "unknown",
        "score": summary.get("score"),
        "counts": _normalize_quality_counts(summary.get("counts")),
        "sections": _normalize_quality_sections(summary.get("sections")),
        "pages_rendered": summary.get("pages_rendered"),
        "detail": detail_level,
    }
    if detail_level != "compact":
        result["findings"] = visible_findings
        result["truncated_findings"] = truncated
        result["total_findings"] = len(normalized_findings)
    if detail_level == "full":
        for key in ("schema_version", "binary_hash", "fields", "content_controls", "generated_at", "updated_at"):
            if key in summary:
                result[key] = summary[key]
    return result


def _is_missing_quality_error(exc: BridgeError) -> bool:
    status_code = exc.payload.get("status_code")
    return status_code == 404


async def _get_cached_docx_quality(bridge: InspyroBridge, artifact_id: str) -> dict[str, Any] | None:
    try:
        payload = await bridge.rest_get("/api/docx/quality", params={"artifact_id": artifact_id})
    except BridgeError as exc:
        if _is_missing_quality_error(exc):
            return None
        raise
    return payload if isinstance(payload, dict) else None


async def _latest_docx_artifact_from_history(
    bridge: InspyroBridge,
    *,
    kernel_id: Optional[str] = None,
    source_path: Optional[str] = None,
) -> dict[str, Any] | None:
    params: dict[str, Any] = {"limit": 1}
    if kernel_id:
        params["kernel_id"] = kernel_id
    if source_path:
        params["source_path"] = source_path
    if "kernel_id" not in params and "source_path" not in params:
        return None
    try:
        payload = await bridge.rest_get("/api/docx/history", params=params)
    except BridgeError as exc:
        if exc.payload.get("status_code") == 404:
            return None
        raise
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list) or not items:
        return None
    item = items[0]
    return item if isinstance(item, dict) else None


async def _resolve_docx_quality_target(
    bridge: InspyroBridge,
    *,
    artifact_id: Optional[str],
    kernel_id: Optional[str],
    execution_id: Optional[str],
    source_path: Optional[str],
) -> dict[str, Any]:
    normalized_artifact_id = str(artifact_id or "").strip() or None
    normalized_kernel_id = str(kernel_id or "").strip() or None
    normalized_execution_id = str(execution_id or "").strip() or None
    normalized_source_path = str(source_path or "").strip() or None

    if normalized_artifact_id:
        return {
            "artifact_id": normalized_artifact_id,
            "kernel_id": normalized_kernel_id,
            "execution_id": normalized_execution_id,
            "source_path": normalized_source_path,
            "artifact": None,
        }

    if normalized_kernel_id:
        artifact = _resolve_artifact_for_kind(
            kind="docx",
            kernel_id=normalized_kernel_id,
            execution_id=normalized_execution_id,
        )
        resolved_artifact_id = _extract_docx_artifact_id(artifact)
        if resolved_artifact_id:
            return {
                "artifact_id": resolved_artifact_id,
                "kernel_id": normalized_kernel_id,
                "execution_id": normalized_execution_id or (artifact or {}).get("execution_id"),
                "source_path": normalized_source_path,
                "artifact": artifact,
            }

        history_item = await _latest_docx_artifact_from_history(bridge, kernel_id=normalized_kernel_id)
        if history_item and history_item.get("artifact_id"):
            return {
                "artifact_id": str(history_item["artifact_id"]),
                "kernel_id": normalized_kernel_id,
                "execution_id": normalized_execution_id or history_item.get("execution_id"),
                "source_path": normalized_source_path or history_item.get("source_path"),
                "artifact": history_item,
            }

    if normalized_source_path:
        history_item = await _latest_docx_artifact_from_history(bridge, source_path=normalized_source_path)
        if history_item and history_item.get("artifact_id"):
            return {
                "artifact_id": str(history_item["artifact_id"]),
                "kernel_id": normalized_kernel_id or history_item.get("kernel_id"),
                "execution_id": normalized_execution_id or history_item.get("execution_id"),
                "source_path": normalized_source_path,
                "artifact": history_item,
            }

    return {
        "artifact_id": None,
        "kernel_id": normalized_kernel_id,
        "execution_id": normalized_execution_id,
        "source_path": normalized_source_path,
        "artifact": None,
    }


def _quality_request_body(target: dict[str, Any]) -> dict[str, Any]:
    if target.get("artifact_id"):
        return {"artifact_id": target["artifact_id"]}
    if target.get("source_path"):
        return {"source_path": target["source_path"]}
    if target.get("kernel_id"):
        return {"kernel_id": target["kernel_id"]}
    raise BridgeError(
        "Debes indicar artifact_id, kernel_id o source_path para revisar calidad DOCX.",
        payload={"type": "mcp_document_error", "error_code": "missing_artifact_selector"},
    )


def _clean_docx_filename(filename: Optional[str]) -> str:
    base_name = str(filename or _default_filename("docx")).strip() or _default_filename("docx")
    if base_name.lower().endswith(".docx"):
        return f"{base_name[:-5]}-clean.docx"
    return f"{base_name}-clean.docx"


def _workbench_request_body(
    target: dict[str, Any],
    *,
    operation: str,
    options: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    body = {**_quality_request_body(target), "operation": str(operation or "audit")}
    if isinstance(options, dict):
        body.update(options)
    return body


def _compact_resource(resource: Any) -> dict[str, Any] | None:
    if not isinstance(resource, dict):
        return None
    return {
        key: resource.get(key)
        for key in ("name", "size_bytes", "hash", "resource_uri")
        if resource.get(key) not in (None, "")
    }


def _normalize_workbench_result(
    raw: dict[str, Any],
    *,
    detail: str = "findings",
    max_findings: int = 12,
) -> dict[str, Any]:
    detail_level = _normalize_detail_level(detail)
    result: dict[str, Any] = {
        "status": raw.get("status") or "ok",
        "operation": raw.get("operation"),
        "artifact_id": raw.get("artifact_id"),
        "parent_artifact_id": raw.get("parent_artifact_id"),
        "workbench_id": raw.get("workbench_id"),
        "generated_at": raw.get("generated_at"),
        "resources": [
            compact
            for compact in (_compact_resource(item) for item in (raw.get("resources") or []))
            if compact
        ],
    }
    if isinstance(raw.get("summary"), dict):
        result["quality"] = _normalize_quality_summary(
            raw["summary"],
            detail=detail_level,
            max_findings=max_findings,
            artifact_id=raw.get("artifact_id"),
        )
    for key in ("review", "fields", "content_controls", "protection", "redaction", "diff", "stats", "render", "visual", "rendered_pages"):
        value = raw.get(key)
        if isinstance(value, (dict, list, str, int, float, bool)):
            result[key] = value
    if isinstance(raw.get("variant"), dict):
        variant = raw["variant"]
        result["variant"] = {
            key: variant.get(key)
            for key in ("parent_artifact_id", "operation", "filename", "size_bytes", "hash", "resource_uri")
            if variant.get(key) not in (None, "")
        }
    return {key: value for key, value in result.items() if value not in (None, "", [])}


async def _run_document_workbench_bridge(
    *,
    operation: str,
    kernel_id: Optional[str],
    execution_id: Optional[str],
    artifact_id: Optional[str],
    source_path: Optional[str],
    options: Optional[dict[str, Any]],
    detail: str,
    max_findings: int,
) -> dict[str, Any]:
    bridge = InspyroBridge.get()
    target = await _resolve_docx_quality_target(
        bridge,
        artifact_id=artifact_id,
        kernel_id=kernel_id,
        execution_id=execution_id,
        source_path=source_path,
    )
    if not target.get("artifact_id") and not target.get("kernel_id") and not target.get("source_path"):
        return {
            "status": "missing_artifact",
            "operation": operation,
            "message": "No hay DOCX resoluble para Workbench. Genera el artefacto o llama con artifact_id.",
        }
    try:
        raw = await bridge.rest_post(
            "/api/docx/workbench/run",
            json_data=_workbench_request_body(target, operation=operation, options=options),
        )
    except BridgeError as exc:
        if exc.payload.get("status_code") == 404:
            return {
                "status": "missing_artifact",
                "operation": operation,
                "artifact_id": target.get("artifact_id"),
                "kernel_id": target.get("kernel_id"),
                "execution_id": target.get("execution_id"),
                "source_path": target.get("source_path"),
                "message": "No hay DOCX disponible para ejecutar Workbench.",
            }
        raise
    if not isinstance(raw, dict):
        raise BridgeError(
            "Workbench DOCX no devolvio JSON valido.",
            payload={"type": "mcp_document_error", "error_code": "invalid_workbench_summary"},
        )
    return _normalize_workbench_result(raw, detail=detail, max_findings=max_findings)


def _resource_uri_to_rest_request(resource_uri: str) -> tuple[str, dict[str, str]]:
    parsed = urlparse(str(resource_uri or ""))
    params = {key: values[-1] for key, values in parse_qs(parsed.query).items() if values}
    rest_path = parsed.path or str(resource_uri or "")
    if rest_path != _WORKBENCH_RESOURCE_REST_PATH or not params.get("workbench_id") or not params.get("name"):
        raise BridgeError(
            "Resource URI Workbench DOCX no es descargable por esta tool.",
            payload={
                "type": "mcp_document_error",
                "error_code": "invalid_workbench_resource_uri",
                "resource_uri": str(resource_uri or ""),
            },
        )
    return rest_path, params


async def _export_document(
    *,
    kind: str,
    kernel_id: str,
    path: str,
    execution_id: Optional[str],
    token: Optional[str],
    overwrite: bool,
) -> dict[str, Any]:
    bridge = InspyroBridge.get()
    artifact = await _wait_for_artifact_for_kind(
        kind=kind,
        kernel_id=kernel_id,
        execution_id=execution_id,
    )
    if artifact is None and not token:
        message = "No hay artefacto exportable asociado a este kernel."
        if kind == "pdf":
            message = "No hay PDF exportable asociado a este kernel. Ejecuta una exportacion o usa reconvert_pdf primero."
        raise BridgeError(
            message,
            payload={"type": "mcp_document_error", "kind": kind, "error_code": "missing_artifact"},
        )

    handles = _resource_handles(
        kind=kind,
        kernel_id=kernel_id,
        execution_id=execution_id,
        artifact=artifact,
        explicit_token=token,
    )
    content, resolved_token, resolved_ref = await _download_artifact_bytes(
        bridge,
        kind=kind,
        artifact=artifact,
        explicit_token=token,
    )
    target_path = await _resolve_export_target(
        bridge,
        raw_path=path,
        filename=str(handles.get("filename") or _default_filename(kind)),
        kind=kind,
    )
    loop = asyncio.get_running_loop()
    mutation, _ = await loop.run_in_executor(
        None,
        lambda: _write_document_bytes(target_path, content, overwrite=overwrite),
    )
    await emit_file_mutation(
        mutation=mutation,
        path=str(target_path),
        is_directory=False,
        file_kind="document",
    )
    return {
        "status": "ok",
        "kernel_id": kernel_id,
        "execution_id": handles.get("execution_id"),
        "path": str(target_path),
        "content_type": _content_type(kind),
        "size_bytes": len(content),
        "hash": handles.get("hash"),
        "token": resolved_token or handles.get("token"),
        "ref": resolved_ref or handles.get("ref"),
        "filename": target_path.name,
        "portable_resource_uri": handles.get("portable_resource_uri"),
    }


@mcp_activity_tool("documents")
async def get_document_pdf(
    kernel_id: str,
    execution_id: Optional[str] = None,
    token: Optional[str] = None,
    inline_content: bool = False,
    max_inline_bytes: Optional[int] = None,
) -> DocumentHandleResult:
    """Cuando usar: descargar el PDF mas reciente asociado a una sesion notebook MCP.

    Prerrequisitos: `kernel_id` con PDF ya generado en la misma sesion o `token` explicito.
    Resultado: devuelve un handle link-first con `token`, `ref`, `resource_uri`,
    `portable_resource_uri`, `resource_scope`, `size_bytes`, `content_type` y `hash`;
    solo incluye `pdf_base64` si `inline_content=True` y el artefacto entra en el
    umbral configurado.
    Siguiente tool tipica: `reconvert_pdf`, `export_document_pdf` o `get_document_docx`.
    """
    bridge = InspyroBridge.get()
    artifact = await _wait_for_artifact_for_kind(
        kind="pdf",
        kernel_id=kernel_id,
        execution_id=execution_id,
    )
    if artifact is None and not token:
        return {
            "status": "missing_artifact",
            "kernel_id": kernel_id,
            "execution_id": execution_id,
            "message": "No hay PDF registrado para este kernel. Ejecuta una celda con export o usa reconvert_pdf primero.",
        }

    handles = _resource_handles(
        kind="pdf",
        kernel_id=kernel_id,
        execution_id=execution_id,
        artifact=artifact,
        explicit_token=token,
    )
    should_inline, inline_skip_reason = _should_inline(
        "pdf",
        inline_content=inline_content,
        size_bytes=handles.get("size_bytes"),
        max_inline_bytes=max_inline_bytes,
    )
    payload: DocumentHandleResult = {
        "status": "ok",
        "kernel_id": kernel_id,
        "execution_id": handles.get("execution_id"),
        "size_bytes": handles.get("size_bytes"),
        "content_type": _content_type("pdf"),
        "token": handles.get("token"),
        "ref": handles.get("ref"),
        "filename": handles.get("filename"),
        "resource_uri": handles["resource_uri"],
        "portable_resource_uri": handles.get("portable_resource_uri"),
        "resource_scope": str(handles.get("resource_scope") or "session"),
        "hash": handles.get("hash"),
        "inline_content": False,
    }
    if inline_skip_reason:
        payload["inline_skipped_reason"] = inline_skip_reason
    if not should_inline:
        return payload

    try:
        pdf_bytes, resolved_token, resolved_ref = await _download_artifact_bytes(
            bridge,
            kind="pdf",
            artifact=artifact,
            explicit_token=token,
        )
    except BridgeError as exc:
        if exc.payload.get("error_code") == "missing_artifact":
            return {
                "status": "missing_artifact",
                "kernel_id": kernel_id,
                "execution_id": execution_id,
                "message": "No hay PDF descargable asociado a esta ejecucion.",
            }
        raise

    payload["pdf_base64"] = base64.b64encode(pdf_bytes).decode("ascii")
    payload["size_bytes"] = len(pdf_bytes)
    payload["token"] = resolved_token or payload.get("token")
    payload["ref"] = resolved_ref or payload.get("ref")
    payload["inline_content"] = True
    return payload


@mcp_activity_tool("documents")
async def check_document_quality(
    kernel_id: Optional[str] = None,
    execution_id: Optional[str] = None,
    artifact_id: Optional[str] = None,
    source_path: Optional[str] = None,
    run: bool = False,
    profile: str = "agent",
    detail: str = "findings",
    max_findings: int = 12,
) -> dict[str, Any]:
    """Cuando usar: revisar errores de calidad DOCX desde MCP sin traer binarios.

    Prerrequisitos: un `artifact_id`, un `kernel_id` con DOCX registrado o un
    `source_path` con historial DOCX. Con `run=False` solo lee el summary cacheado;
    con `run=True` ejecuta la auditoria backend bajo demanda usando `profile`.
    Resultado: devuelve `quality_status`, `score`, `counts`, `sections` y findings
    normalizados segun `detail`, sin DOCX, PNG, XML raw ni base64.
    Siguiente tool tipica: `get_document_docx(include_quality=True)` o
    `export_clean_document_docx` si necesitas una copia publicable.
    """
    bridge = InspyroBridge.get()
    detail_level = _normalize_detail_level(detail)
    finding_limit = _normalize_max_findings(max_findings)
    target = await _resolve_docx_quality_target(
        bridge,
        artifact_id=artifact_id,
        kernel_id=kernel_id,
        execution_id=execution_id,
        source_path=source_path,
    )

    if run:
        try:
            summary = await bridge.rest_post(
                "/api/docx/quality/run",
                json_data={**_quality_request_body(target), "profile": str(profile or "agent")},
            )
        except BridgeError as exc:
            if exc.payload.get("status_code") == 404:
                return {
                    "status": "missing_artifact",
                    "artifact_id": target.get("artifact_id"),
                    "kernel_id": target.get("kernel_id"),
                    "execution_id": target.get("execution_id"),
                    "source_path": target.get("source_path"),
                    "message": "No hay DOCX disponible para auditar. Regenera o descarga el DOCX primero.",
                }
            raise
        if not isinstance(summary, dict):
            raise BridgeError(
                "La auditoria DOCX no devolvio un summary JSON valido.",
                payload={"type": "mcp_document_error", "error_code": "invalid_quality_summary"},
            )
        normalized = _normalize_quality_summary(
            summary,
            detail=detail_level,
            max_findings=finding_limit,
            artifact_id=target.get("artifact_id"),
        )
        normalized.setdefault("artifact_id", target.get("artifact_id"))
        normalized["ran_audit"] = True
        return normalized

    resolved_artifact_id = str(target.get("artifact_id") or "").strip()
    if not resolved_artifact_id:
        return {
            "status": "missing_artifact",
            "artifact_id": None,
            "kernel_id": target.get("kernel_id"),
            "execution_id": target.get("execution_id"),
            "source_path": target.get("source_path"),
            "message": "No hay DOCX resoluble para revisar. Genera el artefacto o llama con artifact_id.",
        }

    cached = await _get_cached_docx_quality(bridge, resolved_artifact_id)
    if cached is None:
        return {
            "status": "missing_quality",
            "artifact_id": resolved_artifact_id,
            "kernel_id": target.get("kernel_id"),
            "execution_id": target.get("execution_id"),
            "source_path": target.get("source_path"),
            "quality_status": "missing_quality",
            "message": "No hay summary de calidad cacheado. Reintenta con check_document_quality(run=True).",
        }

    normalized = _normalize_quality_summary(
        cached,
        detail=detail_level,
        max_findings=finding_limit,
        artifact_id=resolved_artifact_id,
    )
    normalized["ran_audit"] = False
    return normalized


@mcp_activity_tool("documents")
async def get_document_docx(
    kernel_id: str,
    execution_id: Optional[str] = None,
    token: Optional[str] = None,
    inline_content: bool = False,
    max_inline_bytes: Optional[int] = None,
    include_quality: bool = False,
) -> DocumentHandleResult:
    """Cuando usar: descargar el DOCX mas reciente asociado a una sesion notebook MCP.

    Prerrequisitos: `kernel_id` con export DOCX previa en la misma sesion o `token` explicito.
    Resultado: devuelve un handle link-first con `token`, `ref`, `resource_uri`,
    `portable_resource_uri`, `resource_scope`, `size_bytes`, `content_type` y `hash`;
    solo incluye `docx_base64` si `inline_content=True` y el artefacto entra en el
    umbral configurado. `include_quality=True` solo adjunta el summary cacheado compacto,
    nunca ejecuta auditoria.
    Siguiente tool tipica: `check_document_quality`, `get_document_pdf`, `export_document_docx`
    o `reconvert_pdf`.
    """
    bridge = InspyroBridge.get()
    artifact = await _wait_for_artifact_for_kind(
        kind="docx",
        kernel_id=kernel_id,
        execution_id=execution_id,
    )
    if artifact is None and not token:
        return {
            "status": "missing_artifact",
            "kernel_id": kernel_id,
            "execution_id": execution_id,
            "message": "No hay DOCX registrado para este kernel. Ejecuta una celda con export primero.",
        }

    handles = _resource_handles(
        kind="docx",
        kernel_id=kernel_id,
        execution_id=execution_id,
        artifact=artifact,
        explicit_token=token,
    )
    should_inline, inline_skip_reason = _should_inline(
        "docx",
        inline_content=inline_content,
        size_bytes=handles.get("size_bytes"),
        max_inline_bytes=max_inline_bytes,
    )
    payload: DocumentHandleResult = {
        "status": "ok",
        "kernel_id": kernel_id,
        "execution_id": handles.get("execution_id"),
        "size_bytes": handles.get("size_bytes"),
        "content_type": _content_type("docx"),
        "token": handles.get("token"),
        "ref": handles.get("ref"),
        "filename": handles.get("filename"),
        "resource_uri": handles["resource_uri"],
        "portable_resource_uri": handles.get("portable_resource_uri"),
        "resource_scope": str(handles.get("resource_scope") or "session"),
        "hash": handles.get("hash"),
        "inline_content": False,
    }
    if inline_skip_reason:
        payload["inline_skipped_reason"] = inline_skip_reason
    if include_quality:
        artifact_id = _extract_docx_artifact_id(artifact)
        if artifact_id:
            cached_quality = await _get_cached_docx_quality(bridge, artifact_id)
            if cached_quality:
                payload["docx_quality"] = _normalize_quality_summary(
                    cached_quality,
                    detail="compact",
                    max_findings=0,
                    artifact_id=artifact_id,
                )
    if not should_inline:
        return payload

    try:
        docx_bytes, resolved_token, resolved_ref = await _download_artifact_bytes(
            bridge,
            kind="docx",
            artifact=artifact,
            explicit_token=token,
        )
    except BridgeError as exc:
        if exc.payload.get("error_code") == "missing_artifact":
            return {
                "status": "missing_artifact",
                "kernel_id": kernel_id,
                "execution_id": execution_id,
                "message": "No hay DOCX descargable asociado a esta ejecucion.",
            }
        raise

    payload["docx_base64"] = base64.b64encode(docx_bytes).decode("ascii")
    payload["size_bytes"] = len(docx_bytes)
    payload["token"] = resolved_token or payload.get("token")
    payload["ref"] = resolved_ref or payload.get("ref")
    payload["inline_content"] = True
    return payload


@mcp_activity_tool("documents")
async def export_document_pdf(
    kernel_id: str,
    path: str,
    execution_id: Optional[str] = None,
    token: Optional[str] = None,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Cuando usar: exportar el PDF generado a una ruta local explicita y estable.

    Prerrequisitos: `kernel_id` con PDF disponible o `token` explicito; la ruta debe
    quedar dentro de los roots MCP visibles para el cliente.
    Resultado: escribe el archivo en disco y devuelve `path`, `size_bytes`, `hash`,
    `token`, `ref` y `portable_resource_uri`.
    Siguiente tool tipica: `read_file`, `get_document_pdf` o apertura directa del archivo exportado.
    """
    return await _export_document(
        kind="pdf",
        kernel_id=kernel_id,
        path=path,
        execution_id=execution_id,
        token=token,
        overwrite=overwrite,
    )


@mcp_activity_tool("documents")
async def export_document_docx(
    kernel_id: str,
    path: str,
    execution_id: Optional[str] = None,
    token: Optional[str] = None,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Cuando usar: exportar el DOCX generado a una ruta local explicita y estable.

    Prerrequisitos: `kernel_id` con DOCX disponible o `token` explicito; la ruta debe
    quedar dentro de los roots MCP visibles para el cliente.
    Resultado: escribe el archivo en disco y devuelve `path`, `size_bytes`, `hash`,
    `token`, `ref` y `portable_resource_uri`.
    Siguiente tool tipica: `get_document_pdf`, `read_file` o apertura directa del archivo exportado.
    """
    return await _export_document(
        kind="docx",
        kernel_id=kernel_id,
        path=path,
        execution_id=execution_id,
        token=token,
        overwrite=overwrite,
    )


@mcp_activity_tool("documents")
async def export_clean_document_docx(
    path: str,
    kernel_id: Optional[str] = None,
    execution_id: Optional[str] = None,
    artifact_id: Optional[str] = None,
    source_path: Optional[str] = None,
    tracked_changes: str = "accept",
    scrub_metadata: bool = True,
    strip_comments: bool = True,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Cuando usar: generar una copia DOCX limpia y publicable desde un artefacto existente.

    Prerrequisitos: un `artifact_id`, `kernel_id` con DOCX o `source_path` con historial;
    `path` debe quedar dentro de los roots MCP visibles. La copia limpia es opt-in y
    nunca reemplaza el artefacto original.
    Resultado: escribe un `.docx` limpio y devuelve `path`, `size_bytes`, `hash` y
    metadata de origen, sin inlinear el documento.
    Siguiente tool tipica: abrir la ruta exportada o volver a `check_document_quality(run=True)`.
    """
    bridge = InspyroBridge.get()
    target = await _resolve_docx_quality_target(
        bridge,
        artifact_id=artifact_id,
        kernel_id=kernel_id,
        execution_id=execution_id,
        source_path=source_path,
    )
    normalized_tracked_changes = str(tracked_changes or "accept").strip().lower()
    body = {
        **_quality_request_body(target),
        "tracked_changes": normalized_tracked_changes,
        "scrub_metadata": bool(scrub_metadata),
        "strip_comments": bool(strip_comments),
    }
    artifact = target.get("artifact") if isinstance(target.get("artifact"), dict) else {}
    filename = _clean_docx_filename(
        artifact.get("filename")
        or artifact.get("docx_file_name")
        or artifact.get("file_name")
        or _default_filename("docx")
    )
    target_path = await _resolve_export_target(
        bridge,
        raw_path=path,
        filename=filename,
        kind="docx",
    )
    _ensure_document_target_writable(target_path, overwrite=overwrite)

    try:
        content = await bridge.rest_post_bytes("/api/docx/quality/clean", json_data=body)
    except BridgeError as exc:
        if exc.payload.get("status_code") == 404:
            raise BridgeError(
                "No hay DOCX disponible para limpiar. Regenera o identifica el artefacto primero.",
                payload={"type": "mcp_document_error", "error_code": "missing_artifact", **exc.payload},
            ) from exc
        raise

    loop = asyncio.get_running_loop()
    mutation, _ = await loop.run_in_executor(
        None,
        lambda: _write_document_bytes(target_path, content, overwrite=overwrite),
    )
    await emit_file_mutation(
        mutation=mutation,
        path=str(target_path),
        is_directory=False,
        file_kind="document",
    )
    return {
        "status": "ok",
        "artifact_id": target.get("artifact_id"),
        "kernel_id": target.get("kernel_id"),
        "execution_id": target.get("execution_id"),
        "source_path": target.get("source_path"),
        "path": str(target_path),
        "content_type": _content_type("docx"),
        "size_bytes": len(content),
        "hash": hashlib.sha256(content).hexdigest(),
        "filename": target_path.name,
        "tracked_changes": normalized_tracked_changes,
        "scrub_metadata": bool(scrub_metadata),
        "strip_comments": bool(strip_comments),
    }


@mcp_activity_tool("documents")
async def run_document_workbench(
    operation: str,
    kernel_id: Optional[str] = None,
    execution_id: Optional[str] = None,
    artifact_id: Optional[str] = None,
    source_path: Optional[str] = None,
    options: Optional[dict[str, Any]] = None,
    detail: str = "findings",
    max_findings: int = 12,
) -> dict[str, Any]:
    """Cuando usar: ejecutar una operacion DOCX Workbench y recibir solo resumen compacto.

    Prerrequisitos: `operation` debe ser una operacion Workbench soportada y debe existir
    un DOCX resoluble por `artifact_id`, `kernel_id` o `source_path`.
    Resultado: devuelve summary/handles limitados; nunca inlinea DOCX, PNG, XML raw ni base64.
    Siguiente tool tipica: `check_document_quality`, `compare_document_versions` o
    `prepare_document_delivery`.
    """
    return await _run_document_workbench_bridge(
        operation=operation,
        kernel_id=kernel_id,
        execution_id=execution_id,
        artifact_id=artifact_id,
        source_path=source_path,
        options=options if isinstance(options, dict) else {},
        detail=detail,
        max_findings=max_findings,
    )


@mcp_activity_tool("documents")
async def compare_document_versions(
    compare_artifact_id: str,
    artifact_id: Optional[str] = None,
    kernel_id: Optional[str] = None,
    execution_id: Optional[str] = None,
    source_path: Optional[str] = None,
    detail: str = "compact",
) -> dict[str, Any]:
    """Cuando usar: comparar dos versiones DOCX con diff textual compacto.

    Prerrequisitos: indicar `compare_artifact_id` y un documento base por `artifact_id`,
    `kernel_id` o `source_path`.
    Resultado: devuelve metadata del diff y un `resource_uri` descargable; no devuelve el diff inline.
    """
    return await _run_document_workbench_bridge(
        operation="diff",
        kernel_id=kernel_id,
        execution_id=execution_id,
        artifact_id=artifact_id,
        source_path=source_path,
        options={"compare_artifact_id": compare_artifact_id},
        detail=detail,
        max_findings=0,
    )


@mcp_activity_tool("documents")
async def manage_document_review(
    action: str = "comments_extract",
    kernel_id: Optional[str] = None,
    execution_id: Optional[str] = None,
    artifact_id: Optional[str] = None,
    source_path: Optional[str] = None,
    text: Optional[str] = None,
    author: str = "Inspyro",
    tracked_changes: str = "accept",
    detail: str = "compact",
) -> dict[str, Any]:
    """Cuando usar: extraer/completar revision DOCX sin traer el documento al contexto.

    Acciones soportadas: `comments_extract`, `comments_add`, `comments_strip`,
    `redlines_report`, `redlines_accept`, `redlines_reject`.
    Resultado: summary compacto y handles a variantes cuando aplica.
    """
    normalized_action = str(action or "comments_extract").strip().lower()
    allowed = {
        "comments_extract",
        "comments_add",
        "comments_strip",
        "redlines_report",
        "redlines_accept",
        "redlines_reject",
    }
    if normalized_action not in allowed:
        return {
            "status": "invalid_action",
            "action": normalized_action,
            "allowed_actions": sorted(allowed),
        }
    options = {
        "text": text,
        "author": author,
        "tracked_changes": tracked_changes,
        "strip_comments": True,
        "scrub_metadata": False,
    }
    return await _run_document_workbench_bridge(
        operation=normalized_action,
        kernel_id=kernel_id,
        execution_id=execution_id,
        artifact_id=artifact_id,
        source_path=source_path,
        options=options,
        detail=detail,
        max_findings=0,
    )


@mcp_activity_tool("documents")
async def prepare_document_delivery(
    kernel_id: Optional[str] = None,
    execution_id: Optional[str] = None,
    artifact_id: Optional[str] = None,
    source_path: Optional[str] = None,
    path: Optional[str] = None,
    tracked_changes: str = "accept",
    scrub_metadata: bool = True,
    strip_comments: bool = True,
    protect_mode: Optional[str] = None,
    overwrite: bool = False,
    detail: str = "findings",
    max_findings: int = 12,
) -> dict[str, Any]:
    """Cuando usar: preparar una variante DOCX publicable al final del flujo agente.

    Genera una variante limpia opt-in; si `path` se entrega, escribe esa variante dentro de
    roots MCP permitidos. No reemplaza el artefacto original.
    """
    result = await _run_document_workbench_bridge(
        operation="prepare_delivery",
        kernel_id=kernel_id,
        execution_id=execution_id,
        artifact_id=artifact_id,
        source_path=source_path,
        options={
            "tracked_changes": tracked_changes,
            "scrub_metadata": scrub_metadata,
            "strip_comments": strip_comments,
            "protect_mode": protect_mode,
        },
        detail=detail,
        max_findings=max_findings,
    )
    if result.get("status") == "ok":
        visual_result = await _run_document_workbench_bridge(
            operation="render_manifest",
            kernel_id=kernel_id,
            execution_id=execution_id,
            artifact_id=artifact_id or result.get("artifact_id"),
            source_path=source_path,
            options={},
            detail="compact",
            max_findings=0,
        )
        if isinstance(visual_result.get("visual"), dict):
            result["visual"] = visual_result["visual"]
    if not path or result.get("status") != "ok":
        return result

    variant = result.get("variant") if isinstance(result.get("variant"), dict) else {}
    resource_uri = str(variant.get("resource_uri") or "").strip()
    if not resource_uri:
        result["export_status"] = "missing_resource"
        return result

    bridge = InspyroBridge.get()
    rest_path, params = _resource_uri_to_rest_request(resource_uri)
    content = await bridge.rest_get_bytes(rest_path, params=params)
    target_path = await _resolve_export_target(
        bridge,
        raw_path=path,
        filename=str(variant.get("filename") or _default_filename("docx")),
        kind="docx",
    )
    _ensure_document_target_writable(target_path, overwrite=overwrite)
    loop = asyncio.get_running_loop()
    mutation, _ = await loop.run_in_executor(
        None,
        lambda: _write_document_bytes(target_path, content, overwrite=overwrite),
    )
    await emit_file_mutation(
        mutation=mutation,
        path=str(target_path),
        is_directory=False,
        file_kind="document",
    )
    result["export"] = {
        "status": "ok",
        "path": str(target_path),
        "size_bytes": len(content),
        "hash": hashlib.sha256(content).hexdigest(),
        "filename": target_path.name,
    }
    return result


@mcp_activity_tool("documents")
async def reconvert_pdf(kernel_id: str) -> dict:
    """Cuando usar: regenerar el PDF a partir del DOCX actual del notebook.

    Prerrequisitos: `kernel_id` valido y un DOCX base ya existente para esa sesion.
    Resultado: devuelve `status`, `token`, `ref`, `pdf_hash`, `resource_uri` y
    `portable_resource_uri` del PDF regenerado.
    Siguiente tool tipica: `get_document_pdf` o `export_document_pdf`.
    """
    bridge = InspyroBridge.get()
    result = await bridge.ws_request(
        "force_reconvert_pdf",
        {"kernel_id": kernel_id},
        success_types={"pdf_reconverted"},
        error_types={"error", "notebook_error"},
        timeout=_LONG_DOCUMENT_TIMEOUT_S,
    )
    notebook_path = _SESSION_STATE.get_notebook_path(kernel_id)
    if result.get("status") != "ok":
        existing_artifact = _resolve_artifact(kernel_id=kernel_id, execution_id=None)
        existing_token, existing_ref, _, existing_hash, existing_filename = _resolve_artifact_meta(
            "pdf",
            existing_artifact,
            None,
        )
        if existing_token or existing_ref:
            return {
                "status": "ok",
                "kernel_id": kernel_id,
                "token": existing_token,
                "ref": existing_ref,
                "filename": existing_filename or _default_filename("pdf"),
                "pdf_hash": existing_hash,
                "resource_uri": build_artifact_resource_uri("pdf", kernel_id),
                "portable_resource_uri": build_portable_artifact_resource_uri("pdf", existing_token) if existing_token else None,
                "resource_scope": "portable" if existing_token else "session",
                "reused_existing_pdf": True,
                "raw": result,
            }
    artifact_payload = {
        key: value
        for key, value in {
            "kind": "pdf",
            "token": result.get("pdf_file_token"),
            "ref": result.get("pdf_ref"),
            "pdf_ref": result.get("pdf_ref"),
            "pdf_hash": result.get("pdf_hash"),
            "pdf_file_name": result.get("pdf_file_name"),
        }.items()
        if value is not None
    }
    _SESSION_STATE.record_artifacts(
        {
            "kernel_id": kernel_id,
            "pdf_file_token": result.get("pdf_file_token"),
            "pdf_ref": result.get("pdf_ref"),
            "pdf_file_name": result.get("pdf_file_name"),
            "pdf_hash": result.get("pdf_hash"),
        }
    )
    if notebook_path:
        await emit_open_resource(notebook_path, focus_view="docx", resource={"kernel_id": kernel_id})
    if artifact_payload:
        resource = {
            "kernel_id": kernel_id,
            "notebook_path": notebook_path,
            "path": notebook_path,
        }
        await emit_artifact_update(artifact_payload, resource=resource)
    token = result.get("pdf_file_token")
    return {
        "status": result.get("status", "error"),
        "kernel_id": kernel_id,
        "token": token,
        "ref": result.get("pdf_ref"),
        "filename": result.get("pdf_file_name") or _default_filename("pdf"),
        "pdf_hash": result.get("pdf_hash"),
        "resource_uri": build_artifact_resource_uri("pdf", kernel_id),
        "portable_resource_uri": build_portable_artifact_resource_uri("pdf", token) if token else None,
        "resource_scope": "portable" if token else "session",
        "raw": result,
    }


@mcp_activity_tool("documents")
async def get_pdf_status() -> dict:
    """Cuando usar: verificar si la capa de conversion PDF del backend esta disponible.

    Prerrequisitos: ninguno.
    Resultado: devuelve estado del convertidor PDF y diagnostico relacionado.
    Siguiente tool tipica: `reconvert_pdf` o `get_document_pdf`.
    """
    bridge = InspyroBridge.get()
    return await bridge.rest_get("/pdf-status")
