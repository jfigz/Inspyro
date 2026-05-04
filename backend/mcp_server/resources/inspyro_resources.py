"""MCP resources for Inspyro.

These resources are the AI-facing read-only guidance layer for external MCP
clients. They must be enough for a model to understand how to use Inspyro
without reading the repository.
"""

from __future__ import annotations

import json
import logging
from textwrap import dedent

from .. import config
from ..bridge import BridgeError, InspyroBridge
from ..session_state import McpSessionState
from ..tools import documents as document_tools
from ..tools import files as file_tools
from ..tools import notebook as notebook_tools
from ..server import mcp

logger = logging.getLogger("inspyro.mcp.resources")
_SESSION_STATE = McpSessionState.get()


def _json_dump(payload: object) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False)


def _normalize_system_info_payload(payload: object) -> object:
    if not isinstance(payload, dict):
        return payload

    normalized = dict(payload)
    workspace_path = (
        normalized.get("workspace_path")
        or normalized.get("workspace_root")
        or normalized.get("workspace")
    )
    if workspace_path:
        normalized.setdefault("workspace_path", workspace_path)
        normalized.setdefault("workspace_root", workspace_path)
    return normalized


def _normalize_pdf_status_payload(health_payload: object, pdf_payload: object) -> dict[str, object]:
    health = health_payload if isinstance(health_payload, dict) else {}
    pdf_status = pdf_payload if isinstance(pdf_payload, dict) else {}
    word_available = bool(pdf_status.get("word_available"))
    libreoffice_available = bool(pdf_status.get("pdf_available")) or bool(pdf_status.get("soffice_path"))
    preferred_engine = "word" if word_available else "libreoffice" if libreoffice_available else None
    return {
        "conversion_available": word_available or libreoffice_available,
        "word_available": word_available,
        "libreoffice_available": libreoffice_available,
        "preferred_engine": preferred_engine,
        "last_error_kind": pdf_status.get("last_error_kind") or health.get("last_error_kind"),
        "last_error_message": (
            pdf_status.get("last_error_message")
            or health.get("last_error_message")
            or pdf_status.get("word_error")
            or pdf_status.get("error")
        ),
    }


def _render_guide(
    *,
    title: str,
    purpose: str,
    when_to_read: str,
    sequence: str,
    common_errors: str,
    next_step: str,
) -> str:
    return dedent(
        f"""
        # {title}

        ## Proposito
        {purpose}

        ## Cuando leerlo
        {when_to_read}

        ## Secuencia de tools
        {sequence}

        ## Errores comunes
        {common_errors}

        ## Siguiente paso
        {next_step}
        """
    ).strip()


def _render_manifest() -> str:
    return _json_dump(
        {
            "name": "inspyro",
            "profiles": {
                "all": "Expose the full Inspyro MCP surface.",
                "authoring": "Default profile: notebook authoring, document export, templates, and units.",
                "core": "Keep only system/session discovery components.",
                "analysis": "Dependency, impact, optimization, and code checks.",
                "files": "Generic filesystem tools for non-notebook files.",
                "admin": "Diagnostics and maintenance components.",
            },
            "resource_templates": [
                "inspyro://workspace/tree/{path*}",
                "inspyro://workspace/file/{path*}",
                "inspyro://notebooks/{path*}/cells/{cell_id}",
                "inspyro://artifacts/{kernel_id}/{kind}",
                "inspyro://artifacts/{kernel_id}/{kind}/{execution_id}",
                "inspyro://artifacts/token/{kind}/{token}",
                "inspyro://runs/{run_id}",
            ],
            "guides": [
                "inspyro://guides/start-here",
                "inspyro://guides/notebook-workflow",
                "inspyro://guides/docx-quickstart",
                "inspyro://guides/artifact-lifecycle",
                "inspyro://guides/template-workflow",
                "inspyro://guides/analysis-units-workflow",
                "inspyro://guides/error-recovery",
            ],
            "notes": [
                "Use tools for mutations and state-changing execution.",
                "Use resource templates for targeted file/cell/artifact reads.",
                "Prefer notebook editing through `notebook_load`, `notebook_sync_cells`, and `notebook_save` instead of generic file tools or JSON/nbformat.",
                "That notebook-first path preserves notebook structure, runtime context, and report flows more reliably for agents.",
                "Document tools are link-first by default; inline content is opt-in.",
                "DOCX Workbench is opt-in: use `check_document_quality(run=true, profile=\"agent\")` after an artifact exists when an agent needs textual feedback before delivery.",
                "`check_document_quality` and Workbench tools never return DOCX, PNG, XML raw, or base64 inline; visual renders and diffs return handles/resources only.",
                "Use `run_document_workbench(operation=\"render_manifest\")` to inspect cached visual state and `render_page` or `render_all_pages` only as explicit actions.",
                "Artifact resource_uri is session-scoped; portable_resource_uri is token-backed and reusable across MCP sessions while the token remains valid.",
                "Use export_document_docx/export_document_pdf when the client needs a stable local file path inside the exposed MCP roots.",
                "Use prepare_document_delivery for the final clean deliverable; it never replaces the original artifact.",
                "Use set_component_profile only when you need to expand from the default authoring surface into analysis, files, or admin tools.",
                "Use `inspyro://session/notebooks` or `list_session_notebooks` to inspect the notebooks currently alive in this MCP session.",
                "Notebook create/load/execute flows require `stateful-http` or `stdio`; they are intentionally rejected in `stateless-http`.",
                "Notebook execution tools accept timeout controls; raise them deliberately for long COM, SAP2000, Word, or PDF-conversion steps instead of assuming the default 600s is enough.",
            ],
        }
    )


