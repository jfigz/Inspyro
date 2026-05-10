# Changelog 04 - notebook-handlers

> **Última actualización:** 2026-05-10

---

## 2026-05-08 - Binding JSON de plantilla por notebook

1. `notebook_create`, `notebook_load` y `notebook_reset_kernel` resuelven `metadata.inspyro.template_binding` y aplican el JSON portable antes de dejar listo el kernel.
2. El binding usa rutas relativas seguras al directorio del notebook, rechaza traversal y reporta `status="missing"` o `status="error"` sin bloquear ejecución cuando el JSON no existe o está corrupto.
3. Se agrega `backend/app/services/template_binding.py` como servicio compartido para exportar, validar, aplicar y refrescar paquetes `schema_version=1.1` con `semantic_style_slots`.
4. Los ACKs notebook/template incluyen `template_binding` de forma aditiva para que UI y MCP reflejen el estado persistido del notebook.

**Archivos:** `backend/app/services/template_binding.py`, `backend/app/routers/notebook_execution.py`, `backend/app/routers/notebook_kernel_control.py`, `backend/app/routers/notebook_template.py`, `backend/tests/test_template_binding.py`, `docs/modules/04-notebook-handlers.md`, `docs/changelog/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/system-context.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-05-06 - Celdas DOCX lógicas con persistencia Jupyter estándar

1. Se introduce una capa común de normalización `logical_cell_kind <-> persisted cell_type`: `docx` queda como tipo lógico de runtime/UI/MCP y se guarda como `cell_type="code"` + `metadata.inspyro.cell_kind="docx"`.
2. `notebook_save` y la escritura REST de `.ipynb` canonicalizan el notebook, completan campos requeridos por nbformat y validan con `nbformat.validate` antes de persistir.
3. La lectura de notebooks legacy con `cell_type="docx"` o fuentes DOCX detectables sigue exponiendo `docx` al runtime, pero una nueva escritura migra el archivo a forma estándar.
4. La detección legacy queda conservadora y token/AST-aware: `build_doc`, `doc_begin`, `doc_reset`, `doc_finalize` y APIs DOCX reales promocionan celdas; `pd.DataFrame(...)` y métodos genéricos no.
5. `doc_finalize()` se exporta por `docx_builder`/`math_to_docx` y el preámbulo notebook lo inyecta junto con el resto de helpers DOCX, incluyendo `builtins`.

**Archivos:** `backend/app/services/notebook_cell_kinds.py`, `backend/app/services/notebook_service.py`, `backend/app/routers/notebook_execution.py`, `backend/app/routers/files.py`, `backend/librerias_propias/docx_builder/__init__.py`, `backend/librerias_propias/math_to_docx.py`, `backend/tests/test_notebook_load_ids.py`, `backend/tests/test_docx_empty_handling.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/modules/04-notebook-handlers.md`, `docs/changelog/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-05-04 - Attach de template reinyecta slots semánticos al kernel

1. `_apply_template_bytes_to_kernel()` pasa `semantic_style_slots` a `_kernel_docx_set_template_code()` junto con los defaults de tabla y estilos requeridos.
2. El kernel queda alineado con la plantilla que ve la UI/editor, incluso cuando los estilos Word vienen localizados con IDs como `Textoindependiente`, `Ttulo1`, `Descripcin` o `Tablaconcuadrcula`.
3. Se valida el flujo con generación real de DOCX/PDF desde notebook, inspeccionando `document.xml` y `styles.xml` para confirmar contenido y estilos aplicados.

**Archivos:** `backend/app/routers/notebook_common.py`, `backend/tests/test_template_style_fallback.py`, `docs/modules/04-notebook-handlers.md`, `docs/changelog/04-notebook-handlers.md`, `docs/llm-index.yaml`

---

## 2026-04-28 - Persistencia y ejecución de celdas DOCX nativas

1. Históricamente `notebook_save`, carga/normalización y escritura de `.ipynb` preservaban `cell_type="docx"` como tipo custom Inspyro; esto queda superado por la migración nbformat-safe del 2026-05-06.
2. `notebook_execute_cell` acepta `cell_type` en el payload WS y trata `docx` como celda Python ejecutable, conservando `emit_docx` como modo documental de la corrida.
3. La normalización migra suavemente celdas legacy `code` con APIs DOCX detectables hacia `docx`, sin romper notebooks existentes ni fuentes MCP que aún no declaran metadata.

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/app/contracts/ws_models.py`, `backend/app/routers/files.py`, `backend/tests/test_notebook_load_ids.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-04-26 - Cola PDF consistente en exportación documental directa

