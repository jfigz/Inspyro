"""API pública orientada a notebooks para generar documentos DOCX."""

from __future__ import annotations

import os
import io
import sys
import tempfile
import textwrap
from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional, Tuple

from .builder import DocBuilder
from .session import DocxSession, DocxValidationError, get_session

# Re-exports para facilitar uso avanzado (bajo nivel)
try:
    from docx.shared import Inches, Cm, Mm, Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
except ImportError:
    pass


# Almacena (DocBuilder, ContextManager) para cada namespace
_INLINE_BUILDERS: Dict[int, Tuple[DocBuilder, Any]] = {}


def _caller_namespace(depth: int = 2) -> Dict[str, Any]:
    frame = sys._getframe(depth)
    return frame.f_globals


@contextmanager
def build_doc(
    *,
    block_id: Optional[str] = None,
    auto_clear: bool = True,
    strict: bool = False,
    namespace: Optional[Dict[str, Any]] = None,
    order: int,
    cell_id: Optional[str] = None,  # compat alias
    notebook_cell_id: Optional[str] = None,
) -> Iterator[DocBuilder]:
    """Crea un builder para la celda actual.

    El builder puede usarse dentro o fuera de un contexto `with`. Si se crea con
    `auto_clear=True` (comportamiento recomendado) eliminará el contenido previo
    de la celda antes de insertar los nuevos bloques, evitando duplicados.
    """

    if block_id is None and cell_id is not None:
        block_id = cell_id
    if namespace is None:
        namespace = _caller_namespace(depth=3)  # +1 por el wrapper de contextmanager
    session = get_session(namespace)
    with session.activate_cell(
        block_id=block_id,
        auto_clear=auto_clear,
        strict=strict,
        order=order,
        notebook_cell_id=notebook_cell_id,
    ) as handle:
        builder = DocBuilder(session, handle, lambda: None)
        try:
            yield builder
        finally:
            builder.close()


def doc_begin(
    *,
    block_id: Optional[str] = None,
    auto_clear: bool = True,
    strict: bool = False,
    order: int,
    cell_id: Optional[str] = None,  # compat
    notebook_cell_id: Optional[str] = None,
) -> DocBuilder:
    """Inicializa un builder global para la celda actual.

    Este enfoque está pensado para usuarios que prefieren invocar funciones
    sueltas (`Heading`, `Text`, etc.). Se debe emparejar con `doc_end()` al final
    de la celda.
    """

    namespace = _caller_namespace()
    key = id(namespace)
    if block_id is None and cell_id is not None:
        block_id = cell_id
    
    # Cerrar builder anterior si existe
    old_entry = _INLINE_BUILDERS.get(key)
    if old_entry is not None:
        old_builder, old_cm = old_entry
        try:
            old_builder.close()
        except Exception:
            pass
        try:
            old_cm.__exit__(None, None, None)
        except Exception:
            pass
    
    # Crear nuevo context manager y entrar en él
    cm = build_doc(
        block_id=block_id,
        auto_clear=auto_clear,
        strict=strict,
        namespace=namespace,
        order=order,
        notebook_cell_id=notebook_cell_id,
    )
    # Entrar en el context manager para obtener el DocBuilder real
    builder = cm.__enter__()
    # Guardar tanto el builder como el context manager para poder cerrar correctamente
    _INLINE_BUILDERS[key] = (builder, cm)
    return builder


def doc_end() -> None:
    namespace = _caller_namespace()
    key = id(namespace)
    entry = _INLINE_BUILDERS.pop(key, None)
    if entry is not None:
        builder, cm = entry
        try:
            builder.close()
        except Exception:
            pass
        try:
            cm.__exit__(None, None, None)
        except Exception:
            pass


def cleanup_inline_builders() -> None:
    """Limpia todos los builders inline almacenados.
    
    Esta función debe llamarse cuando un kernel se cierra para evitar
    memory leaks de builders orphaned.
    """
    global _INLINE_BUILDERS
    # Cerrar todos los builders activos antes de limpiar
    for key, entry in list(_INLINE_BUILDERS.items()):
        if entry is not None:
            builder, cm = entry
            try:
                builder.close()
            except Exception:
                pass
            try:
                cm.__exit__(None, None, None)
            except Exception:
                pass
    _INLINE_BUILDERS.clear()


# =============================================================================
# METADATOS
# =============================================================================

def doc_info() -> dict:
    return {
        "version": "1.0.0",
    }


@contextmanager
def doc_block(
    *,
    block_id: Optional[str] = None,
    auto_clear: bool = True,
    strict: bool = False,
    namespace: Optional[Dict[str, Any]] = None,
    order: int,
    cell_id: Optional[str] = None,
    notebook_cell_id: Optional[str] = None,
) -> Iterator[DocBuilder]:
    # Debido a que doc_block se declara como contextmanager, hay un marco extra en la
    # pila antes de llegar al usuario final. Por ello necesitamos saltar un nivel más
    # para capturar el namespace correcto del notebook.
    ns = namespace or _caller_namespace(depth=3)
    if block_id is None and cell_id is not None:
        block_id = cell_id
    with build_doc(
        block_id=block_id,
        auto_clear=auto_clear,
        strict=strict,
        namespace=ns,
        order=order,
        notebook_cell_id=notebook_cell_id,
    ) as builder:
        yield builder