async def _read_json_resource(path: str, error_label: str, *, params: dict | None = None) -> str:
    bridge = InspyroBridge.get()
    try:
        payload = await bridge.rest_get(path, params=params)
        if path == "/api/system/info":
            payload = _normalize_system_info_payload(payload)
            health_payload = await bridge.rest_get("/health")
            try:
                pdf_payload = await bridge.rest_get("/pdf-status")
            except Exception:
                pdf_payload = {}
            if isinstance(payload, dict):
                payload["pdf_status"] = _normalize_pdf_status_payload(health_payload, pdf_payload)
        elif path == "/health" and isinstance(payload, dict):
            try:
                pdf_payload = await bridge.rest_get("/pdf-status")
            except Exception:
                pdf_payload = {}
            payload["pdf_status"] = _normalize_pdf_status_payload(payload, pdf_payload)
        if isinstance(payload, dict):
            payload.update(config.notebook_session_mode_payload())
        return _json_dump(payload)
    except Exception as exc:
        logger.debug("Resource %s failed: %s", path, exc)
        return f"Error obteniendo {error_label}: {exc}"


async def _read_workspace_tree_resource(path: str = ".", depth: int = 3) -> str:
    bridge = InspyroBridge.get()
    normalized_path = await file_tools._resolve_workspace_path(bridge, path)
    payload = await bridge.rest_get("/api/files/tree", params={"path": normalized_path, "depth": depth})
    return _json_dump(payload)


async def _read_workspace_file_resource(path: str) -> str:
    bridge = InspyroBridge.get()
    normalized_path = await file_tools._resolve_workspace_path(bridge, path)
    payload = await bridge.rest_get("/api/files/read", params={"path": normalized_path})
    content = payload.get("content") if isinstance(payload, dict) else payload
    if isinstance(content, (dict, list)):
        return _json_dump(content)
    return str(content or "")


async def _read_notebook_cell_resource(path: str, cell_id: str) -> str:
    bridge = InspyroBridge.get()
    normalized_path = await file_tools._resolve_workspace_path(bridge, path)
    notebook_payload = await notebook_tools._read_notebook(bridge, normalized_path)
    cells = notebook_payload.get("cells", [])
    index, cell = notebook_tools._find_cell(cells, cell_id)
    serialized = notebook_tools._serialize_cell(
        cell,
        order=index,
        include_source_preview=True,
        include_source=True,
        include_outputs=True,
    )
    serialized["path"] = normalized_path
    return _json_dump(serialized)


async def _read_run_resource(run_id: str) -> str:
    execution = _SESSION_STATE.get_execution(run_id)
    if not execution:
        return _json_dump(
            {
                "status": "missing_execution",
                "run_id": run_id,
                "execution_id": run_id,
            }
        )
    return _json_dump(
        notebook_tools._serialize_execution_status(
            execution,
            include_failed_outputs=True,
        )
    )


async def _read_session_notebooks_resource() -> str:
    return _json_dump(notebook_tools._session_notebooks_payload())


async def _read_artifact_resource(kernel_id: str, kind: str, execution_id: str | None = None) -> bytes | str:
    bridge = InspyroBridge.get()
    artifact = _SESSION_STATE.get_artifacts(kernel_id=kernel_id, execution_id=execution_id)
    normalized_kind = str(kind or "").strip().lower()
    if normalized_kind not in {"pdf", "docx"}:
        return f"Unsupported artifact kind: {kind}"
    try:
        content, _, _ = await document_tools._download_artifact_bytes(
            bridge,
            kind=normalized_kind,
            artifact=artifact,
            explicit_token=None,
        )
    except BridgeError as exc:  # type: ignore[name-defined]
        return f"Error obteniendo artefacto {normalized_kind}: {exc}"
    return content


async def _read_artifact_token_resource(kind: str, token: str) -> bytes | str:
    bridge = InspyroBridge.get()
    normalized_kind = str(kind or "").strip().lower()
    normalized_token = str(token or "").strip()
    if normalized_kind not in {"pdf", "docx"}:
        return f"Unsupported artifact kind: {kind}"
    if not normalized_token:
        return "Missing artifact token."
    try:
        content, _, _ = await document_tools._download_artifact_bytes(
            bridge,
            kind=normalized_kind,
            artifact=None,
            explicit_token=normalized_token,
        )
    except BridgeError as exc:  # type: ignore[name-defined]
        return f"Error obteniendo artefacto portable {normalized_kind}: {exc}"
    return content


