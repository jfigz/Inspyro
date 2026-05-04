# Notebook Authoring

## Goal

Write notebooks that teach the reader what was done, why it was done, and how to interpret the result. The notebook should remain technically rigorous while staying easy to read for an engineer or informed user.

Use this file to design the notebook as a human-facing artifact. If the notebook also generates DOCX, combine this file with `docx-editorial.md` and `docx-guide-full.md`.

## Audience And Deliverables

Treat the Inspyro notebook as the internal engineering review artifact. The engineer may validate the work from notebook outputs without reading the implementation code, so the notebook must make the calculation path visible through clear inputs, intermediate checks, tables, plots, summaries, and interpretations.

Treat `.py` modules as the implementation layer. They may hold dense logic, helper functions, adapters, and formatting utilities, but the notebook must call them in a way that exposes enough evidence for review.

When the notebook generates a report, treat the DOCX as the external deliverable. It should not mention notebook internals, code, MCP, kernels, APIs, COM, runtime plumbing, or automation unless the user explicitly allows it through the project reporting policy.

## Output-First Rule

Use an output-first/result-first style. The notebook is oriented to Vibe coding in the product sense: the code can be compact and modular, but the outputs must be rich, robust, precise, and directly useful for engineering validation.

Every major calculation stage should output enough information to answer:

1. What inputs were used?
2. What method or criterion was applied?
3. What intermediate values or controlling cases matter?
4. Which checks pass, fail, or govern?
5. What conclusion should the engineer take from the result?

## First Cell Rule

Every notebook must start with a single markdown preface cell whose first line is:

```md
# 0. Resumen operativo e infraestructura de calculo
```

This cell is internal notebook documentation. It is not a reportable chapter, does not require a DOCX cell, and should not be copied into report-facing DOCX prose unless the user explicitly asks for it.

Keep this first cell current whenever files, code, inputs, configuration, calculation procedures, output/report generation, or execution order change. The same cell must contain:

````md
## 0.1. Resumen vigente
Objetivo, alcance, archivos clave y estado actual del proyecto.

## 0.2. Infraestructura de calculo
```text
entradas/config -> modulos .py -> notebook orchestration -> validaciones/outputs -> DOCX/PDF
```

## 0.3. Mantenimiento
Actualizar esta celda cuando cambien archivos, codigo, datos, configuracion, procedimientos o reportes.
````

Use a fenced `text` block or compact markdown table for the infrastructure diagram. Do not require Mermaid, because the current Inspyro markdown renderer uses `marked` and KaTeX but does not initialize Mermaid.

## Structural Pattern

Use this H1+H2 repeating pattern. A notebook with only H1 headings, unnumbered stages, or code directly below a chapter title is not conforming:

1. First markdown preface cell `# 0. Resumen operativo e infraestructura de calculo`
2. H1 markdown chapter title cell for the technical/reportable flow (`# 1.`, `# 2.`, etc.)
3. At least one H2 markdown subchapter title cell under every reportable H1 (`## 1.1.`, `## 2.1.`, etc.)
4. Optional explanation below that title, either in the same markdown cell or in a short follow-up markdown cell when clarity requires it
5. Python code cell (`cell_type: "code"`) under an H2/H3+ section for calculation, analysis, plotting, or data preparation
6. Reader-facing outputs
7. One DOCX report cell (`cell_type: "docx"`) only at the reportable H1 section level when the notebook generates the report contribution for that main section

Every calculation-only code cell must be introduced by an H2/H3+ markdown title in the same local block. Do not place calculation code directly under an H1 chapter.

Use H3+ headings when a subchapter contains multiple distinct checks, methods, plots, or result interpretations.

## Markdown Title Rule

The first line of the markdown title cell should be a hierarchical title with explicit numbering, for example:

```md
# 1. Objetivo y datos de entrada
## 1.1. Cargar parametros del caso base
### 1.1.1. Validar unidades y rangos
```

Keep the title descriptive. Use the explanation below the title to state assumptions, method, or interpretation when needed.

Do not use the title line as a cryptic label. It should be understandable without reading the code cell below.

Use the full hierarchy intentionally. The internal `# 0.` heading defines the notebook preface. Reportable H1 headings (`# 1.`, `# 2.`, etc.) define the main review/report sections. H2/H3 headings (`## 1.1.`, `### 1.1.1.`, etc.) define detailed calculation stages, assumptions, checks, and result interpretation.

Every reportable H1 must contain at least one H2. For very small notebooks, still create one concise H2 such as `## 1.1. Revision del caso` rather than placing code directly under `# 1.`.

## Code Cell Rule

- Write notebook code in Python.
- Use `cell_type: "code"` for calculation and analysis cells.
- Use `cell_type: "docx"` for cells that write, reset, finalize, or otherwise mutate the DOCX report, but only at the reportable H1 granularity by default.
- Place calculation and analysis code under H2/H3+ sections, not directly under H1 chapter headings.
- Keep each code cell focused on orchestration, not deep implementation.
- Import reusable logic from `.py` modules when the code is long, repeated, or hard to scan.
- Use the notebook to wire inputs, run the calculation, and present outputs clearly.
- Keep code cells small enough that a reviewer can understand their role quickly.
- When a cell only exists to define helper functions, that is usually a sign the logic belongs in a module.

## Output Style

Prefer outputs that help the reader understand the procedure:

