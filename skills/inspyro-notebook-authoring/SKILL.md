---
name: inspyro-notebook-authoring
description: Write or refactor output-first Inspyro notebooks for internal engineering review and DOCX report delivery. Use when Codex must create or improve `.ipynb` workflows in Inspyro, enforce a mandatory first markdown `# 0.` summary and calculation-infrastructure flow cell, enforce mandatory H1+H2 numbered chapter/subchapter hierarchy, keep one `cell_type="docx"` report cell per reportable H1 section, design rich validation outputs, move heavy logic into `.py` modules, document project-specific report mention policy, or write DOCX cells with `build_doc`, `math_latex()`, captions, tables, figures, `doc_finalize()`, `builder.document`, or low-level DOCX control.
---

# Inspyro Notebook Authoring

## Overview

Use this skill when the notebook itself is part of the review surface, not just a scratchpad. The target is an output-first Inspyro notebook that an engineer can read from top to bottom, understand the procedure, inspect results clearly, and validate calculations mostly from the notebook outputs. When the workflow emits a report, the DOCX is the external deliverable and must read like engineering documentation rather than notebook internals.

This skill combines four layers:

1. MCP notebook-first mutation discipline.
2. Internal-review notebook structure and rich validation outputs.
3. Short editorial rules for report tone, captions, and allowed deliverable mentions.
4. A full adapted DOCX API guide copied from the repo reference.
5. DOCX Workbench quality feedback for agent-sized review before delivery.

## Current Version

The current version of this skill is whatever appears in `VERSION`.

- `VERSION` is the only source of truth for the current version.
- Do not create a new skill folder for normal improvements to this skill.
- If you need historical traceability, use git history rather than storing old skill versions inside this skill directory.

## When To Use This Skill

Use it for any of these tasks:

- create a new Inspyro notebook with a clear instructional flow
- refactor an existing notebook so it reads well for engineers or end users
- restructure a notebook into markdown heading cells plus Python code cells
- enforce the first markdown cell `# 0. Resumen operativo e infraestructura de calculo` with an always-current project summary and calculation-infrastructure flow diagram
- enforce mandatory numbered chapters and subchapters: every reportable H1 `# n.` must contain at least one H2 `## n.1.`
- design an output-first notebook where an engineer validates calculations from tables, checks, plots, and summaries instead of reading code
- move dense calculations from notebook cells into `.py` modules
- add tables, figures, prints, or plots that explain the calculation path
- write or refactor DOCX report cells in Inspyro
- enforce one DOCX report cell per H1 section while using lower-level markdown/code cells for detailed calculation stages
- document which project artifacts may be mentioned in the delivered report, such as SAP2000 models, calculation memoranda, drawings, standards, appendices, or other deliverables
- use `build_doc`, `doc_reset`, `math_latex()`, `builder.document`, or `python-docx`
- add captions, references, inline math, styled paragraphs, tables, figures, or low-level OOXML edits in a report notebook
- run compact DOCX quality feedback through `doc_finalize()`, `check_document_quality`, or Workbench MCP tools before delivering a report

## Read Order

Follow this routing, in order, before writing:

1. Read [references/mcp-workflow.md](references/mcp-workflow.md) before mutating any notebook through MCP.
2. Read [references/notebook-authoring.md](references/notebook-authoring.md) before planning cell sequence, markdown hierarchy, outputs, or `.py` extraction.
3. Read [references/docx-editorial.md](references/docx-editorial.md) before writing report prose, captions, titles, or reader-facing technical explanations.
4. Read [references/docx-guide-full.md](references/docx-guide-full.md) whenever the notebook includes any DOCX cell, any use of `build_doc`, any math/caption/table/figure API, or any descent into `builder.document`, `python-docx`, or XML low-level control.

## Decision Tree

- If the task edits `.ipynb` structure or notebook state through MCP, start with `mcp-workflow`.
- If the task is about readability, pedagogy, sectioning, titles, outputs, or separating notebook code from reusable logic, start with `notebook-authoring`.
- If the task is about report tone, descriptive labels, context paragraphs, figure/table titles, or source lines, read `docx-editorial`.
- If the task touches any DOCX API, equation, caption, table, figure, section, metadata, `builder.document`, Workbench quality, or OOXML, read `docx-guide-full` in addition to the other references.

## Non-Negotiable Rules