START_HERE_GUIDE = _render_guide(
    title="Inspyro MCP - Start Here",
    purpose=(
        "Punto de arranque obligatorio para cualquier IA. Explica como orientarse, "
        "que resource leer segun la tarea y que prerequisitos existen antes de usar tools mutantes."
    ),
    when_to_read=(
        "Leelo antes de la primera llamada que cree, edite, ejecute o descargue algo. "
        "Si estas empezando una sesion nueva, este debe ser tu primer resource."
    ),
    sequence=dedent(
        """
        1. Lee `inspyro://manifest`.
        2. Lee `inspyro://guides/start-here`.
        3. Consulta `inspyro://system/info` para confirmar workspace y entorno.
        4. Trabaja por defecto en el perfil `authoring`; solo usa `set_component_profile` si necesitas `analysis`, `files` o `admin`.
        5. Si vas a trabajar con notebooks, lee `inspyro://guides/notebook-workflow`.
        6. Si vas a generar documentos, lee `inspyro://guides/docx-quickstart` y `inspyro://guides/artifact-lifecycle`.
        7. Si vas a tocar plantillas, lee `inspyro://guides/template-workflow`.
        8. Si vas a usar analisis o unidades, lee `inspyro://guides/analysis-units-workflow`.
        9. Si recibes un error o una sesion queda inconsistente, lee `inspyro://guides/error-recovery`.
        10. Si una celda o batch va a reiniciar SAP2000, usar COM, tocar Word/LibreOffice o disparar conversion pesada, sube `timeout` o `timeout_per_cell` por encima del default de `600`; `900` suele ser un rango razonable.

        Arbol de decision rapido:
        - Explorar workspace en modo seguro: `inspyro://workspace/tree/{path*}` e `inspyro://workspace/file/{path*}`
        - Ver notebooks vivos de la sesion actual: `inspyro://session/notebooks` o `list_session_notebooks`
        - Crear o cargar notebook: `notebook_create`, `notebook_load(include_source=True)` o `list_cells`/`get_cell`/`find_in_notebook` si primero necesitas inspeccion puntual
        - Editar notebook: `notebook_sync_cells`
        - Ejecutar notebook: `execute_cell` o `execute_all_cells(background=true)` para corridas largas
        - Polling de una corrida larga: `get_run_status(run_id)` o `inspyro://runs/{run_id}`
        - Reanudar o cancelar: `resume_run(run_id)` o `cancel_run(run_id)`
        - Guardar notebook: `notebook_save`
        - Descargar DOCX/PDF: `get_document_docx`, `get_document_pdf`, `inspyro://artifacts/{kernel_id}/{kind}` o `inspyro://artifacts/token/{kind}/{token}`
        - Revisar calidad DOCX textual: `check_document_quality(run=true, profile="agent")` despues de que exista el DOCX; usa `run=false` para leer solo cache
        - Ejecutar Workbench DOCX: `run_document_workbench(operation=...)` para acciones explicitas de revision, visual, campos, redaccion, proteccion o diff
        - Exportar a archivo local estable: `export_document_docx` o `export_document_pdf`
        - Preparar entregable limpio: `prepare_document_delivery`
        - Rehacer PDF desde el DOCX actual: `reconvert_pdf`
        - Mutar archivos no notebook: cambia antes a perfil `files` con `set_component_profile`
        - Terminar sesion notebook: `close_session_notebook` o `shutdown_kernel`
        """
    ).strip(),
    common_errors=dedent(
        """
        - `kernel_id`: casi todas las tools de notebook, documents y templates dependen de el.
          Guardalo despues de `notebook_create` o `notebook_load`.
        - Si `get_system_info` o `inspyro://session/notebooks` reportan `notebook_session_mode=stateless-http`, no intentes crear/cargar/ejecutar notebooks: reinicia el servidor sin `--stateless-http` o usa `stdio`.
        - `missing_artifact`: intentaste pedir un DOCX/PDF sin haber ejecutado antes una celda que exporte documento.
        - `missing_quality`: existe el DOCX, pero no hay auditoria cacheada; repite `check_document_quality(run=true, profile="agent")` si quieres revisar calidad.
        - `missing_notebook_session`: intentaste guardar o mover un kernel que no fue creado/cargado por MCP.
        - Para notebooks, prefiere `notebook_load`, `notebook_sync_cells` y `notebook_save` por sobre file tools genericos o JSON/`nbformat`,
          porque preservan mejor la semantica notebook-first y el estado asociado.
        - La API DOCX ya esta disponible dentro del kernel. Puedes usar `doc_reset`, `build_doc`, `doc_export`,
          `Heading`, `Text` y helpers relacionados directamente en las celdas de codigo.
        - DOCX y PDF no son equivalentes: el DOCX suele estar disponible primero; el PDF puede requerir conversion extra
          o `reconvert_pdf`.
        - El default de `timeout` en tools notebook es `600s`. Si la celda reinicia SAP2000 o usa automatizacion COM/Word, puedes y debes subirlo a discrecion.
        """
    ).strip(),
    next_step=(
        "Elige el guide especifico para tu tarea. Si tu objetivo es crear un notebook con reporte DOCX, "
        "lee `inspyro://guides/notebook-workflow`, luego `inspyro://guides/docx-quickstart`, y finalmente "
        "`inspyro://examples/notebook-docx-report`."
    ),
)

