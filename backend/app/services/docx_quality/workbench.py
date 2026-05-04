from __future__ import annotations

import hashlib
from typing import Any

from .audit import audit_docx_bytes
from .content_controls import fill_content_controls, inspect_content_controls, wrap_placeholders_as_content_controls
from .diff import diff_docx_text
from .fields import flatten_simple_fields, report_fields
from .protection import set_document_protection
from .publish import clean_docx_bytes
from .redaction import redact_docx_bytes
from .redlines import accept_tracked_changes, reject_tracked_changes, report_tracked_changes
from .render import clear_docx_render, render_docx_all_pages, render_docx_manifest, render_docx_page_png
from .review import add_document_comment, extract_comments

WORKBENCH_OPERATIONS = {
    "audit",
    "render_manifest",
    "render_page",
    "render_all_pages",
    "clear_render_cache",
    "clean",
    "prepare_delivery",
    "comments_extract",
    "comments_add",
    "comments_strip",
    "redlines_report",
    "redlines_accept",
    "redlines_reject",
    "fields_report",
    "fields_flatten",
    "redact",
    "protect",
    "content_controls_list",
    "content_controls_wrap",
    "content_controls_fill",
    "diff",
}


def _resource_name(filename: str, suffix: str) -> str:
    stem = filename[:-5] if filename.lower().endswith(".docx") else filename
    return f"{stem}{suffix}"


def _variant_summary(
    data: bytes,
    *,
    parent_artifact_id: str | None,
    operation: str,
    filename: str,
) -> dict[str, Any]:
    return {
        "parent_artifact_id": parent_artifact_id,
        "operation": operation,
        "filename": filename,
        "size_bytes": len(data),
        "hash": hashlib.sha256(data).hexdigest(),
    }


def _base_result(operation: str, artifact_id: str | None) -> dict[str, Any]:
    return {
        "status": "ok",
        "operation": operation,
        "artifact_id": artifact_id,
    }


def _clean_options(payload: dict[str, Any]) -> dict[str, Any]:
    tracked_changes = str(payload.get("tracked_changes") or "accept").strip().lower()
    if tracked_changes not in {"accept", "reject", "preserve"}:
        raise ValueError("tracked_changes debe ser accept, reject o preserve")
    return {
        "tracked_changes": tracked_changes,
        "scrub_metadata": bool(payload.get("scrub_metadata", True)),
        "strip_comments": bool(payload.get("strip_comments", True)),
    }


