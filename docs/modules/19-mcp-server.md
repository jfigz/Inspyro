# 19 - MCP Server (Servidor MCP Local)

> **Estado:** Implementado

> **Ubicacion:** `backend/mcp_server/`

> **Última actualización:** 2026-04-28

> **Changelog:** `docs/changelog/19-mcp-server.md`

---

## Proposito sistemico

Exponer capacidades de Inspyro a modelos de IA externos mediante MCP (Model Context Protocol). El servidor corre localmente, consume el backend existente via REST + WebSocket y actua como capa adaptadora, no como nueva fuente de verdad funcional.

## Celdas DOCX notebook-first (2026-04-28)

- `notebook_create(cells=...)` y `notebook_sync_cells` aceptan `cell_type="docx"`; si una celda legacy llega como `code` pero usa APIs DOCX detectables, la normalización MCP puede migrarla a `docx`.
- `list_cells`, `get_cell` y `find_in_notebook` reportan `type: "docx"` para estas celdas, manteniendo `docx` como Python ejecutable dentro del notebook-first flow.
- `execute_all_cells(include_docx=false)` omite celdas DOCX, devuelve `skipped_docx_cell_ids` y no fuerza `emit_docx`; `execute_cell(include_docx=false)` responde `status="skipped"` si la celda resuelta es DOCX.
- El default sigue siendo `include_docx=true` para preservar el comportamiento de generación de informes. La detección `_should_emit_docx()` permanece como compatibilidad para notebooks legacy y fuentes sin metadata.

## Workbench DOCX compacto para agentes (2026-04-25)

- `authoring` mantiene `check_document_quality` como tool compacta y la extiende con `profile` para usar los perfiles backend (`quick`, `agent`, `delivery`, `visual`, `publishing`) sin devolver PNG, DOCX, XML raw ni base64.
- Se agregan tools documentales deliberadamente pocas: `run_document_workbench`, `compare_document_versions`, `manage_document_review` y `prepare_document_delivery`. Todas devuelven summaries limitados y handles `resource_uri`; los recursos visuales o variantes se abren/exportan solo si el agente lo decide.
- `run_document_workbench(operation, ...)` cubre operaciones tipadas del backend Workbench (`audit`, `render_manifest`, `render_page`, `render_all_pages`, `clear_render_cache`, `comments_*`, `redlines_*`, `fields_*`, `content_controls_*`, `redact`, `protect`, `diff`, `prepare_delivery`) con `detail` y `max_findings` para controlar contexto.
- Las operaciones visuales MCP retornan solo estado de cache, `visual`, `rendered_pages` y handles `/api/docx/render/resource`; nunca abren PNG/DOCX/base64 automáticamente.
- `prepare_document_delivery` genera una variante publicable limpia, puede exportarla a una ruta permitida por roots MCP, adjunta un `render_manifest` compacto si existe y nunca reemplaza el artefacto original.
- Cuando una tool MCP necesita descargar un resource Workbench, solo desreferencia `resource_uri` de `/api/docx/workbench/resource` con `workbench_id` y `name`; rutas o parámetros inesperados fallan antes de hacer fetch REST.
- El flujo recomendado para agentes queda: generar DOCX -> `check_document_quality(run=true, profile="agent")` -> corregir notebook/template -> `prepare_document_delivery` al final.

## Feedback de calidad DOCX para agentes (2026-04-24)

- `authoring` suma `check_document_quality` como tool textual y bajo demanda para revisar un DOCX sin devolver DOCX, PNG, XML raw ni base64. Con `run=false` lee solo el summary cacheado de `/api/docx/quality`; con `run=true` ejecuta `/api/docx/quality/run`.

- La resolución de artefacto sigue una prioridad explícita para no inflar contexto ni abrir binarios: `artifact_id`, artefacto registrado por `kernel_id + execution_id`, último DOCX del `kernel_id` y último DOCX por `source_path`.

- La respuesta se normaliza para agentes con `quality_status`, `score`, `counts`, `sections`, `findings` limitados por `max_findings` y `truncated_findings`; `detail="compact"` omite findings, `detail="findings"` limita hallazgos y `detail="full"` sigue siendo textual/sanitizado.

- `get_document_docx(include_quality=true)` conserva el contrato link-first previo y solo agrega `docx_quality` compacto si ya existe cache; nunca dispara auditoría.

- `export_clean_document_docx` genera una copia DOCX limpia usando `/api/docx/quality/clean`, escribe dentro de roots MCP permitidos y no reemplaza el artefacto original.

## Aislamiento por `session_id` reforzado (2026-04-20)

- Las tools notebook-first capturan `session_id` una sola vez al inicio y lo propagan explícitamente a `InspyroBridge`, locks locales por `kernel_id`, `session_state`, late relays y background tasks.

- Esto reduce el riesgo de que una tarea tardía (`notebook_pdf_ready`, cancelación, polling batch, recovery post-disconnect) resuelva otro bucket MCP por contexto implícito o por resolución tardía de `session_id`.

- El completion handler ya no usa `allow_singleton_fallback=True`; cuando la sesión actual no alcanza para resolver un completion, degrada usando evidencia observable ya registrada en `session_state` en vez de asumir automáticamente “la única sesión del proceso”.

## Progreso estructurado relayado (2026-04-13)

- El bridge MCP sigue reenviando `notebook_progress_update`, pero ahora los clientes pueden distinguir explícitamente `progress_scope=execution` (heartbeat pre-terminal) de `progress_scope=document` (pipeline DOCX/PDF tardío).

