"""
Type stubs for Inspyro DOCX API.

This module provides type hints for the DOCX generation API that is
injected into notebook kernels at runtime. These stubs enable LSP
autocompletion and type checking.
"""

from typing import Any, Optional, Iterator, List, Union, ContextManager
from contextlib import contextmanager


class DocBuilder:
    """Builder for creating DOCX document content."""
    
    def heading(
        self, 
        text: str, 
        *, 
        level: int = 1, 
        style: Optional[str] = None
    ) -> "DocBuilder":
        """Add a heading to the document.
        
        Args:
            text: The heading text
            level: Heading level (1-9), default 1
            style: Optional Word style name
        """
        ...
    
    def text(
        self, 
        text: str, 
        *, 
        style: Optional[str] = None, 
        bold: bool = False,
        italic: bool = False, 
        underline: bool = False, 
        align: Optional[str] = None
    ) -> "DocBuilder":
        """Add a text paragraph to the document.
        
        Args:
            text: The paragraph text (supports ${variable} interpolation)
            style: Optional Word style name
            bold: Make text bold
            italic: Make text italic
            underline: Underline text
            align: Text alignment ('left', 'center', 'right', 'justify')
        """
        ...
    
    def list(
        self, 
        items: List[Any], 
        *, 
        ordered: bool = False
    ) -> "DocBuilder":
        """Add a list to the document.
        
        Args:
            items: List of items to display
            ordered: If True, create numbered list; else bullet list
        """
        ...
    
    def code(
        self, 
        text: str, 
        *, 
        language: Optional[str] = None
    ) -> "DocBuilder":
        """Add a code block to the document.
        
        Args:
            text: The code content
            language: Programming language for syntax hint
        """
        ...
    
    def math(
        self, 
        expr: str, 
        *, 
        label: Optional[str] = None, 
        number: bool = False
    ) -> "DocBuilder":
        """Add a mathematical equation to the document.
        
        Args:
            expr: Math expression in custom notation (e.g., 'E = m c^2')
            label: Reference label for cross-referencing
            number: If True, add equation number
        """
        ...

    def math_latex(
        self,
        expr: str,
        *,
        label: Optional[str] = None,
        number: bool = False
    ) -> "DocBuilder":
        """Add a mathematical equation using math-only LaTeX."""
        ...

    def equation(
        self, 
        expr: str, 
        *, 
        label: Optional[str] = None, 
        number: bool = False
    ) -> "DocBuilder":
        """Alias for math(). Add a mathematical equation."""
        ...

    def create_math_element(self, expression: str) -> Any:
        """Build an inline OMML element using the legacy math parser."""
        ...

    def create_math_latex_element(self, expression: str) -> Any:
        """Build an inline OMML element using math-only LaTeX."""
        ...
    
    def table(
        self, 
        data: Any, 
        *, 
        headers: Any = None, 
        style: str = "Table Grid", 
        autofit: bool = True
    ) -> "DocBuilder":
        """Add a table to the document.
        
        Args:
            data: 2D list or similar structure with table data
            headers: Optional list of header strings
            style: Word table style name
            autofit: Auto-adjust column widths
        """
        ...
    
    def dataframe(
        self, 
        df: Any, 
        *, 
        style: str = "Table Grid", 
        index: bool = False,
        number_format: Any = None,
        max_rows: Optional[int] = None
    ) -> "DocBuilder":
        """Add a pandas DataFrame as a table.
        
        Args:
            df: pandas DataFrame object
            style: Word table style name
            index: Include DataFrame index column
            number_format: Format specification for numbers
            max_rows: Maximum rows to display
        """
        ...
    
    def figure(
        self, 
        figure: Any, 
        *, 
        caption: Optional[str] = None, 
        label: Optional[str] = None,
        width: Optional[float] = None,
        height: Optional[float] = None,
        dpi: int = 200
    ) -> "DocBuilder":
        """Add a matplotlib/plotly figure.
        
        Args:
            figure: matplotlib Figure or plotly Figure object
            caption: Figure caption text
            label: Reference label for cross-referencing
            width: Width in inches
            height: Height in inches
            dpi: Resolution for raster output
        """
        ...
    
    def image(
        self, 
        image: Any, 
        *, 
        width: Optional[float] = None, 
        height: Optional[float] = None,
        align: Optional[str] = None
    ) -> "DocBuilder":
        """Add an image to the document.
        
        Args:
            image: Image path, bytes, or PIL Image object
            width: Width in inches
            height: Height in inches
            align: Alignment ('left', 'center', 'right')
        """
        ...
    
    def caption(
        self, 
        text: str, 
        *, 
        label: Optional[str] = None
    ) -> "DocBuilder":
        """Add a caption (for figures/tables).
        
        Args:
            text: Caption text
            label: Reference label
        """
        ...
    
    def reference(self, label: str) -> "DocBuilder":
        """Insert a cross-reference to a labeled element.
        
        Args:
            label: The label to reference (e.g., 'eq:einstein', 'fig:plot1')
        """
        ...
    
    def link(self, text: str, url: str) -> "DocBuilder":
        """Add a hyperlink.
        
        Args:
            text: Display text
            url: Target URL
        """
        ...
    
    def section(
        self, 
        *, 
        orientation: str = "portrait", 
        page_size: Any = None, 
        margins: Any = None
    ) -> "DocBuilder":
        """Start a new document section.
        
        Args:
            orientation: 'portrait' or 'landscape'
            page_size: Page dimensions tuple
            margins: Page margins
        """
        ...
    
    def table_of_contents(
        self, 
        *, 
        depth: int = 3, 
        hyperlinks: bool = True
    ) -> "DocBuilder":
        """Insert a table of contents.
        
        Args:
            depth: Number of heading levels to include
            hyperlinks: Enable clickable links to sections
        """
        ...
    
    def page_break(self) -> "DocBuilder":
        """Insert a page break."""
        ...
    
    def metadata(
        self, 
        *, 
        title: Optional[str] = None, 
        subject: Optional[str] = None, 
        keywords: Any = None
    ) -> "DocBuilder":
        """Set document metadata.
        
        Args:
            title: Document title
            subject: Document subject
            keywords: List of keywords
        """
        ...
    
    def style(
        self, 
        name: str,
        *, 
        base: str = "Normal", 
        font: Optional[str] = None, 
        size_pt: Optional[float] = None,
        bold: Optional[bool] = None,
        italic: Optional[bool] = None,
        spacing: Any = None
    ) -> "DocBuilder":
        """Define or modify a document style.
        
        Args:
            name: Style name
            base: Base style to inherit from
            font: Font family name
            size_pt: Font size in points
            bold: Bold text
            italic: Italic text
            spacing: Line spacing
        """
        ...
    
    def header(
        self, 
        *, 
        text: Optional[str] = None, 
        image: Any = None
    ) -> "DocBuilder":
        """Set page header.
        
        Args:
            text: Header text
            image: Header image
        """
        ...
    
    def footer(self, *, text: Optional[str] = None) -> "DocBuilder":
        """Set page footer.
        
        Args:
            text: Footer text
        """
        ...
    
    def close(self) -> None:
        """Close the builder and finalize content."""
        ...