1. `_execute_docx_export()` alinea su callback de espera con `_convert_pdf_background()`: cuando el convertidor Word/PDF global está ocupado, emite `notebook_progress_update` con `shared_resource.kind="pdf_converter"` y `status="waiting"`.
2. Esa señal preserva `source_path/source_kind`, por lo que Home, el editor y las pruebas pueden distinguir el notebook dueño de la espera sin mezclar artefactos ni kernels.
3. `test_execute_docx_export_marks_pdf_converter_wait_as_shared_resource_waiting` fija el contrato interno de la ruta directa y evita volver a publicar la cola como `running`.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/tests/test_notebook_document_contracts.py`, `docs/modules/04-notebook-handlers.md`

---

## 2026-04-22 - `shared_resource` y Home compacta coherente para el PDF compartido

1. `notebook_progress_update` suma `shared_resource={ kind, scope, status }` para declarar en forma estructurada la contención serializada real del convertidor PDF; el backend usa hoy `pdf_converter` global en estados `waiting` y `running`.
2. `home_compact.py` deja de cerrar el runtime documental en `notebook_docx_update`; la espera/uso del convertidor sigue visible en `GET /api/system/home-summary` hasta `notebook_pdf_ready`, fallo final, cancelación o interrupción.
3. Se agregan regresiones backend para fijar tres kernels concurrentes con DOCX/PDF, la serialización explícita del convertidor y el cleanup correcto del progreso en Home.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/app/services/home_compact.py`, `backend/tests/test_notebook_document_contracts.py`, `backend/tests/test_home_summary_backend.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/system-context.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-04-19 - La espera del convertidor PDF sale del pool compartido

1. `notebook_service.py` y `handle_force_reconvert_pdf` pasan a usar `build_pdf_context_async()` para que la espera del convertidor Word-capable ocurra en una cola async explícita y no dentro del executor compartido del backend.
2. Cuando el convertidor ya está ocupado, el pipeline documental puede publicar `notebook_progress_update` con mensaje `Esperando turno del convertidor PDF...`, manteniendo aislado el estado de cada notebook aunque Word siga serializado por seguridad COM.
3. Se agregan regresiones para `force_reconvert_pdf`, timeouts notebook-first y el estado de espera del convertidor en el flujo documental.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/app/routers/notebook_execution.py`, `backend/app/services/pdf_converter.py`, `backend/tests/test_notebook_document_contracts.py`, `backend/tests/test_notebook_pdf_large_docs.py`, `backend/tests/test_force_reconvert_pdf_regression.py`, `backend/tests/test_pdf_converter_hardening.py`, `docs/modules/04-notebook-handlers.md`, `docs/modules/01-document-generation-docx.md`, `docs/changelog/04-notebook-handlers.md`, `docs/architecture/feature-threads.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`

---

## 2026-04-19 - Runtime persistente por tab/path y reattach de notebooks vivos

