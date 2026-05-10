# 04 - Notebook Handlers

> **Estado:** ✅ Modularizado

> **Ubicación:** `backend/app/routers/notebook.py` (fachada) + `backend/app/routers/notebook_*.py`

> **Última actualización:** 2026-05-10

> **Changelog:** `docs/changelog/04-notebook-handlers.md`

---

## Propósito sistémico

Orquestar el ciclo de vida del notebook en backend: creación/carga/guardado, ejecución de celdas, coordinación DOCX/PDF, operaciones de template acopladas al mismo `kernel_id` y rebind del runtime cuando el shell cambia de Home/tab sin destruir la sesión.

## Binding JSON de plantilla por notebook (2026-05-08)

- `notebook_create`, `notebook_load`, `notebook_attach_kernel` y `notebook_reset_kernel` exponen `template_binding` aditivo. El binding canónico se persiste dentro del `.ipynb` en `metadata.inspyro.template_binding` y apunta a un JSON portable relativo al directorio del notebook.
- `handle_notebook_load` aplica automáticamente el JSON vinculado después de crear el kernel y antes de emitir `notebook_loaded`; si el archivo falta o está corrupto, responde `status="missing"`/`"error"` sin bloquear la ejecución sin plantilla.
- `handle_notebook_create` puede heredar un default opcional de workspace desde `<workspace>/.inspyro/templates/default.inspyro-template.json`, copiándolo como JSON hermano del nuevo notebook cuando el path final `.ipynb` está disponible.
- Los handlers de template actualizan el JSON vinculado después de ACKs autoritativos (`template_uploaded`, `template_style_updated`, `template_document_defaults_updated`, `template_semantic_slots_updated`, `template_style_created`, `template_format_applied`), manteniendo el paquete portable en sincronía con el template activo del kernel.

## Recarga de plantilla con slots semánticos (2026-05-04)

- `_apply_template_bytes_to_kernel()` reinyecta `semantic_style_slots` junto con `template_path`, `table_style_runtime_defaults` y `builder_required_style_defaults`. La ruta de attach/upload ya no deja al kernel con estilos visuales extraídos pero sin el contrato de slots que consume `docx_builder`.
- Las mutaciones de template siguen invalidando `notebook_docx_hash` y `notebook_last_docx_b64`; la siguiente exportación recompone el DOCX/PDF desde la plantilla actualizada.
- El flujo fue validado con un notebook real que genera heading/body/caption/table, comprobando en `word/document.xml` que los párrafos usan `Ttulo1`, `Ttulo2`, `Textoindependiente`, `Descripcin` y que las tablas usan `Tablaconcuadrcula`.

## Celdas DOCX lógicas nbformat-safe (2026-05-06)

- `docx` es ahora un tipo lógico de Inspyro, no un `cell_type` persistido. En disco todo `.ipynb` debe quedar válido para Jupyter: una celda documental se guarda como `cell_type="code"` con `metadata.inspyro.cell_kind="docx"`.
- `notebook_save`, escritura REST de `.ipynb` y la capa MCP canonicalizan antes de persistir, completan la forma mínima de celdas `code` (`outputs`, `execution_count`) y validan con `nbformat.validate`.
- La normalización runtime sigue exponiendo `cell_type="docx"` hacia UI/MCP para celdas con metadata documental o notebooks legacy que ya traen `cell_type="docx"`/fuentes DOCX detectables.
- La detección legacy de fuentes DOCX debe ser token/AST-aware y conservadora: `doc_reset`, `build_doc`, `doc_begin`, `doc_finalize` y constructores/métodos documentales sí promocionan la celda; `pd.DataFrame(...)`, `DataFrame` de pandas y métodos genéricos `.text()`/`.table()` no bastan por sí solos.
- `doc_finalize()` forma parte del namespace público de `docx_builder`/`math_to_docx` y del preámbulo notebook, incluyendo inyección en `builtins`, para que una celda final de revisión documental ejecute con el mismo runtime que el resto del informe.
- `notebook_execute_cell` acepta `cell_type` aditivo. Las celdas lógicas `docx` se ejecutan como Python, mientras `emit_docx` sigue representando el modo documental de la corrida y no reemplaza al tipo lógico de celda.
- Apagar DOCX/PDF en el cliente no debe llamar `notebook_mdoc_clear`; el backend solo limpia `mdoc` ante la acción explícita `notebook_mdoc_clear`/`clear_mdoc`.

## Shared resource explícito para PDF + Home compacta coherente (2026-04-22)

- `notebook_progress_update` gana metadata aditiva `shared_resource={ kind, scope, status }` para exponer contención serializada real sin introducir mensajes nuevos; hoy el backend usa `kind="pdf_converter"`, `scope="global"` y `status="waiting"|"running"` durante `progress_scope=document` + `progress_stage=pdf_convert`.

- `notebook_docx_update` ya no cierra el runtime documental en `home_compact.py`; la home mantiene visible el progreso notebook-scoped hasta que llegue un terminal documental real (`notebook_pdf_ready`, fallo final, cancelación o interrupción), evitando estados stale cuando el DOCX ya salió pero el PDF sigue esperando/ocupando el convertidor compartido.

