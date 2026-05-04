# Guia DOCX Completa Para La Skill Inspyro Notebook Authoring

**PROPOSITO EN ESTA SKILL:** usar toda la API DOCX de Inspyro para escribir notebooks y reportes tecnicos legibles, bien estructurados y suficientemente ricos en formato, sin depender de intuiciones parciales sobre `build_doc`, `python-docx` o XML OOXML.

**CUANDO LEER ESTE ARCHIVO:**

- antes de escribir o refactorizar cualquier celda DOCX
- cuando el notebook use `build_doc`, `doc_reset`, `doc_export`, `doc_finalize`, `math_latex()`, `builder.document`, captions, tablas o figuras
- cuando necesites bajar a `python-docx` o a OOXML de bajo nivel
- cuando quieras mantener la skill autosuficiente sin volver a abrir `LLM_GUIDE_DOCX.md`

**RELACION CON LAS OTRAS REFERENCIAS DE LA SKILL:**

- `mcp-workflow.md` decide como crear, cargar, sincronizar, ejecutar y guardar el notebook.
- `notebook-authoring.md` decide como debe leerse el notebook para un usuario.
- `docx-editorial.md` decide el tono, la explicacion y la adaptacion editorial del reporte.
- Este archivo decide como usar la API DOCX completa cuando el notebook genera documento.

> Nota de mantenimiento: este archivo es una copia adaptada de `LLM_GUIDE_DOCX.md` en la raiz del repo. Si esa fuente cambia, refresca esta copia en la misma sesion.

> Estandar actual para ecuaciones: usa `builder.math_latex(...)` y `builder.create_math_latex_element(...)`.
> 
> Criterio practico de uso: usa wrappers de alto nivel para estructura comun, captions, tablas, figuras y ecuaciones. Baja a `builder.document`, `python-docx` o XML low-level solo cuando los wrappers no entreguen el control requerido.
> 
> Nota de render actual: matrices (`bmatrix`, `Bmatrix`, `vmatrix`, `Vmatrix`), `cases` y fences `\left...\right` soportados (`()`, `[]`, `{}`, `|`, `\|`, `\langle...\rangle`) salen con delimitadores extensibles nativos de Word; los fences respetan parentesis anidados y llegan a OMML como un unico operando cuando representan una agrupacion.
> 
> Nota de render Word: el postproceso OMML rellena operandos vacios de `\sum`, `\prod` y `\int` cuando la transformacion deja huecos dentro de delimitadores altos, evitando cuadros placeholder en Word.
> 
> Contrato Word-first: usa wrappers de alto nivel como capa semantica neutral y deja que el template activo materialice el estilo Word final; baja a `builder.document` solo cuando haga falta, resolviendo antes el slot semantico correspondiente.
>
> Calidad DOCX actual: usa `doc_finalize(profile="delivery")` dentro del notebook para una revision compacta local, y usa MCP `check_document_quality(run=true, profile="agent")` despues de exportar cuando el agente deba corregir el documento sin cargar binarios, renders ni XML raw en contexto.

---

## 1. Arquitectura del Sistema de Bloques

El sistema DOCX usa un **modelo de bloques** para permitir edicion colaborativa en notebooks. Cada bloque de codigo que genera contenido DOCX se identifica con un `block_id` y un `order`.

### 1.1. Funcion Principal: `build_doc()`

```python
with build_doc(
    block_id: str = None,      # Identificador unico del bloque
    order: int,                 # OBLIGATORIO: Posicion relativa en el documento
    auto_clear: bool = True,    # Limpiar contenido previo al re-ejecutar
    strict: bool = False,       # Lanzar excepciones en lugar de warnings
    cell_id: str = None,        # Alias de block_id (compatibilidad)
    notebook_cell_id: str = None,  # ID de celda del notebook (uso interno)
) as builder:
    # Tu codigo aqui
```

**Parametros detallados:**

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `block_id` | `str` | Identificador unico. Si se omite, se genera automaticamente. Es mejor generar uno manualmente para evitar errores y ser descriptivo. **Usar el mismo ID permite re-ejecutar sin duplicar contenido.** |
| `order` | `int` | **OBLIGATORIO.** Define la posicion del bloque en el documento final. Bloques con `order` menor aparecen primero. |
| `auto_clear` | `bool` | Si `True` (default), al re-ejecutar el bloque se eliminan los elementos previos de ese `block_id`. |
| `strict` | `bool` | Si `True`, errores de validacion lanzan excepciones en lugar de warnings. |