def _require_inline_builder(depth: int = 3) -> DocBuilder:
    """Obtiene el builder inline activo para el namespace del caller.
    
    depth=3 porque la pila típica es:
    - 0: _caller_namespace
    - 1: _require_inline_builder  
    - 2: Heading/Text/etc (alias inline)
    - 3: código del usuario (el que queremos)
    """
    namespace = _caller_namespace(depth=depth)
    key = id(namespace)
    entry = _INLINE_BUILDERS.get(key)
    if entry is None:
        raise RuntimeError(
            "No se ha inicializado un builder. Llama a doc_begin() al inicio de la celda o usa build_doc()."
        )
    # entry es una tupla (builder, cm)
    builder, _ = entry
    return builder


def doc_reset(*, hard: bool = False) -> None:
    session = get_session(_caller_namespace())
    session.reset(hard=hard)


def doc_set_template(path: Optional[str]) -> None:
    """Establece la ruta de la plantilla DOCX para la sesión actual.
    
    Esta configuración persiste durante la vida de la sesión del kernel.
    Para garantizar que la plantilla se use siempre, llama a esta función
    antes de doc_reset(hard=True).
    
    Args:
        path: Ruta absoluta o relativa al archivo .docx de plantilla.
              Si es relativa, se resuelve respecto al directorio de trabajo actual.
              Usa None para limpiar la plantilla.
    """
    if path and not os.path.isabs(path):
        cwd = os.getcwd()
        path = os.path.abspath(os.path.join(cwd, path))
        
    session = get_session(_caller_namespace())
    session.set_template_path(path)


def doc_export(*, format: str = "docx", path: Optional[str] = None) -> Any:
    session = get_session(_caller_namespace())
    if format == "docx":
        return session.export_docx_base64_for_delivery()
    docx_bytes = session.serialize_docx_bytes_for_delivery()
    if format == "bytes":
        return docx_bytes
    if format == "path":
        if path is None:
            fd, temp_path = tempfile.mkstemp(suffix=".docx")
            with os.fdopen(fd, "wb") as fh:  # type: ignore[name-defined]
                fh.write(docx_bytes)
            return temp_path
        with open(path, "wb") as fh:
            fh.write(docx_bytes)
        return path
    raise ValueError("format debe ser 'docx', 'bytes' o 'path'")


def doc_export_provenance() -> str:
    session = get_session(_caller_namespace())
    return session.export_provenance_manifest_json()


def doc_finalize(*, profile: str = "delivery", detail: str = "summary") -> dict:
    """Ejecuta una revision DOCX local compacta sobre el documento actual."""
    from app.services.docx_quality.audit import audit_docx_bytes

    session = get_session(_caller_namespace())
    summary = audit_docx_bytes(session.serialize_docx_bytes_for_delivery(), profile=profile)
    if detail == "full":
        return summary
    return {
        "status": summary.get("status"),
        "score": summary.get("score"),
        "counts": summary.get("counts"),
        "profile": summary.get("profile"),
        "findings": (summary.get("findings") or [])[:12],
        "truncated_findings": len(summary.get("findings") or []) > 12,
    }


def doc_help(topic: Optional[str] = None) -> str:
    base = textwrap.dedent(
        """
        ✨ Nueva API DOCX

        Uso básico (recomendado):

            with build_doc(order=10) as doc:
                doc.heading("Reporte", level=1)
                doc.text("Contenido...")
                doc.table([...])

        `doc.text()` resuelve el slot semÃ¡ntico `body` del template activo.
        Usa `doc.resolve_style_slot("body")` si necesitas bajar a python-docx sin hardcodear nombres Word.

        Alternativa sin contexto (usuarios novatos):

            doc_begin()
            Heading("Reporte")
            Text("Contenido...")
            Table([...])
            doc_end()

        Comandos disponibles: Heading, Text, List, Code, Equation,
        EquationLatex, Reference, Image, Figure, Caption, Table,
        DataFrame, Section, TableOfContents, PageBreak, Metadata, Style.
        """
    ).strip()
    if topic is None:
        print(base)
        return base
    topic_lower = topic.lower()
    snippets = {
        "heading": "Heading('Título', level=1)",
        "tabla": "Table([[1,2],[3,4]], headers=['A','B'])",
        "equation": "Equation('E = m c^2', label='eq:einstein', number=True)",
        "equation_latex": r"EquationLatex(r'\\frac{a}{b}', label='eq:frac', number=True)",
    }
    snippet = snippets.get(topic_lower, "No hay ejemplo específico para ese tópico aún.")
    print(snippet)
    return snippet


