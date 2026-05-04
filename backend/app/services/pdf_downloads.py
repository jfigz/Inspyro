from __future__ import annotations

import base64
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Dict, Optional

from app.services.workspace_service import get_app_storage_dir

PDF_MIME_TYPE = "application/pdf"
PDF_TOKEN_TTL_SECONDS = int(os.getenv("INSPYRO_PDF_TOKEN_TTL", "600"))
PDF_MAX_ENTRIES = int(os.getenv("INSPYRO_PDF_CACHE_MAX", "64"))
PDF_FILESYSTEM_CLEANUP_INTERVAL_SECONDS = max(1, int(os.getenv("INSPYRO_PDF_CACHE_SCAN_INTERVAL", "60")))


def _resolve_pdf_download_dir() -> Path:
    override = os.getenv("INSPYRO_PDF_CACHE_DIR")
    if override:
        download_dir = Path(override).expanduser().resolve()
    else:
        download_dir = get_app_storage_dir("pdf_downloads")
    download_dir.mkdir(parents=True, exist_ok=True)
    return download_dir


PDF_DOWNLOAD_DIR = _resolve_pdf_download_dir()

_PDF_CACHE: Dict[str, Dict[str, object]] = {}
_PDF_LOCK = threading.Lock()
_PDF_LAST_FILESYSTEM_CLEANUP_AT = 0.0


def _delete_entry_locked(token: str) -> None:
    info = _PDF_CACHE.pop(token, None)
    if not info:
        return
    path = info.get("path")
    if isinstance(path, str) and os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass


def _cleanup_locked(now: float) -> None:
    expired = [token for token, info in _PDF_CACHE.items() if info["expires_at"] <= now]
    for token in expired:
        _delete_entry_locked(token)

    if len(_PDF_CACHE) <= PDF_MAX_ENTRIES:
        return

    ordered = sorted(_PDF_CACHE.items(), key=lambda item: item[1]["expires_at"])
    for token, _ in ordered[: max(0, len(_PDF_CACHE) - PDF_MAX_ENTRIES)]:
        _delete_entry_locked(token)


def _cleanup_filesystem_locked(now: float, *, force: bool = False) -> None:
    global _PDF_LAST_FILESYSTEM_CLEANUP_AT
    if not force and (now - _PDF_LAST_FILESYSTEM_CLEANUP_AT) < PDF_FILESYSTEM_CLEANUP_INTERVAL_SECONDS:
        return
    _PDF_LAST_FILESYSTEM_CLEANUP_AT = now

    try:
        files = [path for path in PDF_DOWNLOAD_DIR.glob("*.pdf") if path.is_file()]
    except Exception:
        return

    for file_path in files:
        token = file_path.stem
        info = _PDF_CACHE.get(token)
        if info and isinstance(info.get("expires_at"), (int, float)) and float(info["expires_at"]) > now:
            continue
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass
        _PDF_CACHE.pop(token, None)


def _initialize_pdf_download_store() -> None:
    now = time.time()
    with _PDF_LOCK:
        _cleanup_locked(now)
        _cleanup_filesystem_locked(now, force=True)


def store_pdf_base64(pdf_b64: str, filename: str = "inspyro_document.pdf") -> Dict[str, object]:
    if not pdf_b64:
        raise ValueError("pdf_b64 requerido")
    data = base64.b64decode(pdf_b64)
    return store_pdf_bytes(data, filename=filename)


def store_pdf_bytes(pdf_bytes: bytes, filename: str = "inspyro_document.pdf") -> Dict[str, object]:
    if not pdf_bytes:
        raise ValueError("pdf_bytes requerido")

    token = secrets.token_urlsafe(18)
    path = PDF_DOWNLOAD_DIR / f"{token}.pdf"
    path.write_bytes(pdf_bytes)
    now = time.time()
    expires_at = now + PDF_TOKEN_TTL_SECONDS
    entry = {
        "path": str(path),
        "expires_at": expires_at,
        "filename": filename,
        "size_bytes": len(pdf_bytes),
    }

    with _PDF_LOCK:
        _cleanup_locked(now)
        _PDF_CACHE[token] = entry
        _cleanup_filesystem_locked(now)

    return {"token": token, **entry}


def get_pdf_file(token: str) -> Optional[Dict[str, object]]:
    if not token:
        return None
    now = time.time()
    with _PDF_LOCK:
        _cleanup_locked(now)
        _cleanup_filesystem_locked(now)
        info = _PDF_CACHE.get(token)
        if not info:
            return None
        path = info.get("path")
        if not isinstance(path, str) or not os.path.exists(path):
            _delete_entry_locked(token)
            return None
        return dict(info)


_initialize_pdf_download_store()
