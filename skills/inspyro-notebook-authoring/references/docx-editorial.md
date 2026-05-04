# DOCX Editorial Rules

## Goal

Use Inspyro's DOCX pipeline to produce report-oriented notebook content that reads like engineering documentation, not like notebook internals.

This file is the short editorial layer. Use it together with `docx-guide-full.md`, which contains the full adapted API and implementation reference.

In this skill, the notebook is the internal engineering review artifact and the DOCX is the external deliverable by default. Keep that boundary explicit: the notebook may expose rich validation outputs for the engineer, but the report should expose only deliverable-ready engineering content.

## Read First

- Read `docx-guide-full.md` before writing or refactoring any DOCX cell.
- Refresh `docx-guide-full.md` from the repo root `LLM_GUIDE_DOCX.md` when you are explicitly updating the skill copy.
- If the notebook is part of a formal report workflow, distill reusable editorial rules from the local report standard, but do not hardcode project-specific chapter trees unless the task explicitly requires them.
- Before drafting report prose, ask what project artifacts may be mentioned and record the decision in the particular project's `docs/reporting-policy.md`.

## Base DOCX Pattern

1. Mark every report-writing cell as `cell_type: "docx"` in the notebook/MCP payload.
2. Start the document pipeline with `doc_reset(hard=True)` once near the beginning.
3. Write each DOCX contribution inside `build_doc(block_id=..., order=...)`.
4. Keep `block_id` stable across re-executions.
5. Keep `order` coherent with the report sequence.
6. Use `math_latex()` for new display equations and `create_math_latex_element()` for inline math.
7. Keep supported `\left...\right` fences in LaTeX equations. Inspyro normalizes nested grouped fences to extensible OMML delimiters with a single operand, so do not remove the fences, split the equation, fake delimiters as text, or render the equation as an image to avoid Word artifacts.

Use one DOCX cell per H1 (`una celda DOCX por H1`) by default. Each main notebook section `# 1.`, `# 2.`, etc. owns exactly one DOCX cell, and that cell may contain multiple stable `build_doc(...)` blocks for the section. Do not create DOCX cells for `1.1`, `1.1.1`, or deeper subsections unless the user explicitly authorizes the exception.

## Project Mention Policy

Before writing report text, resolve and document what the report may mention. Store the answer in the particular project's `docs/reporting-policy.md` so later agents do not rediscover the same editorial boundary.

The policy should explicitly cover:

1. Allowed deliverable artifacts, such as SAP2000 models, calculation memoranda, drawings, standards, appendices, data files, or external software models.
2. Forbidden internal artifacts, such as notebooks, source code, MCP, kernels, APIs, COM, runtime plumbing, automation scripts, temporary files, and agent workflow details.
3. Any allowed exception where the user wants a normally internal artifact mentioned in the DOCX.

If the policy is missing and the user is unavailable, use the conservative default: mention only engineering inputs/results and clearly deliverable artifacts, and do not mention notebook/code/runtime internals.

## User-Facing Writing Rules

- Write for the engineer or report reader, not for the runtime.
- Explain the technical meaning of each stage, not the implementation mechanism.
- Do not mention code, notebooks, kernels, APIs, MCP, COM, runtimes, notebook plumbing, temporary artifacts, agent workflow, or internal automation in public prose unless `docs/reporting-policy.md` or the user explicitly allows it.
- It is acceptable to mention deliverable-facing artifacts, such as a SAP2000 model, drawings, standards, memoranda, or appendices, when the project mention policy allows them.
- Use descriptive engineering labels instead of raw code names.

## Tables, Figures, And Equations

- Every table and every figure should have a title or caption.
- Add at least one short paragraph of technical context before or after each table, figure, or equation block.
- Keep captions descriptive and public-facing.
- For formal report notebooks, recommend a source line below the object. Use `Fuente: elaboracion propia.` unless an external source must be named explicitly.
- Let the active Word template control most visual appearance; do not over-format tables directly unless precise control is required for correctness.

## Practical DOCX Guidance

- Use `caption`, `label`, and `reference()` so tables and figures remain cross-referenceable.
- For formula-heavy reports, prefer real OMML equations through `math_latex()` over raster images or manual text. If grouped delimiters render with stray apostrophes, commas, duplicated signs, or broken parentheses, fix or report the DOCX math converter rather than hiding the issue in the notebook.
- Write body text neutrally with `builder.text(...)`; do not use `style="Normal"` as the public convention for body paragraphs.
- Treat the active Word template as owner of appearance. The notebook should emit semantic structure that the template can restyle natively.
- Treat `docDefaults` as the baseline for body typography and paragraph defaults, not as a substitute for semantic style slots.
- Prefer `table(..., style=None)` / `dataframe(..., style=None)` so the active template can resolve `table_default`; only pass an explicit table style when the task clearly requires it.
- Avoid `builder.style()` and `doc.styles.add_style()` inside normal report cells unless the task is explicitly about template authoring or a justified exceptional case.
- Use `builder.document` only when the high-level helpers are not enough for correct equations, paragraph structure, captions, sections, or metadata.
- If you use `builder.document`, resolve the active Word style with `builder.resolve_style_slot(...)` before assigning paragraph/table styles.
- Keep low-level DOCX work in service of clarity and correctness, not decoration.
- Treat `docx-guide-full.md` as the detailed source for builder APIs, `python-docx`, enums, units, and OOXML examples.

## Reusable Editorial Principles

- Keep the narrative centered on assumptions, model behavior, calculations, checks, and interpretation.
- Support technical claims with text, equations, tables, or plots.
- Make tables and figures understandable without exposing internal implementation details.
- Do not import project-specific chapter trees, heading offsets, or numbering policies into a generic skill unless the user requests them.
- Keep the notebook-readable logic and the report-readable logic aligned; the DOCX should not contradict or obscure the notebook narrative.
- Keep the DOCX deliverable clean: it should not tell the reader that the result came from a notebook, a code cell, an MCP session, an agent, or an automation pipeline unless that disclosure is explicitly part of the project scope.

## Minimal DOCX Example

```python
doc_reset(hard=True)

with build_doc(block_id="resumen", order=10) as builder:
    builder.heading("Resumen del procedimiento", level=1)
    builder.text("Se presenta el caso base y la interpretacion de sus resultados principales.")
    builder.math_latex(r"R = \\frac{S}{C}", label="eq:razon", number=True)
    builder.table(
        [["Caso base", 0.84]],
        headers=["Escenario", "Razon demanda/capacidad"],
        caption="Resumen de verificacion",
        label="tbl:resumen"
    )
    builder.text("Fuente: elaboracion propia.")
```