- La ruta directa `_execute_docx_export()` usa la misma señal estructurada que `_convert_pdf_background()`: cuando `build_pdf_context_async()` reporta espera por cola, emite `shared_resource.status="waiting"` y preserva `source_path/source_kind`, de modo que UI, Home y tests ven el cuello de botella Word/PDF como recurso serializado explícito.

- Se agregan regresiones backend para fijar tres kernels concurrentes con DOCX/PDF, la espera serializada del convertidor y el reflejo/cleanup correcto del progreso en `GET /api/system/home-summary`.

## Aislamiento notebook-scoped (2026-04-20)

- `backend/main.py` expone ahora `/ws/notebook` como carril dedicado para `notebook_*`, `template_*`, `reconvert_pdf` y mensajes documentales; la UI humana deja `/ws` para shell global, MCP y `.py`.

- `app/core/state.py` expone `bind_kernel_to_connection()`, y los handlers notebook/template/control que ya operan sobre un `kernel_id` la usan para rebindear ownership hacia el websocket actual, cancelar cleanup pendiente y evitar que el socket viejo apague un kernel todavía vivo tras reconnect.

- `notebook_attach_kernel` sigue siendo el ack explícito de recovery, pero ya no es el único punto que refresca ownership: `notebook_execute_cell`, mutaciones notebook, reconversión PDF, comandos de control de kernel y mutaciones/template sync reafirman el binding cuando la request es válida.

- `handle_notebook_execute_cell` separa explícitamente estado `queued` vs `running` por `kernel_id`: registra la request antes del lock, marca la ejecución viva solo después de adquirirlo y `notebook_cancel_execution` sin `execution_id` apunta a la corrida realmente en curso, no a una request en cola.

- La coordinación DOCX visible ya no usa solo el `active_workspace` global; el artifact store resuelve la copia materializada desde `source_path`, de modo que un cambio de workspace durante el postproceso no desvíe la salida de otro notebook.

## Runtime persistente por tab/path (2026-04-19)

- `handle_notebook_attach_kernel` permite que el shell vuelva a asociar una tab humana a un `kernel_id` ya vivo usando `kernel_id` o `path`; responde `notebook_attached` con snapshot notebook + ruta normalizada, sin recrear kernel.
- `notebook_service.py` mantiene `notebook_runtime_snapshots` por `kernel_id` y los actualiza en create/load/execute/delete/move/order para que `NotebookEditor` pueda rehidratarse después de un unmount sin perder el runtime.
- `handle_code_execution` deja de cancelar globalmente por websocket: ahora correlaciona `execute_code` por `run_id + file_path`, permite concurrencia entre archivos distintos y solo reemplaza la corrida previa del mismo archivo.
- `handle_cancel_code_execution` corta explícitamente el job `.py` de una tab; `home_compact_store` expone tanto `notebook_runtime_items` como `code_runtime_items` para que Home refleje procesos vivos fuera del editor visible.

## Artefactos notebook link-first sobre WS (2026-04-19)

- `notebook_docx_update`, `notebook_pdf_ready` y `pdf_reconverted` priorizan refs/tokens descargables aun para artefactos pequeños cuando el backend ya tiene una referencia estable.
- El inline base64 se conserva solo como fallback de resiliencia cuando falla el storage temporal o persistente, de modo que el contrato público no cambia.
- Esto reduce la posibilidad de que un notebook que acaba de terminar su DOCX/PDF meta blobs pesados en la misma conexión WS y friccione la ejecución en paralelo de otra libreta todavía viva.

## Cola explícita del convertidor PDF (2026-04-19)

- El pipeline documental notebook-first ya no deja que múltiples notebooks queden esperando el convertidor PDF dentro del `run_in_executor(None, ...)` compartido del proceso.
- `notebook_service.py` y `handle_force_reconvert_pdf` pasan a usar `build_pdf_context_async()`, que espera turno del convertidor Word-capable fuera del pool genérico y luego corre la conversión en executors dedicados.
- Si otro notebook ya está usando el convertidor, backend puede publicar `notebook_progress_update` con `progress_scope=document`, `progress_stage=pdf_convert` y mensaje `Esperando turno del convertidor PDF...`.
- El objetivo es aislar la contención del convertidor externo para que dos notebooks paralelos no se estorben mediante workers bloqueados invisibles.

## Slots semánticos de template (2026-04-19)

- Las operaciones template sobre el mismo `kernel_id` ya no recargan solo `template_path`, `table_style_runtime_defaults` y `builder_required_style_defaults`: también reinyectan `semantic_style_slots` al runtime DOCX del kernel.
- `template_update_semantic_slots` se suma al set de mutaciones directas del router y responde `template_semantic_slots_updated` con el template completo ya rehidratado, igual que `template_update_document_defaults`.
- El objetivo es que notebook/template/runtime compartan un contrato Word-first estable: el notebook emite slots semánticos, el template resuelve el estilo Word concreto y Word sigue siendo la fuente de verdad visual.

