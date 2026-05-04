"""Reusable MCP prompts for Inspyro.

The prompts are AI-facing operating instructions. They assume no repository
access and always route the caller through the MCP guides first.
"""

from __future__ import annotations

import logging
from textwrap import dedent

from ..server import mcp

logger = logging.getLogger("inspyro.mcp.prompts")


def _prompt(body: str) -> str:
    return dedent(body).strip()


@mcp.prompt(
    name="create_engineering_notebook",
    title="Create Engineering Notebook",
    description="Crea un notebook de ingenieria guiandose por los resources MCP correctos.",
)
async def create_engineering_notebook(
    topic: str = "calculo estructural",
    description: str = "",
) -> str:
    """Guia MCP para crear un notebook de ingenieria sin asumir acceso al repo."""
    return _prompt(
        f"""
        Objetivo: crear un notebook de ingenieria en Inspyro sobre `{topic}`.

        {f"Descripcion adicional: {description}" if description else "Descripcion adicional: no provista."}

        Antes de usar tools mutantes:
        1. Lee `inspyro://guides/start-here`.
        2. Lee `inspyro://guides/notebook-workflow`.
        3. Si el notebook generara documento, lee `inspyro://guides/docx-quickstart`
           y `inspyro://guides/artifact-lifecycle`.
        4. Si usaras unidades o analisis, lee `inspyro://guides/analysis-units-workflow`.

        Flujo recomendado:
        1. Crea un notebook con `notebook_create`; si ya conoces la estructura completa, puedes pasar `cells=...`.
        2. Guarda `kernel_id` y `path`.
        3. Si el notebook ya existia o prefieres editarlo despues de crear la sesion, usa `notebook_load(include_source=True)` para traer source completo.
        3a. Si el notebook es grande y solo necesitas ubicar una celda o revisar un fragmento, usa primero `list_cells`, `get_cell` o `find_in_notebook`.
        4. Sincroniza las celdas finales con `notebook_sync_cells` en vez de editar JSON del `.ipynb`.
        5. Si el notebook debe producir un documento, usa `build_doc(order=...)`
           y `doc_reset(hard=True)` directamente en las celdas de codigo.
        6. Ejecuta con `execute_all_cells`; si el notebook es pesado, prefiere `execute_all_cells(background=true)`.
        6a. Si alguna celda reinicia SAP2000, usa COM, Word o conversion pesada, sube `timeout` o `timeout_per_cell` por encima del default de `600`; `900` suele ser un buen primer salto.
        6b. Si ejecutaste en background, sigue el progreso con `get_run_status(run_id)` o leyendo `inspyro://runs/{{run_id}}`.
        7. Guarda con `notebook_save`.
        8. Si hubo export DOCX, recupera el documento con `get_document_docx`.
        9. Si necesitas feedback antes de entregar, usa `check_document_quality(run=true, profile="agent")`.
        10. Si necesitas QA visual, usa `run_document_workbench(operation="render_manifest")` y solo despues `render_page` o `render_all_pages`; no pidas PNG inline.
        11. Si necesitas un archivo local estable dentro de los roots MCP del cliente, usa `export_document_docx` o `export_document_pdf`.

        Sugerencias operativas:
        - Para notebooks, prefiere `notebook_load`, `notebook_sync_cells` y `notebook_save` sobre file tools genericos o `nbformat`, porque preservan mejor la semantica notebook-first.
        - No asumas wrappers externos: la API DOCX ya vive dentro del kernel.
        - Para ecuaciones usa `builder.math_latex(...)` y `builder.create_math_latex_element(...)` como estándar.
        - Si aparece un error, lee `inspyro://guides/error-recovery` antes de improvisar.
        """
    )


