"""Template domain package.

This package groups template responsibilities in cohesive entrypoints while
`template_service.py` remains as a temporary compatibility facade.
"""

from app.services.template.mutation import update_template_style
from app.services.template.preview import (
    clear_preview_cache,
    generate_document_table_preview,
    generate_style_preview,
    get_preview_cache,
    set_preview_cache,
)
from app.services.template.storage import (
    delete_template,
    get_template,
    get_template_docx_path,
    list_templates,
    save_template,
)
from app.services.template.table_format import (
    apply_table_format_to_style,
    create_table_style_from_format,
)
from app.services.template.xml_ops import local_name, qn, serialize_xml

__all__ = [
    "apply_table_format_to_style",
    "clear_preview_cache",
    "create_table_style_from_format",
    "delete_template",
    "generate_document_table_preview",
    "generate_style_preview",
    "get_preview_cache",
    "get_template",
    "get_template_docx_path",
    "list_templates",
    "local_name",
    "qn",
    "save_template",
    "serialize_xml",
    "set_preview_cache",
    "update_template_style",
]