## Progreso estructurado de ejecución/documento (2026-04-13)

- `notebook_progress_update` agrega `progress_scope`, `progress_stage`, `progress_status`, `progress_percent` y `progress_indeterminate` para distinguir heartbeat de ejecución vs. pipeline documental.

- `handle_notebook_execute_cell` emite `progress_scope=execution`, `progress_stage=cell_run`, `progress_indeterminate=true` mientras una celda larga sigue viva antes del terminal `notebook_cell_executed`.

- La instrumentación notebook ya no hace `doc_export()` ni `doc_export_provenance()` dentro del `finally` de la celda; el runtime solo cierra `doc_end()` / `doc_finish_cell()` y deja el documento acumulado en el kernel.

- `handle_notebook_execute_cell` ya no ramifica entre rescate DOCX y conversión PDF inline: cada ejecución que pide documento crea un único `DocumentJobRequest` interno y un coordinador latest-wins por `kernel_id`.

- La última celda exportable ya no hace `doc_export()` dentro del camino crítico: el terminal `notebook_cell_executed` sale primero y la exportación DOCX/PDF corre después en background.

- Cuando esa exportación final queda diferida, el camino terminal ya no depende de `capture_docx` en `jupyter_kernel.py`: backend deja de esperar `__INSP_NOTEBOOK_DOCX` / `__INSP_NOTEBOOK_DOCX_PROVENANCE` en el reply terminal y reutiliza solo el estado documental ya acumulado en kernel.

- Si una ejecución nueva llega mientras el job documental anterior espera o exporta, el coordinador descarta emisiones stale y conserva visible solo el artefacto más reciente del mismo `kernel_id`.

- La fase documental tardía usa `progress_scope=document` con etapas `queued`, `docx_export`, `docx_ready` y `pdf_convert`; ese flujo alimenta la barra roja del frontend sin reabrir la corrida de celdas.

## Mutaciones notebook con export diferido y timings documentales (2026-04-18)

- `notebook_delete_cell`, `notebook_move_cell` y `notebook_set_order` ya no ejecutan `_execute_docx_export()` dentro del lock del kernel.
- Esas mutaciones ahora toman el lock solo para aplicar `doc_clear_cell` / `doc_move_cell` / `doc_reorder`, generan un `execution_id` documental propio y encolan el mismo `DocumentJobRequest` latest-wins usado por la exportación notebook final.
- La UI sigue recibiendo el ack de mutación (`notebook_cell_deleted`, `notebook_cell_moved`, `notebook_order_set`), pero el refresh documental real vuelve a entrar por `notebook_progress_update` + `notebook_docx_update` + `notebook_pdf_ready`, reduciendo tiempo retenido bajo lock.
- `notebook_service.py` agrega además `document_timing_ms` al flujo documental tardío y combina métricas de `raw_export_ms`, `kernel_export_ms`, `transport_read_ms`, `transport_cleanup_ms`, `docx_transfer_bytes`, `provenance_transfer_bytes`, `sanitize_ms`, `artifact_store_ms`, `legacy_store_ms`, `terminal_to_docx_ms`, `docx_to_pdf_ms` y los tiempos internos del conversor PDF.

## Handoff DOCX file-backed + metadata workspace (2026-04-18)

- El rescate DOCX/provenance del notebook ya no depende solo de imprimir base64 por `stdout`: la ruta productiva materializa un intercambio por archivo temporal por `execution_id` y solo cae al camino legacy inline si ese handoff falla.
- `notebook_docx_update` y `notebook_pdf_ready` pueden reemitir `workspace_path`, `workspace_relpath` y `workspace_warning`, permitiendo a frontend/desktop abrir la copia persistida del proyecto (`Docx_Documents`) o degradar con warning explícito si no pudo materializarse.

## Presupuesto canónico de ejecución notebook (2026-04-15)

- `notebook_execute_cell` sigue aceptando `execution_timeout_s`, pero si el cliente no lo envía backend ahora usa `INSPYRO_NOTEBOOK_EXECUTION_TIMEOUT=600` como presupuesto operativo por celda.

- El postproceso documental notebook-first (`docx_export` + conversión PDF tardía) usa `INSPYRO_NOTEBOOK_PDF_TIMEOUT=600`, separado de previews/template y de los timeouts genéricos del transporte.

- Las mutaciones notebook que rehacen documento (`delete_cell`, `set_order`, `move_cell`) ya no cierran a `60s`: usan el mismo presupuesto largo para lock + `doc_clear/doc_reorder/doc_move` + export DOCX/PDF.

- La UI humana de Inspyro y el adaptador MCP quedan alineados con ese mismo presupuesto, reduciendo cancelaciones falsas por desincronía entre watchdog local, backend y relay MCP.

## PDFs grandes en notebooks (2026-03-29)

- El runtime notebook ya no depende de un cap fijo de `8 MB` en `pdf_converter.py`; `INSPYRO_PDF_MAX_DOCX_BYTES=0` deja la conversión habilitada por defecto para DOCX grandes.

