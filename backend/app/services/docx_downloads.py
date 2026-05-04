import base64
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Dict, Optional

from app.services.workspace_service import get_app_storage_dir

DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
DOCX_TOKEN_TTL_SECONDS = int(os.getenv("INSPYRO_DOCX_TOKEN_TTL", "600"))
DOCX_MAX_ENTRIES = int(os.getenv("INSPYRO_DOCX_CACHE_MAX", "64"))
DOCX_FILESYSTEM_CLEANUP_INTERVAL_SECONDS = max(1, int(os.getenv("INSPYRO_DOCX_CACHE_SCAN_INTERVAL", "60")))


def _resolve_docx_download_dir() -> Path:
    override = os.getenv("INSPYRO_DOCX_CACHE_DIR")
    if override:
        download_dir = Path(override).expanduser().resolve()
    else:
        download_dir = get_app_storage_dir("docx_downloads")
    download_dir.mkdir(parents=True, exist_ok=True)
    return download_dir


DOCX_DOWNLOAD_DIR = _resolve_docx_download_dir()

_DOCX_CACHE: Dict[str, Dict[str, object]] = {}
_DOCX_LOCK = threading.Lock()
_DOCX_LAST_FILESYSTEM_CLEANUP_AT = 0.0


def _cleanup_locked(now: float) -> None:
    expired = [token for token, info in _DOCX_CACHE.items() if info["expires_at"] <= now]
    for token in expired:
        _delete_entry_locked(token)

    if len(_DOCX_CACHE) <= DOCX_MAX_ENTRIES:
        return

    ordered = sorted(_DOCX_CACHE.items(), key=lambda item: item[1]["expires_at"])
    for token, _ in ordered[: max(0, len(_DOCX_CACHE) - DOCX_MAX_ENTRIES)]:
        _delete_entry_locked(token)


def _delete_entry_locked(token: str) -> None:
    info = _DOCX_CACHE.pop(token, None)
    if not info:
        return
    path = info.get("path")
    if isinstance(path, str) and os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass


def _cleanup_filesystem_locked(now: float, *, force: bool = False) -> None:
    global _DOCX_LAST_FILESYSTEM_CLEANUP_AT
    if not force and (now - _DOCX_LAST_FILESYSTEM_CLEANUP_AT) < DOCX_FILESYSTEM_CLEANUP_INTERVAL_SECONDS:
        return
    _DOCX_LAST_FILESYSTEM_CLEANUP_AT = now

    try:
        files = [path for path in DOCX_DOWNLOAD_DIR.glob("*.docx") if path.is_file()]
    except Exception:
        return

    for file_path in files:
        token = file_path.stem
        info = _DOCX_CACHE.get(token)
        if info and isinstance(info.get("expires_at"), (int, float)) and float(info["expires_at"]) > now:
            continue
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass
        _DOCX_CACHE.pop(token, None)


def _initialize_docx_download_store() -> None:
    now = time.time()
    with _DOCX_LOCK:
        _cleanup_locked(now)
        _cleanup_filesystem_locked(now, force=True)


def store_docx_base64(docx_b64: str, filename: str = "inspyro_document.docx") -> Dict[str, object]:
    if not docx_b64:
        raise ValueError("docx_b64 requerido")

    token = secrets.token_urlsafe(18)
    data = base64.b64decode(docx_b64)
    path = DOCX_DOWNLOAD_DIR / f"{token}.docx"
    path.write_bytes(data)
    now = time.time()
    expires_at = now + DOCX_TOKEN_TTL_SECONDS
    entry = {
        "path": str(path),
        "expires_at": expires_at,
        "filename": filename,
        "size_bytes": len(data),
    }

    with _DOCX_LOCK:
        _cleanup_locked(now)
        _DOCX_CACHE[token] = entry
        _cleanup_filesystem_locked(now)

    return {"token": token, **entry}


def get_docx_file(token: str) -> Optional[Dict[str, object]]:
    if not token:
        return None
    now = time.time()
    with _DOCX_LOCK:
        _cleanup_locked(now)
        _cleanup_filesystem_locked(now)
        info = _DOCX_CACHE.get(token)
        if not info:
            return None
        path = info.get("path")
        if not isinstance(path, str) or not os.path.exists(path):
            _delete_entry_locked(token)
            return None
        return dict(info)


_initialize_docx_download_store()
