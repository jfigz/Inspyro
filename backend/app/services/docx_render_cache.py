from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from app.services.pdf_converter import convert_docx_with_diagnostics, pdf_cache_set
from app.services.workspace_service import get_app_storage_dir

DOCX_RENDER_PROFILE_DEFAULT = "word-fidelity"
DOCX_RENDER_ENGINE_VERSION = "word-pdf-pymupdf-v1"
DOCX_RENDER_ZOOM_DEFAULT = float(os.getenv("INSPYRO_DOCX_RENDER_ZOOM_DEFAULT", "2.0"))
DOCX_RENDER_CACHE_MAX_BYTES = max(1, int(os.getenv("INSPYRO_DOCX_RENDER_CACHE_MAX_BYTES", str(1024 * 1024 * 1024))))
DOCX_RENDER_CACHE_MAX_AGE_DAYS = max(1, int(os.getenv("INSPYRO_DOCX_RENDER_CACHE_MAX_AGE_DAYS", "30")))
DOCX_RENDER_CACHE_MAX_AGE_SECONDS = DOCX_RENDER_CACHE_MAX_AGE_DAYS * 24 * 60 * 60


def _resolve_render_cache_dir() -> Path:
    override = os.getenv("INSPYRO_DOCX_RENDER_CACHE_DIR")
    if override:
        cache_dir = Path(override).expanduser().resolve()
    else:
        cache_dir = get_app_storage_dir("docx_render_cache")
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


DOCX_RENDER_CACHE_DIR = _resolve_render_cache_dir()

_CACHE_LOCK = threading.RLock()
_INFLIGHT_LOCK = threading.Lock()
_INFLIGHT_BY_KEY: dict[str, threading.Lock] = {}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _binary_hash(docx_bytes: bytes, binary_hash: str | None = None) -> str:
    normalized = str(binary_hash or "").strip()
    return normalized or hashlib.sha256(docx_bytes).hexdigest()


def _profile(value: str | None = None) -> str:
    normalized = str(value or DOCX_RENDER_PROFILE_DEFAULT).strip().lower()
    return normalized or DOCX_RENDER_PROFILE_DEFAULT


def _render_id(binary_hash: str, profile: str | None = None) -> str:
    source = f"{binary_hash}:{_profile(profile)}:{DOCX_RENDER_ENGINE_VERSION}"
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def _render_dir(render_id: str) -> Path:
    return DOCX_RENDER_CACHE_DIR / str(render_id)


def _safe_id_segment(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if all(char.isascii() and (char.isalnum() or char in "_-") for char in normalized):
        return normalized
    return None


def _pages_dir(render_id: str) -> Path:
    return _render_dir(render_id) / "pages"


def _manifest_path(render_id: str) -> Path:
    return _render_dir(render_id) / "manifest.json"


def _pdf_path(render_id: str) -> Path:
    return _render_dir(render_id) / "document.pdf"


def _safe_name(name: str | None) -> str:
    return Path(str(name or "")).name


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.name}.tmp")
    tmp_path.write_bytes(data)
    tmp_path.replace(path)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.name}.tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(path)


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _get_key_lock(key: str) -> threading.Lock:
    with _INFLIGHT_LOCK:
        lock = _INFLIGHT_BY_KEY.get(key)
        if lock is None:
            lock = threading.Lock()
            _INFLIGHT_BY_KEY[key] = lock
        return lock


def build_docx_render_resource_url(*, render_id: str | None = None, name: str | None = None) -> str | None:
    if not render_id or not name:
        return None
    return f"/api/docx/render/resource?{urlencode({'render_id': str(render_id), 'name': str(name)})}"