- La conversión PDF disparada desde notebook (`notebook_pdf_ready`, `force_reconvert_pdf`, reexports DOCX de delete/move/order) usa `INSPYRO_NOTEBOOK_PDF_TIMEOUT` con default `600s`.

- Los previews de template siguen usando sus timeouts cortos propios y no heredan el timeout largo del notebook.

- La degradación de payload se mantiene igual: si el PDF/DOCX es grande, backend debe preferir `pdf_ref` / `pdf_file_token` y `docx_ref` / `docx_file_token` antes que inflar el WS con base64.

## Carga robusta de notebooks sin `cell.id` (2026-04-07)

- `handle_notebook_load` ya no reenvía payloads crudos cuando el `.ipynb` llega sin ids de celda: backfillea `cells[].id` y `metadata.inspyro_id` antes de emitir `notebook_loaded`.

- Esto estabiliza snapshots same-path entre backend, frontend y espejo MCP, reduciendo remounts espurios del editor cuando el notebook original venía de un archivo legacy sin ids Jupyter.

- El cambio es aditivo: no altera el contrato WS más allá de garantizar ids faltantes.

## Hardening de celdas sin DOCX real y ownership por `notebook_cell_id` (2026-03-27)

- Tras capturar/exportar el documento, `notebook_service.py` inspecciona el paquete DOCX; si el body queda sin contenido real, responde `docx_is_empty=true`, agrega warning en `docx_warnings` y evita publicar/persistir un artefacto nuevo para esa ejecución.

- Esa decisión preserva el último DOCX válido del notebook en lugar de contaminar descarga e historial con un `.docx` vacío de fallback.

- La instrumentación notebook importa ahora `doc_start_cell`/`doc_finish_cell` y envuelve `build_doc` / `doc_block` / `doc_begin` para inyectar `notebook_cell_id` automáticamente en llamadas directas del usuario.

- La misma instrumentación expone además la API DOCX activa en `builtins`, para que notebooks host-aware que primero intentan reutilizar `build_doc/doc_reset` del host no caigan a un bootstrap legacy ligado a una ruta local privada y sigan generando el documento con la implementación vigente.

- Con ese ownership consistente, la reejecución de una celda puede limpiar bloques DOCX viejos aunque el código actualizado ya no emita contenido documental.

## Procedencia documental para `Modo origen` (2026-04-10)

- `_build_notebook_instrumented_code()` ya no inyecta el código del usuario como bloque indentado: ahora compila `source` con filename sintético `<inspyro-notebook:{cell_id}>` y lo ejecuta con `exec(...)`, permitiendo que la línea del frame coincida con la línea real del notebook cuando `docx_builder` captura procedencia.

- `notebook_service.py` captura y parsea `__INSP_NOTEBOOK_DOCX_PROVENANCE`, la persiste junto al artefacto DOCX y refleja `docx_provenance_available`/`docx_provenance_ref` en `notebook_cell_executed`, `notebook_pdf_ready`, `execution_result` y el historial REST; la instrumentación `compile(..., filename=\"<inspyro-notebook:{cell_id}>\", \"exec\")` preserva líneas exactas para distinguir `callsite` versus `exact`.

- La procedencia sigue viviendo en el DOCX interno que usa la conversión PDF y `force_reconvert_pdf`, pero la entrega visible (`doc_export`, `docx_file_b64`, token legacy y `/api/docx/download`) pasa por una sanitización posterior que elimina hyperlinks OOXML y field codes `HYPERLINK` automáticos `/api/docx/provenance/open?...` antes de exponer el Word al usuario.

- El recovery/export interno del notebook ya no depende del `doc_export()` público: cuando backend rescata el DOCX para PDF, usa explícitamente la variante raw de `DocxSession`; `doc_export()` queda reservado a la variante Word-visible saneada.

- `notebook_pdf_ready` puede reemitir metadata DOCX (`docx_artifact_id`, `docx_provenance_*`) aunque el evento represente solo la conversión PDF tardía; el objetivo es mantener a frontend/MCP sincronizados con la procedencia del documento visible.

- `notebook_execution.py` normaliza `message.source` y `notebook.cells[].source` con la misma semántica visible del frontend: si el `.ipynb` ya trae saltos embebidos por línea (`["a\\n", "b\\n"]`), backend concatena sin insertar `\\n` extra. Esto evita líneas fantasma en `notebook_execute_cell`/`notebook_save` y corrige desfasajes de `exact_line` al navegar desde `Modo origen`.

- `docx_builder.session` deja de promocionar como `callsite` los frames técnicos de `ipykernel` en `AppData\\Local\\Temp\\ipykernel_*` cuando existe una celda notebook o un archivo real más útil en el stack; esos frames se conservan en `user_stack`, pero el destino navegable persistido pasa a ser notebook-first.

- La URL `hyperlink_url` de cada fragmento se construye ahora contra el backend runtime efectivo usando `INSPYRO_BACKEND_URL` y, si falta, `INSPYRO_BACKEND_PORT`; el fallback a `127.0.0.1:8000` queda relegado al último recurso y no debe dominar entornos desktop con puerto dinámico.