1. `handle_notebook_attach_kernel` se agrega al router para reatar una tab humana a un `kernel_id` ya vivo usando `kernel_id` o `path`, devolviendo `notebook_attached` con snapshot notebook.
2. `notebook_service.py` empieza a mantener snapshots notebook por `kernel_id` para rehidratar el editor tras volver desde Home, cambiar de tab o remount del componente sin recrear kernel.
3. `handle_code_execution` deja de cancelar globalmente por websocket: ahora correlaciona `run_id + file_path`, permite concurrencia entre scripts de archivos distintos y suma `handle_cancel_code_execution` para cierre explícito de tab.
4. `home_compact_store` publica runtimes notebook y `.py` en una misma home compacta (`notebook_runtime_items`, `code_runtime_items`, `runtime_items`).

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/app/routers/notebook.py`, `backend/app/services/notebook_service.py`, `backend/app/services/home_compact.py`, `backend/main.py`, `backend/app/contracts/ws_models.py`, `backend/tests/test_ws_payload_validation.py`, `backend/tests/test_home_summary_backend.py`, `docs/modules/04-notebook-handlers.md`, `docs/modules/05-code-execution.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`

---

## 2026-04-19 - Recarga Word-first del template DOCX hacia el kernel

1. Las mutaciones de template sobre un `kernel_id` activo ya no reinyectan solo `template_path`, `table_style_runtime_defaults` y `builder_required_style_defaults`: ahora también propagan `semantic_style_slots` al runtime DOCX del kernel.
2. `template_update_semantic_slots` se suma al router notebook/template como mutación directa, con ack `template_semantic_slots_updated` y template completo rehidratado para el shell.
3. Esto alinea el builder DOCX del kernel con la selección persistida en el editor, evitando drift entre lo que ve la UI y lo que Word materializa al reejecutar.

**Archivos:** `backend/app/routers/notebook_common.py`, `backend/app/routers/notebook_template.py`, `backend/app/services/template_logic.py`, `backend/main.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/changelog/04-notebook-handlers.md`

---

## 2026-04-18 - Pipeline documental notebook-first con materialización deduplicada y metadata de proyecto

1. `notebook_service.py` completa el refactor diferido: la fase documental conserva latest-wins por `kernel_id`, instrumenta el handoff DOCX/procedencia fuera del reply terminal y añade métricas finas de export, transferencia, escritura workspace e indexado.
2. `notebook_execution.py` limpia flags inline ya obsoletos y deja las mutaciones notebook alineadas con un solo pipeline documental posterior a `notebook_cell_executed`, sin reabrir el acoplamiento histórico con el terminal verde.
3. `docx_artifacts.py` pasa a entregar al flujo notebook `workspace_path`, `workspace_relpath` y `workspace_warning`, permitiendo que la UI desktop abra el DOCX persistido del proyecto y que la historia documental mantenga la misma ruta materializada.
4. Las pruebas backend fijan que el handoff file-backed, la deduplicación de `Docx_Documents` y la propagación de artefactos tardíos sigan funcionando en ejecuciones y mutaciones reales.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/app/routers/notebook_execution.py`, `backend/app/services/docx_artifacts.py`, `backend/tests/test_notebook_document_mutations.py`, `backend/tests/test_notebook_docx_file_handoff.py`, `backend/tests/test_force_reconvert_pdf_regression.py`, `docs/modules/04-notebook-handlers.md`, `docs/modules/01-document-generation-docx.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-17 - Serialización fiel de `cell.source` para procedencia exacta

1. `backend/app/routers/notebook_execution.py` deja de usar `"\n".join(...)` ciego para `notebook_execute_cell` y `notebook_save`; ahora normaliza arrays `source` igual que el frontend cuando el `.ipynb` ya trae `\n` embebidos por línea.
2. Con esto backend evita insertar líneas vacías fantasma entre entradas del notebook, de modo que la instrumentación `compile(..., "<inspyro-notebook:{cell_id}>", "exec")` preserve `exact_line` contra el texto visible real.
3. `librerias_propias/docx_builder/session.py` deja de persistir como `callsite` los wrappers técnicos de `ipykernel` cuando el stack ya contiene una celda notebook o un archivo real más útil; esos frames sobreviven en `user_stack`, pero la navegación degradada pasa a ser notebook-first.
4. La construcción de `hyperlink_url` deja de depender ciegamente de `127.0.0.1:8000`: primero honra `INSPYRO_BACKEND_URL` y luego `INSPYRO_BACKEND_PORT`, reduciendo drift en desktop same-origin con puerto dinámico.
5. Se agregan regresiones backend para fijar la serialización de `cell.source`, la selección de `callsite` útil y la URL pública de procedencia.

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/librerias_propias/docx_builder/session.py`, `backend/tests/test_mcp_server_remediation.py`, `backend/tests/test_docx_builder_tracking.py`, `docs/modules/04-notebook-handlers.md`, `docs/changelog/04-notebook-handlers.md`

---

## 2026-04-15 - Las mutaciones notebook con reexport documental también quedan en 600s

1. `backend/app/routers/notebook_execution.py` reemplaza el techo fijo de `60s` en `delete_cell`, `set_order` y `move_cell` por un presupuesto alineado con `INSPYRO_NOTEBOOK_EXECUTION_TIMEOUT` y `INSPYRO_NOTEBOOK_PDF_TIMEOUT`.
2. Esto evita que notebooks grandes fallen al reordenar, mover o borrar celdas cuando la operación necesita recomponer y reconvertir el documento final.

**Archivos:** `backend/app/routers/notebook_execution.py`, `docs/modules/04-notebook-handlers.md`, `docs/changelog/04-notebook-handlers.md`

---

## 2026-04-15 - Timeout notebook-first alineado a 600s

