# Changelog - 19 MCP Server

> **Modulo:** `backend/mcp_server/`

> **Doc principal:** `docs/modules/19-mcp-server.md`

> **Última actualización:** 2026-05-08

---

## 2026-05-08 - Cobertura live MCP en `template-binding-bank`

### Contexto

El binding JSON por notebook necesitaba una campaña live que probara que la tool MCP usa el mismo contrato que backend/UI y que los estados degradados no bloquean ejecución.

### Cambios tecnicos

1. `frontend/tests/template-binding-bank.spec.ts` arranca MCP stateful desde la UI y valida `bind_template_to_notebook`, `notebook_load` con binding válido/missing, `update_template_style` con autoexport del JSON y `execute_all_cells` sin bloqueo cuando el JSON falta.
2. `agent_debug.ps1 template-binding-bank` queda como gate dedicado y deja evidencia en `output/template-binding-bank/<run-id>/summary.{json,md}`.
3. La documentación del módulo 19 registra el banco como complemento de `mcp-smoke` y `mcp-torture` para cambios en templates MCP.

**Archivos:** `frontend/tests/template-binding-bank.spec.ts`, `agent_debug.ps1`, `docs/modules/19-mcp-server.md`, `docs/changelog/19-mcp-server.md`, `docs/agents/quickstart.md`, `docs/llm-index.yaml`

---

## 2026-05-08 - Binding JSON de plantilla notebook-first en MCP

### Contexto

Los agentes necesitaban anidar la plantilla al notebook sin depender de un `template_token` efímero ni de mirrors DOCX legacy. El MCP ahora consume el mismo binding JSON portable que usa backend/UI.

### Cambios tecnicos

1. `bind_template_to_notebook(kernel_id, path?, template_json_path?)` llama a `POST /api/templates/bind`, escribe el JSON portable y devuelve `binding`, `notebook` y `template_binding`.
2. `notebook_create` y `notebook_load` devuelven `template_binding`; además, `notebook_create` envía `path/cwd` al backend para permitir herencia opcional del default de workspace.
3. `upload_template`, `get_template_info` y `update_template_style` propagan `template_binding` para que clientes IA detecten estados `bound`, `missing` o `error` sin consultar la UI.
4. `activity.py` clasifica `bind_template_to_notebook` como mutación de template para que el feed/espejo MCP mantenga la semántica existente.

**Archivos:** `backend/mcp_server/tools/templates.py`, `backend/mcp_server/tools/notebook.py`, `backend/mcp_server/activity.py`, `backend/tests/test_template_binding.py`, `docs/modules/19-mcp-server.md`, `docs/changelog/19-mcp-server.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-05-06 - MCP notebook-first session-scoped, nbformat-safe y remediación DOCX

### Contexto

Los agentes necesitaban que el flujo oficial Inspyro por MCP no dependiera de vías alternativas cuando hubiera celdas documentales, notebooks cargados en otra sesión o pérdida parcial de estado. La misma remediación corrige falsos positivos DOCX, resolución de paths relativos, diagnóstico de calidad y metadata visual Workbench.

### Cambios tecnicos

1. `InspyroBridge.get(..., websocket_scope="notebook")` crea instancias separadas por `(session_id, scope)` y prefiere `INSPYRO_BACKEND_NOTEBOOK_WS_URL` (`/ws/notebook`) con fallback advertido a `/ws`.
2. Las tools notebook-first capturan `session_id` al inicio y lo propagan a bridge, `session_state`, locks y lifecycle, incluyendo `notebook_sync_cells`, `notebook_save`, `list_cells`, `get_cell`, `find_in_notebook` y mutaciones legacy.
3. La persistencia MCP migra `cell_type="docx"` a `cell_type="code"` + `metadata.inspyro.cell_kind="docx"` antes de escribir y valida `nbformat`.
4. `CELL_SOURCE_REQUIRED` ahora devuelve diagnóstico de sesión y notebooks conocidos cuando se omite `source` y no se puede resolver la celda desde el registro session-scoped.
5. Las rutas relativas de notebooks se resuelven contra el workspace activo mediante el resolver root-aware compartido con file tools.
6. `_should_emit_docx()` pasa a un detector AST/token-aware: metadata `cell_kind="docx"` manda, `doc_finalize()` y APIs DOCX de alta confianza promocionan celdas legacy, pero `pd.DataFrame(...)` permanece como cálculo normal.
7. `check_document_quality(source_path="...clean.docx")` devuelve `invalid_quality_selector` cuando se pasa una copia DOCX exportada sin historial, con guidance hacia `artifact_id`, `kernel_id`, `execution_id` o `prepare_document_delivery`.
8. Los renders Workbench agregan `pages_dir`/`local_path` validados bajo el cache visual, sin cambiar el contrato link-first por `resource_uri`.

**Archivos:** `backend/mcp_server/tools/notebook.py`, `backend/mcp_server/tools/documents.py`, `backend/mcp_server/resources/inspyro_resources.py`, `backend/app/services/docx_render_cache.py`, `backend/mcp_server/bridge.py`, `backend/mcp_server/config.py`, `backend/tests/test_mcp_mirror.py`, `backend/tests/test_mcp_server_remediation.py`, `backend/tests/test_docx_quality.py`, `docs/modules/19-mcp-server.md`, `docs/changelog/19-mcp-server.md`, `docs/llm-index.yaml`

---

## 2026-05-04 - `execute_all_cells` no crea bloques DOCX vacíos en celdas de cálculo

### Contexto

Los batches mixtos ejecutados por agentes podían activar `emit_docx` para todas las celdas si el lote contenía al menos una celda documental. Eso contaminaba el orden lógico con bloques vacíos de celdas de cálculo y podía ocultar problemas de rehidratación del runtime.

### Cambios tecnicos

1. `_run_batch_execution()` calcula `docx_selected_ids` y `last_docx_cell_id` antes de iterar el lote.
2. Cada celda recibe `emit_docx` solo si es `cell_type="docx"` o su fuente usa APIs DOCX detectables.
3. `skip_pdf` se calcula contra la última celda documental, no contra la última celda runnable del lote.
4. La regresión `test_execute_all_cells_emits_docx_only_for_document_cells` fija que las celdas de código no exportables no generen bloques DOCX.

**Archivos:** `backend/mcp_server/tools/notebook.py`, `backend/tests/test_mcp_mirror.py`, `docs/modules/19-mcp-server.md`, `docs/changelog/19-mcp-server.md`, `docs/llm-index.yaml`

---

## 2026-04-28 - Celdas DOCX e iteración de cálculo por MCP

### Contexto

Los agentes necesitaban escribir notebooks con celdas documentales explícitas y poder iterar cálculos sin pagar el costo de regenerar DOCX/PDF en cada corrida.

### Cambios tecnicos

1. `notebook_create` y `notebook_sync_cells` aceptan `cell_type="docx"` como tipo lógico y lo exponen a agentes sin persistirlo como tipo Jupyter no estándar.
2. `list_cells`, `get_cell` y `find_in_notebook` reportan `type="docx"` cuando corresponde, incluyendo migración suave desde fuentes legacy con APIs DOCX detectables.
3. `execute_all_cells(include_docx=false)` omite celdas DOCX, devuelve `skipped_docx_cell_ids` y no fuerza `emit_docx`; `execute_cell(include_docx=false)` responde `status="skipped"` para celdas DOCX sin enviar ejecución WS.
4. `_should_emit_docx()` queda como compatibilidad para notebooks antiguos o fuentes sin metadata, mientras `cell_type="docx"` es la marca preferida para autoría nueva.

**Archivos:** `backend/mcp_server/tools/notebook.py`, `backend/tests/test_mcp_mirror.py`, `.codex/skills/inspyro-notebook-authoring/SKILL.md`, `.codex/skills/inspyro-notebook-authoring/references/mcp-workflow.md`, `docs/modules/19-mcp-server.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-04-25 - Tools MCP compactas para Workbench DOCX

### Contexto

La auditoría textual ya existía para agentes, pero el plan maestro DOCX necesitaba una capa MCP que pudiera operar revisión, diff y preparación de entrega sin saturar contexto con binarios, PNG o XML raw.

### Cambios tecnicos

1. `check_document_quality` acepta `profile` y sigue devolviendo un resumen compacto por defecto.
2. `tools/documents.py` agrega `run_document_workbench`, `compare_document_versions`, `manage_document_review` y `prepare_document_delivery`, todas basadas en summaries limitados y `resource_uri` para recursos explícitos.
3. Las operaciones visuales (`render_manifest`, `render_page`, `render_all_pages`) devuelven solo estado/cache y handles `/api/docx/render/resource`; no insertan PNG, DOCX ni base64 en el contexto del agente.
4. `prepare_document_delivery` puede exportar la variante generada dentro de roots MCP permitidos, adjunta un manifest visual compacto si existe y nunca reemplaza el DOCX original.
5. `backend/tests/test_mcp_server_remediation.py` y `backend/tests/test_mcp_ai_first.py` cubren catálogo público, handles Workbench, handles visuales y export de variantes.
6. El parser MCP de `resource_uri` queda restringido a `/api/docx/workbench/resource` con `workbench_id` y `name`, rechazando rutas inesperadas antes de pedir bytes al backend.

**Archivos:** `backend/mcp_server/tools/documents.py`, `backend/mcp_server/activity.py`, `backend/mcp_server/resources/inspyro_resources.py`, `backend/mcp_server/prompts/inspyro_prompts.py`, `backend/tests/test_mcp_server_remediation.py`, `backend/tests/test_mcp_ai_first.py`, `docs/modules/19-mcp-server.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`, `docs/changelog/19-mcp-server.md`

---

## 2026-04-25 - `max_depth` para `analyze_impact`

1. `backend/mcp_server/tools/analysis.py` expone `max_depth` en `analyze_impact` y lo reenvía al backend WS.
2. La tool mantiene el presupuesto largo de análisis existente; el cambio sólo alinea el límite de profundidad con UI/backend.

**Archivos:** `backend/mcp_server/tools/analysis.py`, `docs/modules/19-mcp-server.md`, `docs/changelog/19-mcp-server.md`

---

## 2026-04-24 - Feedback textual de calidad DOCX para agentes MCP

### Contexto