- Esto evita que clientes MCP confundan keepalive de una celda larga con avance documental y mantiene alineada la UX notebook-first entre UI humana y automatizaciones.

- Los artefactos tardíos (`notebook_docx_update`, `notebook_pdf_ready`) ya no dependen de que `notebook_cell_executed` traiga DOCX inline; el relay los registra y los conserva como estado de sesión aunque lleguen completamente después del terminal.

- Las document tools siguen siendo link-first, pero ahora el DOCX puede resolverse y exportarse también con `artifact_id` cuando `docx_ref` o `docx_download_url` no traen token; PDF mantiene el camino token-first y reconstruye el token desde `pdf_ref` si falta `pdf_file_token`.

- Cuando `execute_all_cells` genera documento, el adaptador MCP ya no devuelve el resumen batch apenas termina la última celda: espera a que el `execution_id` público del lote pueda resolver su DOCX final dentro de la sesión MCP, evitando carreras con rerenders de template o mutaciones posteriores del mismo kernel.

## Timeout notebook-first alineado (2026-04-15)

- `INSPYRO_MCP_CELL_TIMEOUT` pasa a `600s` como default operativo de las tools notebook-first.

- El bridge mantiene `WS_TIMEOUT` y `REST_TIMEOUT` genéricos para transporte común, pero las operaciones MCP pesadas de notebook/análisis/documentos usan presupuestos largos específicos de tool y no dependen de un timeout WS corto global.

- Las tools MCP de análisis (`analyze_*`, `run_sensitivity`, `optimize_design`, `compare_scenarios`, `run_code_checks`) y los clientes/probes MCP del repositorio dejan atrás los ceilings heredados de `30/60/120s` y usan también un presupuesto largo de `600s`, evitando falsos timeouts en flujos AI-first pesados fuera del camino notebook puro.

- Las document tools MCP alinean `reconvert_pdf`, la espera por artefactos tardíos (`INSPYRO_MCP_ARTIFACT_WAIT_TIMEOUT`) y la espera batch por el DOCX final visible (`INSPYRO_MCP_BATCH_ARTIFACT_WAIT_TIMEOUT`) al mismo presupuesto de `600s`.

## Reconciliación post-disconnect WS (2026-04-15)

- Si una ejecución notebook-first pierde el stream WS antes del cierre limpio, las tools de notebook reconcilian el resultado usando primero el payload terminal ya observado para ese `execution_id` y, si no existe, el artefacto exacto asociado a esa misma ejecución.

- La recuperación por artefacto solo acepta handles exactos del `execution_id` pedido o su alias batch->child; no usa el último DOCX/PDF global del kernel como sustituto.

- Cuando la reconciliación es exitosa, MCP expone campos aditivos `recovered_after_disconnect`, `recovery_reason`, `outputs_degraded` y `variables_degraded` en la respuesta recuperada, sin inventar `outputs` ni `variables` completos.

- Este comportamiento no agrega contratos backend nuevos: la recuperación vive en la capa MCP notebook-first y solo ajusta la forma de reportar el resultado cuando el WS se corta.

## Corridas públicas por `run_id` e inspección puntual (2026-04-17)

- `authoring` vuelve a exponer un flujo async real para notebooks pesados: `execute_all_cells(background=true)` devuelve rápido `run_id`/`execution_id` y deja el polling en `get_run_status(run_id)` o `inspyro://runs/{run_id}`.

- El catálogo público notebook suma además `cancel_run`, `resume_run`, `get_kernel_status`, `list_cells`, `get_cell` y `find_in_notebook`, reutilizando el registro session-scoped ya existente en lugar de abrir otro scheduler o otro plano de estado.

- `session_state.py` conserva ahora `current_child_execution_id`, `last_output_preview` y artefactos exactos por corrida pública, lo que permite cancelar la celda activa del batch, reanudar pendientes/fallidas y distinguir mejor timeout RPC, timeout backend, cancelación y recovery post-disconnect.

- `get_system_info` y `get_health` añaden un bloque MCP-normalized `pdf_status` con `conversion_available`, `word_available`, `libreoffice_available`, `preferred_engine`, `last_error_kind` y `last_error_message`, para clarificar cuando el host tiene DOCX pero no una ruta PDF operativa.

## Inventario de sesión notebook y guardas stateful (2026-04-19)

- `authoring` suma `list_session_notebooks` como inventario explícito de `kernel_id -> notebook_path` dentro de la sesión MCP actual, y `close_session_notebook` como alias de cierre más descubrible que `shutdown_kernel`.

- `get_system_info`, `get_health` y el nuevo resource fijo `inspyro://session/notebooks` exponen además `mcp_transport`, `mcp_stateless_http`, `notebook_session_mode` y `notebook_sessions_supported`, para que el cliente detecte rápido si está en `stateful-http`, `stdio` o `stateless-http`.

- `notebook_create` y `notebook_load` aceptan ahora `reuse_if_loaded` para reutilizar el kernel ya vivo de una ruta y `close_others` para cerrar el resto de notebooks de la sesión tras abrir/cargar el actual.

- Los workflows notebook-first que dependen de persistencia de sesión (`notebook_create/load`, ejecución, polling por `run_id`, lifecycle de kernel, variables) se rechazan de forma explícita cuando el servidor corre con `--stateless-http`, en vez de degradar a fallos tardíos por pérdida de estado.