- The first cell of every notebook must be a markdown preface cell whose first line is `# 0. Resumen operativo e infraestructura de calculo`.
- Treat `# 0.` as internal notebook preface, not as a reportable chapter. It does not require a DOCX cell and must not appear in report-facing DOCX prose unless the user explicitly asks for it.
- Keep the `# 0.` cell updated whenever project files, code, data flow, configuration, calculations, report generation, or execution procedures change.
- The `# 0.` cell must include `## 0.1. Resumen vigente`, `## 0.2. Infraestructura de calculo`, and `## 0.3. Mantenimiento` in the same markdown cell.
- In `## 0.2.`, include a Markdown-compatible calculation-infrastructure flow diagram using a fenced `text` block or compact table; do not require Mermaid.
- Always subdivide the notebook into numbered chapters and subchapters. A flat notebook with only H1 chapters, unnumbered stages, or code directly under chapter headings is not conforming.
- Use a complete numbered markdown hierarchy with H1+H2 as the minimum structure. Reportable H1 cells use `# 1.`, `# 2.`, etc.; every reportable H1 must contain at least one H2 such as `## 1.1.`; H3+ headings are used when a substage needs more detail.
- Precede every calculation-only code cell with a markdown cell whose first line is a hierarchical H2/H3+ title such as `## 1.1.` or `### 1.1.1.`, followed by a descriptive section name.
- Place calculation-only `cell_type: "code"` cells under H2/H3+ sections, not directly under H1. The H1-level DOCX report cell is the only normal H1-level Python cell.
- Write notebook code in Python.
- Treat the notebook as the internal engineering review artifact. Keep it readable for a human reviewer; do not make the reader reverse-engineer long cells or cryptic runtime names.
- Use an output-first/result-first style: outputs must be rich, traceable, and precise enough for the engineer to validate assumptions, calculations, checks, and conclusions without relying on code review.
- Keep heavy, repeated, or reusable calculations in `.py` files; let the notebook import, call, summarize, and visualize them.
- Prefer outputs that explain what is happening and why it matters: labeled `print()` output, readable tables, formulas/check summaries, pass/fail checks, plots with titles, axes, legends, and units when relevant.
- Add short explanatory markdown below the section title whenever the reader needs assumptions, method, scope, or interpretation before the code.
- Keep public prose focused on engineering logic and user understanding; do not talk about kernels, runtimes, APIs, COM, internal automation, notebooks, or source code in report-facing text unless the user explicitly allows it.
- Mark every report-writing notebook cell as `cell_type: "docx"` when creating or syncing cells through MCP. Use ordinary `cell_type: "code"` for calculation-only Python cells.
- Use exactly one DOCX cell per reportable H1 (`una celda DOCX por H1`): create one `cell_type: "docx"` cell for each main section `# 1.`, `# 2.`, etc. The internal `# 0.` preface is excluded. Subsections `1.1`, `1.1.1`, etc. must contain the calculation markdown/code cells, but must not add their own DOCX cells unless the user explicitly authorizes an exception.
- When the notebook writes DOCX, use stable `block_id` values, ordered `build_doc(block_id=..., order=...)` blocks, `doc_reset(hard=True)` near the start of the document pipeline, `math_latex()` for new equations, and captions for every table and figure.
- For equations with supported LaTeX fences, use `math_latex()` directly. `\left...\right` groups for `()`, `[]`, `{}`, `|`, `\|`, and `\langle...\rangle` support nested parentheses and are normalized to one OMML operand for grouped content; do not strip `\left/\right`, split the equation, fake delimiters with text, or replace the formula with an image as a local workaround. If Word shows stray separators, apostrophes, duplicated signs, or broken grouping, treat it as a DOCX math pipeline regression and verify/fix the converter.
- Before writing DOCX prose, ask which project artifacts may be mentioned in the report and document that policy in the particular project's `docs/reporting-policy.md`; examples include SAP2000 models, calculation memoranda, drawings, standards, appendices, and external deliverables.
- Treat the DOCX deliverable (`DOCX entregable`) as external/public-facing unless the user says otherwise. It must not mention notebook internals, code, MCP, kernels, APIs, COM, or automation plumbing by default.
- During calculation-only iteration, use `execute_all_cells(include_docx=false)` or `execute_cell(include_docx=false)` to skip DOCX cells without clearing the current `mdoc` state or invalidating the last visible DOCX/PDF artifact.
- When the notebook is expected to deliver a DOCX, finish with compact quality feedback: use `doc_finalize(profile="delivery")` inside the notebook when useful, or MCP `check_document_quality(run=true, profile="agent")` after export.
- Do not inline DOCX, PNG render, XML raw, or base64 content into the agent context when Workbench tools return compact summaries or `resource_uri` handles.