La UI humana ya podía auditar calidad DOCX bajo demanda, pero los agentes que trabajan por MCP seguían viendo solo el artefacto binario o el handle link-first. Faltaba una ruta compacta para revisar errores accionables sin inyectar DOCX, PNG, OOXML raw ni base64 al contexto.

### Cambios tecnicos

1. `backend/mcp_server/tools/documents.py` agrega `check_document_quality`, que resuelve `artifact_id`, `kernel_id + execution_id`, último DOCX por `kernel_id` o último DOCX por `source_path`, y consulta cache o ejecuta `/api/docx/quality/run` según `run`.
2. La respuesta normaliza `quality_status`, `score`, `counts`, `sections`, findings limitados, `truncated_findings`, `location`, `suggestion` y `source`, manteniendo `compact/findings/full` como niveles textuales sin binarios.
3. `get_document_docx(include_quality=true)` mantiene el payload histórico por defecto y solo adjunta `docx_quality` compacto cacheado cuando existe.
4. `export_clean_document_docx` llama `/api/docx/quality/clean`, escribe una copia nueva dentro de roots MCP permitidos y respeta `overwrite=false` sin reemplazar el artefacto original.
5. `bridge.py` suma `rest_post_bytes` para endpoints REST que devuelven binarios generados por POST, reutilizado por la copia limpia.
6. `resources/inspyro_resources.py` actualiza `docx-quickstart`, `artifact-lifecycle` y `error-recovery` para explicar `missing_quality`, la auditoría opt-in y la copia limpia.
7. `backend/tests/test_mcp_server_remediation.py` y `backend/tests/test_mcp_ai_first.py` cubren cache hit/miss, auditoría bajo demanda, truncado de findings, `include_quality`, copia limpia, roots/overwrite y que `execute_all_cells` no corra calidad automáticamente.

**Archivos:** `backend/mcp_server/tools/documents.py`, `backend/mcp_server/bridge.py`, `backend/mcp_server/activity.py`, `backend/mcp_server/resources/inspyro_resources.py`, `backend/tests/test_mcp_server_remediation.py`, `backend/tests/test_mcp_ai_first.py`, `docs/modules/19-mcp-server.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`, `docs/changelog/19-mcp-server.md`

---

## 2026-04-19 - Inventario explícito de notebooks MCP, cierre discoverable y guardas `stateless-http`

### Contexto

El MCP ya soportaba aislamiento por `session_id` y paralelismo real entre kernels distintos, pero esa capacidad seguía siendo implícita para agentes: no había inventario público de notebooks vivos, el cierre seguía escondido detrás de `shutdown_kernel`, y `--stateless-http` podía degradar notebook-first a errores tardíos y poco diagnósticos.

### Cambios tecnicos

1. `backend/mcp_server/tools/notebook.py` agrega `list_session_notebooks` y `close_session_notebook`, además de `reuse_if_loaded`/`close_others` en `notebook_create` y `notebook_load` para volver explícita la gestión multi-notebook dentro de una sesión MCP.
2. `backend/mcp_server/session_state.py` expone listado de notebooks vivos por sesión con `kernel_id`, `notebook_path`, `state`, `active` y `last_execution_id`.
3. `backend/mcp_server/resources/inspyro_resources.py` suma el resource fijo `inspyro://session/notebooks` y endurece la guidance AI-first para explicar cuándo usar inventario de sesión y por qué notebook-first no es confiable en `stateless-http`.
4. `backend/mcp_server/config.py`, `server.py` y `tools/system.py` publican `mcp_transport`, `mcp_stateless_http`, `notebook_session_mode` y `notebook_sessions_supported`, y las notebook tools que requieren persistencia fallan temprano con `NOTEBOOK_SESSION_REQUIRES_STATEFUL_MCP` cuando el servidor corre con `--stateless-http`.
5. `backend/mcp_server/tools/notebook.py` añade serialización MCP local por `kernel_id`, reforzando que dos corridas sobre el mismo kernel no se solapan mientras kernels distintos sí pueden ejecutarse en paralelo.
6. `backend/tests/test_mcp_server_remediation.py`, `backend/tests/test_mcp_ai_first.py`, `backend/tests/test_mcp_torture_probe.py` y el catálogo de `backend/dev/mcp_torture_assets.py` quedan alineados con la nueva superficie pública; `backend/dev/mcp_torture_probe.py` ahora cubre también el inventario explícito de sesión y el cierre vía alias discoverable.

**Archivos:** `backend/mcp_server/config.py`, `backend/mcp_server/server.py`, `backend/mcp_server/session_state.py`, `backend/mcp_server/activity.py`, `backend/mcp_server/tools/notebook.py`, `backend/mcp_server/tools/system.py`, `backend/mcp_server/resources/inspyro_resources.py`, `backend/dev/mcp_torture_assets.py`, `backend/dev/mcp_torture_probe.py`, `backend/tests/test_mcp_server_remediation.py`, `backend/tests/test_mcp_ai_first.py`, `backend/tests/test_mcp_torture_probe.py`, `docs/modules/19-mcp-server.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`, `docs/changelog/19-mcp-server.md`

---

## 2026-04-17 - Corridas públicas async, cancelación y reanudación en `authoring`

### Contexto

El servidor MCP ya tenía heartbeat por `execution_id`, resource template `inspyro://runs/{run_id}`, helpers internos de inspección y estado session-scoped suficiente para notebooks pesados. El problema era de superficie pública: `authoring` seguía empujando a esperar una llamada larga o a reconstruir manualmente batches y celdas.

### Cambios tecnicos

1. `backend/mcp_server/tools/notebook.py` vuelve a exponer `background` en `execute_all_cells` y publica `get_run_status`, `cancel_run`, `resume_run`, `get_kernel_status`, `list_cells`, `get_cell` y `find_in_notebook` dentro de `authoring`.
2. `backend/mcp_server/tools/notebook.py` conserva `run_id == execution_id` como handle público, registra `current_child_execution_id` para cancelar la celda activa del batch y permite reanudar pendientes/fallidas sin abrir otro scheduler.
3. `backend/mcp_server/session_state.py` y `bridge.py` consolidan el seguimiento de mensajes de ejecución para guardar `last_output_preview`, heartbeat vivo y artefactos exactos también en corridas batch públicas.
4. `backend/mcp_server/tools/system.py` normaliza `pdf_status` en `get_system_info` y `get_health`, separando disponibilidad global de conversión (`word` o `libreoffice`) de la señal legacy del backend.
5. `backend/mcp_server/tools/notebook.py`, resources y prompts separan `RPC_WAIT_TIMEOUT`, `BACKEND_EXECUTION_TIMEOUT`, `EXECUTION_CANCELLED` y `KERNEL_STATE_ERROR`, evitando volver a colapsar todo en `COM_BACKEND_TIMEOUT`.
6. `backend/tests/test_mcp_ai_first.py` y `backend/tests/test_mcp_server_remediation.py` quedan alineados con el nuevo catálogo `authoring`, el polling por `run_id`, la cancelación, la reanudación y la inspección puntual en notebooks grandes.

**Archivos:** `backend/mcp_server/tools/notebook.py`, `backend/mcp_server/session_state.py`, `backend/mcp_server/bridge.py`, `backend/mcp_server/activity.py`, `backend/mcp_server/tools/system.py`, `backend/mcp_server/resources/inspyro_resources.py`, `backend/mcp_server/prompts/inspyro_prompts.py`, `backend/tests/test_mcp_ai_first.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/modules/19-mcp-server.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`, `docs/changelog/19-mcp-server.md`

---

## 2026-04-15 - Los ceilings MCP/documentales pesados convergen en 600s

### Contexto

Aunque la ruta notebook-first productiva ya operaba con `600s` por celda, seguían existiendo ceilings heredados de `30/60/120s` en tools MCP de análisis/documentos, en la espera de artefactos tardíos y en los probes/clientes live del repositorio. Eso podía reintroducir timeouts falsos en validaciones AI-first pesadas o en clientes externos que reutilizan esos defaults.

### Cambios tecnicos

1. `backend/mcp_server/tools/analysis.py` alinea todas las tools de análisis WS con un presupuesto largo de `600s` o el timeout efectivo del runtime MCP, lo que resulte mayor.
2. `backend/mcp_server/tools/documents.py` sube a `600s` la espera por artefactos tardíos y la reconversión PDF MCP, evitando que `get_document_*`, `export_document_*` o `reconvert_pdf` fallen por ventanas demasiado cortas.
3. `backend/mcp_server/tools/notebook.py` hace que la espera batch por el DOCX final visible del lote también herede el presupuesto largo de `600s`.
4. `backend/dev/mcp_live_client.py` separa el timeout corto de transporte del timeout por defecto para `tools/call`, dejando las llamadas largas en `600s` sin inflar `initialize`, `list` o lecturas rápidas.
5. `backend/dev/mcp_torture_probe.py` reemplaza los `45/60/90/120/240s` heredados por un presupuesto uniforme de `600s` en sus llamadas y `timeout_per_cell`.
6. `backend/tests/test_mcp_server_remediation.py` y `backend/tests/test_notebook_timeout_defaults.py` agregan regresiones para evitar recaídas hacia ceilings más cortos.

**Archivos:** `backend/mcp_server/tools/analysis.py`, `backend/mcp_server/tools/documents.py`, `backend/mcp_server/tools/notebook.py`, `backend/dev/mcp_live_client.py`, `backend/dev/mcp_torture_probe.py`, `backend/tests/test_mcp_server_remediation.py`, `backend/tests/test_notebook_timeout_defaults.py`, `docs/modules/19-mcp-server.md`, `docs/changelog/19-mcp-server.md`, `AGENTS.md`

---

## 2026-04-15 - Reconciliación MCP tras disconnect WS en notebooks grandes

### Contexto

En notebooks grandes se reprodujo un `KERNEL_STATE_ERROR` falso cuando el backend ya había terminado una celda, pero el stream WS del bridge se cortaba antes de cerrar limpio. El caso era recuperable porque el `execution_id` seguía teniendo evidencia válida en sesión.

### Cambios tecnicos

