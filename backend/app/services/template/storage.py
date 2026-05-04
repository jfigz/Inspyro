"""Template storage entrypoints."""

from typing import Any, Dict, List, Optional

from app.services import template_service as _legacy


def save_template(kernel_id: str, docx_bytes: bytes, extracted_json: Dict[str, Any]) -> bool:
    return _legacy.save_template(kernel_id, docx_bytes, extracted_json)


def get_template(kernel_id: str) -> Optional[Dict[str, Any]]:
    return _legacy.get_template(kernel_id)


def delete_template(kernel_id: str) -> bool:
    return _legacy.delete_template(kernel_id)


def list_templates() -> List[str]:
    return _legacy.list_templates()


def get_template_docx_path(kernel_id: str) -> Optional[str]:
    return _legacy.get_template_docx_path(kernel_id)