1. `notebook_execution.py` sube el default operativo de `INSPYRO_NOTEBOOK_EXECUTION_TIMEOUT` a `600s`, manteniendo separado el timeout de lock (`INSPYRO_LOCK_TIMEOUT`) del timeout real de ejecución.
2. `notebook_service.py` alinea el postproceso DOCX/PDF de notebook con `INSPYRO_NOTEBOOK_PDF_TIMEOUT=600`, evitando que el documental falle por un presupuesto menor al de la celda.
3. La documentación del módulo y el hilo E2E dejan explícito que UI, backend y MCP deben compartir ese presupuesto por celda para no reintroducir cancelaciones falsas.

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/app/services/notebook_service.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`, `AGENTS.md`

---

## 2026-04-13 - Coordinador documental único y latest-wins por kernel

1. `handle_notebook_execute_cell` deja de bifurcar entre rescate DOCX y PDF inline; ahora responde siempre primero con `notebook_cell_executed` y encola un único `DocumentJobRequest` interno por ejecución.
2. El pipeline documental notebook-first gana coordinación latest-wins por `kernel_id` con una ventana corta de estabilización, evitando exportaciones duplicadas y anulando emisiones tardías stale cuando llega una ejecución más nueva.
3. Se agregan regresiones backend para fijar el nuevo contrato interno (`_document_job_request`) y el encolado post-terminal sin reabrir la ejecución principal.

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/app/services/notebook_service.py`, `backend/tests/test_mcp_server_remediation.py`, `backend/tests/test_docx_empty_handling.py`, `docs/modules/04-notebook-handlers.md`, `docs/modules/01-document-generation-docx.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-13 - La ultima celda diferida ya no pide DOCX en el reply terminal

1. `notebook_service.py` deja de activar `capture_docx` cuando la exportacion final se difiere a background, de modo que la ultima celda no espera leer `__INSP_NOTEBOOK_DOCX` / `__INSP_NOTEBOOK_DOCX_PROVENANCE` antes de emitir `notebook_cell_executed`.
2. El pipeline documental tardio sigue usando el mismo estado acumulado en kernel y conserva la secuencia `document/queued -> notebook_docx_update -> notebook_pdf_ready` sin reabrir la fase verde.
3. Se agrega una regresion backend para fijar que la ultima celda diferida ejecuta con `capture_docx=False` y evitar recaidas hacia el acoplamiento historico.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-13 - El terminal de la última celda deja el DOCX fuera del camino crítico

1. La última celda exportable ya no ejecuta `doc_export()` dentro de `notebook_cell_executed`; el terminal sale primero y el pipeline documental se dispara después en background.
2. `handle_notebook_execute_cell` usa ahora un pending explícito para el pipeline documental estándar, en vez de depender solo del rescate degradado por IOPub.
3. Se agregan regresiones backend para fijar el orden `notebook_cell_executed` -> `document/queued` y el registro tardío de artefactos en la sesión MCP.

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/app/services/notebook_service.py`, `backend/mcp_server/tools/notebook.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/modules/04-notebook-handlers.md`, `docs/modules/19-mcp-server.md`

---

## 2026-04-13 - Progreso estructurado para separar ejecución y documento

1. `notebook_progress_update` agrega `progress_scope`, `progress_stage`, `progress_status`, `progress_percent` y `progress_indeterminate` para distinguir keepalive de ejecución frente al pipeline documental tardío.
2. `handle_notebook_execute_cell` emite `execution/cell_run` mientras corre una celda larga, y la fase documental usa `document/queued|docx_export|docx_ready|pdf_convert` antes de `notebook_pdf_ready`.
3. Se agregan regresiones backend para fijar el keepalive estructurado y el encolado documental posterior al terminal de ejecución.

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/app/services/notebook_service.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/modules/04-notebook-handlers.md`, `docs/llm-index.yaml`

---

## 2026-04-13 - Heartbeat de ejecución larga antes del terminal

1. `handle_notebook_execute_cell` emite `notebook_progress_update` periódicos (`Ejecutando celda...`) mientras la celda sigue viva pero aún no entrega el terminal, evitando que notebooks grandes disparen el watchdog local de la UI antes de tiempo.

2. El cambio no altera el contrato terminal: `notebook_cell_executed` sigue siendo el único cierre exitoso de la celda, y la recuperación DOCX/PDF tardía mantiene su flujo aparte.

3. Se agrega regresión backend para fijar el keepalive pre-terminal y evitar que una refactorización vuelva a romper la liveness en celdas largas.

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-04-13 - Terminal de ejecución primero, rescate DOCX/PDF después

1. `notebook_cell_executed` queda fijado como mensaje terminal de la ejecución principal incluso cuando IOPub degrada después de `execute_reply`.

2. El rescate DOCX sale del camino crítico: backend reintenta en background y publica `notebook_docx_update` seguido de `notebook_progress_update` / `notebook_pdf_ready` con el mismo `execution_id`.

3. Se agregan regresiones backend para fijar el diferido documental y evitar que `Run All` dependa del rescate inline de artefactos.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/app/routers/notebook_common.py`, `backend/app/routers/notebook_execution.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-04-07 - `notebook_load` rellena ids de celdas faltantes

1. `handle_notebook_load` ya no reenvía notebooks legacy sin ids de celda: si faltan `cells[].id`, backfillea `id` y `metadata.inspyro_id` antes de emitir `notebook_loaded`.

2. El cambio estabiliza la primera carga de notebooks entre backend, frontend y espejo MCP, evitando que el cliente dependa de fallbacks volátiles para identificar celdas.

3. Se agrega regresión backend para fijar el keepalive pre-terminal y evitar que una refactorización vuelva a romper la liveness en celdas largas.

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/tests/test_notebook_load_ids.py`, `docs/modules/04-notebook-handlers.md`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-29 - Timeout PDF propio para notebooks y reconversión de artefactos grandes