1. `backend/mcp_server/tools/notebook.py` añade reconciliación post-disconnect para `execute_cell` y batches notebook-first.
2. La recuperación prioriza, en ese orden, el payload terminal ya observado para el `execution_id` y el artefacto exacto asociado a esa misma ejecución.
3. Las respuestas recuperadas exponen campos aditivos `recovered_after_disconnect`, `recovery_reason`, `outputs_degraded` y `variables_degraded`, sin inventar `outputs` ni `variables` completos.
4. No se agregan contratos backend nuevos: el cambio ajusta la capa MCP para reportar éxito recuperado cuando la evidencia de la ejecución ya existe.

**Archivos:** `backend/mcp_server/tools/notebook.py`, `backend/mcp_server/bridge.py`, `backend/mcp_server/session_state.py`, `docs/modules/19-mcp-server.md`, `docs/architecture/feature-threads.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`, `docs/changelog/19-mcp-server.md`

---

## 2026-04-15 - Default notebook-first de MCP sube a 600s por celda

### Cambios tecnicos

1. `backend/mcp_server/config.py` sube `INSPYRO_MCP_CELL_TIMEOUT` a `600s` como default operativo del catálogo notebook-first.
2. `backend/mcp_server/tools/notebook.py` mantiene la espera específica de notebook como `execution_timeout_s + gracia`, dejando `WS_TIMEOUT` y `REST_TIMEOUT` genéricos sin inflarlos globalmente.
3. La documentación MCP y el índice LLM quedan alineados con ese presupuesto para no recomendar todavía el default legado de `300s`.

**Archivos:** `backend/mcp_server/config.py`, `backend/mcp_server/tools/notebook.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/modules/19-mcp-server.md`, `docs/changelog/19-mcp-server.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`, `AGENTS.md`

---

## 2026-04-15 - `execute_all_cells` espera el DOCX final del `execution_id` batch

### Contexto

El último caso live de `mcp-torture` seguía mostrando una carrera en el rerender con template: el batch MCP podía devolver `status=completed` antes de que el `execution_id` público del lote tuviera su DOCX visible en `session_state`, y una mutación/reset posterior del template podía terminar asociando al lote un documento vacío o stale.

### Cambios tecnicos

1. `backend/mcp_server/tools/notebook.py` agrega una espera corta y explícita para que `execute_all_cells` con intención documental no cierre hasta que el DOCX final quede resolvible por el `execution_id` público del batch.
2. `backend/tests/test_mcp_server_remediation.py` endurece la regresión de artefactos tardíos para exigir que el resumen batch ya salga con el DOCX visible bajo ese `execution_id`.
3. La validación live vuelve a quedar cubierta con `mcp-smoke` y `mcp-torture`, cerrando el hueco reproducido en el rerender de templates.

**Archivos:** `backend/mcp_server/tools/notebook.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/modules/19-mcp-server.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`, `docs/changelog/19-mcp-server.md`

---

## 2026-04-14 - MCP document tools resuelven DOCX por `artifact_id` y reconstruyen token PDF desde `pdf_ref`

### Cambios tecnicos

1. `backend/mcp_server/tools/documents.py` ahora acepta handles DOCX sin `token` cuando `docx_ref` o `docx_download_url` apuntan a `/api/docx/download?artifact_id=...`; el export e inline download usan `artifact_id` sin convertirlo en `portable_resource_uri`.
2. `backend/mcp_server/tools/documents.py` sigue manteniendo PDF token-first, pero si `pdf_file_token` falta y `pdf_ref` trae `token`, el helper reconstruye el token para descargar, inlinear y exportar el PDF.
3. `backend/mcp_server/session_state.py` preserva `docx_artifact_id` junto con `docx_download_url`, de modo que el handle estable sobreviva dentro de la sesion MCP.
4. `backend/tests/test_mcp_server_remediation.py` agrega regresiones para DOCX artifact-id-only, PDF token recovery y persistencia de metadata de artefacto en la sesion.

**Archivos:** `backend/mcp_server/tools/documents.py`, `backend/mcp_server/session_state.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/modules/19-mcp-server.md`, `docs/changelog/19-mcp-server.md`

---

## 2026-04-13 - La sesión MCP registra artefactos que llegan después del terminal

### Cambios tecnicos

1. El relay tardío por `execution_id` registra `notebook_docx_update` y `notebook_pdf_ready` dentro de `McpSessionState`, incluso cuando `notebook_cell_executed` ya no trae DOCX inline.
2. Esto mantiene operativas las document tools link-first después del cambio backend que saca la exportación DOCX del camino crítico de la última celda.

**Archivos:** `backend/mcp_server/tools/notebook.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/modules/19-mcp-server.md`, `docs/changelog/19-mcp-server.md`

---

## 2026-04-13 - Relay MCP alinea progreso estructurado de ejecución/documento

### Cambios tecnicos

1. El contrato `notebook_progress_update` que observa MCP ahora distingue explícitamente keepalive de ejecución (`execution/cell_run`) y pipeline documental (`document/*`).
2. Esto permite a clientes MCP notebook-first conservar la misma separación verde/rojo que la UI humana sin depender de parseo textual libre.

**Archivos:** `docs/modules/19-mcp-server.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`, `docs/changelog/19-mcp-server.md`

---

## 2026-04-13 - Kernel-load persistable y relay tardío DOCX para notebooks grandes

### Contexto

El flujo MCP seguía arrastrando dos fragilidades con notebooks pesados: `notebook_load` y el hard reset reenviaban el notebook completo con outputs embebidos al backend, y el relay tardío del bridge ignoraba `notebook_docx_update`, dejando un hueco entre el terminal de ejecución y la publicación documental completa.

### Cambios tecnicos

1. `backend/mcp_server/tools/notebook.py` serializa una representación persistable del notebook para `notebook_load` y `reset_kernel(hard=true)`, eliminando `outputs`, `execution_count` y metadata runtime efímera antes de tocar el kernel.

2. El relay tardío por `execution_id` ahora observa también `notebook_docx_update`, lo refleja al espejo/UI y mantiene el seguimiento hasta `notebook_pdf_ready`.

3. El tipado de errores MCP agrega `CELL_EXECUTION_INTERRUPTED` para interrupciones/cancelaciones tardías que no deben mezclarse con `COM_BACKEND_TIMEOUT`.

4. `backend/tests/test_mcp_server_remediation.py` agrega regresiones para carga liviana real, hard reset persistable, relay tardío DOCX y tipado de `KeyboardInterrupt`.

### Riesgos/impacto

- `notebook_load` y `reset_kernel(hard=true)` mantienen la misma firma pública, pero dejan de reenviar notebooks gigantes al kernel cuando el archivo viene cargado de outputs históricos.

- El cambio es aditivo para clientes MCP: mejora resiliencia y correlación de artefactos sin romper contratos existentes.

### Archivos afectados

- `backend/mcp_server/tools/notebook.py`

