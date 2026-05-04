from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Dict, Optional

from app.services.workspace_service import get_app_storage_dir

TEMPLATE_TOKEN_TTL_SECONDS = int(os.getenv("INSPYRO_TEMPLATE_TOKEN_TTL", "1800"))
TEMPLATE_TOKEN_MAX_ENTRIES = int(os.getenv("INSPYRO_TEMPLATE_TOKEN_MAX", "64"))


def _resolve_template_token_dir() -> Path:
    override = os.getenv("INSPYRO_TEMPLATE_TOKEN_DIR")
    if override:
        token_dir = Path(override).expanduser().resolve()
    else:
        token_dir = get_app_storage_dir("template_tokens")
    token_dir.mkdir(parents=True, exist_ok=True)
    return token_dir


TEMPLATE_TOKEN_DIR = _resolve_template_token_dir()

_TOKEN_CACHE: Dict[str, Dict[str, object]] = {}
_TOKEN_LOCK = threading.Lock()


def _delete_entry_locked(token: str) -> None:
    info = _TOKEN_CACHE.pop(token, None)
    if not info:
        return
    path = info.get("path")
    if isinstance(path, str) and os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass


def _cleanup_locked(now: float) -> None:
    expired = [token for token, info in _TOKEN_CACHE.items() if info["expires_at"] <= now]
    for token in expired:
        _delete_entry_locked(token)

    if len(_TOKEN_CACHE) <= TEMPLATE_TOKEN_MAX_ENTRIES:
        return

    ordered = sorted(_TOKEN_CACHE.items(), key=lambda item: item[1]["expires_at"])
    for token, _ in ordered[: max(0, len(_TOKEN_CACHE) - TEMPLATE_TOKEN_MAX_ENTRIES)]:
        _delete_entry_locked(token)


def store_template_bytes(template_bytes: bytes, filename: str = "template.docx") -> Dict[str, object]:
    if not template_bytes:
        raise ValueError("template_bytes requerido")

    token = secrets.token_urlsafe(24)
    path = TEMPLATE_TOKEN_DIR / f"{token}.docx"
    path.write_bytes(template_bytes)
    sha256 = hashlib.sha256(template_bytes).hexdigest()
    now = time.time()
    expires_at = now + TEMPLATE_TOKEN_TTL_SECONDS
    entry = {
        "path": str(path),
        "expires_at": expires_at,
        "filename": filename,
        "size_bytes": len(template_bytes),
        "sha256": sha256,
    }

    with _TOKEN_LOCK:
        _cleanup_locked(now)
        _TOKEN_CACHE[token] = entry

    return {"template_token": token, **entry}


def get_template_bytes(template_token: str) -> Optional[Dict[str, object]]:
    if not template_token:
        return None
    now = time.time()
    with _TOKEN_LOCK:
        _cleanup_locked(now)
        info = _TOKEN_CACHE.get(template_token)
        if not info:
            return None
        path = info.get("path")
        if not isinstance(path, str) or not os.path.exists(path):
            _delete_entry_locked(template_token)
            return None
        payload = dict(info)
    payload["bytes"] = Path(payload["path"]).read_bytes()
    return payload