## Recuperación documental tardía tras degradación IOPub (2026-04-13)

- Si la ejecución principal ya alcanzó `execute_reply`, el handler debe emitir `notebook_cell_executed` aunque el canal IOPub haya quedado degradado (`idle_missing` / `iopub_error` aditivo).

- El rescate de DOCX ya no bloquea el camino crítico: backend reintenta la exportación en background y publica `notebook_docx_update` seguido de `notebook_progress_update` / `notebook_pdf_ready` con el mismo `execution_id`.

- El objetivo es que `Run All` cierre por el terminal `notebook_cell_executed`; los artefactos tardíos no deben reinterpretarse como fallo de la celda.

## Integración DOCX con captions nativos (2026-03-25)

- La API DOCX disponible dentro del kernel soporta captions Word-nativos para `image`, `figure`, `table`, `dataframe` y `caption(number=True)`, sin introducir contratos WS nuevos.

- La recarga de template sigue usando el mismo circuito notebook/template, pero ahora el estilo `Caption` también es parte explícita del flujo que frontend y runtime observan en `template_info`.

- Los handlers notebook no cambian de contrato público; el cambio es interno al runtime DOCX y a la metadata aditiva del template (`document_captions`, categoría `captions`).

## Entradas y salidas contractuales

### Entradas (WS `C→S`)

- `notebook_create`, `notebook_load`, `notebook_save`, `notebook_execute_cell`

- `notebook_delete_cell`, `notebook_move_cell`, `notebook_set_order`, `notebook_cancel_execution`

- `notebook_reset_kernel`, `notebook_interrupt_kernel`, `notebook_shutdown_kernel`, `notebook_attach_kernel`, `notebook_comm_msg`, `notebook_mdoc_clear`

- `execute_code`, `cancel_code_execution`, `reconvert_pdf`, `force_reconvert_pdf`

- `template_upload`, `template_attach`, `template_get`, `template_delete`, `template_update_style`, `template_update_document_defaults`, `template_update_semantic_slots`

- `template_preview_style`, `template_preview_cancel`, `template_table_preview`, `template_create_style_from_table`, `template_apply_table_format`

### Salidas principales (WS `S→C`)

- `notebook_created`, `notebook_loaded`, `notebook_saved`

- `notebook_attached`

- `notebook_stream`, `notebook_cell_executed`, `notebook_docx_update`, `notebook_pdf_ready`

- `notebook_clear_output`, `notebook_update_display_data`

- `notebook_comm_open`, `notebook_comm_msg`, `notebook_comm_close`

- `notebook_kernel_reset`, `notebook_kernel_interrupted`, `notebook_kernel_shutdown`

- `notebook_execution_cancelled`

- `template_uploaded`, `template_info`, `template_deleted`, `template_style_updated`, `template_document_defaults_updated`

- `template_preview_ready`, `template_preview_error`

- `template_preview_cancelled`

- `template_table_preview_ready`, `template_table_preview_error`

- `template_style_created`, `template_format_applied`, `template_error`

- Campos aditivos de artefacto: `docx_ref`, `pdf_ref` (fallback legacy base64 conservado)

- `execution_started`, `execution_result`, `execution_error` del modo `.py` reenvían ahora `run_id + file_path` para correlación tab/path.

- `notebook_cell_executed` puede incluir `docx_is_empty=true` cuando la ejecución activó DOCX pero el documento exportado no contiene body útil; en ese caso se conserva el último DOCX válido y el warning viaja en `docx_warnings`.

- `notebook_cell_executed` puede incluir `variables_snapshot_degraded` + `execution_diagnostics` aditivo cuando el snapshot runtime cae en fallback seguro.

- Respuestas notebook/template sincronas reflejan `request_id` en success/error cuando el cliente lo envia.

- `notebook_created`, `notebook_loaded`, `notebook_attached`, `notebook_kernel_reset` y ACKs `template_*` relevantes pueden incluir `template_binding` con estado `none|bound|available|applied|updated|missing|error|inherited`.

- Mensajes de ejecución y PDF usados por MCP incluyen `execution_id` aditivo (`notebook_stream`, `notebook_clear_output`, `notebook_execute_result`, `notebook_display_data`, `notebook_update_display_data`, `notebook_comm_*`, `notebook_docx_update`, `notebook_progress_update`, `notebook_pdf_ready`, `notebook_cell_executed`, `notebook_cell_error`).

- Los mensajes tempranos reenviados desde IOPub y el heartbeat `notebook_progress_update` incluyen además `kernel_id`, `source_path` y `source_kind` cuando el backend conoce ese origen; esto vuelve determinista el ruteo notebook-scoped en shell/MCP aun antes del terminal `notebook_cell_executed`.

Contrato canónico: `docs/architecture/contracts-catalog.md`.

## Dependencias y sinergias

### Upstream

- `09-jupyter-kernel` para ejecución real.

- `01-document-generation-docx` para export DOCX/PDF.

- `02-websocket-manager` para entrega de respuestas.

- `17-template-editor` a través de `template_service`.

### Downstream