@mcp.prompt(
    name="debug_cell_error",
    title="Debug Cell Error",
    description="Recupera una celda fallida usando los guides MCP de recuperacion y notebook.",
)
async def debug_cell_error(
    error_message: str = "",
    cell_source: str = "",
) -> str:
    """Guia MCP para depurar una celda con error dentro de un notebook gestionado por MCP."""
    return _prompt(
        f"""
        Necesito depurar una celda de Inspyro.

        Error observado:
        {error_message or "(sin mensaje explicito)"}

        Codigo actual:
        ```python
        {cell_source}
        ```

        Antes de actuar:
        1. Lee `inspyro://guides/error-recovery`.
        2. Lee `inspyro://guides/notebook-workflow`.
        3. Si la celda usa `build_doc` o `doc_reset`, lee tambien `inspyro://guides/docx-quickstart`.

        Flujo recomendado:
        1. Identifica la causa probable usando el guide de recuperacion.
        2. Si necesitas estado runtime, usa `get_variables`.
        3. Recarga el notebook con `notebook_load(include_source=True)` si necesitas el estado persistido.
        4. Corrige la celda con `notebook_sync_cells`.
        5. Reejecuta con `execute_cell`.
        4a. Si el error fue timeout y la celda usa COM, SAP2000, Word o conversion pesada, reintenta con `timeout=600` o `900` antes de asumir una falla funcional.
        6. Si el problema afecta la sesion completa, usa `reset_kernel` o `notebook_load(path)`.

        No inventes rutas internas del repo ni helpers fuera de MCP. Usa solo tools MCP y la API disponible en el kernel.
        Para notebooks, prefiere el flujo `notebook_load` -> `notebook_sync_cells` -> `notebook_save`; ese camino preserva mejor la semantica notebook-first.
        """
    )


@mcp.prompt(
    name="review_notebook",
    title="Review Notebook",
    description="Revisa un notebook usando guides MCP de notebook, analisis y artefactos.",
)
async def review_notebook(
    notebook_path: str = "",
) -> str:
    """Guia MCP para revisar un notebook completo sin acceso al repositorio."""
    return _prompt(
        f"""
        Necesito revisar el notebook: {notebook_path or "(ruta no provista)"}.

        Antes de actuar:
        1. Lee `inspyro://guides/start-here`.
        2. Lee `inspyro://guides/notebook-workflow`.
        3. Lee `inspyro://guides/analysis-units-workflow`.
        4. Si el notebook genera documentos, lee `inspyro://guides/artifact-lifecycle`.

        Flujo recomendado:
        1. Carga el notebook con `notebook_load`.
        2. Si necesitas source completo por celda, usa `notebook_load(include_source=True)` o el template `inspyro://notebooks/{{path*}}/cells/{{cell_id}}`.
        3. Si necesitas analisis, cambia primero a `analysis` con `set_component_profile`.
        4. Ejecuta `analyze_dependencies` y `analyze_impact` sobre simbolos clave.
        5. Si aplica, corre `run_code_checks`.
        6. Verifica si el notebook usa unidades coherentes y, de ser necesario, apoya el diagnostico con
           `get_units_catalog` o `check_units_compatible`.
        7. Si el notebook exporta documentos, ejecuta y valida con `get_document_docx` o `get_document_pdf`.
        8. Para revisar calidad DOCX, usa `check_document_quality(run=true, profile="agent")`; para visual, pide handles con `run_document_workbench(operation="render_manifest")`.
        9. Si el entregable exige una ruta local estable, termina con `export_document_docx` o `export_document_pdf`.

        Entrega una revision orientada a riesgos, errores, regresiones y pasos concretos de mejora.
        """
    )