### 1.2. Ejemplo de Multiples Bloques

```python
# Bloque 1: Portada
with build_doc(block_id="portada", order=10) as builder:
    builder.heading("Informe Tecnico", level=1)
    builder.metadata(title="Informe Tecnico", subject="Analisis")

# Bloque 2: Introduccion
with build_doc(block_id="intro", order=20) as builder:
    builder.heading("Introduccion", level=2)
    builder.text("Este documento describe...")

# Bloque 3: Contenido (puede re-ejecutarse sin afectar los anteriores)
with build_doc(block_id="contenido", order=30) as builder:
    builder.heading("Analisis", level=2)
    # ... mas contenido
```

En esta skill, usa bloques estables y `order` coherente con la narrativa del notebook y del reporte. Si el notebook es incremental, piensa el documento como una secuencia publica, no como una sucesion de celdas casuales.

---

## 2. Funciones de Control

### 2.1. `doc_reset()`

Reinicia el documento.

```python
doc_reset(hard: bool = False)
```

| Parametro | Descripcion |
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

En notebooks Inspyro, el flujo normal suele terminar en `get_document_docx` o `get_document_pdf` via MCP. Usa `doc_export()` solo cuando el task lo requiera explicitamente o cuando estes trabajando fuera del flujo habitual de artefactos.

### 2.3. `doc_finalize()`

Ejecuta una auditoria DOCX local y compacta sobre el documento actual antes de entregarlo.

```python
doc_finalize(profile: str = "delivery", detail: str = "summary") -> dict
```

| Parametro | Descripcion |
|-----------|-------------|
| `profile` | Perfil de revision: `quick`, `agent`, `delivery`, `visual` o `publishing`. |
| `detail` | `summary` devuelve estado, score, counts y hasta 12 findings; `full` devuelve el summary completo sin binarios. |

Uso recomendado al final de un pipeline de reporte:

```python
quality = doc_finalize(profile="delivery")
print(quality["status"], quality["score"], quality["counts"])
for finding in quality.get("findings", []):
    print(finding["severity"], finding["section"], finding["message"])
```

`doc_finalize()` no reemplaza el artefacto ni genera una copia limpia. Para variantes de publicacion usa MCP `prepare_document_delivery` o Workbench despues de exportar.

---

## 3. Metodos del Builder (Alto Nivel)

Todos los metodos retornan `self` para permitir encadenamiento.

### 3.1. Contenido de Texto

#### `heading(text, *, level=1, style=None)`

Inserta un encabezado.

```python
builder.heading("Titulo Principal", level=1)
builder.heading("Subtitulo", level=2)
```

Con `style=None`, el runtime intenta resolver `heading_{level}` desde el template activo antes de caer al fallback tradicional.

#### `text(text, *, style=None, bold=False, italic=False, underline=False, align=None)`

Inserta un parrafo.

```python
builder.text("Texto normal")
builder.text("Texto importante", bold=True, align="center")
```

Para notebooks DOCX Word-first, `style=None` es la ruta canonica para cuerpo: el runtime resuelve el slot semantico `body` del template activo. No uses `style="Normal"` como convencion publica de authoring.

#### `list(items, *, ordered=False)`

Inserta una lista.

```python
builder.list(["Item 1", "Item 2", "Item 3"])
builder.list(["Primero", "Segundo"], ordered=True)
# Multinivel: tuplas (nivel, texto)
builder.list([(0, "Principal"), (1, "Sub-item")])
```

Con `ordered=False` se prioriza el slot `list_bullet`; con `ordered=True`, el slot `list_number`.

#### `code(text, *, language=None)`

Inserta codigo con fuente monoespaciada.

```python
builder.code("def hello():\n    print('Hello')", language="python")
```

Cuando no pasas un estilo explicito, `code()` intenta resolver el slot semantico `code` del template.

#### `link(text, url)`

Inserta un hipervinculo.