- `backend/tests/test_mcp_server_remediation.py`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/contracts-catalog.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/synergy-matrix.md`

- `docs/llm-index.yaml`

---

## 2026-04-09 - Guidance DOCX AI-first endurecida a LaTeX-only

### Contexto

La guía extendida DOCX y la capa AI-first del MCP seguían mencionando rutas históricas de fórmulas aunque el estándar operativo visible para agentes ya debía quedar concentrado en LaTeX matemático. Eso dejaba una discoverability inconsistente entre guía, resources y prompts.

### Cambios tecnicos

1. `LLM_GUIDE_DOCX.md` elimina la documentación de las rutas históricas de fórmulas del flujo principal, dejando solo `math_latex()`, `EquationLatex()` y `create_math_latex_element()`.

2. `backend/mcp_server/resources/inspyro_resources.py` y `backend/mcp_server/prompts/inspyro_prompts.py` ajustan reglas DOCX para exponer únicamente el estándar LaTeX en la guidance AI-first.

3. `docs/modules/19-mcp-server.md` y `docs/architecture/feature-threads.md` alinean la narrativa pública del MCP con esa guidance LaTeX-only sin cambiar runtime ni contratos.

### Riesgos/impacto

- No cambia el catálogo MCP ni los contratos MCP/WS/REST.

- El soporte runtime subyacente para rutas históricas sigue existiendo, pero deja de promoverse en la documentación AI-first.

---

## 2026-04-09 - Guidance notebook-first pasa de prohibición editorial a recomendación

### Contexto

La documentación AI-first y la skill local estaban formulando el uso de `notebook_load`/`notebook_sync_cells`/`notebook_save` como una prohibición editorial absoluta frente a file tools o `nbformat`. La preferencia del producto es recomendar el camino notebook-first para agentes, sin presentar esa preferencia como regla editorial dura.

### Cambios tecnicos

1. `backend/mcp_server/server.py`, `backend/mcp_server/resources/inspyro_resources.py` y `backend/mcp_server/prompts/inspyro_prompts.py` cambian la guidance hacia "preferir notebook-first" en vez de "prohibir file tools/nbformat".

2. `docs/modules/19-mcp-server.md`, `docs/architecture/feature-threads.md` y `docs/llm-index.yaml` se alinean con esa nueva redacción.

3. La skill repo-local `inspyro-notebook-authoring` deja la misma idea como recomendación operativa y no como prohibición editorial.

### Riesgos/impacto

- No cambia contratos MCP/WS/REST.

- El cambio afecta wording/discoverability para agentes.

---

## 2026-04-09 - `tools/files.py` vuelve a permitir `.ipynb` sin abandonar la preferencia notebook-first

### Contexto

La guidance MCP ya había pasado a formular el camino notebook-first como preferencia para agentes, no como prohibición editorial. Quedaba desalineado el runtime porque `tools/files.py` seguía rechazando `.ipynb` con `NOTEBOOK_PATH_REQUIRES_NOTEBOOK_TOOL`.

### Cambios tecnicos

1. `backend/mcp_server/tools/files.py` elimina el bloqueo específico sobre `.ipynb` en `read_file`, `write_file`, `create_file`, `delete_file` y `rename_file`.

2. `backend/tests/test_mcp_server_remediation.py`, `backend/tests/test_mcp_ai_first.py` y `backend/dev/mcp_torture_probe.py` cambian sus expectativas de rechazo por casos de éxito sobre `.ipynb`.

3. `docs/modules/19-mcp-server.md`, `docs/architecture/feature-threads.md` y `docs/llm-index.yaml` se actualizan para reflejar que file tools pueden operar sobre notebooks, aunque la recomendación para agentes sigue siendo priorizar `notebook_load`/`notebook_sync_cells`/`notebook_save`.

### Riesgos/impacto

- Los clientes MCP ahora pueden usar file tools sobre `.ipynb` cuando lo necesiten.

- La recomendación AI-first no cambia: para agentes sigue siendo preferible el flujo notebook-first porque preserva mejor la semántica y el estado del notebook.

---

## 2026-04-09 - Hardening de completions/live torture y fallback de `reconvert_pdf`

### Contexto

La primera pasada live de `mcp-torture` ya cubría casi toda la superficie pública, pero seguía detectando dos fragilidades operativas: completions dependientes de `session_state` demasiado estricto en hosts/transportes reales, y `reconvert_pdf` fallando con `no_docx` aun cuando el flujo ya tenía un PDF/DOCX vigente asociado al kernel.

### Cambios tecnicos

1. `backend/mcp_server/completions.py` endurece `completion/complete` aceptando contexto directo o `context.arguments`, y agrega fallback de sugerencias via actividad MCP reciente (`/api/mcp/activity`) y `template_get` para `kernel_id`, `execution_id`/`run_id` y `style_name`.

2. `backend/mcp_server/session_state.py` suma helpers `list_*_any()` para mergear buckets de sesión cuando el host MCP o el transporte no conservan exactamente el bucket esperado durante completions.

3. `backend/app/routers/notebook_execution.py` reintenta `force_reconvert_pdf` restaurando el snapshot DOCX desde el artifact store persistente antes de devolver `no_docx`.

4. `backend/mcp_server/tools/documents.py` deja `reconvert_pdf` en modo link-first incluso cuando el backend ya no puede regenerar desde DOCX inline pero sí existe un PDF vigente asociado al kernel.

5. `backend/dev/mcp_live_client.py` y `backend/dev/mcp_torture_probe.py` se endurecen para clientes live reales: normalizan `context.arguments`, desacoplan kernels por fase, validan artefactos DOCX mutados con una ejecución fresca y permiten que el gate exhaustivo siga cubriendo `interrupt/reset/save/shutdown` aunque un kernel de prueba desaparezca antes del `interrupt`.

### Riesgos/impacto

- No cambia el catálogo público MCP, pero sí vuelve más resiliente la discoverability live y la recuperación de artefactos.

- `reconvert_pdf` puede degradar a un PDF vigente ya disponible cuando la reconversión real no es posible; el payload mantiene `raw` para que el cliente vea el motivo backend original.

### Archivos afectados

- `backend/mcp_server/completions.py`

- `backend/mcp_server/session_state.py`

- `backend/app/routers/notebook_execution.py`

- `backend/mcp_server/tools/documents.py`

- `backend/dev/mcp_live_client.py`

- `backend/dev/mcp_torture_probe.py`

- `docs/modules/19-mcp-server.md`

## 2026-04-08 - Campaña `mcp-torture` notebook-first sobre MCP live

### Contexto

`mcp-smoke` ya validaba onboarding, catálogo público y un flujo notebook+DOCX corto, pero seguía faltando una prueba live exhaustiva que ejerciera la superficie pública completa del MCP alrededor de un notebook real, incluyendo files, templates, documents, analysis, admin, activity summary y recovery.

### Cambios tecnicos

1. Se agregan `backend/dev/mcp_live_client.py`, `backend/dev/mcp_torture_assets.py` y `backend/dev/mcp_torture_probe.py` para hablar con el servidor MCP real por Streamable HTTP usando el mismo contrato de transporte de `agent_debug.ps1 mcp-smoke`.

2. El probe introduce un notebook canónico de tortura con `cell_id` estables, inputs auxiliares (`loads.json`, `sections.csv`), reporte DOCX rico, celda larga para interrupción y payloads reales para sensitivity/optimization/code checks.

3. Se agrega una fixture estable `backend/dev/fixtures/mcp_torture_template.docx` y una prueba estática `backend/tests/test_mcp_torture_probe.py` para evitar drift entre catálogo público, matriz de cobertura, spec del notebook y template fixture.

4. `agent_debug.ps1` suma el comando `mcp-torture`, acepta argumentos remanentes para pasarlos al probe y mantiene `mcp-smoke` como sanity gate rápido.

### Riesgos/impacto

- No cambia la API pública MCP; agrega una capa de validación live más agresiva.

- La campaña puede ser más lenta y sensible al estado real del backend/PDF/Word que `mcp-smoke`, por lo que se usa como gate exhaustivo y no como chequeo rápido.

### Archivos afectados

- `backend/dev/__init__.py`

- `backend/dev/mcp_live_client.py`

- `backend/dev/mcp_torture_assets.py`

- `backend/dev/mcp_torture_probe.py`

- `backend/dev/fixtures/mcp_torture_template.docx`

- `backend/tests/test_mcp_torture_probe.py`

- `agent_debug.ps1`

- `docs/modules/19-mcp-server.md`

- `docs/llm-index.yaml`

## 2026-04-08 - MCP notebook-first con perfil `authoring` por defecto

### Contexto

El MCP de Inspyro ya tenía onboarding AI-first, pero seguía publicando demasiadas primitives notebook y filesystem. Eso dejaba a clientes como Codex comparando el MCP contra editar `.ipynb` con `nbformat` o contra mutaciones JSON directas, y a veces el camino MCP no ganaba en simplicidad ni seguridad.

### Cambios tecnicos

1. `backend/mcp_server/config.py`, `server.py`, `runtime.py`, `activity.py` y `tools/system.py` reorientan la visibilidad MCP alrededor de perfiles `all`, `authoring`, `core`, `analysis`, `files` y `admin`, dejando `authoring` como default.

2. El catálogo público notebook se simplifica a `notebook_create`, `notebook_load`, `notebook_sync_cells`, `notebook_save`, `execute_cell`, `execute_all_cells`, `reset_kernel`, `interrupt_kernel`, `shutdown_kernel` y `get_variables`; `create_kernel`, `attach_kernel`, `list_cells`, `get_cell`, `find_in_notebook`, `kernel_status`, `execution_status`, `execute_cells`, `execute_until`, `add_cell`, `delete_cell`, `edit_cell` y `move_cell` salen de la superficie publicada.

3. `backend/mcp_server/tools/notebook.py` agrega `notebook_sync_cells`, extiende `notebook_create(cells=...)`, permite `execute_cell(source=None)` usando el source persistido y elimina `background` del contrato público de `execute_all_cells`.

4. `backend/mcp_server/tools/files.py` pasa a rechazar rutas `.ipynb` con error tipado `NOTEBOOK_PATH_REQUIRES_NOTEBOOK_TOOL`, apuntando a `notebook_load`, `notebook_sync_cells` y `notebook_save`.

5. `backend/mcp_server/resources/inspyro_resources.py`, `backend/mcp_server/prompts/inspyro_prompts.py` y `agent_debug.ps1` reescriben la discoverability para promover el flujo canonico `create/load -> notebook_sync_cells -> execute -> save -> get_document_*`, sin depender de conteos rígidos del catálogo.

6. `backend/app/services/mcp_activity.py` agrega resumen por tool (`started`, `completed`, `failed`, `last_seen`, `avg_duration_ms`) a `GET /api/mcp/activity`.

7. `backend/tests/test_mcp_ai_first.py` y `backend/tests/test_mcp_server_remediation.py` quedan alineados con el perfil `authoring`, la nueva tool `notebook_sync_cells`, `notebook_create(cells=...)` y el rechazo de `.ipynb` en file tools.

### Riesgos/impacto

- El cambio es breaking para clientes que dependían del catálogo MCP legacy o del parámetro `background` en `execute_all_cells`.

- El flujo notebook-first pasa a ser obligatorio para `.ipynb`; las tools de filesystem quedan reservadas a archivos no notebook.

- La visibilidad por perfil sigue dependiendo de capacidades del runtime FastMCP instalado, pero el smoke y la suite AI-first ahora validan explícitamente el comportamiento esperado.

### Archivos afectados

- `backend/mcp_server/config.py`

- `backend/mcp_server/server.py`

- `backend/mcp_server/runtime.py`

- `backend/mcp_server/activity.py`

- `backend/mcp_server/tools/system.py`

- `backend/mcp_server/tools/notebook.py`

- `backend/mcp_server/tools/files.py`

- `backend/mcp_server/resources/inspyro_resources.py`

- `backend/mcp_server/prompts/inspyro_prompts.py`

- `backend/app/services/mcp_activity.py`

- `backend/tests/test_mcp_ai_first.py`

- `backend/tests/test_mcp_server_remediation.py`

- `agent_debug.ps1`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/synergy-matrix.md`

- `docs/llm-index.yaml`

---

## 2026-03-29 - Guías MCP DOCX pasan a recomendar `math_latex()`

### Contexto

La motivación principal del flujo DOCX cambió: los agentes de IA producen ecuaciones en LaTeX con mucha más naturalidad que en la sintaxis histórica del builder, por lo que mantener guías MCP diciendo "no uses LaTeX" ya empujaba a errores sistemáticos en notebooks nuevos.

### Cambios tecnicos

1. `backend/mcp_server/resources/inspyro_resources.py` actualiza `inspyro://guides/docx-quickstart` y el ejemplo notebook DOCX para recomendar `builder.math_latex(...)` en celdas nuevas.

2. `backend/mcp_server/prompts/inspyro_prompts.py` alinea los prompts AI-first para que la guidance documental ya no contradiga la nueva API pública del builder.

3. `backend/mcp_server/tools/notebook.py` amplía los hints de detección DOCX para reconocer también `.math_latex(` y `EquationLatex(`.

4. La documentación del módulo MCP y `feature-threads` reflejan esta preferencia nueva dentro de la capa AI-first, mientras el detalle del runtime histórico permanece documentado en el módulo DOCX canónico.

### Riesgos/impacto

- No cambia el conteo del catálogo MCP ni los contratos MCP/WS/REST.

- Reduce el riesgo de que un agente recién conectado siga generando ecuaciones en la sintaxis histórica cuando el builder ya expone una ruta LaTeX explícita.

### Archivos afectados

- `backend/mcp_server/resources/inspyro_resources.py`

- `backend/mcp_server/prompts/inspyro_prompts.py`