1. `notebook_service.py` añade `INSPYRO_NOTEBOOK_PDF_TIMEOUT` (default `300s`) y lo usa en la conversión PDF background del notebook y en los reexports DOCX que vuelven a disparar PDF.

2. `handle_force_reconvert_pdf` propaga ese mismo timeout a `build_pdf_context()`, manteniendo la ruta link-first para PDFs grandes (`pdf_ref` / `pdf_file_token` en lugar de base64 inline).

3. `/pdf-status` agrega `notebook_pdf_timeout_seconds` para exponer el timeout efectivo notebook sin cambiar contratos WS/REST.

4. Se agregan regresiones backend para fijar la propagación del timeout notebook y la degradación por referencia en reconversiones de PDFs grandes.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/app/routers/notebook_common.py`, `backend/app/routers/notebook_execution.py`, `backend/main.py`, `backend/tests/test_notebook_pdf_large_docs.py`, `docs/modules/04-notebook-handlers.md`, `docs/modules/01-document-generation-docx.md`

---

## 2026-03-27 - Ejecuciones sin DOCX real preservan el último documento válido

1. `notebook_service.py` deja de persistir/publicar artefactos DOCX vacíos cuando una ejecución activa `emit_docx` pero el documento final no tiene body útil; el contrato responde `docx_is_empty=true` y warning en `docx_warnings`.

2. La instrumentación notebook importa ahora `doc_start_cell`/`doc_finish_cell` y envuelve `build_doc` / `doc_block` / `doc_begin` para propagar `notebook_cell_id` a llamadas directas del usuario.

3. La misma instrumentación publica la API DOCX activa en `builtins`, evitando que notebooks host-aware vuelvan a un bootstrap legacy ligado a una ruta local privada cuando el host ya inyectó la implementación actual.

4. Esa propagación permite que `finish_notebook_cell()` elimine bloques DOCX stale al reejecutar una celda cuyo código ya no genera contenido documental.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/tests/test_docx_empty_handling.py`, `docs/modules/04-notebook-handlers.md`, `docs/modules/01-document-generation-docx.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-25 - Runtime DOCX del notebook soporta captions nativos sin cambiar WS

1. La API DOCX disponible dentro del kernel pasa a soportar captions Word `SEQ` para `image`, `figure`, `table`, `dataframe` y `caption(number=True)` sin introducir mensajes WS nuevos.

2. El cambio queda encapsulado en el runtime DOCX y en la metadata aditiva del template (`document_captions`, categoría `captions`), por lo que `template_info` sigue siendo compatible hacia atrás.

3. Se documenta el nuevo flujo E2E notebook/template para que el editor y el builder compartan `Caption` como estilo observable.

**Archivos:** `backend/librerias_propias/docx_builder/builder.py`, `backend/librerias_propias/docx_builder/session.py`, `backend/app/services/template_service.py`, `docs/modules/04-notebook-handlers.md`, `docs/modules/01-document-generation-docx.md`, `docs/modules/17-template-editor.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-24 - Nuevo handler para `docDefaults` globales del template

1. `notebook_template.py` agrega `handle_template_update_document_defaults`, que corre bajo el mismo lock/mutación por `kernel_id`, limpia cachés DOCX del kernel y responde `template_document_defaults_updated` con el template recompuesto.

2. La recarga de template en kernel se unifica en un helper que reinyecta `table_style_runtime_defaults` y `builder_required_style_defaults` después de mutaciones de estilo o de `Documento (Global)`.

3. El dispatcher principal queda sincronizado con el nuevo contrato `template_update_document_defaults`.

**Archivos:** `backend/app/routers/notebook_template.py`, `backend/main.py`, `backend/app/contracts/ws_models.py`, `docs/modules/04-notebook-handlers.md`, `docs/modules/17-template-editor.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-03-24 - Recarga de template reinyecta defaults tipográficos efectivos al kernel

1. `template_attach`, `template_upload` y la restauración post-`notebook_reset_kernel` pasan a reinyectar `builder_required_style_defaults` junto con `table_style_runtime_defaults`.

2. El kernel DOCX deja así de recalcular a ciegas la tipografía fallback desde el `.docx` o de volver a `Calibri/Consolas` cuando la metadata efectiva del template ya estaba persistida en `template.json`.

3. El cambio mantiene compatibilidad del contrato `template_info` porque la metadata extra llega de forma aditiva.

**Archivos:** `backend/app/services/template_logic.py`, `backend/app/routers/notebook_common.py`, `backend/app/routers/notebook_kernel_control.py`, `backend/librerias_propias/docx_builder/session.py`, `docs/modules/04-notebook-handlers.md`, `docs/modules/17-template-editor.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-03-23 - Run All persiste solo el DOCX final y preserva rebuild con imágenes