```python
builder.link("Ver mas", "https://example.com")
```

### 3.2. Matematicas

#### `math_latex(expression, *, label=None, number=False)`

Inserta una ecuacion usando **LaTeX matematico** y la convierte a OMML nativo.

```python
builder.math_latex(r"E = mc^2")
builder.math_latex(r"\frac{-b + \sqrt{b^2 - 4ac}}{2a}", label="eq:newton", number=True)
builder.math_latex(r"\begin{aligned}M &= \frac{wL^2}{8}\\V &= \frac{wL}{2}\end{aligned}")
```

Usa esta ruta por defecto cuando necesites ecuaciones nuevas. Acepta expresiones con o sin delimitadores (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) y soporta LaTeX **math-only**:

- Fracciones, raices, super/subindices.
- Integrales, sumatorias, productorias y limites.
- Matrices, `cases`, `aligned`, `split`, `gather` y delimitadores matematicos.
- `bmatrix`, `Bmatrix`, `vmatrix`, `Vmatrix`, `cases` y fences `\left...\right` soportados (`()`, `[]`, `{}`, `|`, `\|`, `\langle...\rangle`) se normalizan a delimitadores extensibles OMML con emparejamiento anidado y un unico operando para agrupaciones.
- Si la transformacion OMML deja un operador n-ario sin cuerpo dentro de un delimitador alto, el postproceso recoloca el operando correcto para que Word no muestre cuadros placeholder.
- `\text{...}` corto dentro de la formula.

No usar en `math_latex()`:

- `\section`, `\textbf`, `\caption`, `\includegraphics`, `\newcommand`, TikZ o preambulos.
- Para formato del documento usa la API DOCX o `builder.document`.

#### `EquationLatex(expression, *, label=None, number=False)`

Alias funcional de `builder.math_latex(...)`.

```python
with build_doc(block_id="ecuaciones", order=20, strict=True):
    EquationLatex(r"\frac{M y}{I}", label="eq:flexion", number=True)
    Reference("eq:flexion")
```

Usalo cuando estes escribiendo celdas DOCX en estilo funcional, junto a aliases como `Heading(...)`, `Text(...)` o `Reference(...)`. No agrega capacidades nuevas: internamente termina en la misma ruta `math_latex(...)`.

#### `reference(label)`

Inserta referencia a una ecuacion/figura.

```python
builder.reference("eq:newton")  # Genera "(1)" si es la ecuacion 1
```

Cuando `label` apunta a un caption numerado (`figure`, `image`, `table`, `dataframe` o `caption(number=True)`), la referencia resuelve al **numero del objeto**.

### 3.3. Imagenes y Figuras

#### `image(image, *, width=None, height=None, align="center", caption=None, label=None, alt_text=None, caption_position="below", caption_label="Figura")`

Inserta una imagen. Puede generar caption nativo de Word automaticamente.

```python
builder.image("ruta/imagen.png", width=4.0)
builder.image(pil_image, width=5.0, align="left")
builder.image(numpy_array, width=6.0)
builder.image(
    "salida.png",
    width=5.0,
    caption="Esquema general del modelo",
    label="fig:modelo",
    alt_text="Esquema general del modelo estructural"
)
```

Usa `alt_text` en imagenes que transmiten informacion. La auditoria de accesibilidad del Workbench lo usa para distinguir figuras listas de figuras que requieren descripcion.

#### `figure(figure, *, caption=None, label=None, width=None, height=None, alt_text=None, dpi=200, caption_position="below", caption_label="Figura")`

Inserta una figura de Matplotlib con caption nativo de Word.