- `backend/mcp_server/tools/notebook.py`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/feature-threads.md`

---

## 2026-03-24 - Default MCP de 300s para ejecucion de celdas

### Contexto

El flujo notebook normal ya habia quedado en `300s`, pero el servidor MCP seguia arrancando con `INSPYRO_MCP_CELL_TIMEOUT=60` y varias tools/docstrings/guides AI-first seguian sugiriendo valores (`180`/`240`) que quedaban por debajo del nuevo baseline operativo.

### Cambios tecnicos

1. `backend/mcp_server/config.py` sube el default de `INSPYRO_MCP_CELL_TIMEOUT` a `300`.

2. `backend/mcp_server/tools/notebook.py` deja de hardcodear `60` y alinea `execute_cell`, `execute_all_cells`, `execute_cells`, `execute_until` y `_execute_cell_impl` con el default MCP central.

3. `backend/mcp_server/resources/inspyro_resources.py` y `backend/mcp_server/prompts/inspyro_prompts.py` actualizan la guidance AI-first para partir de `300s` y sugerir incrementos mayores (`600`/`900`) en flujos COM, SAP2000, Word o conversion pesada.

4. `backend/tests/test_mcp_server_remediation.py` agrega una regresion sobre los defaults publicos de timeout en las tools notebook del MCP.

5. `agent_debug.ps1 mcp-smoke` se alinea con el catalogo MCP actual y consume paginacion de `tools/list` antes de validar los conteos canonicos.

### Riesgos/impacto

- No cambia la firma publica del catalogo MCP ni el contrato WS/REST subyacente.

- Los clientes que omitian `timeout` ahora reciben un presupuesto por defecto mas amplio, lo que reduce timeouts falsos en celdas pesadas pero puede demorar mas un fallo genuino si el kernel queda colgado.

### Archivos afectados

- `backend/mcp_server/config.py`

- `backend/mcp_server/tools/notebook.py`

- `backend/mcp_server/resources/inspyro_resources.py`

- `backend/mcp_server/prompts/inspyro_prompts.py`

- `backend/tests/test_mcp_server_remediation.py`

- `agent_debug.ps1`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/feature-threads.md`

- `AGENTS.md`

---

## 2026-03-22 - Artefactos portables por token y export explícito a path

### Contexto

La sesión MCP de esta iteración confirmó una limitación real del contrato documental: `get_document_docx/pdf` podía devolver un `resource_uri` que parecía portable, pero en realidad dependía del `McpSessionState` de la sesión viva. Eso impedía reabrir el binario desde otra sesión MCP y dejaba a la IA cliente sin una vía simple para pedir “exporta este PDF aquí”.

### Cambios tecnicos

1. `backend/app/services/notebook_service.py` deja de tratar inline y token store como caminos mutuamente excluyentes: DOCX y PDF ahora se materializan siempre en el download store cuando la persistencia funciona, aun si el artefacto también se devuelve inline por ser pequeño.

2. La metadata documental preserva `token`, `ref`, `hash`, `size_bytes` y `filename` real tanto para DOCX como para PDF; se agrega además `pdf_file_name` en el payload backend y en el registry MCP de sesión.

3. `backend/mcp_server/tools/documents.py` agrega `portable_resource_uri` y `resource_scope` a `get_document_docx/pdf`, manteniendo `resource_uri` legacy como handle session-scoped.

4. `backend/mcp_server/tools/documents.py` incorpora las nuevas tools `export_document_docx` y `export_document_pdf`, que exportan el binario a una ruta pedida por el cliente dentro de los roots MCP visibles, crean directorios padres cuando corresponde y emiten `file_mutation`.

5. `backend/mcp_server/resources/inspyro_resources.py` agrega el template `inspyro://artifacts/token/{kind}/{token}`, que lee el artefacto directamente por token sin depender del bucket de sesión.

6. `backend/mcp_server/completions.py`, `backend/mcp_server/activity.py` y `backend/mcp_server/prompts/inspyro_prompts.py` quedan alineados con la nueva semántica portable/exportable.

7. `backend/tests/test_mcp_ai_first.py` y `backend/tests/test_mcp_server_remediation.py` amplían cobertura para el catálogo actualizado, el handle portable y la exportación a path.

### Riesgos/impacto

- El contrato público crece: el catálogo pasa a 52 tools y 7 resource templates.

- `resource_uri` sigue existiendo por compatibilidad, pero ya no debe interpretarse como portable entre sesiones; el handle durable pasa a ser `portable_resource_uri` o una exportación explícita a path.

- La exportación a disco sigue restringida a los roots MCP expuestos por el cliente; no habilita escritura arbitraria fuera de esa intersección de seguridad.

### Archivos afectados

- `backend/app/services/notebook_service.py`

- `backend/app/routers/notebook_execution.py`

- `backend/mcp_server/runtime.py`

- `backend/mcp_server/session_state.py`

- `backend/mcp_server/tools/documents.py`

- `backend/mcp_server/tools/notebook.py`

- `backend/mcp_server/resources/inspyro_resources.py`

- `backend/mcp_server/prompts/inspyro_prompts.py`

- `backend/mcp_server/completions.py`

- `backend/mcp_server/activity.py`

- `backend/tests/test_mcp_ai_first.py`

- `backend/tests/test_mcp_server_remediation.py`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/feature-threads.md`

- `docs/llm-index.yaml`

- `AGENTS.md`

---

## 2026-03-15 - Timeout guidance explícita en la capa AI-first

### Contexto

Aunque el timeout MCP ya se propagaba correctamente al backend, un agente que entraba por primera vez al servidor podía no inferir que estaba permitido y recomendado subir `timeout` o `timeout_per_cell` en flujos con SAP2000, COM, Word o conversiones pesadas.

### Cambios tecnicos

1. `backend/mcp_server/resources/inspyro_resources.py` explicita en `manifest`, `start-here`, `notebook-workflow` y `error-recovery` que los timeouts notebook son ajustables a discrecion y da rangos orientativos (`180`/`240`) para tareas pesadas.

2. `backend/mcp_server/prompts/inspyro_prompts.py` incorpora la misma instruccion operativa en prompts de onboarding, depuracion, creacion de notebook DOCX y recuperacion de sesion.

3. `backend/mcp_server/tools/notebook.py` endurece las docstrings de `execute_cell`, `execute_all_cells`, `execute_cells` y `execute_until` para que el guidance tambien aparezca en `tools/list`.

### Riesgos/impacto

- No cambia la firma publica del protocolo MCP ni el conteo del catalogo.

- La superficie AI-first reduce la probabilidad de que un agente novato trate un timeout conservador como si fuera una limitacion fija del sistema.

### Archivos afectados

- `backend/mcp_server/resources/inspyro_resources.py`

- `backend/mcp_server/prompts/inspyro_prompts.py`

- `backend/mcp_server/tools/notebook.py`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/feature-threads.md`

- `docs/llm-index.yaml`

---

## 2026-03-15 - Propagación real de timeout notebook desde MCP al backend

### Contexto

Las tools notebook del MCP ya aceptaban `timeout`, pero ese valor solo gobernaba la espera del bridge. El backend seguía ejecutando con su propio timeout interno, lo que producía falsos `COM_BACKEND_TIMEOUT` en celdas largas aunque el cliente MCP hubiese pedido más tiempo.

### Cambios tecnicos

1. `backend/mcp_server/tools/notebook.py` propaga el timeout de `execute_cell` y batches como `execution_timeout_s` dentro de `notebook_execute_cell`.

2. El bridge conserva un margen corto adicional para recibir el terminal/error del backend y no convertirlo en timeout falso del cliente.

3. El mapeo de errores MCP trata `cell_execution_timeout` del backend igual que `kernel_lock_timeout` a nivel tipado (`COM_BACKEND_TIMEOUT`) para mantener una categoría estable de retry.

4. Se agregan regresiones para el payload WS propagado y el mapeo tipado del error.

### Riesgos/impacto

- No cambia la firma pública de las tools MCP: cambia la semántica interna para que `timeout` ahora sí gobierne la ejecución real del backend.

- El límite operativo efectivo sigue existiendo, pero ahora queda alineado entre tool, bridge y backend en vez de divergir silenciosamente.

### Archivos afectados

- `backend/mcp_server/tools/notebook.py`

- `backend/tests/test_mcp_server_remediation.py`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/synergy-matrix.md`

- `docs/llm-index.yaml`

---

## 2026-03-15 - Timeout defensivo para roots MCP

### Contexto

Algunos hosts MCP no responden correctamente a `list_roots()`, lo que podía dejar colgadas las tools de filesystem antes de intersectar el workspace activo con los roots visibles.

### Cambios tecnicos

1. `backend/mcp_server/runtime.py` envuelve `ctx.list_roots()` en un timeout y degrada a `[]` si el host no responde.

2. Se agregan regresiones unitarias para roots normales y timeout defensivo.

3. La documentación AI-first queda alineada con este comportamiento best-effort.

### Riesgos/impacto

- No cambia el contrato MCP público ni el criterio de seguridad.

- La prioridad pasa a ser continuidad operativa ante hosts parciales.

### Archivos afectados

- `backend/mcp_server/runtime.py`

- `backend/tests/test_mcp_runtime.py`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/synergy-matrix.md`

- `docs/llm-index.yaml`

---

## 2026-03-14 - Espejo MCP fiel para files, documents y lifecycle de kernel

### Contexto

El espejo MCP→UI ya cubria parte del flujo notebook/template, pero seguian faltando varios efectos visibles: `execute_cells`/`execute_until` no anclaban el target antes del runtime mirror, `reset/interrupt/shutdown` no dejaban rastro visual, `notebook_save` no diferenciaba save-as y las mutaciones de filesystem o `reconvert_pdf` dependian de hints parciales del feed de actividad.

### Cambios tecnicos

1. `backend/mcp_server/mirror.py` y `backend/app/services/mcp_mirror.py` amplian el contrato granular con la nueva accion `file_mutation`.

2. `backend/mcp_server/tools/files.py` emite `file_mutation` para `write_file`, `create_file`, `rename_file` y `delete_file`, incluyendo `mutation`, rutas relevantes, `is_directory` y `file_kind`.