@mcp.prompt(
    name="unit_conversion_help",
    title="Unit Conversion Help",
    description="Asiste conversiones de unidades guiando primero por el catalogo y compatibilidad.",
)
async def unit_conversion_help(
    from_value: str = "",
    from_unit: str = "",
    to_unit: str = "",
) -> str:
    """Guia MCP para conversiones de unidades de ingenieria."""
    return _prompt(
        f"""
        Necesito ayuda con unidades de ingenieria.

        Solicitud:
        {f"Convertir {from_value} {from_unit} a {to_unit}." if from_value else "Explorar unidades disponibles o verificar compatibilidad."}

        Antes de actuar:
        1. Lee `inspyro://guides/analysis-units-workflow`.
        2. Si hay dudas de tokens o aliases, llama primero `get_units_catalog`.

        Flujo recomendado:
        1. Si el usuario no conoce las unidades exactas, usa `get_units_catalog`.
        2. Si hay duda de compatibilidad, usa `check_units_compatible`.
        3. Solo entonces usa `convert_units`.
        4. Devuelve resultado, categoria y dimension de forma clara.

        Si encuentras un error de unidad desconocida o incompatible, consulta `inspyro://guides/error-recovery`.
        """
    )


@mcp.prompt(
    name="start_inspyro_session",
    title="Start Inspyro Session",
    description="Prompt de onboarding para iniciar una sesion MCP de Inspyro correctamente.",
)
async def start_inspyro_session(
    goal: str = "",
    deliverable: str = "",
) -> str:
    """Orientacion inicial para cualquier IA que entra por MCP a Inspyro."""
    return _prompt(
        f"""
        Inicia una sesion MCP de Inspyro.

        Objetivo declarado: {goal or "(no provisto)"}
        Entregable deseado: {deliverable or "(no provisto)"}

        Pasos obligatorios:
        1. Lee `inspyro://manifest`.
        2. Lee `inspyro://guides/start-here`.
        3. Lee `inspyro://system/info`.
        4. Trabaja por defecto en el perfil `authoring`.
        5. Elige el guide especifico segun la tarea:
           - notebook: `inspyro://guides/notebook-workflow`
           - docx/reportes: `inspyro://guides/docx-quickstart` y `inspyro://guides/artifact-lifecycle`
           - templates: `inspyro://guides/template-workflow`
           - analisis/unidades: `inspyro://guides/analysis-units-workflow`
           - errores: `inspyro://guides/error-recovery`
        6. Solo despues usa tools mutantes.

        Politica de trabajo:
        - Conserva `kernel_id`, `path`, `cell_id`, `token`, `ref` y `portable_resource_uri` cuando aparezcan.
        - No asumas acceso al repositorio.
        - Para notebooks, prefiere `notebook_load`, `notebook_sync_cells` y `notebook_save` sobre file tools genericos o `nbformat`, porque preservan mejor la semantica notebook-first.
        - Usa `set_component_profile` solo para expandir a `analysis`, `files` o `admin`.
        - El `timeout` de las tools notebook es ajustable a discrecion; si la operacion reinicia SAP2000, usa COM, Word o conversion pesada, subelo antes de ejecutar.
        - Si el flujo pide ejemplo literal, lee `inspyro://examples/notebook-docx-report`.
        """
    )