```python
import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.plot([1, 2, 3], [1, 4, 9])
builder.figure(
    fig,
    caption="Grafico de ejemplo",
    label="fig:ejemplo",
    alt_text="Curva de ejemplo con crecimiento cuadratico"
)
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
- Por defecto, figuras/imagenes van con caption **abajo**.
- Por defecto, tablas/dataframes van con caption **arriba**.
- `caption(number=True)` activa numeracion nativa; `caption(number=False)` conserva el modo texto plano.
- `caption_label` define la secuencia visible y Word (`Figura`, `Tabla`, etc.).

### 3.4. Tablas

#### `table(data, *, headers=None, style=None, autofit=True, caption=None, label=None, caption_position="above", caption_label="Tabla", repeat_header_row=True, column_widths=None, cell_padding_twips=None, vertical_align="center")`

Inserta una tabla.

```python
builder.table(
    [["A", "B"], ["1", "2"], ["3", "4"]],
    headers=["Col1", "Col2"],
    style=None,
    repeat_header_row=True,
    column_widths=[2.0, 2.0],
    caption="Resultados principales",
    label="tbl:principales"
)
```

Para authoring Word-first, `style=None` es el default recomendado: el runtime resuelve el slot `table_default` del template y reaplica sus defaults OOXML seguros. Usa un nombre concreto solo cuando el task requiera fijar una tabla Word especifica.

`repeat_header_row=True` mantiene legibles las tablas largas al paginar. Usa `column_widths` en pulgadas, `cell_padding_twips` para padding OOXML explicito, y `vertical_align` con `top`, `center` o `bottom`.

#### `dataframe(df, *, style=None, index=False, number_format=None, max_rows=None, caption=None, label=None, caption_position="above", caption_label="Tabla", repeat_header_row=True, column_widths=None, cell_padding_twips=None, vertical_align="center")`

Convierte un DataFrame de Pandas a tabla DOCX.

```python
builder.dataframe(
    df,
    style=None,
    index=True,
    number_format={"precio": "#,##0.00"},
    caption="Resumen de combinaciones",
    label="tbl:combinaciones",
    repeat_header_row=True
)
```

`dataframe()` sigue la misma regla: si `style=None`, usa el slot `table_default`; si pasas `style=...`, ese valor gana por compatibilidad.

### 3.5. Estructura del Documento

#### `page_break()`

Inserta un salto de pagina.

```python
builder.page_break()
```

#### `section(*, orientation="portrait", page_size=None, margins=None)`

Crea una nueva seccion con configuracion de pagina.

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
    subject="Analisis Tecnico",
    keywords=["ingenieria", "analisis"]
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

Usa `style()` solo para template authoring o casos avanzados justificados. En notebooks de reporte normales, prefiere el contrato semantico del template y evita crear estilos ad hoc dentro de la celda.

#### `resolve_style_slot(slot_name)`

Devuelve el nombre del estilo Word activo para un slot semantico del template.

```python
body_style = builder.resolve_style_slot("body")
caption_style = builder.resolve_style_slot("caption")
```

Usa este helper cuando necesites bajar a `builder.document` o `python-docx` sin hardcodear nombres Word.

#### `header(*, text=None, image=None)`

Configura el encabezado de pagina.

```python
builder.header(text="Informe Confidencial")
builder.header(image="logo.png")
```

#### `footer(*, text=None)`

Configura el pie de pagina.

```python
builder.footer(text="Pagina {PAGE} de {NUMPAGES}")
```

En la mayoria de los notebooks de reporte, los wrappers de esta seccion son la primera opcion. Baja a `builder.document` cuando el control de `python-docx` sea necesario para resolver un caso concreto de formato o estructura.

---

## 4. Acceso Nativo a `python-docx`

La propiedad `builder.document` expone el objeto `docx.document.Document`. Los elementos creados via acceso nativo **se rastrean automaticamente** y se limpian al re-ejecutar el bloque.

### 4.1. Acceso Basico

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

### 4.2. Referencia Rapida de `Document`

| Metodo | Descripcion |
|--------|-------------|
| `doc.add_paragraph(text, style)` | Anade parrafo |
| `doc.add_heading(text, level)` | Anade encabezado |
| `doc.add_table(rows, cols, style)` | Anade tabla |
| `doc.add_picture(path, width, height)` | Anade imagen |
| `doc.add_page_break()` | Anade salto de pagina |
| `doc.add_section(start_type)` | Anade seccion |

| Propiedad | Descripcion |
|-----------|-------------|
| `doc.paragraphs` | Lista de parrafos |
| `doc.tables` | Lista de tablas |
| `doc.sections` | Secciones del documento |
| `doc.styles` | Estilos disponibles |
| `doc.core_properties` | Metadatos (titulo, autor, etc.) |

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

### 4.4. Formato de Parrafo

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
font.no_proof = True  # Omitir verificacion ortografica
```