def _resource_item(
    *,
    render_id: str,
    name: str,
    path: Path,
    mime_type: str,
    page: int | None = None,
    cached: bool | None = None,
    renderer: str | None = None,
) -> dict[str, Any] | None:
    if not path.exists() or not path.is_file():
        return None
    payload: dict[str, Any] = {
        "name": name,
        "size_bytes": path.stat().st_size,
        "hash": hashlib.sha256(path.read_bytes()).hexdigest(),
        "mime_type": mime_type,
        "resource_uri": build_docx_render_resource_url(render_id=render_id, name=name),
    }
    if page is not None:
        payload["page"] = page
    if cached is not None:
        payload["cached"] = bool(cached)
    if renderer:
        payload["renderer"] = renderer
    return payload


def _page_resource_name(page: int, zoom: float) -> str:
    zoom_tag = f"{float(zoom):.2f}".replace(".", "_")
    return f"page-{int(page):04d}-z{zoom_tag}.png"


def _normalize_zoom(zoom: float | int | str | None) -> float:
    try:
        parsed = float(zoom if zoom is not None else DOCX_RENDER_ZOOM_DEFAULT)
    except (TypeError, ValueError):
        parsed = DOCX_RENDER_ZOOM_DEFAULT
    return max(0.25, min(parsed, 6.0))


def _status_from_manifest(render_id: str, manifest: dict[str, Any]) -> str:
    if str(manifest.get("status") or "") == "error":
        return "error"
    page_count = int(manifest.get("page_count") or 0)
    cached_pages = _cached_page_count(render_id)
    if not _pdf_path(render_id).exists():
        return "missing"
    if page_count > 0 and cached_pages >= page_count:
        return "complete"
    if cached_pages > 0:
        return "partial"
    return "ready"


def _cached_page_count(render_id: str) -> int:
    try:
        return len([path for path in _pages_dir(render_id).glob("*.png") if path.is_file()])
    except OSError:
        return 0


def _page_resource_items(render_id: str, manifest: dict[str, Any]) -> list[dict[str, Any]]:
    renderer = str(manifest.get("converter_used") or manifest.get("renderer") or "")
    items: list[dict[str, Any]] = []
    for path in sorted(_pages_dir(render_id).glob("*.png")) if _pages_dir(render_id).exists() else []:
        page = None
        stem = path.stem
        parts = stem.split("-")
        if len(parts) >= 2:
            try:
                page = int(parts[1])
            except ValueError:
                page = None
        resource = _resource_item(
            render_id=render_id,
            name=path.name,
            path=path,
            mime_type="image/png",
            page=page,
            cached=True,
            renderer=renderer,
        )
        if resource:
            items.append(resource)
    return items


def _decorate_manifest(render_id: str, manifest: dict[str, Any]) -> dict[str, Any]:
    payload = dict(manifest)
    payload["render_id"] = render_id
    payload["renderer_signature"] = DOCX_RENDER_ENGINE_VERSION
    payload["status"] = _status_from_manifest(render_id, payload)
    payload["cached_pages"] = _cached_page_count(render_id)
    payload["cache_dir"] = str(_render_dir(render_id))
    pdf_resource = _resource_item(
        render_id=render_id,
        name="document.pdf",
        path=_pdf_path(render_id),
        mime_type="application/pdf",
        cached=True,
        renderer=str(payload.get("converter_used") or ""),
    )
    page_resources = _page_resource_items(render_id, payload)
    payload["pdf_resource"] = pdf_resource
    payload["page_resources"] = page_resources
    payload["resources"] = [item for item in ([pdf_resource] if pdf_resource else []) + page_resources if item]
    return payload


def _missing_manifest(binary_hash: str, *, artifact_id: str | None = None, profile: str | None = None) -> dict[str, Any]:
    render_id = _render_id(binary_hash, profile)
    return {
        "render_id": render_id,
        "artifact_id": artifact_id,
        "binary_hash": binary_hash,
        "profile": _profile(profile),
        "renderer_signature": DOCX_RENDER_ENGINE_VERSION,
        "status": "missing",
        "page_count": None,
        "cached_pages": 0,
        "converter_used": None,
        "resources": [],
        "page_resources": [],
        "pdf_resource": None,
    }