3. `backend/mcp_server/tools/notebook.py` hace que `execute_cells` y `execute_until` emitan `open_resource` al inicio; `reset_kernel`, `interrupt_kernel` y `shutdown_kernel` publican runtime mirror de lifecycle; `notebook_save` solo emite `open_resource` + `notebook_snapshot` cuando hay save-as.

4. `backend/mcp_server/tools/documents.py` hace que `reconvert_pdf` emita `open_resource(focus_view='docx')` antes de `artifact_update(pdf)`.

5. `backend/tests/test_mcp_mirror.py` agrega regresiones para batches, lifecycle de kernel, save-as, `file_mutation` y reconversion PDF.

### Riesgos/impacto

- `mcp_mirror_event` sigue siendo live/best-effort: no existe replay persistente de pasos granulares pasados.

- El backend ya no promete `mirror_conflict` como accion dedicada; el conflicto visual queda en manos del shell porque solo la UI conoce dirty state y tabs abiertos.

- `get_document_docx/pdf` permanecen como herramientas link-first/feed-only en esta fase; el espejo visual mutante de documents se limita a `reconvert_pdf`.

### Archivos afectados

- `backend/app/services/mcp_mirror.py`

- `backend/mcp_server/mirror.py`

- `backend/mcp_server/tools/notebook.py`

- `backend/mcp_server/tools/files.py`

- `backend/mcp_server/tools/documents.py`

- `backend/tests/test_mcp_mirror.py`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/contracts-catalog.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/synergy-matrix.md`

- `docs/llm-index.yaml`

---

## 2026-03-14 - Completions MCP dinamicas sobre prompts y resource templates

### Contexto

La remediacion anterior habia dejado el servidor alineado con tasks, annotations, resource templates y estado por sesion, pero seguia faltando una capacidad MCP estandar importante para discoverability: `completion/complete`. El protocolo y el low-level server de `mcp` ya lo soportaban; FastMCP 3.0.2 todavia no lo exponia en su API de alto nivel.

### Cambios tecnicos

1. Se agrega `backend/mcp_server/completions.py`, que registra `completion/complete` directamente sobre `mcp._mcp_server.completion()` cuando el runtime lo soporta.

2. Las completions cubren prompts y templates existentes sin ampliar el catalogo publico: `review_notebook.notebook_path`, `recover_mcp_notebook_session.{notebook_path,kernel_id,style_name}`, `unit_conversion_help.{from_unit,to_unit}`, `inspyro://notebooks/{path*}/cells/{cell_id}`, `inspyro://artifacts/{kernel_id}/{kind}`, `inspyro://artifacts/{kernel_id}/{kind}/{execution_id}`, `inspyro://runs/{run_id}` y templates de workspace.

3. `backend/mcp_server/session_state.py` incorpora listados de kernels/notebooks/runs y cache de template por `kernel_id`, con estilos disponibles para sugerir `style_name` en la misma sesion MCP.

4. `backend/mcp_server/tools/templates.py` persiste snapshots de template en el registry de sesion despues de `upload_template`, `get_template_info`, `update_template_style` y limpia ese estado al borrar la plantilla.

5. `backend/mcp_server/prompts/inspyro_prompts.py` amplía `recover_mcp_notebook_session` con `style_name` para que el protocolo pueda ofrecer esa completion sin agregar prompts artificiales.

6. `backend/tests/test_mcp_ai_first.py` agrega cobertura black-box de completions y `agent_debug.ps1 mcp-smoke` pasa a validar `completion/complete` end-to-end contra el servidor HTTP real.

### Riesgos/impacto

- El aislamiento operativo por `session_id` se mantiene para tools/resources; solo las completions usan un fallback acotado al unico bucket activo cuando el runtime low-level no propaga el `session_id` que sí ve FastMCP en las tools.

- No cambia el conteo publico del catalogo MCP: siguen siendo 50 tools, 14 resources, 6 resource templates y 7 prompts.

- La capacidad sigue siendo estandar MCP: no introduce endpoints propietarios ni extensiones fuera de `completion/complete`.

### Archivos afectados

- `backend/mcp_server/completions.py`

- `backend/mcp_server/server.py`

- `backend/mcp_server/session_state.py`

- `backend/mcp_server/tools/templates.py`

- `backend/mcp_server/prompts/inspyro_prompts.py`

- `backend/tests/test_mcp_ai_first.py`

- `agent_debug.ps1`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/synergy-matrix.md`

- `docs/llm-index.yaml`

---

## 2026-03-13 - Session scoping, link-first artifacts y surface MCP tipada

### Contexto

El servidor MCP ya exponia la superficie funcional correcta, pero seguia arrastrando tres limites de arquitectura: estado global compartido entre sesiones HTTP, contratos documentales demasiado verbosos en artefactos (`base64` inline por defecto) y discoverability incompleta para clientes MCP modernos (`manifest`, templates, annotations/tags/tasks).

### Cambios tecnicos

1. `backend/mcp_server/bridge.py` y `backend/mcp_server/session_state.py` pasan a modelo session-scoped por `session_id`, aislando bridges REST/WS, mapeos `kernel_id <-> notebook_path`, artefactos y ejecuciones entre clientes concurrentes.

2. Se agrega `backend/mcp_server/runtime.py` para centralizar contexto MCP opcional: roots del host, `session_id`, progreso/logging nativos y visibilidad tag-based por sesion.

3. `backend/mcp_server/activity.py` deja de registrar tools "peladas" y ahora intenta publicar `annotations`, `tags`, `task` y metadata de grupo/perfil en `tools/list`.

4. `backend/mcp_server/tools/system.py` agrega `list_component_profiles` y `set_component_profile`; `get_system_info` reporta `component_profile` y `default_component_profile`.

5. `backend/mcp_server/tools/documents.py` pasa a respuesta link-first por defecto: devuelve `token`, `ref`, `resource_uri`, `hash`, `size_bytes` y `content_type`, y solo inlinea `pdf_base64`/`docx_base64` bajo `inline_content=true` y umbral real (`MAX_PDF_SIZE_BYTES`, `MAX_DOCX_SIZE_BYTES`).

6. `backend/mcp_server/resources/inspyro_resources.py` agrega `inspyro://manifest` y 6 resource templates (`workspace/tree`, `workspace/file`, `notebooks/.../cells/...`, `artifacts/...`, `runs/...`).

7. `backend/mcp_server/tools/files.py` se vuelve root-aware: sigue anclado al workspace activo del backend, pero rechaza rutas fuera de los roots MCP visibles cuando el host los expone.

8. `backend/mcp_server/tools/notebook.py` reporta progreso/logging MCP en ejecuciones largas y mantiene `execution_status` como shim de compatibilidad.

9. `backend/mcp_server/server.py` agrega knobs `INSPYRO_MCP_DEFAULT_PROFILE`, `INSPYRO_MCP_LIST_PAGE_SIZE` e `INSPYRO_MCP_MASK_ERROR_DETAILS`, y deja el shutdown alineado con `disconnect_all()`.

10. `backend/mcp_server/requirements-mcp.txt`, `backend/mcp_server/start_mcp.py`, `backend/tests/test_mcp_ai_first.py`, `backend/tests/test_mcp_server_remediation.py` y `agent_debug.ps1` se actualizan para el nuevo catalogo publico (50 tools, 14 resources, 6 templates, 7 prompts) y su validacion.

### Riesgos/impacto

- Los clientes que asumian artefactos inline por defecto ahora deben pedir `inline_content=true` o consumir `resource_uri`/`token`/`ref`.

- El scoping por sesion cambia la semantica observable en HTTP: un `kernel_id` ya no debe asumirse reusable entre clientes diferentes aunque compartan backend.

- La aplicacion de perfiles visibles depende de capacidades del runtime FastMCP instalado; la surface base sigue siendo compatible si el host no soporta visibilidad por tags.

- FastMCP no exponia entonces el registro de completions de alto nivel; la capacidad queda reintroducida en la entrada 2026-03-14 usando el low-level server oficial de `mcp`.

### Archivos afectados

- `backend/mcp_server/activity.py`

- `backend/mcp_server/bridge.py`

- `backend/mcp_server/config.py`

- `backend/mcp_server/runtime.py`

- `backend/mcp_server/server.py`

- `backend/mcp_server/session_state.py`

- `backend/mcp_server/start_mcp.py`

- `backend/mcp_server/tools/notebook.py`

- `backend/mcp_server/tools/files.py`

- `backend/mcp_server/tools/documents.py`

- `backend/mcp_server/tools/system.py`

- `backend/mcp_server/resources/inspyro_resources.py`

- `backend/mcp_server/prompts/inspyro_prompts.py`

- `backend/mcp_server/requirements-mcp.txt`

- `backend/tests/test_mcp_ai_first.py`

- `backend/tests/test_mcp_server_remediation.py`

- `agent_debug.ps1`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/system-context.md`

- `docs/architecture/synergy-matrix.md`

- `docs/llm-index.yaml`

- `AGENTS.md`

---

## 2026-03-12 - Hardening notebook MCP: modo liviano, polling y kernel lifecycle

### Contexto

Los notebooks técnicos grandes estaban consumiendo demasiados tokens al serializar celdas completas por defecto y seguían teniendo puntos frágiles al resetear kernels o diagnosticar ejecuciones batch largas desde MCP.

### Cambios tecnicos

1. `backend/mcp_server/tools/notebook.py` pasa `notebook_load` y `notebook_create` a respuestas livianas por celda (`source_preview`, `source_len`, `has_outputs`, `last_execution_count`) y mueve inspección detallada a `list_cells`, `get_cell` y `find_in_notebook`.

2. Se agregan tools notebook nuevas: `create_kernel`, `attach_kernel`, `execute_cells`, `execute_until`, `kernel_status` y `execution_status`.

3. `execute_all_cells` y los nuevos batches devuelven resúmenes compactos con `execution_id`, contadores y `duration_ms`; `execution_status` hace polling incremental con estado por celda, heartbeat y outputs fallidos bajo demanda.

4. `backend/mcp_server/session_state.py` amplía el registry local para guardar estado de kernel (`idle/running/error/disconnected`), ejecuciones, timeline y resultados resumidos.

5. `reset_kernel` se vuelve idempotente en la capa MCP y agrega fallback de hard reset reconstruyendo la sesión desde el notebook cuando el backend falla con errores tipo `threads can only be started once`.

6. Los errores notebook se tipan de forma consistente (`NOTEBOOK_PARSE_ERROR`, `NOTEBOOK_ENCODING_ERROR`, `KERNEL_RESET_FAILED`, `COM_BACKEND_TIMEOUT`, `CELL_EXECUTION_ERROR`, etc.) y `get_variables` filtra variables runtime por defecto.

7. `backend/mcp_server/activity.py` actualiza el catálogo de notebook mutations y resúmenes UI para la nueva superficie pública.

8. `backend/tests/test_mcp_server_remediation.py` agrega regresiones de carga liviana, inspección puntual, background polling, fallback de reset y filtrado de variables; `backend/tests/test_mcp_ai_first.py` actualiza el conteo público del catálogo a 48 tools.

### Riesgos/impacto

- Cambian los defaults de serialización de notebook: los clientes reciben menos contexto inline salvo que pidan `include_source`, `include_outputs` o `include_failed_outputs`.

- `reset_kernel(hard=true)` puede devolver un `kernel_id` nuevo si el fallback reconstruye la sesión, por lo que el caller debe usar el `kernel_id` retornado.

- La UI no cambia contrato propio, pero cualquier cliente MCP que asumiera blobs grandes inline en `notebook_load` o `execute_all_cells` debe adaptarse al modo liviano.

### Archivos afectados

- `backend/mcp_server/tools/notebook.py`

- `backend/mcp_server/session_state.py`

- `backend/mcp_server/activity.py`

- `backend/tests/test_mcp_server_remediation.py`

- `backend/tests/test_mcp_ai_first.py`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/synergy-matrix.md`