- `tools/notebook.py` añade además serialización MCP local por `kernel_id` dentro de cada sesión, reforzando que dos corridas simultáneas del mismo kernel no se solapen aunque el backend ya tenga su propio lock, mientras kernels distintos siguen pudiendo correr en paralelo.

## Heartbeat de clientes y home compacta (2026-04-19)

- El subprocess MCP shell-owned sigue exponiendo `status/start/stop/logs`, pero el backend distingue ahora entre estado del servicio y clientes MCP conectados.
- `POST /api/mcp/client-heartbeat` registra `client_id/session_id`, `client_label`, `transport`, `workspace_path`, `last_seen_at` y `status` para cada cliente observable por el shell.
- `POST /api/mcp/activity/events` añade campos aditivos `client_id`, `client_label` y `transport`; el backend los usa para enriquecer el feed WS, el panel `Agents` y el summary workspace-scoped de la home.
- `POST /api/mcp/restart` envuelve `stop + start` y limpia `active_runs` / `mcp_clients` efímeros antes de volver a levantar el subprocess.
- `GET /api/system/home-summary` agrupa servicio MCP + clientes + actividad reciente por cliente para la tarjeta `Clientes MCP`, pero mantiene stdout/stderr del subprocess en `/api/mcp/logs` como observabilidad del servicio, no del cliente.

## Entradas y salidas contractuales

### Entradas (MCP JSON-RPC 2.0 via Streamable HTTP o stdio)

- `tools/call` con superficie publicada por perfiles:

  - **Perfil por defecto `authoring`:** `get_system_info`, `get_health`, `list_component_profiles`, `set_component_profile`, `notebook_create`, `notebook_load`, `list_session_notebooks`, `notebook_sync_cells`, `notebook_save`, `execute_cell`, `execute_all_cells`, `get_kernel_status`, `get_run_status`, `cancel_run`, `resume_run`, `list_cells`, `get_cell`, `find_in_notebook`, `reset_kernel`, `interrupt_kernel`, `shutdown_kernel`, `close_session_notebook`, `get_variables`, `check_document_quality`, `run_document_workbench`, `compare_document_versions`, `manage_document_review`, `prepare_document_delivery`, `get_document_pdf`, `get_document_docx`, `export_clean_document_docx`, `export_document_pdf`, `export_document_docx`, `reconvert_pdf`, `upload_template`, `get_template_info`, `delete_template`, `update_template_style`, `convert_units`, `get_units_catalog`, `check_units_compatible`

  - **Perfil `analysis`:** agrega `analyze_dependencies`, `analyze_impact`, `run_sensitivity`, `optimize_design`, `compare_scenarios`, `run_code_checks`
    - `analyze_impact` acepta `max_depth` y lo propaga al contrato WS para mantener el mismo límite visible que la UI.

  - **Perfil `files`:** agrega `list_files`, `read_file`, `write_file`, `create_file`, `delete_file`, `rename_file` para mutaciones filesystem genéricas; para notebooks `.ipynb` se sigue recomendando la capa notebook-first

  - **Perfil `admin`:** agrega `get_metrics` y `get_pdf_status`

  - **Fuera del catálogo público actual:** `create_kernel`, `attach_kernel`, `kernel_status`, `execution_status`, `execute_cells`, `execute_until`, `add_cell`, `delete_cell`, `edit_cell`, `move_cell`

- `resources/read` con resources MCP estables:

  - **Operativos:** `inspyro://manifest`, `inspyro://system/info`, `inspyro://system/health`, `inspyro://units/catalog`, `inspyro://pdf/status`, `inspyro://files/tree`, `inspyro://session/notebooks`

  - **Guides AI-first:** `inspyro://guides/start-here`, `inspyro://guides/notebook-workflow`, `inspyro://guides/docx-quickstart`, `inspyro://guides/artifact-lifecycle`, `inspyro://guides/template-workflow`, `inspyro://guides/analysis-units-workflow`, `inspyro://guides/error-recovery`

  - **Ejemplo E2E:** `inspyro://examples/notebook-docx-report`

- `resources/templates/list` con resource templates MCP:

  - `inspyro://workspace/tree/{path*}`

  - `inspyro://workspace/file/{path*}`

  - `inspyro://notebooks/{path*}/cells/{cell_id}`

  - `inspyro://artifacts/{kernel_id}/{kind}`

  - `inspyro://artifacts/{kernel_id}/{kind}/{execution_id}`

  - `inspyro://artifacts/token/{kind}/{token}`

  - `inspyro://runs/{run_id}`

- `prompts/get` con prompts reutilizables:

  - **Prompts legacy corregidos:** `create_engineering_notebook`, `debug_cell_error`, `review_notebook`, `unit_conversion_help`

  - **Prompts nuevos de onboarding/recuperacion:** `start_inspyro_session`, `create_docx_report_notebook`, `recover_mcp_notebook_session`

- `completion/complete` sobre prompts y resource templates MCP:

  - **Prompts con completions utiles:** `review_notebook.notebook_path`, `recover_mcp_notebook_session.{notebook_path,kernel_id,style_name}`, `unit_conversion_help.{from_unit,to_unit}`

  - **Templates con completions utiles:** `inspyro://workspace/tree/{path*}`, `inspyro://workspace/file/{path*}`, `inspyro://notebooks/{path*}/cells/{cell_id}`, `inspyro://artifacts/{kernel_id}/{kind}`, `inspyro://artifacts/{kernel_id}/{kind}/{execution_id}`, `inspyro://artifacts/token/{kind}/{token}`, `inspyro://runs/{run_id}`

  - Los completions de `kernel_id`, `execution_id`/`run_id` y `style_name` degradan a estado reciente observable (`session_state`, actividad MCP y `template_get`) para seguir siendo utiles aunque el host MCP o el transporte no preserven perfectamente el bucket de sesion original.