- `11-notebook-editor-ui` y `14-main-app` consumen la mayoría de respuestas notebook/template.

- `12-dependency-graph-ui` depende de mensajes de análisis activados desde notebook.

## Estado compartido y concurrencia

1. Lock por `kernel_id` para serializar operaciones críticas del kernel.

2. Lock de mutación por template para reducir contención del lock de kernel.

3. Semáforos dedicados para previews (`template_preview_style`, `template_table_preview`) + política latest-wins.

4. Timeouts defensivos separados: `INSPYRO_LOCK_TIMEOUT` acota solo la espera del lock por `kernel_id`; `notebook_execute_cell` puede propagar `execution_timeout_s` y, si no lo hace, backend usa `INSPYRO_NOTEBOOK_EXECUTION_TIMEOUT` (default operativo `600s`).

5. La conversión PDF del notebook tiene timeout propio (`INSPYRO_NOTEBOOK_PDF_TIMEOUT`, default `600s`) y no comparte el timeout corto de previews/template.

6. Integración con `execute_lock` del kernel manager para evitar carreras en canales ZMQ.

7. `notebook_create`/`notebook_load` soportan `previous_kernel_id` solo para rebuilds explícitos del mismo contexto (por ejemplo reset duro o reemplazo real de sesión), no para navegar a `home`, cambiar de tab o abrir otro archivo.

8. Operaciones pesadas de template se delegan a ejecutor dedicado para no bloquear event loop.

9. Espera de locks y latencias de handlers template se instrumentan en `runtime_metrics`.

10. La correlacion por `request_id`/`execution_id` ya no es solo convencion de frontend: el backend la ecoea explicitamente en handlers criticos usados por MCP.

11. El cierre de `notebook_cell_executed` ya no depende de que el kernel entregue `idle` perfecto ni de que la captura de variables termine sin degradacion; los diagnósticos quedan en logs/backend y la respuesta terminal se conserva.

12. La preparación de DOCX/PDF se mantiene fuera del camino crítico: si falla el post-procesamiento no esencial, la celda igual responde como ejecutada y la conversión tardía sigue separada.

13. La última celda exportable ya no publica DOCX inline en `notebook_cell_executed`; backend siempre difiere la exportación final a `notebook_docx_update` / `notebook_pdf_ready` en background sin reabrir el terminal de ejecución.

14. `notebook_execution.py` y `notebook_service.py` mantienen `kernel_id -> source_path/source_kind` para anclar cada DOCX persistido al notebook/archivo real cuando existe ruta conocida.

15. La instrumentación DOCX propaga `notebook_cell_id` a `build_doc` / `doc_block` / `doc_begin`, permitiendo que `finish_notebook_cell()` elimine bloques stale al reejecutar celdas notebook.

16. Las ejecuciones notebook que exportan un DOCX sin body útil ya no persisten artefactos vacíos ni reemplazan el último documento válido; el contrato aditivo `docx_is_empty` + `docx_warnings` cubre ese caso.

17. `template_attach`, `template_upload`, `template_update_style`, `template_update_document_defaults` y la restauración post-`notebook_reset_kernel` reinyectan ahora `builder_required_style_defaults` junto con `table_style_runtime_defaults`, para que el kernel DOCX no vuelva a `Calibri/Consolas` cuando la plantilla define otra resolución efectiva.

18. `template_update_document_defaults` usa una mutación dedicada para materializar `w:docDefaults` globales en `styles.xml`, devuelve `template_document_defaults_updated` con el template completo y limpia el estado DOCX cacheado del kernel antes de la siguiente exportación.

19. `handle_notebook_load` garantiza ids estables por celda (`id` + `metadata.inspyro_id`) cuando el notebook cargado carece de ellos, evitando que frontend/MCP dependan de fallbacks volátiles en primera carga.

20. El pipeline documental notebook-first ahora tiene un único coordinador latest-wins por `kernel_id`, con una ventana corta de estabilización antes del export; eso evita dobles exportaciones y hace que una ejecución nueva invalide las emisiones tardías de la anterior.

21. El backend mantiene además un snapshot notebook por `kernel_id` y un runtime registry visible para el shell; navegar fuera del editor deja de implicar shutdown automático mientras la tab siga abierta.

22. El modo `.py` ya no es un singleton por conexión: `_code_run_by_path` y `active_tasks[run_id]` permiten un job aislado por archivo, cancelable por `run_id` o `file_path` sin afectar otros tabs.

23. La espera del convertidor PDF Word-capable ocurre ahora en una cola async explícita y ya no consume workers del executor compartido mientras otro notebook termina su propio PDF.

## Hardening DOCX persistente (2026-03-23)

1. `notebook_create`, `notebook_load` y `notebook_execute_cell` actualizan la procedencia DOCX del `kernel_id` usando `path`, de modo que el historial persistente quede ligado al notebook guardado y sobreviva reinicios del backend.

2. `notebook_service.py` persiste un artefacto DOCX estable por generación y reexpone `docx_artifact_id`, `source_path` y `source_kind` aditivamente en `notebook_cell_executed` / `execution_result`.

