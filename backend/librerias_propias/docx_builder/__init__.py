"""API pública para la nueva experiencia de generación DOCX en Notebook.

Este paquete expone helpers de alto nivel pensados para un flujo sin fricción
para usuarios finales. La implementación principal reside en
`docx_builder.api`, pero re-exportamos símbolos clave para simplificar las
importaciones.
"""

from .api import (
    build_doc,
    doc_begin,
    doc_block,
    doc_end,
    doc_export,
    doc_export_provenance,
    doc_finalize,
    doc_help,
    doc_reset,
    Heading,
    Text,
    List,
    Code,
    Link,
    Equation,
    EquationLatex,
    Reference,
    Image,
    Figure,
    Caption,
    Table,
    DataFrame,
    Section,
    TableOfContents,
    PageBreak,
    Metadata,
    Style,
    Header,
    Footer,
)
from .builder import DocBuilder
from .session import DocxSession, get_session

__all__ = [
    "build_doc",
    "doc_begin",
    "doc_block",
    "doc_end",
    "doc_export",
    "doc_export_provenance",
    "doc_finalize",
    "doc_help",
    "doc_reset",
    "DocBuilder",
    "DocxSession",
    "get_session",
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
]