- labeled `print()` summaries for key steps and results
- explicit echoes of controlling inputs, units, assumptions, and selected criteria
- readable DataFrames with public column names
- plots with titles, axes labels, legends, and units when relevant
- compact summary tables for comparisons, envelopes, checks, or conclusions
- pass/fail or demand/capacity check tables when verification logic is involved
- governing-case summaries that identify the controlling element, load case, combination, section, or limit state
- short textual interpretation after a non-obvious result
- clear transitions between input, processing, result, and conclusion

## DOCX Cell Rule

DOCX cells are still Python cells, but they are report-generation cells with a distinct notebook type. Mark them as `cell_type: "docx"` in MCP payloads and `.ipynb` structure whenever they call `doc_reset`, `build_doc`, `doc_finalize`, `builder.document`, `math_latex()`, or report table/figure/caption helpers. This lets calculation iterations run with `include_docx=false` without paying the cost of report generation.

Use one DOCX cell per reportable H1 (`una celda DOCX por H1`): create exactly one DOCX cell for each main markdown section `# 1.`, `# 2.`, etc. Put that section's DOCX report contribution inside this single cell, using stable `build_doc(block_id=..., order=...)` blocks as needed. Do not create a DOCX cell for the internal `# 0.` preface. Do not create separate DOCX cells for `1.1`, `1.1.1`, or deeper subsections unless the user explicitly authorizes an exception.

Subsections should normally contain markdown explanation, calculation code cells, and rich outputs. The H1 DOCX cell should summarize the deliverable-ready report content for that main section, drawing from the computed objects and outputs.

## Reader Questions To Answer

For each major section, make sure the notebook answers these questions:

1. What is being done in this stage?
2. Why is this stage needed?
3. What are the key inputs or assumptions?
4. What should the reader look at in the output?
5. What does the result mean?
6. Is the evidence sufficient for an engineer to validate the result without reading the code?

## Public Naming

- Rename variables and table columns for display when internal names are cryptic.
- Prefer engineering labels such as `momento maximo`, `razon demanda/capacidad`, or `desplazamiento horizontal`.
- Avoid exposing raw runtime names such as `ratio_M`, `rho_max`, `eta_comp`, or similar as the notebook's public language.
- If you must preserve a raw identifier for traceability, relegate it to a secondary column, note, or mapping table.

## When To Extract A Module

Move logic into a `.py` file when any of these are true:

- the cell is long enough that the reader has to scroll to understand it
- the same computation is reused in more than one place
- the cell mixes business logic, data cleaning, formatting, and plotting
- the notebook would be clearer if the cell simply called a named function

## Refactor Strategy

When improving an existing notebook:

1. Identify which cells are reader-facing and which are implementation clutter.
2. Add or update the first `# 0.` preface cell so it reflects the current files, procedures, execution flow, and report outputs.
3. Preserve the analytical storyline.
4. Move helper logic, repeated calculations, and opaque transformations into `.py`.
5. Replace long code cells with small orchestration cells that call named functions.
6. Strengthen outputs before shortening code; the refactor succeeds only if the review evidence remains visible.
7. Introduce or repair the H1+H2 hierarchy so every reportable H1 has at least one subchapter and calculation cells sit under H2/H3+ headings.
8. Add markdown transitions where the reader would otherwise have to infer intent.
9. Consolidate report-writing cells so each reportable H1 section has at most one DOCX cell.

## Minimal Skeleton

````md
# 0. Resumen operativo e infraestructura de calculo

## 0.1. Resumen vigente
Objetivo, alcance, archivos clave y estado actual del proyecto.

## 0.2. Infraestructura de calculo
```text
entradas/config -> modulos .py -> notebook orchestration -> validaciones/outputs -> DOCX/PDF
```

## 0.3. Mantenimiento
Actualizar esta celda si cambian archivos, codigo, datos, configuracion, procedimientos o reportes.
````

```md
# 1. Alcance del analisis
Breve explicacion del objetivo, entradas y criterio de salida.
```

```md
## 1.1. Ejecutar caso base
Explicar que se calculara y que salida debe revisar el lector.
```

```python
from project.calculos import ejecutar_modelo

resultado = ejecutar_modelo(parametros)
print("Caso analizado:", resultado.nombre)
print("Factor de utilizacion maximo:", resultado.utilizacion_maxima)
```

```md
## 1.2. Interpretacion de resultados
Explicar que muestra la tabla o grafico que sigue y por que importa.
```

## Do Not

- Do not start a notebook with code or with `# 1.`; the first cell must be the internal `# 0.` markdown preface.
- Do not create a DOCX cell for `# 0.` unless the user explicitly asks to make the preface report-facing.
- Do not use Mermaid as a required diagram format for this cell; prefer a fenced `text` flow or compact markdown table.
- Do not leave a code cell without its markdown title cell.
- Do not create a flat notebook. Every reportable H1 must have at least one H2, even when the notebook is short.
- Do not place calculation-only code cells directly below an H1 chapter title; put them under H2/H3+ headings.
- Do not use the notebook as a dump of internal helper code that belongs in a module.
- Do not hide engineering evidence inside code or helper modules; surface the relevant checks, assumptions, intermediate values, and conclusions as outputs.
- Do not rely on hidden knowledge from the repo when a short markdown explanation can make the notebook self-explanatory.
- Do not present outputs without context when the reader needs to know what was calculated or how to read it.
- Do not add DOCX cells under `1.1`, `1.1.1`, or deeper subsections unless the user explicitly asked for that exception.
- Do not confuse "more code" with "more explanation"; the notebook should expose intent, not implementation noise.