NOTEBOOK_WORKFLOW_GUIDE = _render_guide(
    title="Notebook Workflow",
    purpose=(
        "Describe el flujo canonico de notebooks manejados por MCP y cuando usar cada tool."
    ),
    when_to_read=(
        "Leelo antes de crear, cargar, editar, ejecutar, guardar o cerrar notebooks."
    ),
    sequence=dedent(
        """
        Flujo base:
        1. `notebook_create(path, name, cells=...)` si necesitas un notebook nuevo y ya sabes la estructura inicial.
        2. `notebook_create(path, name)` si solo quieres abrir la sesion primero.
        3. `notebook_load(path, include_source=True)` si el notebook ya existe y necesitas editarlo.
        3a. Si el notebook es grande y solo necesitas ubicar una celda o inspeccionar un fragmento, usa primero `list_cells`, `get_cell` o `find_in_notebook`.
        3b. Si necesitas confirmar que kernels siguen vivos o cerrar notebooks anteriores, usa `list_session_notebooks` y `close_session_notebook`.
        4. Guarda `kernel_id` y `path` del resultado.
        5. Sincroniza el contenido final con `notebook_sync_cells`.
        6. Ejecuta una celda con `execute_cell` o varias con `execute_all_cells`.
        6b. Para notebooks pesados, prefiere `execute_all_cells(background=true)` y luego sigue el progreso con `get_run_status(run_id)` o `inspyro://runs/{run_id}`.
        6a. Si una celda reinicia SAP2000, usa COM, recarga Word/LibreOffice o hace conversion pesada, ajusta `timeout` o `timeout_per_cell` antes de ejecutar. Para ese tipo de trabajo `600` o `900` suele ser razonable.
        7. Persiste el notebook con `notebook_save`.
        8. Descarga artefactos con `get_document_docx` o `get_document_pdf` si hubo export documental.
        9. Finaliza el kernel con `close_session_notebook` o `shutdown_kernel` cuando cierres el trabajo.

        Cuando usar cada tool:
        - `notebook_create`: crea notebook en disco y abre una nueva sesion MCP con `kernel_id`; acepta `cells=...` para evitar un create+sync separado.
        - `notebook_load`: vincula un `.ipynb` existente a un kernel nuevo; `reuse_if_loaded=true` reutiliza el kernel ya vivo para esa ruta y `close_others=true` cierra el resto de notebooks de la sesion.
        - `list_session_notebooks`: inventario rapido de `kernel_id -> notebook_path` para la sesion MCP actual.
        - `close_session_notebook`: alias explicito para cerrar un notebook vivo de la sesion actual.
        - `notebook_sync_cells`: describe la lista ordenada final de celdas y deja el notebook exacto sin editar JSON manualmente.
        - `execute_cell`: prueba una celda puntual.
        - `execute_all_cells`: flujo recomendado cuando quieres materializar un notebook completo y sus artefactos; con `background=true` devuelve `run_id` para polling/cancelacion/reanudacion.
        - `get_run_status`: polling tool-first del estado de una corrida larga.
        - `cancel_run`: cancela una corrida larga sin destruir el kernel.
        - `resume_run`: reanuda celdas pendientes o fallidas de una corrida previa.
        - `list_cells`, `get_cell`, `find_in_notebook`: inspeccion puntual para notebooks grandes sin inflar `notebook_load(include_source=True)`.
        - `get_variables`: captura variables visibles del kernel si necesitas inspeccion runtime.
        """
    ).strip(),
    common_errors=dedent(
        """
        - Si pierdes `kernel_id`, vuelve a `notebook_load(path)` para reconstruir la sesion MCP.
        - Si `notebook_session_mode=stateless-http`, primero cambia el servidor a `stateful-http` o `stdio`; repetir la tool en ese modo no repara la falta de sesion.
        - `cell_not_found` indica que debes volver a leer el notebook y usar el `cell_id` correcto.
        - `missing_notebook_session` suele resolverse cargando de nuevo el notebook con `notebook_load`.
        - Para notebooks, prefiere `notebook_load(include_source=True)` -> `notebook_sync_cells` -> `notebook_save` en vez de `read_file`, `write_file` o `nbformat`, porque preserva mejor la semantica notebook-first.
        - Si una ejecucion larga ya tiene `run_id`, usa `get_run_status` o `inspyro://runs/{run_id}` antes de asumir que debes repetirla.
        - Si una corrida queda parcial o cancelada, usa `resume_run(run_id)` para continuar pendientes; usa `retry_failed=true` si quieres repetir tambien las fallidas.
        - Si hay timeout durante automatizacion COM o reinicio de SAP2000, no asumas que la tool esta rota: primero reintenta con `timeout=600` o `timeout_per_cell=600` y sube a `900` si el flujo lo justifica.
        """
    ).strip(),
    next_step=(
        "Si tu notebook va a producir un documento, continua con `inspyro://guides/docx-quickstart` "
        "y `inspyro://guides/artifact-lifecycle`."
    ),
)

DOCX_QUICKSTART_GUIDE = _render_guide(
    title="DOCX Quickstart",
    purpose=(
        "Explica la API DOCX disponible dentro del kernel y el patron minimo para producir reportes DOCX correctos."
    ),
    when_to_read=(
        "Leelo antes de escribir una celda que use `build_doc`, `doc_reset`, `doc_export`, `Heading`, `Text`, "
        "`Table`, `Figure`, `Equation` o acceso low-level con `builder.document`."
    ),
    sequence=dedent(
        """
        Reglas base:
        1. Reinicia el documento una vez al comienzo con `doc_reset(hard=True)`.
        2. Crea bloques con `with build_doc(block_id=\"...\", order=N) as builder:`.
        3. Usa `order` para definir la posicion del bloque en el documento final.
        4. Reusa `block_id` si quieres re-ejecutar sin duplicar contenido.
        5. Para ecuaciones usa LaTeX matematico: `builder.math_latex(r\"\\frac{qL}{2}\")`.
        6. Para formato avanzado usa `builder.document` y `builder.create_math_latex_element(...)`.
        7. Ejecuta la celda o el notebook. Luego usa `get_document_docx`.
        8. Si necesitas revision antes de entregar, usa `check_document_quality(run=true, profile="agent", detail="findings")`;
           la respuesta es textual y compacta, sin DOCX/PNG/base64.
        9. Si necesitas acciones documentales explicitas, usa `run_document_workbench(operation=...)` y conserva solo los handles que realmente necesites abrir.
           Para inspeccion visual, parte por `operation="render_manifest"`; usa `render_page` o `render_all_pages` solo si realmente necesitas PNGs.
        10. Al final, usa `prepare_document_delivery` para generar una variante publicable.

        API disponible dentro del kernel:
        - Disponible sin import extra: `build_doc`, `doc_reset`, `doc_export`, `Heading`, `Text`, `List`, `Code`,
          `Link`, `Equation`, `EquationLatex`, `Reference`, `Image`, `Figure`, `Caption`, `Table`, `DataFrame`, `PageBreak`,
          `Metadata`, `Style`, `Header`, `Footer`.
        - Si necesitas helpers low-level como `RGBColor`, `Pt` o enums de `python-docx`, importalos en la celda.

        Patron minimo:
        ```python
        doc_reset(hard=True)

        with build_doc(block_id="cover", order=10) as builder:
            builder.heading("Informe tecnico", level=1)
            builder.text("Resumen del problema")

        with build_doc(block_id="results", order=20) as builder:
            builder.heading("Resultados", level=2)
            builder.math_latex(r"M_{max} = \\frac{wL^2}{8}", label="eq:mmax", number=True)
            builder.table([["Momento", 56.25, "kN m"]], headers=["Magnitud", "Valor", "Unidad"])
        ```
        """
    ).strip(),
    common_errors=dedent(
        """
        - Si el documento no aparece, revisa si la celda realmente usa la API DOCX y vuelve a ejecutarla.
        - Si necesitas texto o estilo muy fino, usa `builder.document` en vez de forzar wrappers.
        - Si pides un PDF y no existe aun, primero recupera el DOCX y luego usa `reconvert_pdf` o `get_document_pdf`.
        - `build_doc` y `doc_reset` ya existen dentro del kernel; no asumas que debes crear wrappers externos.
        - `check_document_quality(run=false)` solo lee cache; si devuelve `missing_quality`, reintenta con `run=true`.
        - Las operaciones visuales de Workbench retornan `resource_uri`, no imagen inline; abre el recurso solo si necesitas inspeccion visual.
        - `render_manifest` no fuerza raster pesado si ya existe cache; `render_page` y `render_all_pages` preparan recursos visuales derivados de forma explicita.
        """
    ).strip(),
    next_step=(
        "Despues de escribir celdas DOCX, consulta `inspyro://guides/artifact-lifecycle` "
        "para descargar el DOCX/PDF correcto, revisar calidad bajo demanda y preparar entrega."
    ),
)