def get_docx_render_manifest(
    *,
    binary_hash: str | None,
    artifact_id: str | None = None,
    profile: str | None = None,
) -> dict[str, Any]:
    normalized_hash = str(binary_hash or "").strip()
    if not normalized_hash:
        return _missing_manifest("", artifact_id=artifact_id, profile=profile)
    render_id = _render_id(normalized_hash, profile)
    manifest = _read_json(_manifest_path(render_id))
    if not manifest or str(manifest.get("binary_hash") or "") != normalized_hash:
        return _missing_manifest(normalized_hash, artifact_id=artifact_id, profile=profile)
    if artifact_id and not manifest.get("artifact_id"):
        manifest["artifact_id"] = artifact_id
    return _decorate_manifest(render_id, manifest)


def _extract_pdf_pages(pdf_bytes: bytes) -> tuple[int, list[dict[str, Any]]]:
    import fitz  # PyMuPDF

    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        pages: list[dict[str, Any]] = []
        for index in range(document.page_count):
            rect = document.load_page(index).rect
            pages.append(
                {
                    "page": index + 1,
                    "width_pt": round(float(rect.width), 2),
                    "height_pt": round(float(rect.height), 2),
                }
            )
        return int(document.page_count), pages
    finally:
        document.close()


def _render_pdf_page(pdf_path: Path, *, page: int, zoom: float) -> bytes:
    import fitz  # PyMuPDF

    document = fitz.open(str(pdf_path))
    try:
        if page > document.page_count:
            raise ValueError(f"page {page} out of range; document has {document.page_count} pages")
        pdf_page = document.load_page(page - 1)
        matrix = fitz.Matrix(float(zoom), float(zoom))
        pixmap = pdf_page.get_pixmap(matrix=matrix, alpha=False)
        return pixmap.tobytes("png")
    finally:
        document.close()


def _cleanup_render_cache_locked(now: float | None = None) -> None:
    current = time.time() if now is None else now
    cutoff = current - DOCX_RENDER_CACHE_MAX_AGE_SECONDS
    render_dirs = [path for path in DOCX_RENDER_CACHE_DIR.iterdir() if path.is_dir()] if DOCX_RENDER_CACHE_DIR.exists() else []
    for path in render_dirs:
        try:
            if path.stat().st_mtime <= cutoff:
                shutil.rmtree(path, ignore_errors=True)
        except OSError:
            continue

    render_dirs = [path for path in DOCX_RENDER_CACHE_DIR.iterdir() if path.is_dir()] if DOCX_RENDER_CACHE_DIR.exists() else []
    sized_dirs: list[tuple[float, int, Path]] = []
    total_size = 0
    for path in render_dirs:
        size = 0
        try:
            for item in path.rglob("*"):
                if item.is_file():
                    size += item.stat().st_size
            mtime = path.stat().st_mtime
        except OSError:
            continue
        total_size += size
        sized_dirs.append((mtime, size, path))
    if total_size <= DOCX_RENDER_CACHE_MAX_BYTES:
        return
    for _mtime, size, path in sorted(sized_dirs, key=lambda item: item[0]):
        shutil.rmtree(path, ignore_errors=True)
        total_size -= size
        if total_size <= DOCX_RENDER_CACHE_MAX_BYTES:
            break