- `docs/llm-index.yaml`

---

## 2026-03-11 - Files MCP ancladas al workspace activo

### Contexto

Tras habilitar workspaces de usuario desde la UI, las tools MCP de filesystem todavia podian caer en el cwd del proceso (`C:\CalcPyro\P2`) cuando el cliente llamaba `list_files()` sin `path` o usaba rutas relativas.

### Cambios tecnicos

1. `backend/mcp_server/tools/files.py` agrega resolucion interna de rutas contra `active_workspace`, con fallback a `workspace_path`/`workspace_root` reportados por `GET /api/system/info`.

2. `list_files` deja de usar `"."` como default operativo y ahora lista la raiz del workspace activo si el cliente omite `path`.

3. `read_file`, `write_file`, `create_file`, `delete_file` y `rename_file` resuelven rutas relativas dentro del workspace activo antes de llamar al backend REST.

4. `rename_file` acepta renombrado relativo por basename dentro del directorio original del archivo, manteniendo la limitacion de no hacer moves cross-directory porque el backend solo expone rename por nombre.

5. `backend/tests/test_mcp_server_remediation.py` agrega regresiones para default de `list_files()` y resolucion de rutas relativas.

### Riesgos/impacto

- No cambia ninguna firma MCP publica; el cambio corrige la semantica por defecto y hace a las tools mas seguras para clientes que no conocen el cwd del proceso.

- Las rutas absolutas siguen siendo respetadas; el anclaje al workspace solo aplica a rutas omitidas o relativas.

### Archivos afectados

- `backend/mcp_server/tools/files.py`

- `backend/tests/test_mcp_server_remediation.py`

- `docs/modules/19-mcp-server.md`

---

## 2026-03-11 - Hardening AI-first de onboarding MCP

### Contexto

El MCP ya exponia las tools reales de Inspyro, pero una IA externa seguia dependiendo de conocimiento implicito del repo para descubrir el flujo correcto de notebooks, DOCX, artefactos, templates y recuperacion de errores.

### Cambios tecnicos

1. `backend/mcp_server/server.py` endurece `mcp.instructions` para que cualquier cliente lea primero `inspyro://guides/start-here`.

2. `backend/mcp_server/resources/inspyro_resources.py` mantiene los 5 resources operativos y agrega 8 resources AI-first: onboarding, workflow notebook, quickstart DOCX, lifecycle de artefactos, templates, analysis/units, recovery y ejemplo notebook+DOCX.

3. `backend/mcp_server/prompts/inspyro_prompts.py` reescribe los 4 prompts existentes para que lean guides MCP antes de actuar y agrega 3 prompts nuevos de onboarding, flujo DOCX y recuperacion de sesion.

4. `backend/mcp_server/tools/notebook.py`, `tools/documents.py`, `tools/templates.py` y `tools/units.py` mejoran sus descripciones publicas sin cambiar firmas, documentando cuando usar, prerrequisitos, resultado y siguiente tool tipica.

5. `backend/tests/test_mcp_ai_first.py` agrega una suite black-box que usa solo `initialize`, `resources/read`, `prompts/get` y `tools/call`, incluyendo un flujo notebook+DOCX y un caso de recuperacion desde `missing_artifact`.

6. `agent_debug.ps1 mcp-smoke` ahora valida conteos publicos, presencia de resources/prompts obligatorios y contenido minimo de `start-here`, el ejemplo DOCX y el prompt de onboarding.

7. `get_system_info` y `inspyro://system/info` normalizan `workspace_path` desde `workspace_root` para que clientes MCP ciegos al repo reciban siempre un campo canonico utilizable.

### Riesgos/impacto

- No cambia ninguna firma de tool ni el nivel de abstraccion del MCP; el cambio es aditivo en discoverability y DX.

- Los clientes MCP existentes ven mas resources y prompts, pero los nombres legacy se conservan.

- El catalogo publico ahora exige sincronizar instrucciones, resources, prompts, docstrings y smoke tests para no romper la autosuficiencia AI-first.

### Archivos afectados

- `backend/mcp_server/server.py`

- `backend/mcp_server/resources/inspyro_resources.py`

- `backend/mcp_server/prompts/inspyro_prompts.py`

- `backend/mcp_server/tools/notebook.py`

- `backend/mcp_server/tools/documents.py`

- `backend/mcp_server/tools/templates.py`

- `backend/mcp_server/tools/units.py`

- `backend/tests/test_mcp_ai_first.py`