ARTIFACT_LIFECYCLE_GUIDE = _render_guide(
    title="Artifact Lifecycle",
    purpose=(
        "Explica cuando existen DOCX/PDF, como descargarlos y por que puede aparecer `missing_artifact`."
    ),
    when_to_read=(
        "Leelo antes de llamar `get_document_docx`, `get_document_pdf` o `reconvert_pdf`."
    ),
    sequence=dedent(
        """
        1. Crea o carga un notebook con `notebook_create` o `notebook_load`.
        2. Ejecuta una o mas celdas que usen la API DOCX con `execute_cell` o `execute_all_cells`.
        3. Pide el DOCX con `get_document_docx(kernel_id=...)`.
        4. Si necesitas revisar el documento, usa `check_document_quality(run=true, profile="agent")`; si solo quieres leer un resultado previo, usa `run=false`.
        5. Si tambien necesitas PDF, intenta `get_document_pdf(kernel_id=...)`.
        6. Si el PDF aun no existe o quieres regenerarlo desde el DOCX actual, usa `reconvert_pdf(kernel_id=...)` y luego `get_document_pdf`.
        7. Si necesitas un archivo local estable dentro del workspace o de otro root permitido, usa `export_document_docx` o `export_document_pdf`.
        8. Si necesitas inspeccion visual, primero usa `run_document_workbench(operation="render_manifest")`; usa `render_page` o `render_all_pages` solo como accion explicita.
        9. Si necesitas una copia publicable sin metadata/comentarios/redlines, usa `prepare_document_delivery`; `export_clean_document_docx` queda como compatibilidad directa para limpieza simple.

        Reglas practicas:
        - El DOCX suele estar disponible inmediatamente despues de ejecutar una celda DOCX.
        - El PDF depende de la conversion backend y puede estar disponible mas tarde.
        - `get_document_docx` y `get_document_pdf` devuelven primero un handle (`token`/`ref`/`resource_uri`) y solo
          embeben base64 cuando lo pides explicitamente con `inline_content=true`.
        - `resource_uri` es session-scoped y depende de que la sesion MCP actual siga teniendo registrado el artefacto.
        - `portable_resource_uri` es token-backed y sirve para reabrir el mismo artefacto desde otra sesion MCP mientras el token siga vigente.
        - `inspyro://artifacts/{kernel_id}/{kind}` y `inspyro://artifacts/{kernel_id}/{kind}/{execution_id}` sirven para
          leer el artefacto binario real dentro de la sesion MCP actual.
        - `inspyro://artifacts/token/{kind}/{token}` sirve para leer el artefacto portable sin depender de `McpSessionState`.
        - Si tu cliente necesita persistir el archivo en una ruta local explicita, usa `export_document_docx` o `export_document_pdf`.
        - La auditoria y el Workbench DOCX no corren automaticamente tras cada export; el agente los dispara bajo demanda para evitar costo y ruido.
        - `check_document_quality` retorna `quality_status`, `score`, `counts`, `sections` y findings limitados; nunca retorna DOCX, PNG, XML raw ni base64.
        - Las operaciones visuales de Workbench (`render_manifest`, `render_page`, `render_all_pages`, `clear_render_cache`) retornan estado/cache y handles; no devuelven PNG inline.
        - `run_document_workbench`, `compare_document_versions`, `manage_document_review` y `prepare_document_delivery` retornan summaries compactos y handles `resource_uri`.
        - `get_document_docx(include_quality=true)` solo adjunta el summary compacto cacheado si existe; no ejecuta auditoria.
        - `prepare_document_delivery` y `export_clean_document_docx` crean copias nuevas dentro de roots MCP permitidos y nunca reemplazan el artefacto original.
        """
    ).strip(),
    common_errors=dedent(
        """
        - `missing_artifact` en DOCX: ejecuta de nuevo una celda con `build_doc` o `doc_reset`.
        - `missing_artifact` en PDF: el DOCX existe pero el PDF aun no fue convertido; usa `reconvert_pdf`.
        - `missing_quality`: el DOCX existe pero no hay auditoria cacheada; corre `check_document_quality(run=true, profile="agent")`.
        - Si guardaste un notebook pero no ejecutaste ninguna celda DOCX en la sesion actual, no habra artefacto asociado.
        - Si perdiste `kernel_id`, vuelve a `notebook_load(path)` y repite la descarga.
        """
    ).strip(),
    next_step=(
        "Si trabajas con plantillas DOCX, continua con `inspyro://guides/template-workflow`. "
        "Si estas recuperandote de un error, ve a `inspyro://guides/error-recovery`."
    ),
)