3. La emisión DOCX ya no depende de que cambie el hash semántico: si hay DOCX exportado, siempre se vuelve a publicar una referencia descargable estable.

4. Si falla el storage persistente o el token store legacy, el backend conserva al menos una ruta descargable por `kernel_id` mientras el runtime del notebook siga vivo.

5. `handle_code_execution` propaga `file_path` a `_execute_python_code_simple()` para que el modo código comparta la misma semántica de persistencia/historial cuando trabaja sobre un archivo real.

6. `clear_mdoc` y el cleanup de runtime limpian el estado vivo del kernel, pero no borran el historial persistente guardado en app-state.

7. En `Run All`, las celdas intermedias (`skip_pdf=True`) ya no persisten DOCX ni actualizan `notebook_last_docx_b64`; solo la última celda exportable fija el artefacto/historial final.

8. El rebuild del documento reutiliza snapshots relationship-aware del `docx_builder`, preservando relaciones OOXML e imágenes antes de persistir el artefacto o disparar la conversión PDF.

## Hardening de handlers template (2026-02-07)

1. `table_index` en `template_table_preview`, `template_create_style_from_table` y `template_apply_table_format` se normaliza a entero antes de llamar servicios.

2. Valores no convertibles, booleanos o negativos se rechazan temprano sin tocar `run_in_executor`.

3. En errores se preservan campos de correlación (`kernel_id`, `table_index`, `request_id` cuando aplica).

4. Se mantiene compatibilidad de contrato WS: no cambian tipos de mensaje ni campos de éxito usados por frontend.

5. `template_preview_style` acepta `force_refresh` opcional para bypass de caché backend cuando el frontend exige render fresco (ej: acción manual “Renderizar”).

6. El dispatcher valida payloads críticos con modelos tipados antes del handler; si falla, retorna `type="error"` con `error_code="invalid_message_payload"` y `details.validation_errors`.

## Fallos frecuentes y observabilidad

### Fallos frecuentes

- `kernel_lock_timeout` por contención real del lock por `kernel_id`.

- `cell_execution_timeout` por celdas largas que exceden su timeout efectivo de backend.

- `template_preview_error` por motor de render no disponible o cola saturada.

- `error_code=connection_queue_full` cuando una conexión excede el backpressure del dispatcher WS.

- Estados stale cuando no se invalida caché de DOCX/PDF tras cambios de template.

- Emisión/persistencia accidental de DOCX vacíos si la clasificación post-export deja de correr o si `docx_is_empty` se ignora al resolver el artefacto latest.

- Pérdida de descarga DOCX si el mapping `kernel_id -> source_path` se desalineara o si el fallback estable por `artifact_id`/`kernel_id` dejara de emitirse.

- Generaciones DOCX duplicadas si una regresión vuelve a persistir celdas intermedias del batch (`skip_pdf=True`) como si fueran el export final.

### Observabilidad

- Logs con `INSPYRO_NOTEBOOK_DEBUG=1`.

- Métricas en `/metrics` y salud de conversión en `/pdf-status` (incluye `max_docx_bytes` y `notebook_pdf_timeout_seconds`).

- Validar contratos con `./agent_debug.ps1 docs-check`.

- Escenario reproducible de carga mixta: `./agent_debug.ps1 stress-ws` (`backend/scripts/stress_ws_mix.py`).

## Archivos fuente y puntos de entrada

- `backend/app/routers/notebook.py` (fachada de compatibilidad/import surface)

- `backend/app/routers/notebook_common.py` (estado compartido, locks y utilidades)

- `backend/app/routers/notebook_execution.py` (create/load/save/execute/reconvert/code)

- `backend/app/routers/notebook_kernel_control.py` (cancel/reset/interrupt/shutdown/control)

- `backend/app/routers/notebook_template.py` (upload/attach/preview/update/apply template)

- `backend/app/services/notebook_service.py`

- `backend/main.py` (dispatcher principal)

Punto de entrada WS: `websocket_endpoint()` en `backend/main.py`.

## Resumen de cambios recientes

1. Serialización reforzada de operaciones kernel/template mediante helper seguro.

2. Previews de template en background desde dispatcher para no bloquear ejecución de celdas.

3. Timeouts y semáforos explícitos para previews de estilo/tabla.

4. Apply de formato de tabla soporta `style_name` y `style_id`.

5. Mejor sincronización con frontend para evitar estado stale.

6. Validación estricta de `table_index` para prevenir apply/preview sobre tablas equivocadas por índices inválidos.

7. Errores `template_*_error` con mejor trazabilidad para debugging en frontend/backend.

8. Soporte de bypass de caché en preview de estilo (`force_refresh`) para evitar falsos positivos por reuso de `preview_key`.

9. `notebook_error`/`notebook_cell_error` estandarizan campos aditivos (`message`, `error_code`) manteniendo compatibilidad con `error`.

10. Reenvío IOPub ampliado (`clear_output`, `update_display_data`, `comm_*`) para alinear runtime backend con expectativas del UI notebook.

11. Correlación de ejecución por `execution_id` + cancelación explícita con `notebook_cancel_execution`.

