from __future__ import annotations

from typing import Any

from app.services.docx_render_cache import (
    clear_docx_render_cache,
    get_docx_render_manifest,
    render_all_docx_pages_png_cached,
    render_docx_page_png_cached,
)


def render_docx_page_png(
    docx_bytes: bytes,
    *,
    page: int = 1,
    timeout_s: int | None = None,
    zoom: float = 2.0,
    binary_hash: str | None = None,
    artifact_id: str | None = None,
    profile: str | None = None,
) -> tuple[bytes, dict[str, Any]]:
    return render_docx_page_png_cached(
        docx_bytes,
        page=page,
        timeout_s=timeout_s,
        zoom=zoom,
        binary_hash=binary_hash,
        artifact_id=artifact_id,
        profile=profile,
    )


def render_docx_manifest(
    *,
    binary_hash: str | None,
    artifact_id: str | None = None,
    profile: str | None = None,
) -> dict[str, Any]:
    return get_docx_render_manifest(binary_hash=binary_hash, artifact_id=artifact_id, profile=profile)


def render_docx_all_pages(
    docx_bytes: bytes,
    *,
    timeout_s: int | None = None,
    zoom: float = 2.0,
    binary_hash: str | None = None,
    artifact_id: str | None = None,
    profile: str | None = None,
) -> dict[str, Any]:
    return render_all_docx_pages_png_cached(
        docx_bytes,
        timeout_s=timeout_s,
        zoom=zoom,
        binary_hash=binary_hash,
        artifact_id=artifact_id,
        profile=profile,
    )


def clear_docx_render(binary_hash: str | None = None, *, profile: str | None = None) -> dict[str, Any]:
    return clear_docx_render_cache(binary_hash=binary_hash, profile=profile)