### Salidas

- Respuestas JSON-RPC 2.0 con resultados MCP tipados y metadata MCP rica (`annotations`, `tags`, `task` cuando aplica).

- Artefactos DOCX/PDF link-first por `token`, `ref`, `resource_uri`, `portable_resource_uri`, `resource_scope`, `hash` y `size_bytes`; el base64 queda opt-in (`inline_content=true`) y sujeto a umbral real.

- Las tools notebook-first preservan tipos `code|markdown|docx`; para iteraciones de cálculo, `include_docx=false` evita ejecutar report cells sin limpiar `mdoc` ni descartar el último artefacto visible.

- Calidad/Workbench DOCX MCP es opt-in y textual por defecto: `check_document_quality` usa summaries cacheados o ejecuta auditoría bajo demanda, `run_document_workbench` ejecuta operaciones explícitas con summaries limitados, y `get_document_docx(include_quality=true)` solo adjunta cache compacto si ya existe.

- `resource_uri` documenta el handle session-scoped y `portable_resource_uri` documenta el handle token-backed reutilizable entre sesiones MCP mientras el token siga vigente.

- `export_document_docx` y `export_document_pdf` materializan el artefacto a una ruta explícita dentro de los roots MCP visibles del cliente, emitiendo además `file_mutation` para el shell.

- `export_clean_document_docx` materializa una copia limpia opt-in dentro de roots MCP visibles, con tratamiento de metadata, comentarios y redlines delegado al backend DOCX quality. Para entregas finales nuevas, `prepare_document_delivery` usa el Workbench y puede devolver/exportar la variante resultante con lineage.

- `reconvert_pdf` intenta la reconversion real via backend; si el backend ya no conserva el snapshot inline DOCX pero existe un PDF vigente asociado al kernel, la tool degrada a ese artefacto existente sin romper el flujo link-first del cliente.

- Errores estructurados cuando faltan prerequisitos de sesion, artefactos o correlacion WS.

- Actividad MCP estructurada reportada al backend principal por `POST /api/mcp/activity/events`, que a su vez difunde `mcp_activity_event` hacia la UI.

- Espejo UI granular reportado por `POST /api/mcp/mirror-events`, que el backend principal difunde como `mcp_mirror_event` para `open_resource`, snapshots de notebook/template, runtime `notebook_*`, lifecycle de kernel, artefactos y `file_mutation`.

## Dependencias y sinergias

### Upstream (consume)

- `04-notebook-handlers`: ejecucion de celdas, control de kernel, templates y reconversion PDF via WS.

- `03-file-system-api`: lectura/escritura de notebooks y archivos via REST.

- `01-document-generation-docx`: descarga real de DOCX/PDF via tokens y refs REST.

- `06-dependency-analyzer` + `07-sensitivity-analyzer`: analisis y calculos de ingenieria via WS.

- `17-template-editor`: upload REST + attach/update/get/delete via WS.

- `18-engineering-units`: conversion y catalogo de unidades via REST.

### Downstream (impacta)

- Clientes MCP externos (Claude Desktop, GPT, Gemini, Cursor, agentes locales).

- `14-main-app`, `11-notebook-editor-ui`, `17-template-editor` y `15-notification-center` via relay estructurado de actividad + espejo; el shell desktop/web consume siempre actividad/feed y habilita el replay granular de forma opt-in bajo control del modo espejo.

## Estado compartido y concurrencia

1. `InspyroBridge` ya no es singleton global efectivo para HTTP: mantiene una instancia por `session_id` MCP, con su propio `httpx.AsyncClient`, conexion WS, colas por `request_id` y subscribers multi-mensaje por `execution_id`.

2. `session_state.py` agrupa el estado local por `session_id`: `kernel_id -> notebook_path`, `notebook_path -> kernel_id`, inventario de notebooks vivos por sesión, estado local del kernel, ultimos artefactos DOCX/PDF por kernel/ejecucion, evidencia compacta de recovery por `execution_id` (payload terminal observado o artefacto exacto), aliases `child_execution_id -> execution_id` público en batches, timeline/heartbeat de batches y task registry de background.

3. Los streams multi-mensaje se separan por `execution_id` para que dos `execute_cell` concurrentes no mezclen `notebook_stream`, `notebook_clear_output` o `notebook_pdf_ready`; ademas el bridge expone observers internos por `execution_id` para relayar `notebook_docx_update`/`notebook_progress_update`/`notebook_pdf_ready` tardios despues del terminal de ejecucion.

4. `activity.py` envuelve las tools MCP publicadas, publica `annotations`, `tags`, `task` y metadata de perfil/grupo en `tools/list`, y genera eventos `started/completed/failed` con `resource` y `ui_hints` por familia.

5. `runtime.py` centraliza contexto MCP opcional: `session_id`, roots del host, `report_progress`, logging hacia el cliente y aplicacion de perfiles visibles por tags.