12. Cleanup de kernels/templates al desconectar socket para cortar fugas de lifecycle.

13. `template_preview_cancel` + latest-wins para descartar previews stale bajo ráfaga.

14. `notebook_create`/`notebook_load` conservan `previous_kernel_id` solo para rebuilds explícitos; el shell ya no debe usarlo como cleanup implícito al navegar entre tabs o hacia Home.

15. Dispatcher WS usa colas acotadas por conexión (`work`/`preview`) y workers dedicados para evitar crecimiento no acotado de memoria.

16. Nuevo flujo aditivo de plantilla por token (`template_attach`) para usar upload REST y evitar base64 masivo por WS.

17. Respuestas de ejecución soportan referencias de artefacto (`docx_ref`/`pdf_ref`) para descargar contenido grande por REST.

18. Router monolítico se divide en módulos cohesivos (`notebook_execution`, `notebook_kernel_control`, `notebook_template`) con fachada estable en `notebook.py`.

19. `notebook_cell_executed` incluye `kernel_id` de forma explícita, permitiendo a consumidores MCP correlacionar y persistir artefactos inline de DOCX/PDF sin depender de estado externo implícito.

19. Se añade script de stress mixto WS para baseline reproducible de rendimiento/latencia.

20. Sub-routers reemplazan `globals()` injection por imports explícitos, restaurando autocompletado IDE y linting. Facades intermedias (`template_storage.py`, `template_preview.py`) eliminadas.

21. Debug scripts relocalizados de `backend/` a `backend/dev/`.

22. Se corrigió argumento faltante `progress_callback=None` en llamada a `build_pdf_context` dentro de `handle_force_reconvert_pdf`.

23. Se corrigió bare `except:` a `except Exception:` en código inyectado al kernel (`doc_clear_cell`) y se añadió `add_done_callback` a tareas async de conversión PDF.

24. Extracción de estado global (Locks, caches) de `notebook_common.py` hacia `app/core/state.py` para centralización segura del estado concurrente.

25. Reescritura del router monolítico de templates extrayendo la lógica algorítmica y de validación hacia `app/services/template_logic.py`, dejando el router exclusivamente para delegación WS/REST.

26. Optimización de generación DOCX: se evita la costosa exportación de fallback `doc_export` en celdas intermedias durante una ejecución masiva (Run All), mitigando warnings de timeout y acelerando la respuesta del frontend.

27. `notebook_create`, `notebook_load`, `notebook_save`, `notebook_reset_kernel`, `notebook_interrupt_kernel`, `notebook_shutdown_kernel`, `notebook_delete_cell`, `notebook_set_order` y `force_reconvert_pdf` reflejan `request_id` en respuestas y errores para permitir correlacion confiable desde MCP.

28. El reenvío IOPub agrega `execution_id` a mensajes de stream/display/progress/PDF/DOCX tardío para separar ejecuciones concurrentes sobre una misma conexión WS.

29. El pipeline de ejecucion tolera `iopub` degradado despues de `execute_reply`: si falta `idle` o falla la lectura del canal, el handler conserva `notebook_cell_executed` y registra el diagnostico en backend.

30. El post-procesamiento de variables y artefactos deja de ser bloqueante para `Run All`; fallos de captura o preparacion DOCX/PDF ya no escalan a `notebook_cell_error` si la celda principal ejecuto bien.

31. La respuesta terminal ahora puede marcar `variables_snapshot_degraded` y exponer `execution_diagnostics` aditivo cuando la captura runtime cae en fallback seguro, sin alterar `status="ok"` de la ejecución principal.

32. `notebook_load` ya no devuelve notebooks legacy sin ids de celda: rellena `cells[].id` y `metadata.inspyro_id` durante la carga antes de publicar `notebook_loaded`.

33. `handle_notebook_execute_cell` separa el timeout de lock del timeout de ejecucion: `INSPYRO_LOCK_TIMEOUT` ya no puede matar falsamente una celda larga despues de adquirir el lock, y `cell_execution_timeout` queda reservado para la ejecucion real del kernel.

34. El runtime notebook persiste un artefacto DOCX estable por generación, incluso cuando el hash exportado no cambia, y reexpone `docx_artifact_id`/`source_path`/`source_kind` para descarga restart-safe e historial.

35. Si la última celda exportable pierde el DOCX inline por degradación IOPub, backend ya no espera el rescate dentro de `notebook_cell_executed`: difiere a `notebook_docx_update` y conserva `notebook_pdf_ready` como contrato documental tardío del mismo `execution_id`.

36. `handle_code_execution` propaga `file_path` y el trimming de payload descarta `docx_file_b64` cuando ya existe `docx_ref`, evitando WS gigantes sin perder la ruta de descarga.

37. El camino notebook-first hacia PDF usa `build_pdf_context_async()` con executors dedicados y espera visible de convertidor, evitando contención oculta del pool compartido cuando dos notebooks reclaman DOCX/PDF al mismo tiempo.

Detalle histórico: `docs/changelog/04-notebook-handlers.md`.
