# MCP Notebook Workflow

## Purpose

Use the notebook-first MCP flow exposed by Inspyro. This is the canonical path when the task creates, edits, executes, saves, or exports a notebook.

Within this skill, use this file to decide how the notebook is mutated. Use `notebook-authoring.md` to decide how the notebook should read, and use the DOCX references only when the notebook includes report cells.

## Read Order

1. Read `inspyro://manifest`.
2. Read `inspyro://guides/start-here`.
3. Read `inspyro://guides/notebook-workflow`.
4. If the notebook will generate a report, also read `inspyro://guides/docx-quickstart` and `inspyro://guides/artifact-lifecycle`.
5. If the report needs delivery review, use the Workbench-capable document tools described in those guides: `check_document_quality`, `run_document_workbench`, and `prepare_document_delivery`.
6. If the task includes reader-facing notebook restructuring, read `notebook-authoring.md`.
7. If the task includes DOCX cells, captions, equations, or low-level document control, read `docx-editorial.md` and `docx-guide-full.md`.
8. If needed, read the MCP prompt `create_docx_report_notebook`.

## Canonical Mutation Flow

1. Create a new notebook with `notebook_create(path, name, cells=...)` if you already know the initial structure.
2. Create a new notebook with `notebook_create(path, name)` if you want to open the session first and sync cells afterward.
3. Load an existing notebook with `notebook_load(path, include_source=True)` when the file already exists.
4. Keep `kernel_id` and `notebook_path` from the MCP response.
5. Describe the exact final list of cells with `notebook_sync_cells`.
6. Use `execute_cell` for a targeted probe or `execute_all_cells` for the full materialization pass. Pass `include_docx=false` when the intent is calculation-only iteration and report cells should be skipped.
7. Save with `notebook_save`.
8. Fetch report artifacts with `get_document_docx` or `get_document_pdf` when the notebook produced them.
9. When quality review is required, run `check_document_quality(run=true, profile="agent")` after the artifact exists; use the compact findings to correct the notebook/template, then re-execute.
10. Export with `export_document_docx` or `export_document_pdf` only when a stable local file path is needed.
11. Use `prepare_document_delivery` only at the end when a clean variant is desired; it should not replace the original artifact.
12. Close with `shutdown_kernel` when the session is finished.

## Preferred Authoring Shape

When you prepare the final list of cells for `notebook_sync_cells`, prefer this structure:

1. markdown title cell
2. optional markdown explanation cell
3. python code cell (`cell_type: "code"`) or report-writing Python cell (`cell_type: "docx"`)
4. outputs

Repeat that pattern for each stage instead of accumulating many unrelated concerns in one long cell.

## Notebook Sync Rules

- Treat `notebook_sync_cells` as the source of truth for notebook structure.
- Provide ordered cells with `cell_type`, `source`, and `cell_id` only when you are preserving an existing identity.
- Use `cell_type: "docx"` for every cell whose source writes, resets, finalizes, or directly mutates the DOCX report through `doc_reset`, `build_doc`, `doc_finalize`, `builder.document`, `math_latex()`, captions, tables, figures, or related DOCX APIs.
- Use `cell_type: "code"` for calculation, analysis, plotting, and data preparation cells that do not write the report.
- Use `notebook_create(cells=...)` for a clean initial scaffold; use `notebook_sync_cells` for later reshaping.
- Prefer one coherent sync that describes the final notebook over many piecemeal edits.
- Decide the final notebook shape before syncing; do not use the notebook as an ad-hoc accumulation of debug cells.
- If you are refactoring, preserve only the cells that still belong in the reader-facing notebook and move heavy implementation details to `.py` modules.

## Tool Selection

- Use `execute_cell` when you are iterating on one stage, debugging, or validating a refactor.
- Use `execute_all_cells` when you want the notebook state and report artifacts to be coherent end to end.
- Use `execute_cell(include_docx=false)` or `execute_all_cells(include_docx=false)` for fast calculation iterations that should omit DOCX cells. This does not clear `mdoc` and should not be treated as invalidating the last visible DOCX/PDF artifact.
- Raise `timeout` or `timeout_per_cell` deliberately to `600` or `900` for Word, PDF conversion, COM automation, SAP2000 restarts, or other long steps.
- If the notebook is meant to end in a report artifact, prefer a full `execute_all_cells` pass once the final structure is in place.
- Use Workbench/MCP quality tools as textual, bounded feedback. They should return statuses, counts, findings, and `resource_uri` handles, not inline DOCX/PDF/PNG/XML blobs.
- Prefer `.ipynb` editing through `notebook_load`, `notebook_sync_cells`, and `notebook_save` instead of generic file tools or `nbformat`; that is the recommended notebook-first path for agents because it preserves notebook structure, runtime context, and report flows.

## Do Not

- Do not treat generic file tools as a notebook editor.
- Do not assume the default `300` second timeout is enough for heavy automation.
- Do not let the MCP mutation flow decide the notebook pedagogy; define the notebook structure intentionally before syncing.

## Recovery Notes

- If `kernel_id` is lost, reload the notebook with `notebook_load(path)`.
- If `missing_notebook_session` appears, reload the notebook and resume from there.
- If a report artifact is missing, return to `inspyro://guides/error-recovery` and rerun the relevant execution step.
- If quality is missing, rerun `check_document_quality(run=true, profile="agent")`; if the artifact is missing, regenerate/export the DOCX first.
- If the notebook is structurally correct but reads poorly, the fix is usually a new `notebook_sync_cells` pass, not more execution retries.