6. `mirror.py` reutiliza el mismo contexto para reportar `mcp_mirror_event` best-effort, de forma granular y aditiva, sin mezclarlo con la telemetria de actividad; cubre notebook, templates, filesystem y reconversion PDF, mientras el arbitraje de conflictos queda del lado del shell.

7. Un disconnect o reconnect invalida y despierta todos los pendientes del bridge de esa sesion para evitar futures zombis.

8. Los timeouts siguen gobernados por `INSPYRO_MCP_WS_TIMEOUT`, `INSPYRO_MCP_REST_TIMEOUT` y `INSPYRO_MCP_CELL_TIMEOUT`; en notebooks el default operativo por celda ahora es `600s`, mientras el listado/mascarado del servidor se ajusta con `INSPYRO_MCP_LIST_PAGE_SIZE`, `INSPYRO_MCP_MASK_ERROR_DETAILS` e `INSPYRO_MCP_DEFAULT_PROFILE`.

9. En tools notebook, el `timeout` MCP ya no solo limita la espera del bridge: se propaga al backend como `execution_timeout_s`, mientras el bridge conserva un margen corto adicional para recibir el mensaje terminal o el error tipado correspondiente. Esas mismas tools aplican además una serialización local por `kernel_id` dentro de cada sesión MCP, reforzando que el paralelismo real es entre kernels/notebooks distintos y no dentro del mismo kernel.

10. La resolución de roots MCP es best-effort: si el host no responde a `list_roots()` dentro del timeout interno, `runtime.py` cae a `[]` en vez de bloquear tools mutantes o el smoke MCP.

## Capa AI-first de discoverability

1. `mcp.instructions` obliga a cualquier cliente MCP a leer primero `inspyro://manifest` y luego `inspyro://guides/start-here` antes de la primera tool mutante.

2. Los resources y templates MCP forman una capa autosuficiente para clientes sin acceso al repo: manifest, onboarding, workflow notebook, API DOCX, lifecycle de artefactos, templates, analysis/units, recuperacion, ejemplo E2E y lecturas puntuales de archivo/celda/artefacto/run.

3. Todos los guides siguen la misma estructura machine-friendly: proposito, cuando leerlo, secuencia de tools, errores comunes y siguiente paso.

4. La capa AI-first explicita que `execute_cell` y batches arrancan con default `600s` y aceptan `timeout` ajustable a discrecion; para COM, SAP2000, Word o conversiones pesadas se recomienda subirlo deliberadamente en vez de asumir que ese default basta.

5. Las guias y prompts MCP para DOCX estandarizan las ecuaciones en `builder.math_latex(...)` y `builder.create_math_latex_element(...)`, alineando la discoverability AI-first con el flujo LaTeX-only visible para agentes.

6. La guidance DOCX AI-first ahora indica que la revisión de calidad es un paso posterior y opt-in: `check_document_quality(run=true, profile="agent")` tras generar el artefacto, `missing_quality` se resuelve con `run=true`, `prepare_document_delivery` se reserva para el cierre, y los renders visuales quedan como handles de Workbench fuera del contexto inline.

7. Los prompts MCP ya no asumen conocimiento implicito del backend; fuerzan la lectura previa de resources MCP, recuerdan la politica de timeout ajustable y enrutan por flujo segun la tarea.

8. La discoverability notebook-first ahora recomienda priorizar `notebook_load`, `notebook_sync_cells` y `notebook_save` para `.ipynb`, por sobre file tools genericos o JSON/`nbformat`, y suma `list_session_notebooks` / `inspyro://session/notebooks` como inventario explícito de kernels vivos para agentes.

9. El servidor implementa completions dinamicas MCP para prompts/resources aunque FastMCP 3.0.2 no lo exponga todavia en su API de alto nivel: Inspyro monta el handler sobre el servidor low-level y lo alimenta con estado de sesion, roots/workspace y catalogo de unidades.

10. Las docstrings de las tools MCP prioritarias (`notebook`, `documents`, `templates`, `units`) quedaron endurecidas con cuatro piezas estables: cuando usar, prerrequisitos, resultado esperado y siguiente tool tipica.

11. `tools/files.py` ahora es root-aware y también puede operar sobre `.ipynb`, pero la guidance AI-first sigue promoviendo el camino notebook-first del MCP como ruta preferida para agentes porque preserva mejor la semántica y el estado del notebook.

12. La validacion ya no depende solo de inspeccion manual del repo: `backend/tests/test_mcp_ai_first.py` y `./agent_debug.ps1 mcp-smoke` verifican perfiles, annotations clave, resources obligatorios, prompts obligatorios, `completion/complete`, export de artefactos y un flujo notebook+DOCX black-box.

13. `backend/dev/mcp_torture_probe.py` agrega una campaña live notebook-first mucho más agresiva: recorre perfiles, files, templates, documents, analysis, admin, actividad MCP y recovery sobre un workspace descartable.

## Perfiles y superficie publicada

1. El servidor soporta perfiles tag-based para reducir superficie por sesion: `all`, `authoring`, `core`, `analysis`, `files`, `admin`.

2. `server.py` puede aplicar un perfil por defecto via `INSPYRO_MCP_DEFAULT_PROFILE`; `set_component_profile()` permite cambiarlo en runtime si el host/FastMCP soporta visibilidad por tags.

3. `list_component_profiles()` expone los perfiles disponibles y `get_system_info()` reporta `component_profile` y `default_component_profile`.

4. `authoring` es ahora el perfil por defecto y concentra notebook, documents, templates y units; `analysis`, `files` y `admin` se exponen solo bajo demanda.