### 4.7. Propiedades Completas de `ParagraphFormat`

```python
pf = p.paragraph_format
pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
pf.left_indent = Inches(0.5)
pf.right_indent = Inches(0.5)
pf.first_line_indent = Inches(0.25)  # Negativo para sangria colgante
pf.space_before = Pt(12)
pf.space_after = Pt(12)
pf.line_spacing = 1.5  # Multiplicador
pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY  # o SINGLE, DOUBLE, AT_LEAST
pf.keep_together = True   # No dividir parrafo entre paginas
pf.keep_with_next = True  # Mantener con siguiente parrafo
pf.page_break_before = True  # Salto de pagina antes
pf.widow_control = True  # Control de viudas/huerfanas
```

### 4.8. Configuracion de Secciones

```python
section = doc.sections[-1]  # Ultima seccion

# Orientacion y tamano
section.orientation = WD_ORIENTATION.LANDSCAPE
section.page_width = Inches(11)
section.page_height = Inches(8.5)

# Margenes
section.top_margin = Inches(1)
section.bottom_margin = Inches(1)
section.left_margin = Inches(1.25)
section.right_margin = Inches(1.25)
section.gutter = Inches(0)  # Espacio para encuadernacion
section.header_distance = Inches(0.5)
section.footer_distance = Inches(0.5)

# Encabezados/Pies diferenciados
section.different_first_page_header_footer = True
```

### 4.9. Metadatos del Documento (`CoreProperties`)

```python
props = doc.core_properties
props.author = "Nombre del Autor"
props.title = "Titulo del Documento"
props.subject = "Asunto"
props.keywords = "palabra1, palabra2"
props.category = "Categoria"
props.comments = "Comentarios"
props.content_status = "Borrador"  # o "Final"
props.language = "es-ES"
props.version = "1.0"
# Fechas (datetime objects)
from datetime import datetime
props.created = datetime.now()
props.modified = datetime.now()
```

Usa acceso nativo cuando necesites control fino. No lo uses para convertir el notebook en una demostracion de `python-docx`; el criterio sigue siendo claridad tecnica y estructura correcta del reporte.

---

## 5. Matematicas Inline con `create_math_latex_element()`

Para insertar ecuaciones inline nuevas dentro de texto o en celdas de tabla:

```python
with build_doc(block_id="inline_math", order=10) as builder:
    doc = builder.document

    p = doc.add_paragraph("La formula ")
    math_xml = builder.create_math_latex_element(r"E = mc^2")
    p._p.append(math_xml)
    p.add_run(" es fundamental.")
```

### Ecuacion en Celda de Tabla

```python
table = doc.add_table(2, 2)
cell = table.cell(1, 1)
p = cell.paragraphs[0]
math_xml = builder.create_math_latex_element(r"\sigma = \frac{F}{A}")
p._p.append(math_xml)
```

`create_math_latex_element()` es solo para inline. Si la formula es display o multilinea (`aligned`, `split`, `gather`, etc.), usa `builder.math_latex(...)`.

---

## 6. Unidades y Colores

Importar desde la API:

```python
from backend.librerias_propias.docx_builder.api import Inches, Cm, Pt, RGBColor
```

| Clase | Uso | Ejemplo |
|-------|-----|---------|
| `Inches(n)` | Pulgadas | `width=Inches(2.5)` |
| `Cm(n)` | Centimetros | `margin=Cm(2.54)` |
| `Mm(n)` | Milimetros | `indent=Mm(10)` |
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

### Alineacion de Parrafo (`WD_ALIGN_PARAGRAPH`)

`LEFT`, `CENTER`, `RIGHT`, `JUSTIFY`, `DISTRIBUTE`, `THAI_JUSTIFY`

### Tipos de Salto (`WD_BREAK`)

`LINE`, `PAGE`, `COLUMN`, `LINE_CLEAR_LEFT`, `LINE_CLEAR_RIGHT`, `LINE_CLEAR_ALL`

### Interlineado (`WD_LINE_SPACING`)

`SINGLE`, `ONE_POINT_FIVE`, `DOUBLE`, `AT_LEAST`, `EXACTLY`, `MULTIPLE`