TEMPLATE_WORKFLOW_GUIDE = _render_guide(
    title="Template Workflow",
    purpose=(
        "Define el orden correcto para adjuntar, inspeccionar y modificar una plantilla DOCX desde MCP."
    ),
    when_to_read=(
        "Leelo antes de usar `upload_template`, `get_template_info`, `update_template_style` o `delete_template`."
    ),
    sequence=dedent(
        """
        1. Ten un `kernel_id` activo via `notebook_create` o `notebook_load`.
        2. Adjunta la plantilla con `upload_template(kernel_id, file_path)`.
        3. Inspecciona la plantilla activa con `get_template_info(kernel_id)`.
        4. Si necesitas editar estilos, usa `update_template_style(kernel_id, style_name, updates)`.
        5. Re-ejecuta las celdas DOCX del notebook para que el documento se regenere usando la plantilla actual.
        6. Descarga el nuevo DOCX/PDF con `get_document_docx` o `get_document_pdf`.
        7. Si quieres quitar la plantilla activa, usa `delete_template(kernel_id)`.

        Recordatorio importante:
        - `upload_template` recibe la ruta local de un archivo `.docx`.
        - Cambiar la plantilla no re-renderiza documentos automaticamente; debes volver a ejecutar el notebook o las celdas DOCX.
        """
    ).strip(),
    common_errors=dedent(
        """
        - `template_not_found`: la ruta local no existe o no termina en `.docx`.
        - Si la plantilla se adjunto bien pero el documento no cambia, re-ejecuta las celdas DOCX.
        - Si el kernel ya no existe, vuelve a `notebook_load(path)` antes de operar sobre la plantilla.
        """
    ).strip(),
    next_step=(
        "Despues de ajustar la plantilla, consulta `inspyro://guides/artifact-lifecycle` para recuperar el nuevo documento."
    ),
)

ANALYSIS_UNITS_WORKFLOW_GUIDE = _render_guide(
    title="Analysis And Units Workflow",
    purpose=(
        "Resume cuando usar las tools de analisis y unidades sin necesidad de inspeccionar el backend."
    ),
    when_to_read=(
        "Leelo antes de pedir grafo de dependencias, impacto, sensibilidad, checks o conversiones de unidades."
    ),
    sequence=dedent(
        """
        Seleccion de tools:
        - `analyze_dependencies`: cuando quieres saber de que depende un simbolo.
        - `analyze_impact`: cuando quieres saber que afecta un simbolo.
        - `run_sensitivity`: cuando ya tienes `modified_variables`, `output_variables`, `formulas` y `current_values`.
        - `run_code_checks`: cuando quieres verificar checks de ingenieria sobre formulas y valores actuales.
        - `convert_units`: conversion directa entre unidades compatibles.
        - `get_units_catalog`: catalogo completo de unidades disponibles.
        - `check_units_compatible`: confirma si dos unidades comparten dimension.

        Flujo recomendado para unidades:
        1. Si no conoces los tokens disponibles, usa `get_units_catalog`.
        2. Si dudas si dos unidades son equivalentes, usa `check_units_compatible`.
        3. Solo entonces usa `convert_units`.

        Flujo recomendado para analisis:
        1. Si estas en notebook, ten claro el simbolo objetivo y, si aplica, `kernel_id`.
        2. Usa `analyze_dependencies` o `analyze_impact`.
        3. Si necesitas sensibilidad o checks, prepara `formulas` y `current_values`.
        """
    ).strip(),
    common_errors=dedent(
        """
        - Unidades desconocidas o incompatibles: primero consulta `get_units_catalog` y `check_units_compatible`.
        - Analisis vacio o impreciso: confirma el simbolo y el contexto notebook antes de reintentar.
        - `run_sensitivity` y `run_code_checks` necesitan payloads completos; si faltan formulas o valores, reconstruye el input.
        """
    ).strip(),
    next_step=(
        "Si el trabajo ocurre dentro de un notebook, vuelve a `inspyro://guides/notebook-workflow` para cerrar el flujo."
    ),
)

