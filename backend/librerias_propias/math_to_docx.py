"""Superficie pública de la librería DOCX renovada."""

from __future__ import annotations

try:
    import docx  # noqa: F401
    HAS_DOCX = True
except ImportError:  # pragma: no cover
    HAS_DOCX = False

from .docx_builder import (
    Caption,
    Code,
    DataFrame,
    DocBuilder,
    Figure,
    Footer,
    Header,
    Heading,
    Image,
    Link,
    List,
    Metadata,
    PageBreak,
    Reference,
    Section,
    Style,
    Table,
    TableOfContents,
    Text,
    build_doc,
    doc_begin,
    doc_block,
    doc_end,
    doc_export,
    doc_export_provenance,
    doc_help,
    doc_reset,
    Equation,
    EquationLatex,
)
from .docx_builder.session import DocxSession, get_session

docblock = doc_block


def doc_clear_cell(block_id: str | None = None, *, cell_id: str | None = None) -> bool:
    """Elimina el contenido asociado al bloque indicado en el documento activo."""
    if block_id is None and cell_id is not None:
        block_id = cell_id
    session = get_session()
    return session.clear_cell(block_id)


def doc_get_order() -> list[str]:
    """Devuelve el orden lógico actual de los bloques DOCX."""
    session = get_session()
    return session.get_cell_order()


def doc_set_order(order: list[str]) -> list[str]:
    """Establece el orden lógico de los bloques DOCX."""
    session = get_session()
    return session.set_cell_order(order)


def doc_move_cell(block_id: str | None, direction: str, *, cell_id: str | None = None) -> list[str]:
    """Mueve un bloque dentro del orden actual."""
    effective_id = block_id if block_id is not None else cell_id
    if effective_id is None:
        raise ValueError("Debe proporcionar block_id o cell_id")
    session = get_session()
    return session.move_cell(effective_id, direction)


def doc_start_cell(notebook_cell_id: str) -> None:
    """Marca el inicio de la ejecución de una celda de notebook."""
    session = get_session()
    session.start_notebook_cell(notebook_cell_id)


def doc_finish_cell(notebook_cell_id: str) -> None:
    """Marca el final de la ejecución de una celda notebook y limpia bloques obsoletos."""
    session = get_session()
    session.finish_notebook_cell(notebook_cell_id)


def notebook_set_strict_mode(value: bool) -> bool:
    """Activa o desactiva el modo estricto, devolviendo el estado anterior."""
    session = get_session()
    previous = session.is_strict_mode()
    session.set_strict_mode(value)
    return previous


def notebook_get_event_log() -> list[dict]:
    """Devuelve el registro de eventos generados por las celdas notebook."""
    session = get_session()
    return session.get_event_log()


def notebook_clear_event_log() -> None:
    """Limpia el registro de eventos de la sesión actual."""
    session = get_session()
    session.clear_event_log()


def notebook_snapshot_cell(block_id: str | None = None, *, include_meta: bool = False, cell_id: str | None = None) -> dict:
    """Obtiene un snapshot de los elementos generados por un bloque."""
    if block_id is None and cell_id is not None:
        block_id = cell_id
    session = get_session()
    return session.snapshot_cell(cell_id=block_id, include_meta=include_meta)


def notebook_clear_cell(block_id: str | None = None, *, cell_id: str | None = None) -> bool:
    """Alias semántico para doc_clear_cell."""
    return doc_clear_cell(block_id, cell_id=cell_id)

__all__ = [
    "HAS_DOCX",
    "DocBuilder",
    "DocxSession",
    "docblock",
    "build_doc",
    "doc_begin",
    "doc_block",
    "doc_end",
    "doc_export",
    "doc_export_provenance",
    "doc_help",
    "doc_reset",
    "get_session",
    "doc_clear_cell",
    "doc_get_order",
    "doc_set_order",
    "doc_move_cell",
    "doc_start_cell",
    "doc_finish_cell",
    "Heading",
    "Text",
    "List",
    "Code",
    "Link",
    "Equation",
    "EquationLatex",
    "Reference",
    "Image",
    "Figure",
    "Caption",
    "Table",
    "DataFrame",
    "Section",
    "TableOfContents",
    "PageBreak",
    "Metadata",
    "Style",
    "Header",
    "Footer",
    "notebook_set_strict_mode",
    "notebook_get_event_log",
    "notebook_clear_event_log",
    "notebook_snapshot_cell",
    "notebook_clear_cell",
]