def ensure_docx_render_pdf(
    docx_bytes: bytes,
    *,
    binary_hash: str | None = None,
    artifact_id: str | None = None,
    profile: str | None = None,
    timeout_s: int | None = None,
    force: bool = False,
) -> dict[str, Any]:
    normalized_hash = _binary_hash(docx_bytes, binary_hash)
    normalized_profile = _profile(profile)
    render_id = _render_id(normalized_hash, normalized_profile)
    lock = _get_key_lock(render_id)
    with lock:
        with _CACHE_LOCK:
            _cleanup_render_cache_locked()
            existing = _read_json(_manifest_path(render_id))
            if not force and existing and _pdf_path(render_id).exists():
                return _decorate_manifest(render_id, existing)

        started_at = time.perf_counter()
        docx_b64 = base64.b64encode(docx_bytes).decode("ascii")
        diag = convert_docx_with_diagnostics(docx_b64, timeout_s=timeout_s)
        pdf_b64 = diag.get("pdf_b64") if isinstance(diag, dict) else None
        if not pdf_b64:
            error_manifest = {
                "render_id": render_id,
                "artifact_id": artifact_id,
                "binary_hash": normalized_hash,
                "profile": normalized_profile,
                "renderer_signature": DOCX_RENDER_ENGINE_VERSION,
                "status": "error",
                "converter_used": (diag or {}).get("converter_used") if isinstance(diag, dict) else None,
                "error": (diag or {}).get("error") if isinstance(diag, dict) else "pdf_conversion_failed",
                "error_kind": (diag or {}).get("error_kind") if isinstance(diag, dict) else None,
                "generated_at": _utc_now_iso(),
                "updated_at": _utc_now_iso(),
            }
            _write_json(_manifest_path(render_id), error_manifest)
            raise RuntimeError(str(error_manifest.get("error") or "pdf_conversion_failed"))

        pdf_bytes = base64.b64decode(str(pdf_b64))
        page_count, pages = _extract_pdf_pages(pdf_bytes)
        pdf_path = _pdf_path(render_id)
        _atomic_write_bytes(pdf_path, pdf_bytes)
        try:
            pdf_cache_set(normalized_hash, str(pdf_b64))
        except Exception:
            pass

        generated_at = _utc_now_iso()
        manifest = {
            "render_id": render_id,
            "artifact_id": artifact_id,
            "binary_hash": normalized_hash,
            "profile": normalized_profile,
            "renderer_signature": DOCX_RENDER_ENGINE_VERSION,
            "status": "ready",
            "page_count": page_count,
            "pages": pages,
            "converter_used": diag.get("converter_used"),
            "word_error": diag.get("word_error"),
            "duration_ms": diag.get("duration_ms"),
            "stage_timings_ms": diag.get("stage_timings_ms") or {},
            "pdf_size_bytes": len(pdf_bytes),
            "pdf_hash": hashlib.sha256(pdf_bytes).hexdigest(),
            "generated_at": generated_at,
            "updated_at": generated_at,
            "render_prepare_ms": int((time.perf_counter() - started_at) * 1000),
        }
        _write_json(_manifest_path(render_id), manifest)
        return _decorate_manifest(render_id, manifest)


def render_docx_page_png_cached(
    docx_bytes: bytes,
    *,
    page: int = 1,
    binary_hash: str | None = None,
    artifact_id: str | None = None,
    profile: str | None = None,
    timeout_s: int | None = None,
    zoom: float | int | str | None = None,
) -> tuple[bytes, dict[str, Any]]:
    if page < 1:
        raise ValueError("page must be >= 1")
    normalized_zoom = _normalize_zoom(zoom)
    manifest = ensure_docx_render_pdf(
        docx_bytes,
        binary_hash=binary_hash,
        artifact_id=artifact_id,
        profile=profile,
        timeout_s=timeout_s,
    )
    page_count = int(manifest.get("page_count") or 0)
    if page_count and page > page_count:
        raise ValueError(f"page {page} out of range; document has {page_count} pages")

    render_id = str(manifest["render_id"])
    resource_name = _page_resource_name(page, normalized_zoom)
    page_path = _pages_dir(render_id) / resource_name
    cached = page_path.exists()
    if cached:
        png_bytes = page_path.read_bytes()
    else:
        png_bytes = _render_pdf_page(_pdf_path(render_id), page=page, zoom=normalized_zoom)
        _atomic_write_bytes(page_path, png_bytes)
        raw_manifest = _read_json(_manifest_path(render_id)) or manifest
        raw_manifest["updated_at"] = _utc_now_iso()
        _write_json(_manifest_path(render_id), raw_manifest)
        manifest = _decorate_manifest(render_id, raw_manifest)

    resource = _resource_item(
        render_id=render_id,
        name=resource_name,
        path=page_path,
        mime_type="image/png",
        page=page,
        cached=True,
        renderer=str(manifest.get("converter_used") or ""),
    )
    return png_bytes, {
        "page": page,
        "page_count": manifest.get("page_count"),
        "converter_used": manifest.get("converter_used"),
        "duration_ms": manifest.get("duration_ms"),
        "cached": cached,
        "zoom": normalized_zoom,
        "render_id": render_id,
        "resource_name": resource_name,
        "resource_uri": resource.get("resource_uri") if resource else None,
        "resource": resource,
        "manifest": get_docx_render_manifest(binary_hash=manifest.get("binary_hash"), artifact_id=artifact_id, profile=profile),
    }