def run_workbench_operation(
    docx_bytes: bytes,
    *,
    operation: str,
    payload: dict[str, Any] | None = None,
    artifact: dict[str, Any] | None = None,
    compare_docx_bytes: bytes | None = None,
) -> tuple[dict[str, Any], dict[str, bytes]]:
    request_payload = payload or {}
    normalized_operation = str(operation or "audit").strip().lower()
    if normalized_operation not in WORKBENCH_OPERATIONS:
        raise ValueError(f"Operacion Workbench no soportada: {operation}")

    artifact_id = str((artifact or {}).get("artifact_id") or request_payload.get("artifact_id") or "").strip() or None
    filename = str((artifact or {}).get("filename") or "inspyro_document.docx")
    result = _base_result(normalized_operation, artifact_id)
    resources: dict[str, bytes] = {}

    if normalized_operation == "audit":
        profile = str(request_payload.get("profile") or "agent")
        result["summary"] = audit_docx_bytes(docx_bytes, artifact_id=artifact_id, profile=profile)
        return result, resources

    if normalized_operation == "render_manifest":
        profile = str(request_payload.get("profile") or "word-fidelity")
        result["visual"] = render_docx_manifest(
            binary_hash=str((artifact or {}).get("binary_hash") or hashlib.sha256(docx_bytes).hexdigest()),
            artifact_id=artifact_id,
            profile=profile,
        )
        result["resources"] = result["visual"].get("resources") or []
        return result, resources

    if normalized_operation == "render_page":
        page = int(request_payload.get("page") or 1)
        profile = str(request_payload.get("profile") or "word-fidelity")
        zoom = request_payload.get("zoom", 2.0)
        _png_bytes, meta = render_docx_page_png(
            docx_bytes,
            page=page,
            zoom=zoom,
            artifact_id=artifact_id,
            binary_hash=str((artifact or {}).get("binary_hash") or hashlib.sha256(docx_bytes).hexdigest()),
            profile=profile,
        )
        result["render"] = {key: value for key, value in meta.items() if key != "manifest"}
        result["visual"] = meta.get("manifest")
        if isinstance(meta.get("resource"), dict):
            result["resources"] = [meta["resource"]]
        return result, resources

    if normalized_operation == "render_all_pages":
        profile = str(request_payload.get("profile") or "word-fidelity")
        zoom = request_payload.get("zoom", 2.0)
        rendered = render_docx_all_pages(
            docx_bytes,
            zoom=zoom,
            artifact_id=artifact_id,
            binary_hash=str((artifact or {}).get("binary_hash") or hashlib.sha256(docx_bytes).hexdigest()),
            profile=profile,
        )
        result["rendered_pages"] = rendered.get("rendered_pages") or []
        result["visual"] = rendered.get("manifest") or {}
        result["resources"] = (result["visual"] or {}).get("page_resources") or (result["visual"] or {}).get("resources") or []
        return result, resources

    if normalized_operation == "clear_render_cache":
        binary_hash = str((artifact or {}).get("binary_hash") or hashlib.sha256(docx_bytes).hexdigest())
        profile = str(request_payload.get("profile") or "word-fidelity")
        result["stats"] = clear_docx_render(binary_hash, profile=profile)
        result["visual"] = render_docx_manifest(binary_hash=binary_hash, artifact_id=artifact_id, profile=profile)
        return result, resources

    if normalized_operation in {"clean", "prepare_delivery", "comments_strip"}:
        clean_kwargs = _clean_options(request_payload)
        cleaned, stats = clean_docx_bytes(docx_bytes, **clean_kwargs)
        protect_mode = str(request_payload.get("protect_mode") or "").strip()
        if normalized_operation == "prepare_delivery" and protect_mode:
            cleaned, protection_stats = set_document_protection(cleaned, mode=protect_mode)
            stats = {**stats, "protection": protection_stats}
        suffix = "-delivery.docx" if normalized_operation == "prepare_delivery" else "-clean.docx"
        name = _resource_name(filename, suffix)
        resources[name] = cleaned
        result["variant"] = _variant_summary(cleaned, parent_artifact_id=artifact_id, operation=normalized_operation, filename=name)
        result["stats"] = stats
        if normalized_operation == "prepare_delivery":
            result["summary"] = audit_docx_bytes(cleaned, artifact_id=artifact_id, profile="delivery")
        return result, resources

    if normalized_operation == "comments_extract":
        result["review"] = extract_comments(docx_bytes)
        return result, resources

    if normalized_operation == "comments_add":
        text = str(request_payload.get("text") or request_payload.get("comment") or "").strip()
        if not text:
            raise ValueError("text requerido para comments_add")
        updated, stats = add_document_comment(
            docx_bytes,
            text=text,
            author=str(request_payload.get("author") or "Inspyro"),
            initials=str(request_payload.get("initials") or "IP"),
        )
        name = _resource_name(filename, "-commented.docx")
        resources[name] = updated
        result["variant"] = _variant_summary(updated, parent_artifact_id=artifact_id, operation=normalized_operation, filename=name)
        result["review"] = stats
        return result, resources

    if normalized_operation == "redlines_report":
        result["review"] = report_tracked_changes(docx_bytes)
        return result, resources

    if normalized_operation in {"redlines_accept", "redlines_reject"}:
        updated, stats = accept_tracked_changes(docx_bytes) if normalized_operation == "redlines_accept" else reject_tracked_changes(docx_bytes)
        name = _resource_name(filename, "-redlines.docx")
        resources[name] = updated
        result["variant"] = _variant_summary(updated, parent_artifact_id=artifact_id, operation=normalized_operation, filename=name)
        result["stats"] = stats
        return result, resources

    if normalized_operation == "fields_report":
        result["fields"] = report_fields(docx_bytes)
        return result, resources

    if normalized_operation == "fields_flatten":
        updated, stats = flatten_simple_fields(docx_bytes)
        name = _resource_name(filename, "-fields-flat.docx")
        resources[name] = updated
        result["variant"] = _variant_summary(updated, parent_artifact_id=artifact_id, operation=normalized_operation, filename=name)
        result["fields"] = stats
        return result, resources

    if normalized_operation == "redact":
        patterns = request_payload.get("patterns")
        if isinstance(patterns, str):
            patterns = [patterns]
        if not isinstance(patterns, list):
            raise ValueError("patterns debe ser una lista de regex o texto")
        updated, stats = redact_docx_bytes(
            docx_bytes,
            patterns=[str(item) for item in patterns],
            replacement=str(request_payload.get("replacement") or "X"),
            preserve_length=bool(request_payload.get("preserve_length", True)),
            include_comments=bool(request_payload.get("include_comments", False)),
        )
        name = _resource_name(filename, "-redacted.docx")
        resources[name] = updated
        result["variant"] = _variant_summary(updated, parent_artifact_id=artifact_id, operation=normalized_operation, filename=name)
        result["redaction"] = stats
        return result, resources

    if normalized_operation == "protect":
        updated, stats = set_document_protection(docx_bytes, mode=str(request_payload.get("mode") or "readOnly"))
        name = _resource_name(filename, "-protected.docx")
        resources[name] = updated
        result["variant"] = _variant_summary(updated, parent_artifact_id=artifact_id, operation=normalized_operation, filename=name)
        result["protection"] = stats
        return result, resources

    if normalized_operation == "content_controls_list":
        result["content_controls"] = inspect_content_controls(docx_bytes)
        return result, resources

    if normalized_operation == "content_controls_wrap":
        updated, stats = wrap_placeholders_as_content_controls(docx_bytes)
        name = _resource_name(filename, "-sdt.docx")
        resources[name] = updated
        result["variant"] = _variant_summary(updated, parent_artifact_id=artifact_id, operation=normalized_operation, filename=name)
        result["content_controls"] = stats
        return result, resources

    if normalized_operation == "content_controls_fill":
        values = request_payload.get("values")
        if not isinstance(values, dict):
            raise ValueError("values debe ser un objeto tag->valor")
        updated = fill_content_controls(docx_bytes, {str(key): str(value) for key, value in values.items()})
        name = _resource_name(filename, "-filled.docx")
        resources[name] = updated
        result["variant"] = _variant_summary(updated, parent_artifact_id=artifact_id, operation=normalized_operation, filename=name)
        result["content_controls"] = {"filled": len(values)}
        return result, resources

    if normalized_operation == "diff":
        if compare_docx_bytes is None:
            raise ValueError("compare_artifact_id requerido para diff")
        diff_text = diff_docx_text(docx_bytes, compare_docx_bytes)
        name = "docx.diff"
        resources[name] = diff_text.encode("utf-8")
        result["diff"] = {
            "changed": bool(diff_text.strip()),
            "lines": len(diff_text.splitlines()),
            "resource_name": name,
        }
        return result, resources

    return result, resources