5. El trimming por perfil afecta solo a las tools publicadas; resources/prompts/templates MCP siguen siendo la capa estable de discoverability del servidor.

## Contratos notebook endurecidos

1. `notebook_load` y `notebook_create` devuelven por defecto una vista liviana por celda: `id`, `type`, `order`, `source_preview`, `source_len`, `has_outputs`, `last_execution_count`. Al cargar o reconstruir kernels (`reset_kernel(hard=true)`), el MCP envía al backend una versión persistable del notebook sin `outputs`, `execution_count` ni metadata runtime efímera para evitar timeouts y payloads gigantes en notebooks grandes. Ambos aceptan además `reuse_if_loaded` y `close_others` para hacer explícita la gestión de múltiples notebooks dentro de la misma sesión MCP.

2. `notebook_create` acepta `cells=...` para arrancar un notebook ya estructurado y `notebook_sync_cells` sincroniza la lista ordenada final de celdas en una sola llamada, evitando `add/edit/move/delete` tool-by-tool o mutacion manual con `nbformat`.

3. `notebook_sync_cells` reutiliza `cell_id` cuando existe, crea IDs nuevas cuando faltan, borra por omision y limpia `outputs`/`execution_count` de celdas de codigo modificadas salvo que se pida `preserve_outputs=true`.

4. `execute_all_cells` devuelve por defecto un resumen compacto con `execution_id`, contadores, celdas fallidas y `duration_ms`; con `background=true` devuelve rápido `status="started"` + `run_id`/`execution_id` y delega el polling a `get_run_status(run_id)` o `inspyro://runs/{run_id}`. Si el batch genera documento, ese `execution_id` público ya sale listo para `get_document_docx`, `export_document_docx` e `inspyro://artifacts/{kernel_id}/docx/{execution_id}` porque MCP espera el artefacto DOCX final antes de cerrar la tool o antes de marcarla como resuelta en sesión.

5. `execute_cell` acepta `source` opcional: si no se envia, usa el contenido persistido actual de la celda.

6. Las ejecuciones largas reportan progreso/logging nativos MCP cuando el cliente lo soporta; además `get_run_status`, `cancel_run` y `resume_run` convierten ese estado session-scoped en un flujo público soportado para notebooks pesados.

7. `execute_cell` y los batches notebook propagan su timeout efectivo hasta `notebook_execute_cell.execution_timeout_s`; esto evita falsos `BACKEND_EXECUTION_TIMEOUT` causados por un limite interno de backend menor al timeout de la tool y separa mejor ese caso de `RPC_WAIT_TIMEOUT`.

8. `reset_kernel`, `interrupt_kernel`, `shutdown_kernel` y `close_session_notebook` reflejan lifecycle en el canal granular (`notebook_kernel_reset`, `notebook_kernel_interrupted`, `notebook_kernel_shutdown`) antes de limpiar o mutar el registro local; `reset_kernel(hard=true)` sigue recreando la sesion desde el notebook cuando el restart backend no es confiable.

9. `notebook_save` mantiene replay silencioso para save same-path; solo en save-as emite `open_resource` + `notebook_snapshot` sobre la nueva ruta y reancla `kernel_id <-> notebook_path`.

10. Los errores notebook del MCP ahora salen tipados (`NOTEBOOK_PARSE_ERROR`, `NOTEBOOK_ENCODING_ERROR`, `KERNEL_RESET_FAILED`, `CELL_EXECUTION_ERROR`, `RPC_WAIT_TIMEOUT`, `BACKEND_EXECUTION_TIMEOUT`, `EXECUTION_CANCELLED`, `KERNEL_STATE_ERROR`, etc.) para diagnostico y retry mas predecibles; si existe evidencia exacta de una ejecucion ya completada tras un disconnect WS, la tool recupera el resultado en vez de convertirlo en `KERNEL_STATE_ERROR`.

11. El relay tardío de ejecución ya no espera solo `notebook_pdf_ready`: también observa `notebook_docx_update`, publica ese artefacto al espejo/UI y luego sigue hasta el PDF final del mismo `execution_id`.

## Cobertura del espejo MCP→UI

1. El espejo granular cubre mutaciones visibles en `notebook`, `templates`, `files`, `check_document_quality`, `run_document_workbench`, `prepare_document_delivery`, `export_clean_document_docx` y `reconvert_pdf`; lecturas puras (`read_file`, `get_document_docx/pdf`, `analysis`, `units`, `system`) permanecen como telemetria/feed.

2. `tools/files.py` emite `file_mutation` para `write_file`, `create_file`, `rename_file` y `delete_file`, con `mutation`, rutas relevantes, `is_directory` y `file_kind` inferido (`notebook`, `code`, `text`, `directory`, `unknown`).

3. `reconvert_pdf` emite `open_resource` con `focus_view='docx'` cuando el `kernel_id` sigue asociado a un notebook y luego publica `artifact_update` para el PDF regenerado.

4. El backend no decide conflictos visuales por dirty state local: publica hechos granulares y deja al shell arbitrar si recarga, retargetea tabs, cierra tabs limpios o bloquea el replay.

5. El replay sigue siendo live/best-effort por WebSocket; en esta fase no existe historial persistente de `mcp_mirror_event` para rehidratar pasos granulares pasados.

