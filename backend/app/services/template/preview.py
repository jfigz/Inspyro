"""Template preview entrypoints and cache."""

from collections import OrderedDict
import threading
from typing import Optional

from app.services import template_service as _legacy

PREVIEW_CACHE_MAX = 64
_preview_cache: "OrderedDict[str, str]" = OrderedDict()
_preview_cache_lock = threading.RLock()


def _build_preview_cache_key(preview_key: Optional[str], kernel_id: Optional[str] = None) -> Optional[str]:
    if not preview_key:
        return None
    if kernel_id:
        return f"{kernel_id}:{preview_key}"
    return preview_key


def get_preview_cache(preview_key: Optional[str], kernel_id: Optional[str] = None) -> Optional[str]:
    cache_key = _build_preview_cache_key(preview_key, kernel_id)
    if not cache_key:
        return None
    with _preview_cache_lock:
        try:
            value = _preview_cache[cache_key]
            _preview_cache.move_to_end(cache_key)
            return value
        except KeyError:
            return None


def set_preview_cache(preview_key: str, preview_b64: str, kernel_id: Optional[str] = None) -> None:
    cache_key = _build_preview_cache_key(preview_key, kernel_id)
    if not cache_key or not preview_b64:
        return
    with _preview_cache_lock:
        _preview_cache[cache_key] = preview_b64
        _preview_cache.move_to_end(cache_key)
        while len(_preview_cache) > PREVIEW_CACHE_MAX:
            try:
                _preview_cache.popitem(last=False)
            except Exception:
                break


def clear_preview_cache(kernel_id: Optional[str] = None) -> None:
    with _preview_cache_lock:
        if kernel_id is None:
            _preview_cache.clear()
            return
        prefix = f"{kernel_id}:"
        keys_to_remove = [key for key in _preview_cache.keys() if key.startswith(prefix)]
        for key in keys_to_remove:
            _preview_cache.pop(key, None)


def generate_style_preview(kernel_id: str, style_name: str, style_props=None) -> Optional[str]:
    return _legacy.generate_style_preview(kernel_id, style_name, style_props)


def generate_document_table_preview(kernel_id: str, table_index: int, max_rows: int = 4):
    return _legacy.generate_document_table_preview(kernel_id, table_index, max_rows)