ERROR_RECOVERY_GUIDE = _render_guide(
    title="Error Recovery",
    purpose=(
        "Tabla de recuperacion rapida para errores comunes del MCP de Inspyro."
    ),
    when_to_read=(
        "Leelo cuando una tool falle, una sesion se pierda o un artefacto no aparezca."
    ),
    sequence=dedent(
        """
        | Error observado | Causa probable | Siguiente action MCP recomendada |
        | --- | --- | --- |
        | `missing_artifact` | No ejecutaste aun una celda DOCX o perdiste la sesion correcta | Lee `inspyro://guides/artifact-lifecycle`, re-ejecuta la celda DOCX o usa `execute_all_cells`, luego llama `get_document_docx` o `get_document_pdf` |
        | `missing_quality` | El DOCX existe, pero no hay summary de calidad cacheado | Ejecuta `check_document_quality(run=true, profile="agent")`; si tambien falta artefacto, regenera el DOCX primero |
        | `missing_notebook_session` | El `kernel_id` no fue creado/cargado por MCP en esta sesion | Usa `notebook_load(path)` para reconstruir la sesion MCP y vuelve a intentar |
        | `template_not_found` | `upload_template` recibio una ruta inexistente o sin `.docx` | Corrige `file_path` y vuelve a `upload_template` |
        | `cell_not_found` | `cell_id` viejo o incorrecto | Lee el notebook actual, identifica el `cell_id` vigente y reintenta `edit_cell`, `move_cell` o `delete_cell` |
        | Timeout de ejecucion | Celda larga, kernel ocupado o backend presionado | Si la celda usa COM, SAP2000, Word o conversion pesada, reintenta subiendo `timeout`/`timeout_per_cell` a `600` o `900`; si el timeout ya era generoso y el kernel quedo mal, usa `interrupt_kernel`, `reset_kernel` o `notebook_load(path)` |
        | Backend no disponible | Inspyro backend no esta sano o el bridge no pudo conectar | Usa `get_health` o lee `inspyro://system/health`; si falla desde el inicio, no sigas mutando estado hasta recuperar backend |
        """
    ).strip(),
    common_errors=dedent(
        """
        - No intentes descargar artefactos antes de restablecer la sesion notebook.
        - Si un error afecta estado local y `kernel_id`, la recuperacion mas segura suele ser `notebook_load(path)`.
        - Si dudas entre recuperar DOCX o PDF, recupera primero el DOCX; es el artefacto base.
        - No uses `get_document_docx(include_quality=true)` para disparar auditoria; solo lee cache compacto.
        """
    ).strip(),
    next_step=(
        "Una vez identificado el error, vuelve al guide especifico de tu flujo: notebook, DOCX, templates o analysis/units."
    ),
)

NOTEBOOK_DOCX_REPORT_EXAMPLE = dedent(
    """
    # Example - Notebook To DOCX Report

    ## Proposito
    Ejemplo corto y literal para crear un notebook, ejecutar calculos y descargar un DOCX.

    ## Cuando leerlo
    Leelo despues de `inspyro://guides/start-here`, `inspyro://guides/notebook-workflow`
    y `inspyro://guides/docx-quickstart`.

    ## Secuencia de tools
    1. `notebook_create(path=\"<workspace_dir>\", name=\"beam_report.ipynb\")`
    2. Guarda `kernel_id` y `path`.
    3. `notebook_sync_cells(notebook_path=path, cells=[<calc cell>, <docx cell>])`
    4. `execute_all_cells(kernel_id=kernel_id, notebook_path=path)`
    5. `notebook_save(kernel_id=kernel_id, path=path)`
    6. `get_document_docx(kernel_id=kernel_id)`
    7. Opcional antes de entregar: `check_document_quality(kernel_id=kernel_id, run=true, profile="agent")`
    8. Entrega final: `prepare_document_delivery(kernel_id=kernel_id, path="<ruta permitida>")`

    ## Calc cell
    ```python
    L_m = 6.0
    w_kN_m = 12.5
    M_max_kNm = w_kN_m * L_m**2 / 8.0
    print(f"Mmax = {M_max_kNm:.2f} kN m")
    ```

    ## DOCX cell
    ```python
    doc_reset(hard=True)

    with build_doc(block_id="cover", order=10) as builder:
        builder.heading("Informe tecnico", level=1)
        builder.text("Reporte generado desde MCP")

    with build_doc(block_id="results", order=20) as builder:
        builder.heading("Resultados", level=2)
        builder.math_latex(r"M_{max} = \\frac{wL^2}{8}", label="eq:mmax", number=True)
        builder.table(
            [["Momento maximo", round(M_max_kNm, 2), "kN m"]],
            headers=["Magnitud", "Valor", "Unidad"],
        )
    ```

    ## Errores comunes
    - Si `get_document_docx` devuelve `missing_artifact`, vuelve a ejecutar la celda DOCX o `execute_all_cells`.
    - Si `check_document_quality(run=false)` devuelve `missing_quality`, repite con `run=true`.
    - Si perdiste `kernel_id`, recarga el notebook con `notebook_load(path)`.

    ## Siguiente paso
    Si tambien necesitas PDF, sigue `inspyro://guides/artifact-lifecycle` y usa `reconvert_pdf` o `get_document_pdf`.
    """
).strip()


@mcp.resource(
    "inspyro://manifest",
    title="Manifest",
    description="Mapa corto y machine-readable del servidor MCP de Inspyro.",
    mime_type="application/json",
)
async def manifest() -> str:
    return _render_manifest()


@mcp.resource(
    "inspyro://system/info",
    title="System Info",
    description="Informacion operativa del backend Inspyro y del workspace actual.",
    mime_type="application/json",
)
async def system_info() -> str:
    return await _read_json_resource("/api/system/info", "info del sistema")


@mcp.resource(
    "inspyro://system/health",
    title="System Health",
    description="Estado de salud del backend Inspyro.",
    mime_type="application/json",
)
async def system_health() -> str:
    return await _read_json_resource("/health", "salud del sistema")


@mcp.resource(
    "inspyro://units/catalog",
    title="Units Catalog",
    description="Catalogo completo de unidades de ingenieria disponibles.",
    mime_type="application/json",
)
async def units_catalog() -> str:
    return await _read_json_resource("/api/units/catalog", "catalogo de unidades")


@mcp.resource(
    "inspyro://pdf/status",
    title="PDF Status",
    description="Estado del sistema de conversion PDF.",
    mime_type="application/json",
)
async def pdf_status() -> str:
    return await _read_json_resource("/pdf-status", "estado PDF")