6. El shell actual mantiene estos eventos como superficie operativa real: `mcp_activity_event` sigue alimentando feed/notificaciones y `mcp_mirror_event` se aplica solo cuando `mirrorEnabled=true`, respetando dirty state local y activación desde caché.

## Fallos frecuentes y observabilidad

### Fallos frecuentes

- Backend Inspyro no corriendo: `ConnectionError` al iniciar o al usar el bridge.

- Timeout de ejecucion de celdas largas: `TimeoutError` configurable.

- `missing_artifact` al pedir PDF/DOCX sin una exportacion previa o sin `token` explicito.

- `missing_quality` al pedir calidad DOCX cacheada sin haber corrido todavía `check_document_quality(run=true)`.

- `missing_notebook_session` al guardar o mover un kernel sin notebook gestionado por MCP.

- `NOTEBOOK_PARSE_ERROR` / `NOTEBOOK_ENCODING_ERROR` al abrir `.ipynb` corruptos, con BOM invalido o contenido no JSON.

- `KERNEL_RESET_FAILED` cuando el restart del backend no deja el kernel usable y tampoco es posible recrear la sesion.

- Reconexion WS durante una ejecucion: el bridge cancela waiters/subscribers; si la tool ya observó el terminal o puede resolver el artefacto exacto del `execution_id`, devuelve recuperación aditiva en vez de un `KERNEL_STATE_ERROR` falso.

- Cliente HTTP generico sin headers/protocolo MCP correctos: `406 Not Acceptable` o sesion invalida hasta enviar `Accept: application/json, text/event-stream`, `initialize`, `Mcp-Session-Id` y `notifications/initialized`.

- Host MCP que anuncia soporte de roots pero no responde a `list_roots()`, dejando `tools/files.py` colgado si `runtime.py` no fuerza timeout defensivo.

### Observabilidad

- Logs a `stderr`, requisito para `--stdio`.

- Nivel configurable: `INSPYRO_MCP_LOG_LEVEL`.

- Health del backend accesible via `get_health`.

- `tools/list` expone annotations/tags/task metadata en FastMCP actual cuando la version instalada lo soporta.

- `completion/complete` expone sugerencias dinamicas para paths de notebook/workspace, `cell_id`, `kernel_id`, `style_name`, unidades y `run_id`, con fallback acotado al unico bucket activo cuando el runtime no propaga `session_id` al handler low-level.

- Feed de actividad visible en la UI principal via `mcp_activity_event` para evitar que la actividad MCP ocurra "en sombras".

- `mcp_mirror_event` sigue observable en backend/logs como canal granular canónico y la UI lo aplica solo si el usuario habilita el modo espejo o si una acción UI `start/restart` de MCP lo autoactiva.

- Suite black-box AI-first en `backend/tests/test_mcp_ai_first.py`, construida para usar solo `initialize`, `resources/read`, `prompts/get` y `tools/call`.

- Suite de regresion MCP en `backend/tests/test_mcp_server_remediation.py`.

- Smoke reproducible via `./agent_debug.ps1 mcp-smoke` para validar `initialize`, conteos/listados MCP, `resources/templates/list`, annotations clave, resources/prompts obligatorios, `manifest`, `completion/complete` y `get_health` end-to-end.

- Torture probe reproducible via `./agent_debug.ps1 mcp-torture` para validar el flujo notebook-first exhaustivo contra el servidor MCP live, con `report.json` y `report.md` generados en un workspace temporal.

## Compatibilidad de transporte y DX

1. `python -m mcp_server --stdio` sigue siendo la via recomendada para clientes desktop como Codex, Claude Desktop o Cursor.

2. `python -m mcp_server --json-response --stateless-http` ofrece un modo HTTP mas amigable para clientes genericos, scripts y smoke tests sin parsing SSE stateful.

3. `python -m mcp_server --wait-for-backend 20` agrega espera/reintento del backend antes de fallar, util cuando Inspyro y MCP arrancan juntos.

4. `python -m mcp_server` ahora reutiliza el preflight de `start_mcp.py`, por lo que verifica dependencias/backend antes de delegar al servidor real.

5. `requirements-mcp.txt` pasa a `fastmcp[tasks]>=3.0.0` para habilitar soporte de tasks/progress en instalaciones canónicas del servidor.

6. `./agent_debug.ps1 mcp-smoke` ejecuta una validacion reproducible del protocolo MCP real contra `:8100`.

7. `./agent_debug.ps1 mcp-torture` ejecuta una campaña exhaustiva notebook-first contra el MCP live y deja evidencia verificable en disco.

## Archivos fuente y puntos de entrada

- `backend/mcp_server/__init__.py`

- `backend/mcp_server/__main__.py`

- `backend/mcp_server/activity.py`

- `backend/mcp_server/mirror.py`

- `backend/mcp_server/config.py`

- `backend/mcp_server/bridge.py`

- `backend/mcp_server/runtime.py`

- `backend/mcp_server/session_state.py`

- `backend/mcp_server/server.py`

- `backend/mcp_server/start_mcp.py`

- `backend/mcp_server/tools/notebook.py`

- `backend/mcp_server/tools/files.py`

- `backend/mcp_server/tools/documents.py`

- `backend/mcp_server/tools/analysis.py`

- `backend/mcp_server/tools/system.py`

- `backend/mcp_server/tools/templates.py`

- `backend/mcp_server/tools/units.py`

- `backend/mcp_server/resources/inspyro_resources.py`

- `backend/mcp_server/prompts/inspyro_prompts.py`

