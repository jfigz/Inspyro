# Guía Maestra de Generación DOCX para IAs (Referencia Completa)

**OBJETIVO PRINCIPAL:** Generar documentos DOCX profesionales, ricos en formato y estructura, utilizando el poder completo de la API y de `python-docx`.

> ⚠️ **DIRECTIVA CRÍTICA PARA LA IA:**
> Privilegia primero los wrappers de alto nivel como capa semántica neutral (`heading`, `text`, `list`, `table`, `dataframe`, `caption`, `figure`, `image`, `math_latex`). Baja a `builder.document`, `python-docx` o XML nativo solo cuando el control extra sea realmente necesario.

> ✅ **Estándar actual para ecuaciones:** usa `builder.math_latex(...)` y `builder.create_math_latex_element(...)`.
> ✅ **Nota de render actual:** matrices (`bmatrix`, `Bmatrix`, `vmatrix`, `Vmatrix`), `cases` y fences `\left...\right` soportados (`()`, `[]`, `{}`, `|`, `\|`, `\langle...\rangle`) salen con delimitadores extensibles nativos de Word; los fences respetan paréntesis anidados y llegan a OMML como un único operando cuando representan una agrupación.
> ✅ **Nota de render Word:** el postproceso OMML rellena operandos vacíos de `\sum`, `\prod` y `\int` cuando la transformación deja huecos dentro de delimitadores altos, evitando cuadros placeholder en Word.
> ✅ **Contrato Word-first:** el notebook aporta semántica neutral y el template activo decide la apariencia Word final; `Normal` queda solo como fallback técnico, no como convención pública de authoring.

---

## 1. Arquitectura del Sistema de Bloques

El sistema DOCX usa un **modelo de bloques** para permitir edición colaborativa en notebooks. Cada bloque de código que genera contenido DOCX se identifica con un `block_id` y un `order`.

### 1.1. Función Principal: `build_doc()`

```python
with build_doc(
    block_id: str = None,      # Identificador único del bloque
    order: int,                 # OBLIGATORIO: Posición relativa en el documento
    auto_clear: bool = True,    # Limpiar contenido previo al re-ejecutar
    strict: bool = False,       # Lanzar excepciones en lugar de warnings
    cell_id: str = None,        # Alias de block_id (compatibilidad)
    notebook_cell_id: str = None,  # ID de celda del notebook (uso interno)
) as builder:
    # Tu código aquí
```

**Parámetros detallados:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `block_id` | `str` | Identificador único. Si se omite, se genera automáticamente. Es mejor generar uno manualmente para evitar errores y ser descriptivo. **Usar el mismo ID permite re-ejecutar sin duplicar contenido.** |
| `order` | `int` | **OBLIGATORIO.** Define la posición del bloque en el documento final. Bloques con `order` menor aparecen primero. |
| `auto_clear` | `bool` | Si `True` (default), al re-ejecutar el bloque se eliminan los elementos previos de ese `block_id`. |
| `strict` | `bool` | Si `True`, errores de validación lanzan excepciones en lugar de warnings. |

### 1.2. Ejemplo de Múltiples Bloques

```python
# Bloque 1: Portada
with build_doc(block_id="portada", order=10) as builder:
    builder.heading("Informe Técnico", level=1)
    builder.metadata(title="Informe Técnico", subject="Análisis")

# Bloque 2: Introducción
with build_doc(block_id="intro", order=20) as builder:
    builder.heading("Introducción", level=2)
    builder.text("Este documento describe...")

# Bloque 3: Contenido (puede re-ejecutarse sin afectar los anteriores)
with build_doc(block_id="contenido", order=30) as builder:
    builder.heading("Análisis", level=2)
    # ... más contenido
```

---

## 2. Funciones de Control

### 2.1. `doc_reset()`
Reinicia el documento.

```python
doc_reset(hard: bool = False)
```

| Parámetro | Descripción |
|-----------|-------------|
| `hard=False` | Limpia el contenido pero mantiene el objeto Document. |
| `hard=True` | Crea un nuevo objeto Document desde cero. Usar al inicio de notebooks. |

### 2.2. `doc_export()`
Exporta el documento. No usar a menos que se pida explicitamente.

```python
result = doc_export(
    format: str = "docx",   # "docx", "bytes", o "path"
    path: str = None        # Ruta de archivo (solo para format="path")
)
```