# Context manager for creating document content
@contextmanager
def build_doc(
    *, 
    block_id: Optional[str] = None, 
    auto_clear: bool = True,
    strict: bool = False, 
    order: int,
    cell_id: Optional[str] = None,
    notebook_cell_id: Optional[str] = None
) -> Iterator[DocBuilder]:
    """Create a document builder context for the current cell.
    
    This is the recommended way to add content to the document.
    
    Args:
        block_id: Optional block identifier
        auto_clear: Clear previous content from this cell (recommended)
        strict: Enable strict validation
        order: Execution order (determines content position in document)
        cell_id: Alias for block_id (compatibility)
        notebook_cell_id: Notebook cell identifier
        
    Example:
        with build_doc(order=10) as doc:
            doc.heading("Results", level=1)
            doc.text("The calculation shows...")
            doc.equation("E = m c^2")
    """
    ...


def doc_begin(
    *, 
    block_id: Optional[str] = None, 
    auto_clear: bool = True,
    strict: bool = False, 
    order: int,
    cell_id: Optional[str] = None,
    notebook_cell_id: Optional[str] = None
) -> DocBuilder:
    """Initialize a global builder for the current cell.
    
    Use this when you prefer calling functions directly instead of
    using a context manager. Must be paired with doc_end().
    
    Example:
        doc_begin(order=10)
        Heading("Results")
        Text("Content...")
        doc_end()
    """
    ...


def doc_end() -> None:
    """Finalize the current document builder started with doc_begin()."""
    ...


def doc_reset(*, hard: bool = False) -> None:
    """Reset the document session.
    
    Args:
        hard: If True, completely clear all content
    """
    ...