### Orientacion (`WD_ORIENTATION`)

`PORTRAIT`, `LANDSCAPE`

### Inicio de Seccion (`WD_SECTION_START`)

`NEW_PAGE`, `EVEN_PAGE`, `ODD_PAGE`, `CONTINUOUS`, `NEW_COLUMN`

### Alineacion de Tabla (`WD_TABLE_ALIGNMENT`)

`LEFT`, `CENTER`, `RIGHT`

### Alineacion Vertical de Celda (`WD_CELL_VERTICAL_ALIGNMENT`)

`TOP`, `CENTER`, `BOTTOM`, `BOTH`

### Tipos de Subrayado (`WD_UNDERLINE`)

`SINGLE`, `WORDS`, `DOUBLE`, `DOTTED`, `THICK`, `DASH`, `DOT_DASH`, `DOT_DOT_DASH`, `WAVY`, `WAVY_DOUBLE`

### Colores de Resaltado (`WD_COLOR_INDEX`)

`AUTO`, `BLACK`, `BLUE`, `BRIGHT_GREEN`, `DARK_BLUE`, `DARK_RED`, `DARK_YELLOW`, `GRAY_25`, `GRAY_50`, `GREEN`, `PINK`, `RED`, `TEAL`, `TURQUOISE`, `VIOLET`, `WHITE`, `YELLOW`

### Tipos de Estilo (`WD_STYLE_TYPE`)

`PARAGRAPH`, `CHARACTER`, `TABLE`, `LIST`

---

## 8. Manipulacion XML de Bajo Nivel

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

Usa esta capa solo cuando realmente necesites control que ni los wrappers ni `python-docx` expongan de forma suficiente. Mantener el documento correcto vale mas que mantenerlo "puramente high-level".

---

## 9. Patrones de Uso Recomendados

### Inicio de Notebook

```python
doc_reset(hard=True)  # Limpiar cualquier documento previo
```

### Bloque Tipico con Mezcla de APIs

```python
with build_doc(block_id="mixto", order=50) as builder:
    # Alto nivel para estructura
    builder.heading("Resultados", level=2)

    # Bajo nivel para formato rico
    doc = builder.document
    p = doc.add_paragraph(style=builder.resolve_style_slot("body"))
    p.add_run("Valor critico: ").bold = True
    math_xml = builder.create_math_latex_element(r"\sigma = 25.3")
    p._p.append(math_xml)
    p.add_run(" MPa (").italic = True
    p.add_run("superior al limite").font.color.rgb = RGBColor(255, 0, 0)
    p.add_run(")").italic = True
```

### Tabla con Formato Rico

```python
with build_doc(block_id="tabla_rica", order=60) as builder:
    builder.table(
        [[150, 0.93], [142, 0.88]],
        headers=["sigma_max", "utilizacion"],
        style=None,
        caption="Resultados del modelo",
        label="tbl:modelo"
    )
```

### Figura con Titulo y Referencia

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

### Excepcion justificada: estilos personalizados on-the-fly

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

Este patron es excepcional. En notebooks DOCX normales, deja que el template controle la materializacion Word via slots semanticos y evita crear estilos nuevos dentro de la celda.

### Exportacion Final

```python
# Guardar a archivo
ruta = doc_export(format="path", path="output/informe.docx")

# O obtener bytes para enviar
bytes_docx = doc_export(format="bytes")
```

## 10. Criterio De Uso Dentro De Esta Skill

Usa esta guia completa con estos criterios:

1. Arranca por los wrappers cuando el caso sea comun: headings, text, tables, dataframes, figures, image, caption, reference, `math_latex()`.
2. Baja a `builder.document` cuando necesites control de runs, parrafos, tablas, secciones o metadatos.
3. Baja a OOXML low-level cuando `python-docx` tampoco alcance.
4. Manten siempre el foco en el documento tecnico final y en la legibilidad para el usuario del notebook y del reporte.
5. Si una solucion low-level mejora el control pero vuelve ilegible el notebook, considera mover esa logica a un modulo `.py` y dejar en la celda solo la llamada orquestadora.

---

*Ultima actualizacion de la copia adaptada: 2026-04-25*