| Formato | Retorna |
|---------|---------|
| `"docx"` | String Base64 del archivo DOCX. |
| `"bytes"` | Bytes del archivo DOCX. |
| `"path"` | Ruta al archivo guardado (genera temp si `path=None`). |

---

## 3. Métodos del Builder (Alto Nivel)

Todos los métodos retornan `self` para permitir encadenamiento.

### 3.1. Contenido de Texto

#### `heading(text, *, level=1, style=None)`
Inserta un encabezado.
```python
builder.heading("Título Principal", level=1)
builder.heading("Subtítulo", level=2)
```

#### `text(text, *, style=None, bold=False, italic=False, underline=False, align=None)`
Inserta un párrafo.
```python
builder.text("Texto normal")
builder.text("Texto importante", bold=True, align="center")
```

Para authoring Word-first, `style=None` es la ruta canónica para cuerpo: el runtime resuelve el slot semántico `body` del template activo. No uses `style="Normal"` como convención pública de authoring.

#### `list(items, *, ordered=False)`
Inserta una lista.
```python
builder.list(["Item 1", "Item 2", "Item 3"])
builder.list(["Primero", "Segundo"], ordered=True)
# Multinivel: tuplas (nivel, texto)
builder.list([(0, "Principal"), (1, "Sub-item")])
```

#### `code(text, *, language=None)`
Inserta código con fuente monoespaciada.
```python
builder.code("def hello():\n    print('Hello')", language="python")
```

#### `link(text, url)`
Inserta un hipervínculo.
```python
builder.link("Ver más", "https://example.com")
```

### 3.2. Matemáticas

#### `math_latex(expression, *, label=None, number=False)`
Inserta una ecuación usando **LaTeX matemático** y la convierte a OMML nativo.
```python
builder.math_latex(r"E = mc^2")
builder.math_latex(r"\frac{-b + \sqrt{b^2 - 4ac}}{2a}", label="eq:newton", number=True)
builder.math_latex(r"\begin{aligned}M &= \frac{wL^2}{8}\\V &= \frac{wL}{2}\end{aligned}")
```

Usa esta ruta por defecto cuando necesites ecuaciones nuevas. Acepta expresiones con o sin delimitadores (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) y soporta LaTeX **math-only**:
- Fracciones, raíces, super/subíndices.
- Integrales, sumatorias, productorias y límites.
- Matrices, `cases`, `aligned`, `split`, `gather` y delimitadores matemáticos.
- `bmatrix`, `Bmatrix`, `vmatrix`, `Vmatrix`, `cases` y fences `\left...\right` soportados (`()`, `[]`, `{}`, `|`, `\|`, `\langle...\rangle`) se normalizan a delimitadores extensibles OMML con emparejamiento anidado y un único operando para agrupaciones.
- Si la transformación OMML deja un operador n-ario sin cuerpo dentro de un delimitador alto, el postproceso recoloca el operando correcto para que Word no muestre cuadros placeholder.
- `\text{...}` corto dentro de la fórmula.

No usar en `math_latex()`:
- `\section`, `\textbf`, `\caption`, `\includegraphics`, `\newcommand`, TikZ o preámbulos.
- Para formato del documento usa la API DOCX o `builder.document`.

#### `EquationLatex(expression, *, label=None, number=False)`
Alias funcional de `builder.math_latex(...)`.
```python
with build_doc(block_id="ecuaciones", order=20, strict=True):
    EquationLatex(r"\frac{M y}{I}", label="eq:flexion", number=True)
    Reference("eq:flexion")
```

Úsalo cuando estés escribiendo celdas DOCX en estilo funcional, junto a aliases como `Heading(...)`, `Text(...)` o `Reference(...)`. No agrega capacidades nuevas: internamente termina en la misma ruta `math_latex(...)`.

#### `reference(label)`
Inserta referencia a una ecuación/figura.
```python
builder.reference("eq:newton")  # Genera "(1)" si es la ecuación 1
```

Cuando `label` apunta a un caption numerado (`figure`, `image`, `table`, `dataframe` o `caption(number=True)`),
la referencia resuelve al **número del objeto**.

### 3.3. Imágenes y Figuras