- `agent_debug.ps1`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/synergy-matrix.md`

- `docs/llm-index.yaml`

---

## 2026-03-10 - Compatibilidad HTTP/DX y smoke reproducible

### Contexto

Durante la validación desde clientes externos aparecieron dos fricciones distintas: el modo HTTP por defecto exigía negociación SSE stateful poco amigable para pruebas manuales y el arranque MCP fallaba demasiado pronto cuando el backend aún no estaba listo.

### Cambios tecnicos

1. `backend/mcp_server/server.py` agrega flags `--json-response` y `--stateless-http` para ofrecer un modo HTTP mas simple a clientes genericos.

2. `backend/mcp_server/start_mcp.py` agrega `--wait-for-backend`, reintento del health del backend y forwarding explícito de argumentos al servidor real.

3. `backend/mcp_server/__main__.py` pasa a reutilizar `start_mcp.py`, alineando `python -m mcp_server` con el mismo preflight usado por clientes desktop.

4. `agent_debug.ps1` incorpora `mcp-smoke`, que valida `initialize`, `tools/list`, `resources/list`, `prompts/list` y `tools/call get_health` contra el servidor MCP real.

5. Se amplía cobertura en `backend/tests/test_mcp_server_remediation.py` para wait/retry del backend y flags HTTP compatibles.

### Riesgos/impacto

- `stdio` no cambia su contrato; sigue siendo el camino recomendado para clientes desktop.

- El modo HTTP friendly es opt-in; no rompe clientes existentes que ya consumen SSE/stateful.

- El smoke test depende de backend+MCP activos y no reemplaza `verify-fast`/`verify`.

### Archivos afectados

- `backend/mcp_server/config.py`

- `backend/mcp_server/server.py`

- `backend/mcp_server/start_mcp.py`

- `backend/mcp_server/__main__.py`

- `agent_debug.ps1`

- `backend/tests/test_mcp_server_remediation.py`

- `docs/modules/19-mcp-server.md`

- `docs/agents/quickstart.md`

- `docs/llm-index.yaml`

- `AGENTS.md`

---

## 2026-03-08 - Réplica UI granular por `mcp_mirror_event`

### Contexto

El feed MCP ya mostraba actividad estructurada, pero la UI humana no podía reproducir paso a paso lo que hacía la IA: las tools notebook/template actuaban por el websocket privado del bridge y el shell solo disponía de `started/completed/failed`.

### Cambios tecnicos

1. **Nuevo relay granular:** `backend/app/services/mcp_mirror.py` normaliza eventos y `backend/app/routers/mcp_manager.py` expone `POST /api/mcp/mirror-events`, que broadcast ea `mcp_mirror_event` por `/ws`.

2. **Contexto compartido activity→mirror:** `backend/mcp_server/activity.py` conserva `run_id`, `tool_name` y `tool_group` para que `backend/mcp_server/mirror.py` emita eventos de espejo coherentes con el run activo.

3. **Streaming WS reutilizable:** `InspyroBridge.ws_request_multi()` acepta callback por mensaje y permite relay en tiempo real de `notebook_stream`, `notebook_clear_output`, `notebook_cell_executed` y mensajes afines.

4. **Instrumentacion notebook/template:** las tools MCP de notebook emiten `open_resource`, `notebook_snapshot`, `notebook_runtime_message` y `artifact_update`; las tools de template emiten `open_resource` con foco `docx` y `template_snapshot`.

5. **Cobertura de regresion:** se agregan pruebas para normalizacion/broadcast de `mcp_mirror_event`, secuencia de `execute_cell` y snapshots template.

### Riesgos/impacto

- `mcp_mirror_event` es aditivo y no reemplaza `mcp_activity_event`; la telemetría/feed sigue separada del replay UI.

- El espejo sigue siendo best-effort: si el relay falla, la tool MCP mantiene su efecto real sobre backend/filesystem.

- La UX final depende del arbitraje frontend por dirty state y disponibilidad del recurso objetivo.

### Archivos afectados

- `backend/app/routers/mcp_manager.py`

- `backend/app/services/mcp_mirror.py`

- `backend/mcp_server/activity.py`

- `backend/mcp_server/mirror.py`

- `backend/mcp_server/bridge.py`

- `backend/mcp_server/tools/notebook.py`

- `backend/mcp_server/tools/templates.py`

- `backend/tests/test_mcp_mirror.py`

- `docs/architecture/contracts-catalog.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/synergy-matrix.md`

- `docs/modules/19-mcp-server.md`

- `docs/modules/14-main-app.md`

- `docs/modules/11-notebook-editor-ui.md`

- `docs/modules/17-template-editor.md`

- `docs/llm-index.yaml`

---

## 2026-03-08 - Continuidad de `kernel_id` en snapshots de mutación notebook

### Contexto

Durante la validación visual del replay MCP, la UI podía reflejar edición/movimiento de celdas pero quedar sin contexto de kernel si la mutación venía de `add_cell`, `edit_cell` o `delete_cell` sobre un notebook ya abierto por MCP.

### Cambios tecnicos

1. `backend/mcp_server/tools/notebook.py` ahora consulta `session_state.py` para recuperar `kernel_id` desde `notebook_path` cuando emite snapshots de mutación same-path.

2. `open_resource` y `notebook_snapshot` para `add_cell`, `edit_cell` y `delete_cell` arrastran ese `kernel_id`, permitiendo que el shell mantenga continuidad de toolbar/template/docx sin depender de un `notebook_load` nuevo.

3. Se agrega cobertura de regresión en `backend/tests/test_mcp_mirror.py` para asegurar que `edit_cell` reinyecta el `kernel_id` registrado.

### Riesgos/impacto

- El contrato WS no cambia; solo se completa metadata opcional ya prevista en `mcp_mirror_event.payload.kernel_id`.

- Si el notebook no fue registrado previamente por MCP, el comportamiento sigue siendo best-effort y el `kernel_id` puede permanecer ausente.

### Archivos afectados

- `backend/mcp_server/tools/notebook.py`

- `backend/tests/test_mcp_mirror.py`

- `docs/modules/19-mcp-server.md`

---

## 2026-03-07 - Actividad MCP estructurada y espejo visual seguro

### Contexto

La UX del frontend no mostraba actividad MCP real: las tools ejecutaban cambios efectivos pero la interfaz no recibía una representación estructurada ni señales para refrescar contexto visible. Se agrega un canal de actividad explícito y seguro entre servidor MCP, backend principal y shell React.

### Cambios tecnicos

1. **Instrumentacion transversal:** nueva capa `backend/mcp_server/activity.py` envuelve las 39 tools MCP y emite eventos `started/completed/failed`.

2. **Relay backend principal:** nuevo store en memoria (`backend/app/services/mcp_activity.py`) y endpoints `GET /api/mcp/activity`, `POST /api/mcp/activity/events`.

3. **Broadcast WS:** el backend principal difunde `mcp_activity_event` por el WS existente para alimentar UI sin polling de alta frecuencia.

4. **Hints UI seguros:** las familias `files`, `notebook`, `templates` y `documents` generan `ui_hints` (`refresh_workspace`, `reload_path`, `show_agent_execution`, `refresh_preview`, `artifact`); `analysis`, `units` y `system` quedan como feed/notificación.

5. **Espejo contextual:** el frontend solo recarga el recurso activo si coincide con el evento y no tiene dirty state local; si está sucio, muestra aviso y evita sobrescritura.

### Riesgos/impacto

- El contrato `mcp_activity_event` es aditivo y no altera el protocolo MCP externo ni el dispatcher WS principal.

- Los eventos de actividad son best-effort; si el relay falla, la tool MCP sigue ejecutando su trabajo real.

- `execute_all_cells` y tools compuestas pueden generar granularidad alta de eventos; la UX depende del filtrado/agrupación del frontend.

### Archivos afectados

- `backend/mcp_server/activity.py`

- `backend/app/services/mcp_activity.py`

- `backend/app/routers/mcp_manager.py`

- `frontend/src/hooks/useMcpActivity.js`

- `frontend/src/components/McpPanel.js`

- `frontend/src/components/McpStatusButton.js`

- `frontend/src/components/NotificationCenter.js`

- `frontend/src/components/NotebookEditor.js`

- `docs/architecture/contracts-catalog.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/synergy-matrix.md`

- `docs/modules/14-main-app.md`

- `docs/modules/15-notification-center.md`

- `docs/modules/19-mcp-server.md`

- `docs/llm-index.yaml`

---

## 2026-03-07 - Hardening runtime de notebook/documents/units

### Contexto

Durante un smoke real del MCP aparecieron tres no conformidades separadas: `execute_cell` no activaba el preámbulo DOCX aunque la celda usara `build_doc/doc_reset`, `get_document_docx/pdf` no encontraba artefactos inline recién emitidos y `check_units_compatible` no resolvía aliases como `force_pound`.

### Cambios tecnicos

1. `tools/notebook.py` detecta uso real de la API DOCX en `source` y fuerza `emit_docx` al backend cuando corresponde.

2. `_source_to_text()` recompone listas de líneas preservando saltos entre fragmentos para no concatenar código notebook inválido.

3. `execute_cell` backfillea `kernel_id`/`cell_id` al registrar artefactos inline en `session_state.py`, permitiendo que `get_document_docx` y `get_document_pdf` encuentren exportes inmediatos aunque el artefacto no use `token`.

4. `tools/units.py` amplía matching de compatibilidad a `canonical`, `display`, `pint`, `pint_symbol` y `aliases`.

### Riesgos/impacto

- El cambio no altera el contrato MCP externo; endurece la adaptación sobre contratos backend ya existentes.

- La exportación PDF sigue siendo potencialmente asíncrona: el DOCX puede quedar disponible antes que `notebook_pdf_ready`.

### Archivos afectados

- `backend/mcp_server/tools/notebook.py`

- `backend/mcp_server/tools/units.py`

- `backend/tests/test_mcp_server_remediation.py`

- `docs/modules/19-mcp-server.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/synergy-matrix.md`

- `docs/architecture/contracts-catalog.md`

- `docs/llm-index.yaml`

---

## 2026-03-07 - Remediacion integral de contratos MCP

### Contexto

La implementacion inicial del servidor MCP habia quedado como wrapper best-effort sobre REST/WS, con drift real en notebook, documents, templates, files y analysis. Se corrige el adaptador para trabajar con los contratos reales del backend y para fallar de forma estructurada cuando faltan prerequisitos.

### Cambios tecnicos

1. **Correlacion WS dura:** `InspyroBridge` deja de correlacionar por `type` global y pasa a usar waiters por `request_id` y subscribers por `execution_id`. Un disconnect invalida pendientes y despierta requests bloqueados.

2. **Estado MCP minimo:** nuevo `session_state.py` para mapear `kernel_id <-> notebook_path` y ultimos artefactos DOCX/PDF por kernel/ejecucion.

3. **Notebook tools reales:** `notebook_create`, `notebook_load`, `notebook_save`, `move_cell`, `execute_cell`, `execute_all_cells` y `shutdown_kernel` operan sobre notebooks `.ipynb` gestionados, no sobre wrappers WS ambiguos.

4. **Documents tools corregidas:** `get_document_pdf` y `get_document_docx` descargan por `token` o `ref` reales y devuelven `missing_artifact` cuando no existe export previa.

5. **Templates corregidos:** `upload_template` lee `.docx` binario local, sube por multipart REST, consume `template_token` y adjunta por `template_attach`.

6. **Files corregidos:** `create_file` y `rename_file` se alinean con `/api/files/create` (`path + name + type`) y `/api/files/rename` (`oldPath + newName`).

7. **Analysis normalizado:** las tools MCP usan `symbol`, `formulas` como `dict`, `code_profile`, `seed`, `modified_variables`, `output_variables` y `current_values` segun contrato WS real.

8. **Backend WS reforzado:** handlers notebook/template relevantes reflejan `request_id`; los mensajes IOPub/documentales usados por MCP incluyen `execution_id`.

9. **CLI stdio segura:** `start_mcp.py --stdio` deja de imprimir banners o checks a stdout antes del protocolo MCP.

10. **Pruebas nuevas:** `backend/tests/test_mcp_server_remediation.py` cubre session state, correlacion del bridge, `request_id`/`execution_id`, tools MCP de templates/analysis y silencio de stdout en stdio.

### Riesgos/impacto

- Cambian firmas publicas MCP de analysis para reflejar el contrato backend real.

- El servidor MCP ahora falla explicitamente cuando falta notebook gestionado o artefacto exportado, en vez de fabricar un `ok` ambiguo.

- La semantica del frontend no cambia; los cambios WS en backend son aditivos (`request_id`, `execution_id`).

### Archivos afectados

- `backend/mcp_server/bridge.py`

- `backend/mcp_server/session_state.py`

- `backend/mcp_server/start_mcp.py`

- `backend/mcp_server/tools/notebook.py`

- `backend/mcp_server/tools/documents.py`

- `backend/mcp_server/tools/files.py`

- `backend/mcp_server/tools/templates.py`

- `backend/mcp_server/tools/analysis.py`

- `backend/app/routers/notebook_execution.py`

- `backend/app/routers/notebook_kernel_control.py`

- `backend/app/services/notebook_service.py`

- `backend/tests/test_mcp_server_remediation.py`

- `docs/modules/19-mcp-server.md`

- `docs/modules/04-notebook-handlers.md`

- `docs/architecture/contracts-catalog.md`

- `docs/architecture/feature-threads.md`

- `docs/architecture/synergy-matrix.md`

- `docs/llm-index.yaml`

---

## 2026-03-06 - Implementacion inicial del servidor MCP

### Contexto

Se creo un servidor MCP local e independiente para permitir que cualquier modelo de IA interactue con Inspyro. Usa FastMCP 3.0 con transporte Streamable HTTP + stdio.

### Cambios tecnicos

1. **Infraestructura:** `config.py`, `bridge.py`, `server.py`.

2. **39 tools MCP** distribuidas en notebook, files, documents, analysis, system, templates y units.

3. **5 resources MCP:** system/info, system/health, units/catalog, pdf/status, files/tree.

4. **4 prompts MCP:** create_engineering_notebook, debug_cell_error, review_notebook, unit_conversion_help.

5. **Dependencias dedicadas:** `fastmcp`, `mcp[cli]`, `httpx`, `websockets`.

### Riesgos/impacto

- No modifica modulos internos del backend; consume contratos existentes.

- Requiere backend Inspyro activo en `:8000`.

- Puerto MCP por defecto: `8100`.