1. `notebook_service.py` deja de persistir artefactos DOCX en celdas batch intermedias (`skip_pdf=True`), evitando historiales inflados mientras `Run All` todavía está en curso.

2. La integración con `docx_builder.session` pasa a depender de snapshots relationship-aware, preservando imágenes y otras relaciones OOXML antes de emitir `notebook_cell_executed` o disparar PDF.

3. Se agrega una regresión backend que fija que `notebook_last_docx_b64` y `store_docx_artifact()` no se actualizan en celdas intermedias del batch.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/tests/test_docx_artifacts.py`, `docs/modules/04-notebook-handlers.md`, `docs/modules/01-document-generation-docx.md`, `docs/architecture/feature-threads.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-23 - Provenance DOCX por kernel y artefactos persistentes por ejecución

1. `notebook_execution.py` y `notebook_service.py` mantienen `kernel_id -> source_path/source_kind` para anclar el DOCX persistido al notebook/archivo real cuando existe ruta conocida.

2. Cada generación DOCX crea una entrada persistente con `docx_artifact_id`, incluso si el hash exportado coincide con el previo; la respuesta WS sigue reemitiendo una referencia descargable estable.

3. `handle_code_execution` propaga `file_path` hacia `_execute_python_code_simple()` para que el modo código comparta la misma semántica de persistencia/historial.

4. El trimming de payload ya puede descartar `docx_file_b64` cuando existe `docx_ref`, reduciendo WS grandes sin romper la descarga.

5. `clear_mdoc` y cleanup de runtime limpian estado vivo del kernel sin borrar el historial DOCX persistido en app-state.

**Archivos:** `backend/app/routers/notebook_common.py`, `backend/app/routers/notebook_execution.py`, `backend/app/services/notebook_service.py`, `backend/app/routers/docx.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-15 - Separación de timeout de lock vs timeout de ejecución

1. `handle_notebook_execute_cell` deja de envolver toda la ejecución dentro de `INSPYRO_LOCK_TIMEOUT`; ese timeout ahora cubre solo la adquisición del lock por `kernel_id`.

2. `notebook_execute_cell` acepta `execution_timeout_s` aditivo y, si la celda lo excede, responde `cell_execution_timeout` en vez de falsear `kernel_lock_timeout`.

3. Ante `cell_execution_timeout`, backend intenta `interrupt_kernel()` como cleanup best-effort para no dejar el kernel ejecutando una tarea huérfana.

**Archivos:** `backend/app/routers/notebook_common.py`, `backend/app/routers/notebook_execution.py`, `backend/app/contracts/ws_models.py`, `backend/app/services/notebook_service.py`, `backend/tests/test_mcp_server_remediation.py`, `backend/tests/test_ws_payload_validation.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-13 - Hardening de snapshot runtime para notebooks con COM/SAP2000

1. `notebook_service.py` expone `variables_snapshot_degraded` y `execution_diagnostics` de forma aditiva en `notebook_cell_executed` cuando la captura runtime cae en fallback seguro.

2. Esto permite que frontend/MCP distingan una ejecución principal exitosa de un snapshot parcial sin frenar `Run All`.

3. Se añadieron regresiones backend para preservar el mensaje terminal incluso cuando el snapshot runtime llega degradado.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-03-07 - Correlación explícita de artefactos en `notebook_cell_executed`

1. `notebook_service.py` añade `kernel_id` al payload `notebook_cell_executed`, alineándolo con otros mensajes notebook correlacionados por ejecución.

2. Esto permite a consumidores MCP registrar artefactos inline DOCX/PDF por kernel sin depender de estado implícito o de `token`/`ref`.

3. Se agrega regresión backend para fijar el keepalive pre-terminal y evitar que una refactorización vuelva a romper la liveness en celdas largas.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/tests/test_mcp_server_remediation.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`

---

## 2026-02-20 - Optimización DOCX en ejecución múltiple (Run All)

1. En operaciones de `Run All` (`skip_pdf=True`), el inyector de código aísla y omite la fase más pesada (`doc_export`) para las ejecuciones intermedias, sin perder el rastreo del documento (`doc_begin`/`doc_end`).

2. Adicionalmente, `notebook_service.py` omite la recolección de rescate DOCX vía `stdout` cuando `skip_pdf=True`.

3. Esto mitiga interrupciones de `execution_timeout` severos causadas por el overhead masivo en notebooks de gran escala.

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/app/services/notebook_service.py`, `docs/modules/04-notebook-handlers.md`