#### `image(image, *, width=None, height=None, align="center", caption=None, label=None, caption_position="below", caption_label="Figura")`
Inserta una imagen. Puede generar caption nativo de Word automáticamente.
```python
builder.image("ruta/imagen.png", width=4.0)
builder.image(pil_image, width=5.0, align="left")
builder.image(numpy_array, width=6.0)
builder.image(
    "salida.png",
    width=5.0,
    caption="Esquema general del modelo",
    label="fig:modelo"
)
```

#### `figure(figure, *, caption=None, label=None, width=None, height=None, dpi=200, caption_position="below", caption_label="Figura")`
Inserta una figura de Matplotlib con caption nativo de Word.
```python
import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.plot([1, 2, 3], [1, 4, 9])
builder.figure(fig, caption="Gráfico de ejemplo", label="fig:ejemplo")
```

#### `caption(text, *, label=None, number=False, caption_label="Figura")`
Inserta un caption independiente.
```python
builder.caption("Leyenda manual", label="cap:manual")  # texto plano

builder.caption(
    "Resultados del caso base",
    label="tbl:resultados",
    number=True,
    caption_label="Tabla"
)
```

**Comportamiento de captions nativos:**
- `figure()`, `image()`, `table()` y `dataframe()` usan campos Word `SEQ`.
- Por defecto, figuras/imágenes van con caption **abajo**.
- Por defecto, tablas/dataframes van con caption **arriba**.
- `caption(number=True)` activa numeración nativa; `caption(number=False)` conserva el modo texto plano.
- `caption_label` define la secuencia visible y Word (`Figura`, `Tabla`, etc.).

### 3.4. Tablas

#### `table(data, *, headers=None, style=None, autofit=True, caption=None, label=None, caption_position="above", caption_label="Tabla")`
Inserta una tabla.
```python
builder.table(
    [["A", "B"], ["1", "2"], ["3", "4"]],
    headers=["Col1", "Col2"],
    style=None,
    caption="Resultados principales",
    label="tbl:principales"
)
```

Con `style=None`, el runtime resuelve el slot `table_default` del template activo y luego reaplica defaults OOXML seguros sobre la tabla concreta. Pasa un nombre de estilo explícito solo cuando sea un requisito real del task.

#### `dataframe(df, *, style=None, index=False, number_format=None, max_rows=None, caption=None, label=None, caption_position="above", caption_label="Tabla")`
Convierte un DataFrame de Pandas a tabla DOCX.
```python
builder.dataframe(
    df,
    style=None,
    index=True,
    number_format={"precio": "#,##0.00"},
    caption="Resumen de combinaciones",
    label="tbl:combinaciones"
)
```

### 3.5. Estructura del Documento

#### `page_break()`
Inserta un salto de página.
```python
builder.page_break()
```

#### `section(*, orientation="portrait", page_size=None, margins=None)`
Crea una nueva sección con configuración de página.
```python
builder.section(orientation="landscape")
builder.section(
    page_size=(11, 8.5),  # Ancho x Alto en pulgadas
    margins={"top": 0.5, "bottom": 0.5, "left": 1, "right": 1}
)
```

#### `table_of_contents(*, depth=3, hyperlinks=True)`
Inserta una tabla de contenidos.
```python
builder.table_of_contents(depth=2)
```

### 3.6. Metadatos y Estilos

#### `metadata(*, title=None, subject=None, keywords=None)`
Configura propiedades del documento.
```python
builder.metadata(
    title="Mi Informe",
    subject="Análisis Técnico",
    keywords=["ingeniería", "análisis"]
)
```

#### `style(name, *, base="Normal", font=None, size_pt=None, bold=None, italic=None, spacing=None)`
Crea o modifica un estilo en casos avanzados o de template authoring.
```python
builder.style(
    "MiEstilo",
    base="Normal",
    font="Arial",
    size_pt=11,
    bold=False,
    spacing={"space_after_pt": 6}
)
```

Usa `style()` solo cuando realmente estés authorando la plantilla o resolviendo un caso excepcional. En notebooks de reporte normales, prefiere el contrato semántico del template y evita crear estilos ad hoc dentro de la celda.

#### `resolve_style_slot(slot_name)`
Devuelve el nombre del estilo Word activo para un slot semántico del template.
```python
body_style = builder.resolve_style_slot("body")
caption_style = builder.resolve_style_slot("caption")
```

Úsalo cuando necesites bajar a `builder.document` o `python-docx` sin hardcodear nombres Word.

