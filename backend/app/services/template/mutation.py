"""Template mutation entrypoints."""

from typing import Any, Dict

from app.services import template_service as _legacy


def normalize_style_updates(updates: Dict[str, Any]) -> Dict[str, Any]:
    normalize = getattr(_legacy, "_normalize_style_updates", None)
    if callable(normalize):
        return normalize(updates)
    return dict(updates)


def update_template_style(kernel_id: str, style_name: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    return _legacy.update_template_style(kernel_id, style_name, updates)


def update_template_document_defaults(kernel_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    return _legacy.update_template_document_defaults(kernel_id, updates)
