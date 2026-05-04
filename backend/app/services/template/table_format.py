"""Template table-format entrypoints."""

from typing import Optional

from app.services import template_service as _legacy


def create_table_style_from_format(kernel_id: str, table_index: int, style_name: str):
    return _legacy.create_table_style_from_format(kernel_id, table_index, style_name)


def apply_table_format_to_style(
    kernel_id: str,
    table_index: int,
    target_style_name: Optional[str] = None,
    target_style_id: Optional[str] = None,
):
    return _legacy.apply_table_format_to_style(kernel_id, table_index, target_style_name, target_style_id)