#### `header(*, text=None, image=None)`
Configura el encabezado de página.
```python
builder.header(text="Informe Confidencial")
builder.header(image="logo.png")
```

#### `footer(*, text=None)`
Configura el pie de página.
```python
builder.footer(text="Página {PAGE} de {NUMPAGES}")
```

---

## 4. Acceso Nativo a `python-docx`

La propiedad `builder.document` expone el objeto `docx.document.Document`. Los elementos creados via acceso nativo **se rastrean automáticamente** y se limpian al re-ejecutar el bloque.

### 4.1. Acceso Básico

```python
with build_doc(block_id="nativo", order=10) as builder:
    doc = builder.document
    body_style = builder.resolve_style_slot("body")

    # Usar python-docx directamente
    p = doc.add_paragraph(style=body_style)
    p.add_run("Texto con formato manual")
    run = p.add_run(" en rojo")
    run.font.color.rgb = RGBColor(255, 0, 0)
```

### 4.2. Referencia Rápida de `Document`

| Método | Descripción |
|--------|-------------|
| `doc.add_paragraph(text, style)` | Añade párrafo |
| `doc.add_heading(text, level)` | Añade encabezado |
| `doc.add_table(rows, cols, style)` | Añade tabla |
| `doc.add_picture(path, width, height)` | Añade imagen |
| `doc.add_page_break()` | Añade salto de página |
| `doc.add_section(start_type)` | Añade sección |

| Propiedad | Descripción |
|-----------|-------------|
| `doc.paragraphs` | Lista de párrafos |
| `doc.tables` | Lista de tablas |
| `doc.sections` | Secciones del documento |
| `doc.styles` | Estilos disponibles |
| `doc.core_properties` | Metadatos (título, autor, etc.) |

### 4.3. Formateo de Runs

```python
run = p.add_run("Texto")
run.bold = True
run.italic = True
run.font.name = "Arial"
run.font.size = Pt(12)
run.font.color.rgb = RGBColor(0, 0, 255)
run.font.underline = True
run.font.superscript = True  # o subscript
```

### 4.4. Formato de Párrafo

```python
p = doc.add_paragraph("Texto")
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
pf = p.paragraph_format
pf.first_line_indent = Inches(0.5)
pf.space_before = Pt(12)
pf.space_after = Pt(12)
pf.line_spacing = 1.5
pf.keep_with_next = True
```

### 4.5. Tablas Nativas

```python
table = doc.add_table(rows=3, cols=2)
table.style = builder.resolve_style_slot("table_default") or "Table Grid"
table.autofit = False

cell = table.cell(0, 0)
cell.text = "Valor"
cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

# Fusionar celdas
a = table.cell(0, 0)
b = table.cell(0, 1)
a.merge(b)
```

### 4.6. Propiedades Completas de `Font`

```python
font = run.font
font.name = "Calibri"
font.size = Pt(11)
font.bold = True
font.italic = True
font.underline = True  # o WD_UNDERLINE.SINGLE, DOUBLE, etc.
font.strike = True     # Tachado
font.double_strike = True
font.subscript = True
font.superscript = True
font.all_caps = True
font.small_caps = True
font.shadow = True
font.outline = True
font.emboss = True
font.imprint = True
font.hidden = True
font.highlight_color = WD_COLOR_INDEX.YELLOW
font.color.rgb = RGBColor(255, 0, 0)
font.color.theme_color = MSO_THEME_COLOR.ACCENT_1
font.no_proof = True  # Omitir verificación ortográfica
```

### 4.7. Propiedades Completas de `ParagraphFormat`

```python
pf = p.paragraph_format
pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
pf.left_indent = Inches(0.5)
pf.right_indent = Inches(0.5)
pf.first_line_indent = Inches(0.25)  # Negativo para sangría colgante
pf.space_before = Pt(12)
pf.space_after = Pt(12)
pf.line_spacing = 1.5  # Multiplicador
pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY  # o SINGLE, DOUBLE, AT_LEAST
pf.keep_together = True   # No dividir párrafo entre páginas
pf.keep_with_next = True  # Mantener con siguiente párrafo
pf.page_break_before = True  # Salto de página antes
pf.widow_control = True  # Control de viudas/huérfanas
```

### 4.8. Configuración de Secciones