- `backend/dev/mcp_torture_probe.py`

- `backend/dev/mcp_torture_assets.py`

- `backend/app/routers/mcp_manager.py`

- `backend/app/services/mcp_activity.py`

- `backend/app/services/mcp_mirror.py`

Puntos de entrada principales:

- `python -m mcp_server`

- `python -m mcp_server --stdio`

- `python -m mcp_server --json-response --stateless-http`

- `python -m mcp_server --wait-for-backend 20`

- `python backend/mcp_server/start_mcp.py`

- `./agent_debug.ps1 mcp-smoke`

- `./agent_debug.ps1 mcp-torture`

## Resumen de cambios recientes

1. `bridge.py` y `session_state.py` pasan a ser session-scoped por `session_id`, eliminando mezcla de kernels, artefactos y ejecuciones entre clientes HTTP/stdio concurrentes.

2. `runtime.py` agrega helpers para roots MCP, progress/logging nativos y perfil visible por sesion.

3. `activity.py` registra annotations/tags/task metadata en `mcp.tool()` y clasifica la superficie por perfiles (`core`, `notebook`, `documents`, `templates`, `analysis`, `units`, `admin`).

4. `tools/system.py` agrega `list_component_profiles` y `set_component_profile`, y `get_system_info` reporta `component_profile`/`default_component_profile`.

5. `tools/documents.py` pasa a contrato link-first endurecido: `token`, `ref`, `resource_uri`, `portable_resource_uri`, `resource_scope`, `hash`, `size_bytes`, `content_type`; el inline base64 queda opt-in, el token store se intenta siempre y `export_document_docx/pdf` permiten materializar el archivo en una ruta explícita. Desde 2026-04-25 también expone `check_document_quality(profile=...)`, `run_document_workbench`, `compare_document_versions`, `manage_document_review` y `prepare_document_delivery` para feedback/entrega DOCX sin binarios inline.

6. `resources/inspyro_resources.py` agrega `inspyro://manifest` y 7 resource templates para árbol de workspace, archivo puntual, celda puntual, artefactos session-scoped, artefactos portables por token y runs.

7. `tools/files.py` se vuelve root-aware y evita operar fuera de los roots MCP visibles cuando el host los expone.

8. `tools/notebook.py` publica progreso/logging nativos MCP en ejecuciones largas y simplifica el flujo authoring-first alrededor de `notebook_create`, `notebook_load`, `notebook_sync_cells`, `execute_cell`, `execute_all_cells` y `notebook_save`.

9. `tools/notebook.py` propaga el timeout de `execute_cell`/batches al backend como `execution_timeout_s` y deja un margen corto extra en el bridge para recibir el terminal/error del backend sin convertirlo en timeout falso del cliente.

10. `server.py` puede aplicar un perfil por defecto con `INSPYRO_MCP_DEFAULT_PROFILE`, ajustar paginacion con `INSPYRO_MCP_LIST_PAGE_SIZE` y enmascarar errores con `INSPYRO_MCP_MASK_ERROR_DETAILS`.

11. `requirements-mcp.txt` sube a `fastmcp[tasks]>=3.0.0` y `start_mcp.py` valida tambien el extra de tasks.

12. `backend/tests/test_mcp_ai_first.py` y `backend/tests/test_mcp_server_remediation.py` cubren perfiles publicos, `notebook_sync_cells`, `notebook_create(cells=...)`, soporte file tools sobre `.ipynb` con guidance notebook-first, annotations, handles portables y export a path.

13. `backend/mcp_server/completions.py` registra `completion/complete` sobre el low-level server y expone sugerencias dinamicas para prompts/resources clave sin romper el wrapper FastMCP actual.

14. `./agent_debug.ps1 mcp-smoke` ahora valida manifest, templates de resources, completions y annotations clave del catalogo publico.

15. `mirror.py` agrega `file_mutation`; las tools notebook reflejan `execute_cells`, `execute_until`, lifecycle de kernel y save-as, mientras `reconvert_pdf` fuerza foco `docx` antes de publicar el nuevo PDF.

16. `runtime.py` endurece la lectura de roots MCP con timeout defensivo y fallback a `[]`, evitando cuelgues en hosts parciales o sin soporte real de roots.

17. `resources/inspyro_resources.py` e `inspyro_prompts.py` endurecen la guidance DOCX AI-first para exponer solo el flujo de fórmulas LaTeX (`math_latex()` y `create_math_latex_element()`).

18. `backend/dev/mcp_torture_probe.py` y `backend/tests/test_mcp_torture_probe.py` agregan una campaña exhaustiva notebook-first con matriz de cobertura estática, fixture DOCX rica y verificación live de activity, files, templates, documents, analysis, admin y recovery.

19. `backend/mcp_server/tools/notebook.py` añade reconciliación post-disconnect para `execute_cell` y batches: prioriza payload terminal observado, luego artefacto exacto por `execution_id`, y expone campos aditivos de recuperación sin introducir contratos backend nuevos.

20. `backend/mcp_server/tools/notebook.py`, `resources/inspyro_resources.py` y `tools/system.py` agregan inventario público de notebooks por sesión (`list_session_notebooks` + `inspyro://session/notebooks`), alias explícito de cierre (`close_session_notebook`), flags `reuse_if_loaded`/`close_others` y guardas duras para rechazar workflows notebook-first cuando el servidor corre en `--stateless-http`.

Detalle historico: `docs/changelog/19-mcp-server.md`.