def render_all_docx_pages_png_cached(
    docx_bytes: bytes,
    *,
    binary_hash: str | None = None,
    artifact_id: str | None = None,
    profile: str | None = None,
    timeout_s: int | None = None,
    zoom: float | int | str | None = None,
) -> dict[str, Any]:
    manifest = ensure_docx_render_pdf(
        docx_bytes,
        binary_hash=binary_hash,
        artifact_id=artifact_id,
        profile=profile,
        timeout_s=timeout_s,
    )
    rendered_pages: list[dict[str, Any]] = []
    for page in range(1, int(manifest.get("page_count") or 0) + 1):
        _png, meta = render_docx_page_png_cached(
            docx_bytes,
            page=page,
            binary_hash=manifest.get("binary_hash"),
            artifact_id=artifact_id,
            profile=profile,
            timeout_s=timeout_s,
            zoom=zoom,
        )
        rendered_pages.append(
            {
                key: meta.get(key)
                for key in ("page", "page_count", "cached", "zoom", "resource_name", "resource_uri")
                if meta.get(key) not in (None, "")
            }
        )
    return {
        "status": "ok",
        "rendered_pages": rendered_pages,
        "manifest": get_docx_render_manifest(binary_hash=manifest.get("binary_hash"), artifact_id=artifact_id, profile=profile),
    }


def clear_docx_render_cache(*, binary_hash: str | None = None, profile: str | None = None) -> dict[str, Any]:
    removed_dirs = 0
    removed_bytes = 0
    targets: list[Path] = []
    normalized_hash = str(binary_hash or "").strip()
    if normalized_hash:
        targets.append(_render_dir(_render_id(normalized_hash, profile)))
    elif DOCX_RENDER_CACHE_DIR.exists():
        targets.extend([path for path in DOCX_RENDER_CACHE_DIR.iterdir() if path.is_dir()])

    for target in targets:
        if not target.exists():
            continue
        size = 0
        try:
            for item in target.rglob("*"):
                if item.is_file():
                    size += item.stat().st_size
        except OSError:
            size = 0
        shutil.rmtree(target, ignore_errors=True)
        removed_dirs += 1
        removed_bytes += size
    return {
        "status": "ok",
        "binary_hash": normalized_hash or None,
        "profile": _profile(profile),
        "removed_dirs": removed_dirs,
        "removed_bytes": removed_bytes,
    }


def get_docx_render_resource(render_id: str, name: str) -> dict[str, Any] | None:
    safe_render_id = _safe_id_segment(render_id)
    safe_name = _safe_name(name)
    if not safe_render_id or not safe_name:
        return None
    base_dir = _render_dir(safe_render_id)
    candidates = [base_dir / safe_name, base_dir / "pages" / safe_name]
    for candidate in candidates:
        try:
            resolved_cache = DOCX_RENDER_CACHE_DIR.resolve()
            resolved_base = base_dir.resolve()
            resolved_path = candidate.resolve()
            resolved_base.relative_to(resolved_cache)
            resolved_path.relative_to(resolved_base)
        except Exception:
            continue
        if not resolved_path.exists() or not resolved_path.is_file():
            continue
        data = resolved_path.read_bytes()
        return {
            "name": safe_name,
            "path": str(resolved_path),
            "bytes": data,
            "size_bytes": len(data),
            "hash": hashlib.sha256(data).hexdigest(),
        }
    return None