## MCP-First Authoring Flow

1. Discover the active workspace and notebook context through the MCP notebook flow.
2. Prefer `notebook_create(...)` or `notebook_load(...)` to establish the session instead of reaching for generic file editing on `.ipynb`; that is the recommended agent path because it preserves notebook semantics, kernel context, and a cleaner authoring flow.
3. If the notebook emits a report, resolve the project mention policy before drafting report prose and record it in `docs/reporting-policy.md` for that project.
4. Decide the final notebook structure first, beginning with the `# 0.` summary/infrastructure preface cell, then reportable H1 title cells, at least one H2 subchapter under every reportable H1, calculation cells placed under H2/H3+ headings, rich outputs, and exactly one DOCX report cell per reportable H1 section.
5. Materialize the final structure through `notebook_sync_cells`, declaring report cells with `cell_type: "docx"` and keeping the `# 0.` preface as ordinary `cell_type: "markdown"`.
6. Whenever you change project files, code, procedures, data flow, or report-generation logic during authoring, update the `# 0.` cell before saving.
7. Probe isolated stages with `execute_cell` when iterating; pass `include_docx=false` when you intentionally want DOCX cells skipped.
8. Use `execute_all_cells` when you need the notebook and generated artifacts to be coherent end to end; pass `include_docx=false` for calculation-only passes.
9. Save with `notebook_save`.
10. If the notebook emits report content, retrieve DOCX or PDF artifacts through the document tools, not through manual notebook mutation.
11. For report review, run `check_document_quality(run=true, profile="agent")` and fix the notebook/template before final delivery when the findings are actionable.
12. For final handoff, use `prepare_document_delivery` or an explicit Workbench operation only when a clean/redacted/protected variant is needed.

## Notebook Authoring Standard

Use the notebook as an output-first orchestrator and explainer:

- start with the `# 0.` markdown preface cell and keep it synchronized with the current files, code, and execution flow
- divide every notebook into chapters and subchapters before adding code
- announce the stage with a markdown title cell
- explain the purpose or assumptions if needed
- run a focused Python cell
- show human-readable outputs with enough detail to audit the calculation path
- interpret the outcome before moving on when the result is not self-explanatory

Treat the notebook as the internal review narrative layer. Treat `.py` modules as the implementation layer. Treat the DOCX as the external report layer.

## DOCX Authoring Standard

For any report notebook:

- read the full guide in [references/docx-guide-full.md](references/docx-guide-full.md)
- declare every cell that writes or mutates the DOCX report as `cell_type: "docx"` in `.ipynb`/MCP payloads
- keep one DOCX cell per reportable H1 section and use `build_doc(...)` blocks inside that cell for the section's report contribution
- follow the project's `docs/reporting-policy.md` before mentioning models, software files, drawings, memoranda, standards, appendices, or other deliverables in the report
- use the high-level builder API for common structure, captions, tables, figures, and equations
- add `alt_text` to meaningful figures/images and keep repeated table headers enabled unless the document explicitly needs otherwise
- use `doc_finalize(profile="delivery")` as a lightweight in-notebook check before exporting important deliverables
- drop to `builder.document`, `python-docx`, or OOXML only when the wrappers do not provide enough control
- keep captions, headings, labels, tables, and equations readable for engineers
- support technical claims with explanatory text, equations, tables, or figures
- keep template-driven appearance under control of the Word template unless direct formatting is required for correctness

## Word-First Template Contract