# ----------------------------------------------------------------------
# Alias estilo funcional
# ----------------------------------------------------------------------


def Heading(text: str, *, level: int = 1, style: Optional[str] = None) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.heading(text, level=level, style=style)


def Text(
    text: str,
    *,
    style: Optional[str] = None,
    bold: bool = False,
    italic: bool = False,
    underline: bool = False,
    align: Optional[str] = None,
) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.text(text, style=style, bold=bold, italic=italic, underline=underline, align=align)


def List(items, *, ordered: bool = False) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.list(items, ordered=ordered)


def Code(text: str, *, language: Optional[str] = None) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.code(text, language=language)


def Link(text: str, url: str) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.link(text, url)


def Equation(expr: str, *, label: Optional[str] = None, number: bool = False) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.math(expr, label=label, number=number)


def EquationLatex(expr: str, *, label: Optional[str] = None, number: bool = False) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.math_latex(expr, label=label, number=number)


def Reference(label: str) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.reference(label)


def Image(
    image: Any,
    *,
    width: Optional[float] = None,
    height: Optional[float] = None,
    align: Optional[str] = None,
    caption: Optional[str] = None,
    label: Optional[str] = None,
    alt_text: Optional[str] = None,
    caption_position: str = "below",
    caption_label: str = "Figura",
) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.image(
        image,
        width=width,
        height=height,
        align=align,
        caption=caption,
        label=label,
        alt_text=alt_text,
        caption_position=caption_position,
        caption_label=caption_label,
    )


def Figure(
    figure: Any,
    *,
    caption: Optional[str] = None,
    label: Optional[str] = None,
    width: Optional[float] = None,
    height: Optional[float] = None,
    alt_text: Optional[str] = None,
    dpi: int = 200,
    caption_position: str = "below",
    caption_label: str = "Figura",
) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.figure(
        figure,
        caption=caption,
        label=label,
        width=width,
        height=height,
        alt_text=alt_text,
        dpi=dpi,
        caption_position=caption_position,
        caption_label=caption_label,
    )

def Caption(
    text: str,
    *,
    label: Optional[str] = None,
    number: bool = False,
    caption_label: str = "Figura",
) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.caption(text, label=label, number=number, caption_label=caption_label)

def Table(
    data,
    *,
    headers=None,
    style: Optional[str] = None,
    autofit: bool = True,
    caption: Optional[str] = None,
    label: Optional[str] = None,
    caption_position: str = "above",
    caption_label: str = "Tabla",
    repeat_header_row: bool = True,
    column_widths=None,
    cell_padding_twips=None,
    vertical_align: Optional[str] = "center",
) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.table(
        data,
        headers=headers,
        style=style,
        autofit=autofit,
        caption=caption,
        label=label,
        caption_position=caption_position,
        caption_label=caption_label,
        repeat_header_row=repeat_header_row,
        column_widths=column_widths,
        cell_padding_twips=cell_padding_twips,
        vertical_align=vertical_align,
    )

def DataFrame(
    df,
    *,
    style: Optional[str] = None,
    index: bool = False,
    number_format=None,
    max_rows=None,
    caption: Optional[str] = None,
    label: Optional[str] = None,
    caption_position: str = "above",
    caption_label: str = "Tabla",
    repeat_header_row: bool = True,
    column_widths=None,
    cell_padding_twips=None,
    vertical_align: Optional[str] = "center",
) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.dataframe(
        df,
        style=style,
        index=index,
        number_format=number_format,
        max_rows=max_rows,
        caption=caption,
        label=label,
        caption_position=caption_position,
        caption_label=caption_label,
        repeat_header_row=repeat_header_row,
        column_widths=column_widths,
        cell_padding_twips=cell_padding_twips,
        vertical_align=vertical_align,
    )


def Section(*, orientation: str = "portrait", page_size=None, margins=None) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.section(orientation=orientation, page_size=page_size, margins=margins)


def TableOfContents(*, depth: int = 3, hyperlinks: bool = True) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.table_of_contents(depth=depth, hyperlinks=hyperlinks)


def PageBreak() -> DocBuilder:
    builder = _require_inline_builder()
    return builder.page_break()


def Metadata(*, title: Optional[str] = None, subject: Optional[str] = None, keywords=None) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.metadata(title=title, subject=subject, keywords=keywords)


def Style(*, name: str, base: str = "Normal", font: Optional[str] = None, size_pt: Optional[float] = None, bold: Optional[bool] = None, italic: Optional[bool] = None, spacing=None) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.style(name, base=base, font=font, size_pt=size_pt, bold=bold, italic=italic, spacing=spacing)


def Header(*, text: Optional[str] = None, image: Any = None) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.header(text=text, image=image)


def Footer(*, text: Optional[str] = None) -> DocBuilder:
    builder = _require_inline_builder()
    return builder.footer(text=text)