## 2026-02-19 - Corrección de bare except y tracking de tareas async PDF

1. Se corrigió bare `except:` en código inyectado al kernel (línea `doc_clear_cell`) a `except Exception:` para no capturar `SystemExit`/`KeyboardInterrupt`.

2. Se añadió `add_done_callback` a `asyncio.create_task(_convert_pdf_background(...))` para prevenir warnings de excepciones no capturadas en tareas background de conversión PDF.

**Archivos:** `backend/app/routers/notebook_execution.py`, `docs/modules/04-notebook-handlers.md`

## 2026-02-19 - Fix argumento faltante en `build_pdf_context`

1. Se añadió `progress_callback=None` como 5º argumento en la llamada a `build_pdf_context` dentro de `handle_force_reconvert_pdf`.

2. Sin este argumento, la función recibía un parámetro desplazado y podía fallar en runtime.

**Archivos:** `backend/app/routers/notebook_execution.py`, `docs/modules/04-notebook-handlers.md`

## 2026-02-10 - Eliminación de globals() injection y facades en sub-routers

1. Los sub-routers (`notebook_execution.py`, `notebook_kernel_control.py`, `notebook_template.py`) reemplazan `globals()` injection por imports explícitos, restaurando soporte IDE, linting y autocompletado.

2. Se eliminan facades `app/services/template_storage.py` y `app/services/template_preview.py`. Los imports ahora apuntan directamente a `app.services.template.storage` y `app.services.template.preview`.

3. `template_service.py` actualiza lazy imports para bypasear facades eliminadas.

4. Debug scripts (`debug_calculation.py`, `reproduce_issue.py`, `fix_word_lock.py`, etc.) relocalizados de `backend/` a `backend/dev/`.

5. Bare `except:` corregidos a `except Exception:` con logging en `notebook_service.py`.

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/app/routers/notebook_kernel_control.py`, `backend/app/routers/notebook_template.py`, `backend/app/services/template_service.py`, `backend/app/services/notebook_service.py`, `docs/modules/04-notebook-handlers.md`

## 2026-02-10 - Split router notebook + benchmark mixto reproducible

1. `backend/app/routers/notebook.py` pasa a ser fachada de compatibilidad y se divide en:

- `notebook_common.py` (estado compartido/locks/helpers)

- `notebook_execution.py`

- `notebook_kernel_control.py`

- `notebook_template.py`

2. Se preserva el import surface usado por `backend/main.py` y contratos WS sin cambios breaking.

3. Se incorpora benchmark mixto reproducible (`backend/scripts/stress_ws_mix.py` + `stress_ws_mix.ps1`) y comando `./agent_debug.ps1 stress-ws`.

4. `verify-fast` ahora incluye tests de utilidad del benchmark (`tests/test_stress_ws_mix.py`).

**Archivos:** `backend/app/routers/notebook.py`, `backend/app/routers/notebook_common.py`, `backend/app/routers/notebook_execution.py`, `backend/app/routers/notebook_kernel_control.py`, `backend/app/routers/notebook_template.py`, `backend/scripts/stress_ws_mix.py`, `backend/scripts/stress_ws_mix.ps1`, `backend/tests/test_stress_ws_mix.py`, `agent_debug.ps1`, `docs/modules/04-notebook-handlers.md`, `docs/llm-index.yaml`

## 2026-02-10 - Backpressure WS, template attach y refs de artefactos

1. Dispatcher `/ws` migra a colas acotadas por conexión (`work` y `preview`) con workers dedicados y error aditivo `connection_queue_full` bajo saturación.

2. Se incorpora contrato WS aditivo `template_attach` para asociar plantilla por `template_token` (subida previa por REST), manteniendo `template_upload` legacy.

3. Operaciones pesadas de template (`preview/update/apply`) se ejecutan en pool dedicado para proteger el event loop.

4. Respuestas de ejecución exponen refs aditivas de artefactos (`docx_ref`/`pdf_ref`) con fallback legacy inline/base64.

5. Se agrega instrumentación runtime de colas, waits de lock y latencia de handlers para observabilidad en `/metrics`.

**Archivos:** `backend/main.py`, `backend/app/routers/notebook.py`, `backend/app/services/notebook_service.py`, `backend/app/services/template_service.py`, `backend/app/services/runtime_metrics.py`, `backend/app/contracts/ws_models.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