- Treat DOCX notebook cells as a semantic authoring layer, not as a place to hardcode Word style names.
- Write body paragraphs neutrally with `doc.text()` or `builder.text()`; do not use `style="Normal"` as the public convention for body text.
- Treat `docDefaults` as the global baseline for font and paragraph defaults only; it is not the replacement for semantic style slots.
- Assume the template runtime resolves semantic slots such as `body`, `heading_1..6`, `list_bullet`, `list_number`, `caption`, `code`, and `table_default` to concrete Word styles.
- Do not create styles on the fly inside report cells unless the task explicitly requires template authoring or a justified exceptional case.
- Treat `builder.style()` and `doc.styles.add_style()` as advanced/template-authoring tools, not as the normal notebook authoring path.
- If you drop to `builder.document`, resolve the active Word style through `builder.resolve_style_slot(...)` before assigning `style=...`.
- Prefer `table(..., style=None)` and `dataframe(..., style=None)` unless the task explicitly requires a concrete table style name.

## Reference Map

- [references/mcp-workflow.md](references/mcp-workflow.md): canonical MCP notebook mutation flow, tool selection, timeout strategy, and recovery rules.
- [references/notebook-authoring.md](references/notebook-authoring.md): notebook structure, title grammar, output style, `.py` extraction rules, and readability checklist.
- [references/docx-editorial.md](references/docx-editorial.md): concise editorial and report-facing rules, plus adaptation guidance for public prose.
- [references/docx-guide-full.md](references/docx-guide-full.md): full adapted copy of the DOCX reference, including builder, `python-docx`, enums, XML low-level, and usage patterns.
- `scripts/bump_version.py`: validates the skill and updates `VERSION`.

## Maintenance Note

`references/docx-guide-full.md` is a skill-local adapted copy of the repo root `LLM_GUIDE_DOCX.md`. When that source changes, refresh the skill copy in the same session so the skill stays aligned with the canonical DOCX guide.

## Update Protocol

Edit this skill directly in place. Do not create a new skill for routine improvements.

Recommended protocol:

1. Update `SKILL.md`, `references/*`, and `agents/openai.yaml` if triggers, workflow, or UI metadata changed.
2. Run the skill validator.
3. Bump the version at the end with `python scripts/bump_version.py patch`, `minor`, `major`, or `--set X.Y.Z`.

Version policy:

- `patch`: wording fixes, examples, links, synchronization updates, and improvements that do not change the skill's scope.
- `minor`: new references, new capabilities, or meaningful workflow expansion.
- `major`: incompatible changes to purpose, triggers, or the core operating contract of the skill.

Keep the skill name and folder stable: `inspyro-notebook-authoring`.

## Definition Of Done

- No code cell appears without a preceding markdown title cell.
- The first cell is the markdown `# 0. Resumen operativo e infraestructura de calculo` preface, with current summary, infrastructure flow diagram, and maintenance note in the same cell.
- No notebook is flat: every reportable H1 chapter has at least one H2 subchapter, and calculation-only code cells live under H2/H3+ headings.
- The notebook can be read as a technical explanation, not only as an execution transcript.
- The notebook is output-first/result-first: outputs are detailed enough for internal engineering review without requiring code review.
- Heavy computation lives in `.py` modules when it would otherwise make notebook cells hard to read.
- Public labels, tables, and figures use descriptive engineering language instead of raw runtime names.
- The MCP flow intentionally prefers `notebook_*` tools over generic mutation of `.ipynb`.
- DOCX notebooks use `doc_reset(hard=True)`, `build_doc(...)`, `math_latex()`, and captions consistently.
- DOCX equations use the supported LaTeX-to-OMML path directly, including nested `\left...\right` fences, without notebook-local formatting workarounds for grouping.
- DOCX notebooks use one DOCX cell per reportable H1 (`una celda DOCX por H1`) by default: one `cell_type="docx"` cell per main `# 1.`/`# 2.` section, with all subsection calculations kept under H2/H3+ markdown/code cells and no DOCX cell for the internal `# 0.` preface.
- DOCX notebook cells are explicitly marked with `cell_type: "docx"`, and calculation-only MCP runs use `include_docx=false` when report generation should be skipped.
- Report prose follows the project-specific `docs/reporting-policy.md` and does not mention notebook/code/MCP/runtime internals unless explicitly allowed.
- DOCX notebooks follow the Word-first template contract: semantic body text, no public reliance on `Normal`, and no ad hoc style creation by default.
- DOCX deliverables can be checked through `doc_finalize()` or MCP Workbench quality without flooding the agent context with binaries or raw XML.
- The agent can work from the skill-local DOCX guide without reopening `LLM_GUIDE_DOCX.md` unless it is explicitly refreshing the copy.