```python
section = doc.sections[-1]  # Última sección

# Orientación y tamaño
section.orientation = WD_ORIENTATION.LANDSCAPE
section.page_width = Inches(11)
section.page_height = Inches(8.5)

# Márgenes
section.top_margin = Inches(1)
section.bottom_margin = Inches(1)
section.left_margin = Inches(1.25)
section.right_margin = Inches(1.25)
section.gutter = Inches(0)  # Espacio para encuadernación
section.header_distance = Inches(0.5)
section.footer_distance = Inches(0.5)

# Encabezados/Pies diferenciados
section.different_first_page_header_footer = True
```

### 4.9. Metadatos del Documento (`CoreProperties`)

```python
props = doc.core_properties
props.author = "Nombre del Autor"
props.title = "Título del Documento"
props.subject = "Asunto"
props.keywords = "palabra1, palabra2"
props.category = "Categoría"
props.comments = "Comentarios"
props.content_status = "Borrador"  # o "Final"
props.language = "es-ES"
props.version = "1.0"
# Fechas (datetime objects)
from datetime import datetime
props.created = datetime.now()
props.modified = datetime.now()
```

---

## 5. Matemáticas Inline con `create_math_latex_element()`

Para insertar ecuaciones inline nuevas dentro de texto o en celdas de tabla:

```python
with build_doc(block_id="inline_math", order=10) as builder:
    doc = builder.document

    p = doc.add_paragraph("La fórmula ")
    math_xml = builder.create_math_latex_element(r"E = mc^2")
    p._p.append(math_xml)
    p.add_run(" es fundamental.")
```

### Ecuación en Celda de Tabla

```python
table = doc.add_table(2, 2)
cell = table.cell(1, 1)
p = cell.paragraphs[0]
math_xml = builder.create_math_latex_element(r"\sigma = \frac{F}{A}")
p._p.append(math_xml)
```

`create_math_latex_element()` es solo para inline. Si la fórmula es display o multilinea (`aligned`, `split`, `gather`, etc.), usa `builder.math_latex(...)`.

---

## 6. Unidades y Colores

Importar desde la API:
```python
from backend.librerias_propias.docx_builder.api import Inches, Cm, Pt, RGBColor
```

| Clase | Uso | Ejemplo |
|-------|-----|---------|
| `Inches(n)` | Pulgadas | `width=Inches(2.5)` |
| `Cm(n)` | Centímetros | `margin=Cm(2.54)` |
| `Mm(n)` | Milímetros | `indent=Mm(10)` |
| `Pt(n)` | Puntos (fuentes) | `size=Pt(12)` |
| `Emu(n)` | EMU (base) | Uso interno |
| `Twips(n)` | Twips | Uso interno |
| `RGBColor(r, g, b)` | Color RGB (0-255) | `RGBColor(255, 0, 0)` |

---

## 7. Enumeraciones Completas

```python
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.section import WD_ORIENTATION, WD_SECTION_START
from docx.enum.style import WD_STYLE_TYPE
```

### Alineación de Párrafo (`WD_ALIGN_PARAGRAPH`)
`LEFT`, `CENTER`, `RIGHT`, `JUSTIFY`, `DISTRIBUTE`, `THAI_JUSTIFY`

### Tipos de Salto (`WD_BREAK`)
`LINE`, `PAGE`, `COLUMN`, `LINE_CLEAR_LEFT`, `LINE_CLEAR_RIGHT`, `LINE_CLEAR_ALL`

### Interlineado (`WD_LINE_SPACING`)
`SINGLE`, `ONE_POINT_FIVE`, `DOUBLE`, `AT_LEAST`, `EXACTLY`, `MULTIPLE`

### Orientación (`WD_ORIENTATION`)
`PORTRAIT`, `LANDSCAPE`

### Inicio de Sección (`WD_SECTION_START`)
`NEW_PAGE`, `EVEN_PAGE`, `ODD_PAGE`, `CONTINUOUS`, `NEW_COLUMN`

### Alineación de Tabla (`WD_TABLE_ALIGNMENT`)
`LEFT`, `CENTER`, `RIGHT`

### Alineación Vertical de Celda (`WD_CELL_VERTICAL_ALIGNMENT`)
`TOP`, `CENTER`, `BOTTOM`, `BOTH`