def doc_export(*, format: str = "docx", path: Optional[str] = None) -> Any:
    """Export the document.
    
    Args:
        format: Output format ('docx', 'bytes', 'path')
        path: Output file path (for format='path')
    """
    ...


def doc_help(topic: Optional[str] = None) -> str:
    """Show help for the DOCX API.
    
    Args:
        topic: Specific topic ('heading', 'table', 'equation', etc.)
    """
    ...


# ==============================================================================
# Functional-style API (aliases that work after doc_begin())
# ==============================================================================

def Heading(text: str, *, level: int = 1, style: Optional[str] = None) -> DocBuilder:
    """Add a heading. Requires doc_begin() to be called first."""
    ...


def Text(
    text: str,
    *,
    style: Optional[str] = None,
    bold: bool = False,
    italic: bool = False,
    underline: bool = False,
    align: Optional[str] = None,
) -> DocBuilder:
    """Add a text paragraph. Requires doc_begin() to be called first."""
    ...


def List(items: List[Any], *, ordered: bool = False) -> DocBuilder:
    """Add a list. Requires doc_begin() to be called first."""
    ...


def Code(text: str, *, language: Optional[str] = None) -> DocBuilder:
    """Add a code block. Requires doc_begin() to be called first."""
    ...


def Equation(expr: str, *, label: Optional[str] = None, number: bool = False) -> DocBuilder:
    """Add an equation. Requires doc_begin() to be called first."""
    ...


def EquationLatex(expr: str, *, label: Optional[str] = None, number: bool = False) -> DocBuilder:
    """Add a math-only LaTeX equation. Requires doc_begin() to be called first."""
    ...


def Table(
    data: Any, 
    *, 
    headers: Any = None, 
    style: str = "Table Grid", 
    autofit: bool = True
) -> DocBuilder:
    """Add a table. Requires doc_begin() to be called first."""
    ...


def DataFrame(
    df: Any, 
    *, 
    style: str = "Table Grid", 
    index: bool = False,
    number_format: Any = None,
    max_rows: Optional[int] = None
) -> DocBuilder:
    """Add a DataFrame as table. Requires doc_begin() to be called first."""
    ...


def Figure(
    figure: Any,
    *,
    caption: Optional[str] = None,
    label: Optional[str] = None,
    width: Optional[float] = None,
    height: Optional[float] = None,
    dpi: int = 200,
) -> DocBuilder:
    """Add a figure. Requires doc_begin() to be called first."""
    ...


def Image(
    image: Any, 
    *, 
    width: Optional[float] = None, 
    height: Optional[float] = None,
    align: Optional[str] = None
) -> DocBuilder:
    """Add an image. Requires doc_begin() to be called first."""
    ...


def Caption(text: str, *, label: Optional[str] = None) -> DocBuilder:
    """Add a caption. Requires doc_begin() to be called first."""
    ...


def Reference(label: str) -> DocBuilder:
    """Insert a cross-reference. Requires doc_begin() to be called first."""
    ...


def Link(text: str, url: str) -> DocBuilder:
    """Add a hyperlink. Requires doc_begin() to be called first."""
    ...


def Section(
    *, 
    orientation: str = "portrait", 
    page_size: Any = None, 
    margins: Any = None
) -> DocBuilder:
    """Start a new section. Requires doc_begin() to be called first."""
    ...


def TableOfContents(*, depth: int = 3, hyperlinks: bool = True) -> DocBuilder:
    """Insert table of contents. Requires doc_begin() to be called first."""
    ...


def PageBreak() -> DocBuilder:
    """Insert page break. Requires doc_begin() to be called first."""
    ...


def Metadata(
    *, 
    title: Optional[str] = None, 
    subject: Optional[str] = None, 
    keywords: Any = None
) -> DocBuilder:
    """Set document metadata. Requires doc_begin() to be called first."""
    ...


def Style(
    *, 
    name: str, 
    base: str = "Normal", 
    font: Optional[str] = None, 
    size_pt: Optional[float] = None,
    bold: Optional[bool] = None,
    italic: Optional[bool] = None,
    spacing: Any = None
) -> DocBuilder:
    """Define a style. Requires doc_begin() to be called first."""
    ...


def Header(*, text: Optional[str] = None, image: Any = None) -> DocBuilder:
    """Set page header. Requires doc_begin() to be called first."""
    ...


def Footer(*, text: Optional[str] = None) -> DocBuilder:
    """Set page footer. Requires doc_begin() to be called first."""
    ...