@mcp.resource(
    "inspyro://files/tree",
    title="Workspace Tree",
    description="Arbol de archivos del workspace actual.",
    mime_type="application/json",
)
async def workspace_tree() -> str:
    return await _read_workspace_tree_resource(".", depth=3)


@mcp.resource(
    "inspyro://session/notebooks",
    title="Session Notebooks",
    description="Inventario de notebooks y kernels vivos dentro de la sesion MCP actual.",
    mime_type="application/json",
)
async def session_notebooks() -> str:
    return await _read_session_notebooks_resource()


@mcp.resource(
    "inspyro://guides/start-here",
    title="Start Here Guide",
    description="Onboarding obligatorio para usar el MCP de Inspyro sin acceso al repo.",
    mime_type="text/markdown",
)
async def guide_start_here() -> str:
    return START_HERE_GUIDE


@mcp.resource(
    "inspyro://guides/notebook-workflow",
    title="Notebook Workflow Guide",
    description="Flujo canonico para crear, editar, ejecutar, guardar y cerrar notebooks.",
    mime_type="text/markdown",
)
async def guide_notebook_workflow() -> str:
    return NOTEBOOK_WORKFLOW_GUIDE


@mcp.resource(
    "inspyro://guides/docx-quickstart",
    title="DOCX Quickstart Guide",
    description="Uso correcto de la API DOCX disponible dentro del kernel.",
    mime_type="text/markdown",
)
async def guide_docx_quickstart() -> str:
    return DOCX_QUICKSTART_GUIDE


@mcp.resource(
    "inspyro://guides/artifact-lifecycle",
    title="Artifact Lifecycle Guide",
    description="Cuando existen DOCX/PDF y como descargarlos correctamente.",
    mime_type="text/markdown",
)
async def guide_artifact_lifecycle() -> str:
    return ARTIFACT_LIFECYCLE_GUIDE


@mcp.resource(
    "inspyro://guides/template-workflow",
    title="Template Workflow Guide",
    description="Orden correcto para adjuntar y modificar plantillas DOCX desde MCP.",
    mime_type="text/markdown",
)
async def guide_template_workflow() -> str:
    return TEMPLATE_WORKFLOW_GUIDE


@mcp.resource(
    "inspyro://guides/analysis-units-workflow",
    title="Analysis And Units Workflow Guide",
    description="Seleccion de tools para analisis y conversion de unidades.",
    mime_type="text/markdown",
)
async def guide_analysis_units_workflow() -> str:
    return ANALYSIS_UNITS_WORKFLOW_GUIDE


@mcp.resource(
    "inspyro://guides/error-recovery",
    title="Error Recovery Guide",
    description="Tabla de recuperacion para errores MCP frecuentes.",
    mime_type="text/markdown",
)
async def guide_error_recovery() -> str:
    return ERROR_RECOVERY_GUIDE


@mcp.resource(
    "inspyro://examples/notebook-docx-report",
    title="Notebook DOCX Report Example",
    description="Ejemplo corto end-to-end para notebook + DOCX via MCP.",
    mime_type="text/markdown",
)
async def example_notebook_docx_report() -> str:
    return NOTEBOOK_DOCX_REPORT_EXAMPLE


@mcp.resource(
    "inspyro://workspace/tree/{path*}",
    title="Workspace Tree Template",
    description="Arbol de archivos de un path puntual dentro del workspace activo.",
    mime_type="application/json",
)
async def workspace_tree_template(path: str) -> str:
    return await _read_workspace_tree_resource(path or ".", depth=6)


@mcp.resource(
    "inspyro://workspace/file/{path*}",
    title="Workspace File Template",
    description="Contenido de un archivo puntual dentro del workspace activo.",
    mime_type="text/plain",
)
async def workspace_file_template(path: str) -> str:
    return await _read_workspace_file_resource(path)


@mcp.resource(
    "inspyro://notebooks/{path*}/cells/{cell_id}",
    title="Notebook Cell Template",
    description="Snapshot detallado de una celda puntual de notebook.",
    mime_type="application/json",
)
async def notebook_cell_template(path: str, cell_id: str) -> str:
    return await _read_notebook_cell_resource(path, cell_id)


@mcp.resource(
    "inspyro://artifacts/token/{kind}/{token}",
    title="Portable Artifact Token Template",
    description="Artefacto puntual (DOCX/PDF) accesible por token portable entre sesiones MCP.",
    mime_type="application/octet-stream",
)
async def artifact_token_template(kind: str, token: str) -> bytes | str:
    return await _read_artifact_token_resource(kind, token)


@mcp.resource(
    "inspyro://artifacts/{kernel_id}/{kind}",
    title="Artifact Template",
    description="Artefacto mas reciente (DOCX/PDF) asociado a un kernel MCP.",
    mime_type="application/octet-stream",
)
async def artifact_template(kernel_id: str, kind: str) -> bytes | str:
    return await _read_artifact_resource(kernel_id, kind)


@mcp.resource(
    "inspyro://artifacts/{kernel_id}/{kind}/{execution_id}",
    title="Artifact Execution Template",
    description="Artefacto puntual (DOCX/PDF) asociado a una ejecucion MCP.",
    mime_type="application/octet-stream",
)
async def artifact_execution_template(kernel_id: str, kind: str, execution_id: str) -> bytes | str:
    return await _read_artifact_resource(kernel_id, kind, execution_id=execution_id)


@mcp.resource(
    "inspyro://runs/{run_id}",
    title="Execution Run Template",
    description="Estado resumido de una ejecucion MCP rastreada por Inspyro.",
    mime_type="application/json",
)
async def run_template(run_id: str) -> str:
    return await _read_run_resource(run_id)