### Tipos de Subrayado (`WD_UNDERLINE`)
`SINGLE`, `WORDS`, `DOUBLE`, `DOTTED`, `THICK`, `DASH`, `DOT_DASH`, `DOT_DOT_DASH`, `WAVY`, `WAVY_DOUBLE`

### Colores de Resaltado (`WD_COLOR_INDEX`)
`AUTO`, `BLACK`, `BLUE`, `BRIGHT_GREEN`, `DARK_BLUE`, `DARK_RED`, `DARK_YELLOW`, `GRAY_25`, `GRAY_50`, `GREEN`, `PINK`, `RED`, `TEAL`, `TURQUOISE`, `VIOLET`, `WHITE`, `YELLOW`

### Tipos de Estilo (`WD_STYLE_TYPE`)
`PARAGRAPH`, `CHARACTER`, `TABLE`, `LIST`

---

## 8. Manipulación XML de Bajo Nivel

Para funcionalidades no expuestas directamente por python-docx:

```python
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
```

### Ejemplo: Bordes de Celda Personalizados

```python
def set_cell_border(cell, **kwargs):
    """
    kwargs: top, bottom, left, right
    Cada uno es un dict con keys: sz, val, color, space
    Ejemplo: bottom={"sz": 12, "val": "single", "color": "FF0000"}
    """
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = OxmlElement('w:tcBorders')
    
    for edge, props in kwargs.items():
        tag = f'w:{edge}'
        element = OxmlElement(tag)
        for key, value in props.items():
            element.set(qn(f'w:{key}'), str(value))
        tcBorders.append(element)
    
    tcPr.append(tcBorders)

# Uso:
set_cell_border(cell, bottom={"sz": 12, "val": "single", "color": "FF0000"})
```

---

## 9. Patrones de Uso Recomendados

### Inicio de Notebook
```python
doc_reset(hard=True)  # Limpiar cualquier documento previo
```

### Bloque Típico con Mezcla de APIs
```python
with build_doc(block_id="mixto", order=50) as builder:
    # Alto nivel para estructura
    builder.heading("Resultados", level=2)
    
    # Bajo nivel para formato rico
    doc = builder.document
    p = doc.add_paragraph(style=builder.resolve_style_slot("body"))
    p.add_run("Valor crítico: ").bold = True
    math_xml = builder.create_math_latex_element(r"\sigma = 25.3")
    p._p.append(math_xml)
    p.add_run(" MPa (").italic = True
    p.add_run("superior al límite").font.color.rgb = RGBColor(255, 0, 0)
    p.add_run(")").italic = True
```

### Tabla con Formato Rico
```python
with build_doc(block_id="tabla_rica", order=60) as builder:
    builder.table(
        [[150, 0.93], [142, 0.88]],
        headers=["sigma_max", "utilización"],
        style=None,
        caption="Resultados del modelo",
        label="tbl:modelo"
    )
```

### Figura con Título y Referencia
```python
with build_doc(block_id="figura_con_caption", order=65) as builder:
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots()
    ax.plot([1, 2, 3], [1, 4, 9])
    builder.figure(
        fig,
        caption="Curva de respuesta del sistema",
        label="fig:respuesta"
    )
    plt.close(fig)

with build_doc(block_id="referencia_figura", order=66) as builder:
    builder.text("Ver figura ")
    builder.reference("fig:respuesta")
```

### Caso excepcional: estilos personalizados on-the-fly
```python
with build_doc(block_id="estilos", order=70) as builder:
    doc = builder.document
    styles = doc.styles
    
    if 'Disclaimer' not in [s.name for s in styles]:
        from docx.enum.style import WD_STYLE_TYPE
        style = styles.add_style('Disclaimer', WD_STYLE_TYPE.PARAGRAPH)
        style.base_style = styles['Normal']
        style.font.name = 'Consolas'
        style.font.size = Pt(8)
        style.font.color.rgb = RGBColor(100, 100, 100)
    
    doc.add_paragraph("Contenido autogenerado.", style='Disclaimer')
```

Este patrón es excepcional. En notebooks DOCX normales, deja que el template controle la materialización Word vía slots semánticos y evita crear estilos nuevos dentro de la celda.

### Exportación Final
```python
# Guardar a archivo
ruta = doc_export(format="path", path="output/informe.docx")

# O obtener bytes para enviar
bytes_docx = doc_export(format="bytes")
```

---

*Última actualización: 2026-04-19*