@mcp.prompt(
    name="create_docx_report_notebook",
    title="Create DOCX Report Notebook",
    description="Flujo guiado para crear un notebook y terminar con un DOCX recuperable.",
)
async def create_docx_report_notebook(
    topic: str = "informe tecnico",
    notebook_name: str = "report.ipynb",
) -> str:
    """Guia MCP para crear un notebook que termine en un DOCX descargable."""
    return _prompt(
        f"""
        Necesito crear un notebook de reporte DOCX sobre `{topic}` y guardarlo como `{notebook_name}`.

        Antes de usar tools:
        1. Lee `inspyro://guides/start-here`.
        2. Lee `inspyro://guides/notebook-workflow`.
        3. Lee `inspyro://guides/docx-quickstart`.
        4. Lee `inspyro://guides/artifact-lifecycle`.
        5. Lee `inspyro://examples/notebook-docx-report`.

        Flujo recomendado:
        1. `notebook_create` o `notebook_create(cells=...)`
        2. `notebook_sync_cells` para dejar el notebook exacto final
        3. `execute_all_cells(background=true)` para notebooks largos; usa sin `background` solo cuando quieras esperar el resultado completo en la misma llamada.
        3a. Si el notebook tiene celdas largas o automatizacion COM, ajusta `timeout_per_cell` a `600` o `900`.
        3b. Si la corrida va en background, consulta `get_run_status(run_id)` o `inspyro://runs/{{run_id}}` antes de decidir si reintentas.
        4. `notebook_save`
        5. `get_document_docx`
        6. Solo si se pide PDF: `get_document_pdf` o `reconvert_pdf` seguido de `get_document_pdf`
        7. Revision opcional antes de entregar: `check_document_quality(run=true, profile="agent")`
        8. QA visual opcional: `run_document_workbench(operation="render_manifest")`, luego `render_page` o `render_all_pages` solo si el cliente lo pide.
        9. Si el cliente necesita un archivo local estable: `export_document_docx` o `export_document_pdf`

        Sugerencias:
        - Usa `doc_reset(hard=True)` al comienzo del pipeline DOCX.
        - Usa bloques con `build_doc(block_id=..., order=...)`.
        - Para notebooks, prefiere `notebook_load`, `notebook_sync_cells` y `notebook_save`, porque preservan mejor la semantica notebook-first y el estado asociado.
        - Si el resultado de `get_document_docx` es `missing_artifact`, vuelve al guide `inspyro://guides/error-recovery`.
        """
    )


@mcp.prompt(
    name="recover_mcp_notebook_session",
    title="Recover MCP Notebook Session",
    description="Recupera una sesion notebook MCP perdida o inconsistente.",
)
async def recover_mcp_notebook_session(
    observed_error: str = "",
    notebook_path: str = "",
    kernel_id: str = "",
    style_name: str = "",
) -> str:
    """Guia MCP para recuperar sesion, artefactos o contexto notebook."""
    return _prompt(
        f"""
        Necesito recuperar una sesion MCP de notebook.

        Error observado: {observed_error or "(no provisto)"}
        notebook_path conocido: {notebook_path or "(no provisto)"}
        kernel_id conocido: {kernel_id or "(no provisto)"}
        style_name involucrado: {style_name or "(no provisto)"}

        Antes de actuar:
        1. Lee `inspyro://guides/error-recovery`.
        2. Lee `inspyro://guides/notebook-workflow`.
        3. Si faltan documentos, lee `inspyro://guides/artifact-lifecycle`.

        Flujo recomendado:
        1. Si tienes `notebook_path`, ejecuta `notebook_load(path)` para reconstruir `kernel_id`.
        2. Si el problema es `missing_artifact`, reejecuta la celda DOCX o `execute_all_cells`.
        2a. Si todavia tienes `run_id`, consulta `get_run_status(run_id)` o `inspyro://runs/{{run_id}}` antes de asumir que la corrida fallo.
        3. Si el problema fue timeout sobre una celda COM/SAP2000/Word, reintenta primero con `timeout=600` o `900`.
        4. Si la corrida quedo parcial o cancelada, usa `resume_run(run_id)` para seguir pendientes y `retry_failed=true` si tambien quieres repetir fallidas.
        5. Si el kernel esta colgado, usa `interrupt_kernel`, `cancel_run`, `reset_kernel` o `notebook_load(path)` segun corresponda.
        6. Si la plantilla estaba involucrada, vuelve a `get_template_info`, inspecciona `style_name` si existe y re-adjuntala o ajustala con `update_template_style`.
        7. Si necesitas el documento final, termina con `get_document_docx` o `get_document_pdf`.
        8. Si necesitas dejarlo materializado en una ruta local estable dentro de los roots MCP, usa `export_document_docx` o `export_document_pdf`.

        No inventes estado interno. Reconstituye la sesion MCP con las tools disponibles.
        Para notebooks, prefiere el flujo notebook-first del MCP para preservar mejor la semantica y el estado del notebook.
        """
    )