## 2026-02-10 - Cleanup temprano de kernel previo en create/load

1. `notebook_create` y `notebook_load` aceptan `previous_kernel_id` opcional para apagar el kernel anterior antes de continuar con la nueva sesión.

2. Se reduce la ventana de fuga de kernels al cambiar rápidamente de notebooks en el frontend.

3. El cambio es aditivo y compatible hacia atrás (si no viene `previous_kernel_id`, el flujo mantiene comportamiento previo).

**Archivos:** `backend/app/routers/notebook.py`, `backend/app/contracts/ws_models.py`, `frontend/src/components/NotebookEditor.js`, `docs/architecture/contracts-catalog.md`, `docs/modules/04-notebook-handlers.md`

## 2026-02-09 - Remediación de lifecycle, cancelación y preview stale

1. Se agrega correlación por `execution_id` en ejecución de celdas y PDF async, con cancelación explícita (`notebook_cancel_execution` → `notebook_execution_cancelled`).

2. Se implementa cleanup de kernels/templates en desconexión WS (`connection_id -> kernel_ids`) para cortar fugas de sesión y artefactos temporales.

3. Operaciones template reducen contención del lock de kernel usando lock de mutación dedicado.

4. Se agrega `template_preview_cancel` y política latest-wins para descartar previews stale bajo ráfaga.

**Archivos:** `backend/app/routers/notebook.py`, `backend/main.py`, `backend/app/services/notebook_service.py`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

## 2026-02-09 - Gate de validación de payload previo al handler

1. El dispatcher WS (`backend/main.py`) valida payloads críticos antes de enrutar a handlers notebook/template/análisis.

2. Mensajes inválidos ya no llegan al handler: se responde `error_code=invalid_message_payload` con `details.validation_errors`.

3. Se mantiene compatibilidad de contratos de éxito/error de dominio (`notebook_*`, `template_*`) para payloads válidos.

**Archivos:** `backend/main.py`, `backend/app/contracts/ws_models.py`, `docs/modules/04-notebook-handlers.md`

## 2026-02-07 - Contratos runtime iopub y errores notebook estandarizados

1. `notebook_service._forward_iopub` agrega reenvío para `clear_output`, `update_display_data` y `comm_open/comm_msg/comm_close`.

2. `notebook_error` y `notebook_cell_error` incorporan `message` y `error_code` como campos aditivos manteniendo compatibilidad con `error`.

3. Se evita ambigüedad entre errores de infraestructura y errores de ejecución reportados al UI.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/app/routers/notebook.py`, `docs/modules/04-notebook-handlers.md`

## 2026-02-07 - Bypass de caché para preview manual de estilos

1. `handle_template_preview_style` incorpora lectura de `force_refresh` opcional en payload.

2. Cuando `force_refresh=true`, el handler omite `get_preview_cache(preview_key, kernel_id)` y fuerza generación nueva.

3. Se conserva el contrato de salida (`template_preview_ready`/`template_preview_error`) sin cambios de tipo.

**Archivos:** `backend/app/routers/notebook.py`

## 2026-02-07 - Hardening de `table_index` en handlers de template

1. `handle_template_table_preview`, `handle_template_create_style_from_table` y `handle_template_apply_table_format` normalizan `table_index` y rechazan valores inválidos de forma temprana.

2. Los handlers no ejecutan llamadas de servicio en background cuando `table_index` no cumple formato/rango básico.

3. Se reforzó trazabilidad de error preservando `kernel_id`, `table_index` y `request_id` cuando corresponde.

4. No hubo cambios de contrato WS: se conservan `template_table_preview_error`, `template_error` y mensajes de éxito existentes.

**Archivos:** `backend/app/routers/notebook.py`, `backend/tests/test_template_table_hardening.py`

## 2026-02-06 - Concurrencia de previews y sincronía con template editor

1. Previews de template migrados a ejecución no bloqueante para reducir contención con `notebook_execute_cell`.

2. Se consolidaron semáforos y timeouts en handlers de preview para evitar saturación del motor de conversión.

3. Se mantuvo refresh de estado de template tras apply para evitar payload stale en UI.

**Archivos:** `backend/app/routers/notebook.py`, `backend/main.py`, `frontend/src/components/TemplateEditor.js`

## 2026-02-06 - Normalización documental LLM-first

1. Se reestructuró el módulo con formato canónico (propósito, contratos, sinergias, concurrencia, observabilidad).

2. Se consolidó referencia de contratos WS hacia `docs/architecture/contracts-catalog.md`.

3. Se dejó el histórico detallado en changelog para mantener el módulo técnico más legible.

**Archivos:** `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`
