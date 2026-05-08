# Catálogo Canónico de Contratos (WS/REST)

> **Última actualización:** 2026-05-08

> **Fuente canónica de entrada WS:** `backend/main.py` (`websocket_endpoint`, `notebook_websocket_endpoint`).

---

## Convenciones

- **Dirección:** `C→S` (cliente a servidor), `S→C` (servidor a cliente).

- **Sync mode:**

- `direct`: handler atendido en la ruta principal del dispatcher.

- `background`: handler lanzado en tarea de fondo desde dispatcher.

- **Criticidad:**

- `critical`: impacta ejecución o estado principal del notebook.

- `high`: impacta features primarias no bloqueantes.

- `normal`: soporte/auxiliar.

---

## WebSocket `/ws` (shell global, legacy-compatible)

- Desde 2026-04-20 el shell humano usa `/ws` para eventos globales (`workspace_fs_event`, `mcp_*`, `.py`, control general) y `/ws/notebook` para `notebook_*`, `template_*`, `reconvert_pdf` y mensajes documentales por notebook.

- El catálogo siguiente sigue siendo la fuente canónica de contratos WS; cuando el contrato pertenece a notebook/template, la ruta preferida para UI humana es `/ws/notebook` aunque `/ws` permanezca aceptando compatibilidad legacy y consumidores internos existentes.

| Contrato | Dirección | Handler/Fuente | Sync mode | Criticidad |

|----------|-----------|----------------|-----------|------------|

| `notebook_create` | C→S | `handle_notebook_create` | direct | critical |

| `notebook_load` | C→S | `handle_notebook_load` | direct | critical |

| `notebook_attach_kernel` | C→S | `handle_notebook_attach_kernel` | direct | critical |

| `notebook_save` | C→S | `handle_notebook_save` | direct | critical |

| `notebook_execute_cell` | C→S | `handle_notebook_execute_cell` | direct | critical |

| `notebook_delete_cell` | C→S | `handle_notebook_delete_cell` | direct | high |

| `notebook_move_cell` | C→S | `handle_notebook_move_cell` | direct | high |

| `notebook_set_order` | C→S | `handle_notebook_set_order` | direct | high |

| `notebook_reset_kernel` | C→S | `handle_notebook_reset_kernel` | direct | critical |

| `notebook_interrupt_kernel` | C→S | `handle_notebook_interrupt_kernel` | direct | critical |

| `notebook_shutdown_kernel` | C→S | `handle_notebook_shutdown_kernel` | direct | high |

| `notebook_cancel_execution` | C→S | `handle_notebook_cancel_execution` | direct | critical |

| `notebook_comm_msg` | C→S | `handle_notebook_comm_msg` | direct | normal |

| `notebook_mdoc_clear` | C→S | `handle_notebook_mdoc_clear` | direct | normal |

| `execute_code` | C→S | `handle_code_execution` | direct | normal |

| `cancel_code_execution` | C→S | `handle_cancel_code_execution` | direct | normal |

| `reconvert_pdf` | C→S | `handle_reconvert_pdf` | direct | normal |

| `force_reconvert_pdf` | C→S | `handle_force_reconvert_pdf` | direct | normal |

| `analyze_dependencies` | C→S | `handle_analyze_dependencies` | direct | high |

| `analyze_impact` | C→S | `handle_analyze_impact` | direct | high |

| `sensitivity_analyze` | C→S | `handle_sensitivity_analyze` | direct | high |

| `optimize_design` | C→S | `handle_optimize_design` | direct | high |

| `analyze_load_envelope` | C→S | `handle_analyze_load_envelope` | direct | high |

| `run_code_checks` | C→S | `handle_run_code_checks` | direct | high |

| `compare_scenarios` | C→S | `handle_compare_scenarios` | direct | high |

| `template_upload` | C→S | `handle_template_upload` | direct | high |

| `template_attach` | C→S | `handle_template_attach` | direct | high |

| `template_get` | C→S | `handle_template_get` | direct | normal |

| `template_delete` | C→S | `handle_template_delete` | direct | high |

| `template_update_style` | C→S | `handle_template_update_style` | direct | high |

| `template_update_document_defaults` | C→S | `handle_template_update_document_defaults` | direct | high |

| `template_update_semantic_slots` | C→S | `handle_template_update_semantic_slots` | direct | high |

| `template_preview_cancel` | C→S | `handle_template_preview_cancel` | direct | high |

| `template_preview_style` | C→S | `handle_template_preview_style` | background | high |

| `template_table_preview` | C→S | `handle_template_table_preview` | background | high |

| `template_create_style_from_table` | C→S | `handle_template_create_style_from_table` | direct | high |

| `template_apply_table_format` | C→S | `handle_template_apply_table_format` | direct | high |

| `clear_mdoc` | C→S | respuesta in-line en dispatcher | direct | normal |

| `ping` | C→S | respuesta in-line (`pong`) | direct | normal |

| `mcp_activity_event` | S→C | `mcp_manager.py` (`/api/mcp/activity/events` -> broadcast WS) | direct | normal |

| `mcp_mirror_event` | S→C | `mcp_manager.py` (`/api/mcp/mirror-events` -> broadcast WS) | direct | normal |

| `workspace_fs_event` | S→C | `file_watcher.py` (`watchdog` -> batch -> broadcast WS) | direct | high |

Notas de payload:

- Dispatcher `/ws` devuelve `type="error"` con `error_code` y `details` opcional para:

- JSON inválido (`invalid_json`)

- payload no objeto (`invalid_payload`)

- `type` faltante (`missing_message_type`)

- payload inválido para un contrato tipado (`invalid_message_payload`, con `details.validation_errors`)

- `type` desconocido (`unknown_message_type`)

- mensajes sobredimensionados (`message_too_large`)

- saturación de cola por conexión (`connection_queue_full`, con `details.queue_type` y `details.queue_maxsize`)

- `template_preview_style` acepta `force_refresh` opcional (`bool`) para omitir caché backend (`kernel_id + preview_key`) cuando el cliente requiere un render fresco.

- `template_attach` adjunta una plantilla previamente subida por REST (`template_token`) al `kernel_id` activo; `template_upload` se mantiene por compatibilidad.

- `mcp_activity_event` transporta ahora aditivamente `client_id`, `client_label` y `transport`; la UI puede usar esos campos para filtrar `Agents` por cliente o para agrupar actividad MCP dentro de la home compacta.

- `notebook_create`, `notebook_load`, `notebook_save`, `notebook_reset_kernel`, `notebook_interrupt_kernel`, `notebook_shutdown_kernel`, `notebook_delete_cell`, `notebook_set_order`, `force_reconvert_pdf` y mutaciones/template sync reflejan `request_id` en respuestas success/error cuando el cliente lo envia.

- `notebook_save` acepta payload real `{ notebook }`; no depende de `kernel_id` ni `path` para serializar el contenido persistible.

- Los notebooks Inspyro aceptan `cells[].cell_type` lógico en `code|markdown|docx` para UI/MCP/runtime. En disco, `.ipynb` debe persistir solo tipos Jupyter (`code|markdown|raw`); una celda documental se guarda como `cell_type="code"` + `metadata.inspyro.cell_kind="docx"`. Al normalizar notebooks legacy, `cell_type="docx"` o fuentes `code` con uso detectable de APIs DOCX pueden exponerse suavemente como `docx` y migrarse al guardar.

- `notebook_execute_cell` acepta `execution_id` opcional para correlación de respuestas.

- `notebook_execute_cell` acepta `cell_type` aditivo (`code|docx|markdown`); `docx` se ejecuta como Python, pero marca intención documental de la celda. `emit_docx` conserva su semántica de modo documental de la corrida y no debe tratarse como sinónimo exclusivo de `cell_type="docx"`.

- `notebook_execute_cell` acepta `path` aditivo cuando el cliente conoce la ruta real del notebook; backend lo usa para anclar la historia DOCX persistente al archivo guardado.

- `notebook_execute_cell` acepta `execution_timeout_s` opcional (`float > 0`) para fijar el timeout efectivo de ejecución en backend; si no viene, el backend usa `INSPYRO_NOTEBOOK_EXECUTION_TIMEOUT` (default operativo: `600s`).

- `notebook_attach_kernel` acepta `kernel_id` o `path` para reatar una tab visible a un kernel ya vivo sin recrearlo; el ack `notebook_attached` devuelve `kernel_id`, `notebook_path` y un snapshot notebook serializable.

- `notebook_mdoc_clear` es una acción explícita del usuario/cliente. Apagar DOCX/PDF en UI o llamar MCP con `include_docx=false` no debe emitir este contrato ni limpiar `mdoc`; el último artefacto DOCX/PDF visible sigue válido hasta que una generación documental real lo reemplace.

- En `/ws/notebook`, cualquier request notebook/template/control válida que llegue con `kernel_id` debe rebindear el ownership `kernel_id -> websocket` hacia la conexión actual y cancelar cleanup pendiente del socket anterior; `notebook_attach_kernel` sigue existiendo para recovery explícito, pero ya no es prerrequisito para ejecutar o controlar un kernel tras un reconnect legítimo.

- `execute_code` acepta `file_path` y `run_id` aditivos para correlacionar una corrida `.py` al archivo/tab correcto; backend los reenvía en `execution_started`, `execution_result` y `execution_error`.

- `cancel_code_execution` acepta `run_id` o `file_path`; el shell lo usa al cerrar una tab `.py` o al cancelar explícitamente su job asociado.

- En ejecuciones batch intermedias (`skip_pdf=True`) el backend no persiste artefactos DOCX ni agrega historial; solo la última celda exportable del lote puede fijar el documento final.

- `kernel_lock_timeout` en `notebook_cell_error` ahora significa exclusivamente timeout adquiriendo el lock por `kernel_id` (`INSPYRO_LOCK_TIMEOUT`); `cell_execution_timeout` significa que la celda excedió su timeout efectivo de ejecución y el backend intenta `interrupt_kernel()` como best-effort.

- Cuando una cancelación/interrupción tardía deriva en `KeyboardInterrupt` después de que la celda ya había cerrado su camino principal, el adaptador MCP lo normaliza como `CELL_EXECUTION_INTERRUPTED` retryable en vez de mezclarlo con `COM_BACKEND_TIMEOUT`.

- Los mensajes `notebook_stream`, `notebook_clear_output`, `notebook_execute_result`, `notebook_display_data`, `notebook_update_display_data`, `notebook_comm_open`, `notebook_comm_msg`, `notebook_comm_close`, `notebook_docx_update`, `notebook_progress_update`, `notebook_pdf_ready`, `notebook_cell_executed` y `notebook_cell_error` incluyen `execution_id` aditivo cuando provienen de una ejecucion de notebook.

- Los mensajes tempranos reenviados desde IOPub (`notebook_stream`, `notebook_execute_input`, `notebook_execute_result`, `notebook_display_data`, `notebook_clear_output`, `notebook_update_display_data`, `notebook_comm_open`, `notebook_comm_msg`, `notebook_comm_close` y `notebook_error` cuando proviene del forward IOPub), junto con el heartbeat `notebook_progress_update`, incluyen aditivamente `kernel_id`, `source_path` y `source_kind` cuando el backend ya conoce ese origen.

- `notebook_cell_executed` incluye `kernel_id` aditivo; es el payload canónico para correlacionar artefactos inline DOCX/PDF por kernel incluso cuando no existe `token`/`ref`.

- `notebook_cell_executed` es el mensaje terminal de ejecución de celda aunque el rescate DOCX/PDF quede diferido; la ausencia temporal de artefactos no debe reinterpretarse como fallo de la ejecución principal.

- En la última celda exportable, `notebook_cell_executed` ya no debe transportar DOCX/PDF inline como condición de cierre; el artefacto final llega después por `notebook_progress_update` + `notebook_docx_update` + `notebook_pdf_ready`.

- `notebook_docx_update` es un contrato `S→C` aditivo para publicar metadata/artefactos DOCX tardíos (`docx_ref`, `docx_artifact_id`, `docx_file_token`, `docx_hash`, `docx_provenance_*`, warnings/errores) después del terminal `notebook_cell_executed`.

- Los payloads documentales backend (`notebook_cell_executed`, `notebook_pdf_ready`, `pdf_reconverted`, `execution_result`) pueden incluir `token`/`ref` aunque el artefacto también vaya inline/base64; inline y download-store ya no son caminos mutuamente excluyentes.

- Los payloads DOCX documentales pueden incluir aditivamente `docx_artifact_id`, `source_path` y `source_kind`; `docx_ref`/`docx_download_url` deben seguir considerándose válidos incluso cuando llegan sin `docx_file_b64`.

- Los payloads documentales DOCX/PDF (`notebook_cell_executed`, `notebook_pdf_ready`, `pdf_reconverted`, `execution_result`, `/api/docx/history`) pueden incluir aditivamente `docx_provenance_available` (`bool`) y `docx_provenance_ref` (`/api/docx/provenance?artifact_id=...`) para habilitar navegación PDF -> código desde frontend o clientes externos.

- `notebook_pdf_ready` puede reemitir `docx_artifact_id`, `docx_provenance_available` y `docx_provenance_ref` aunque el evento solo transporte cambios PDF, permitiendo a frontend/MCP mantener sincronizada la procedencia del documento asociado.

- `notebook_docx_update` y `notebook_pdf_ready` pueden incluir aditivamente `workspace_path`, `workspace_relpath` y `workspace_warning` para señalar la copia persistida del proyecto (`Docx_Documents`) o la degradación cuando no se pudo materializar dentro del workspace activo.

- `notebook_docx_update` y `notebook_pdf_ready` pueden incluir `document_timing_ms` con timings del pipeline documental tardío. Además de `sanitize_ms` / `artifact_store_ms` / `docx_to_pdf_ms`, el payload puede transportar `kernel_export_ms`, `transport_read_ms`, `transport_cleanup_ms`, `docx_transfer_bytes`, `provenance_transfer_bytes`, `artifact_cleanup_ms`, `blob_write_ms`, `delivery_cache_ms`, `workspace_write_ms`, `provenance_manifest_ms`, `index_write_ms` y `cache_lookup_ms` cuando apliquen.

- La emisión DOCX ya no depende de que cambie el hash semántico: cada generación vuelve a publicar una referencia descargable estable y una entrada histórica persistente cuando existe DOCX exportado.

- `notebook_cell_executed` y `execution_result` pueden incluir aditivamente `docx_is_empty=true`; cuando aparece, backend no debe publicar un artefacto DOCX nuevo para esa ejecución y frontend/MCP deben preservar el último documento válido mientras muestran el warning asociado en `docx_warnings`.

- Los consumidores frontend/MCP deben considerar “nuevo DOCX” solo un payload con identidad estable real (`docx_artifact_id`, `docx_ref`/`docx_download_url`, `docx_file_token`) o `docx_file_b64` no vacío; claves DOCX presentes pero nulas/stale no deben inflar historial.

- Los payloads PDF documentales incluyen aditivamente `pdf_file_name`; los payloads DOCX ya incluían `docx_file_name`.

- `notebook_cell_executed` puede incluir `variables_snapshot_degraded=true` y `execution_diagnostics` aditivo cuando la captura runtime cae en fallback/omisión segura (por ejemplo, objetos COM/interop o timeout de snapshot); el estado `status="ok"` sigue describiendo la ejecución principal de la celda.

- `notebook_progress_update` sigue siendo señal de liveness/progreso documental tardío y no sustituye el terminal `notebook_cell_executed`.

- `notebook_progress_update` admite aditivamente `progress_scope`, `progress_stage`, `progress_status`, `progress_percent` y `progress_indeterminate` para que UI/MCP separen la corrida de celdas del pipeline documental.

- `notebook_progress_update` admite además `shared_resource={ kind, scope, status }` para declarar contención serializada real sin crear un contrato nuevo; hoy `kind="pdf_converter"`, `scope="global"` y `status="waiting"|"running"` exponen la espera/uso del convertidor Word/LibreOffice compartido.

- Cuando `shared_resource.kind="pdf_converter"` llega junto a `progress_scope="document"` y `progress_stage="pdf_convert"`, frontend/MCP deben preferir esa metadata estructurada sobre texto libre para copy como `Esperando convertidor PDF compartido` o `Usando convertidor PDF compartido`.

- `progress_scope="execution"` + `progress_stage="cell_run"` representa heartbeat pre-terminal de una celda larga; `progress_scope="document"` modela el pipeline tardío por etapas (`queued` -> `docx_export` -> `docx_ready` -> `pdf_convert`) que alimenta la barra documental sin reabrir la ejecución principal.

- `analyze_dependencies` y `analyze_impact` aceptan `request_id` opcional para correlación determinística de `*_result` / `*_error` en frontend.

- `analyze_dependencies` requiere `symbol` y acepta aditivamente `source_code`, `notebook_context`, `line`, `column`, `file_path`, `max_depth`, `kernel_id`, `context_cell_ids`, `cell_id`; si `line/column` no vienen, el backend preserva `None` y no sintetiza `1:0`.

- `analyze_impact` acepta `line` y `column` opcionales para desambiguar scope cuando hay símbolos homónimos (ej: `b` global vs `self.b`).

- `analyze_impact` requiere `symbol` y acepta aditivamente `source_code`, `notebook_context`, `line`, `column`, `file_path`, `max_depth`, `kernel_id`, `context_cell_ids`, `cell_id`.

- `analyze_dependencies` y `analyze_impact` devuelven metadatos aditivos de análisis (`analysis_mode`, `parse_errors`, `runtime_enriched`, `workspace_scanned_files`, `workspace_reverse_index_used`, `workspace_scan_truncated`) sin romper payload previo.

- `sensitivity_analyze` acepta `modified_variables`, `output_variables`, `formulas` (`dict`) y `current_values`.

- `optimize_design` acepta `objective`, `variables`, `constraints`, `formulas` (`dict`), `current_values`, `iterations`, `seed` y responde con `optimization_progress` + `optimization_result` (o `optimization_error`).

- `analyze_load_envelope` acepta `combinations`, `outputs`, `formulas`, `current_values` y responde `load_envelope_result` (o `load_envelope_error`).

- `run_code_checks` acepta `checks`, `code_profile`, `formulas` (`dict`), `current_values` y responde `code_checks_result` (o `code_checks_error`).

- `compare_scenarios` acepta `baseline`, `candidates`, `outputs`, `formulas` (`dict`), `current_values` y responde `scenario_comparison_result` (o `scenario_comparison_error`).

- `notebook_create` y `notebook_load` aceptan `previous_kernel_id` opcional para rebuilds explícitos del mismo contexto; Home, cambio de tab o apertura de otro archivo ya no deben usar ese cleanup para destruir runtimes vivos.

- Clientes UI/MCP que reconstruyen kernels con `notebook_load` o `reset_kernel(hard=true)` deben serializar una versión persistable del notebook (sin `outputs`, `execution_count` ni metadata runtime efímera) para evitar timeouts y payloads WS sobredimensionados en notebooks grandes.

- `notebook_cancel_execution` permite cancelar por `kernel_id` + `execution_id` (o por ejecución activa cuando `execution_id` no viene).

- `template_preview_cancel` permite descartar previews stale por `kernel_id` + `preview_key`/`request_id` (estrategia latest-wins).

- `template_preview_style.style_props` puede incluir `table_signature` (string) para versionar preview de estilos de tabla aunque no cambien propiedades de fuente/párrafo.

- `template_preview_ready` y `template_preview_error` mantienen correlación por `request_id` + `preview_key` para descartar respuestas stale en frontend.

- Mutaciones de template (`template_upload`, `template_delete`, `template_update_style`, `template_update_document_defaults`, `template_update_semantic_slots`, `template_create_style_from_table`, `template_apply_table_format`) aceptan `request_id` opcional y lo reflejan en respuestas `success/error`.

- `template_update_style.updates` soporta formato dual: plano legacy (`font_size_pt`, `table_border_color`, etc.) y bloques aditivos (`font`, `paragraph`, `table`, `advanced_props`) normalizados en backend. Desde 2026-05-08 acepta además `word_style` como contenedor práctico de paridad Word (`metadata`, `visibility`, `font`/`run`, `paragraph`, `list`, `table`, `raw`/`advanced_props`) y `style_visibility` como alias top-level de visibilidad/galería (`hidden`, `semiHidden`, `qFormat`, `uiPriority`, `unhideWhenUsed`).

- `template_update_document_defaults.updates` separa `font` y `paragraph`; backend materializa `w:docDefaults/w:rPrDefault/w:rPr` y `w:docDefaults/w:pPrDefault/w:pPr` en `styles.xml`, removiendo nodos/atributos conflictivos cuando un campo global se limpia para reactivar herencia de Word/theme. El campo aditivo `word_defaults` puede transportar la misma intención como `{ run|font, paragraph }` para clientes Word-complete.

- `template_update_semantic_slots.semantic_style_slots` persiste el mapeo Word-first de slots semánticos (`body`, `heading_1..6`, `list_bullet`, `list_number`, `caption`, `code`, `table_default`) hacia estilos Word reales del template; backend revalida cada slot contra `style_browser` y recompone heurísticas si el estilo quedó stale tras reextraer la plantilla.

- `template_error` se estandariza con `error_code` (machine readable), `message` (texto humano), `error` (compatibilidad legacy) y `request_id` opcional para correlación.

- `notebook_error`/`notebook_cell_error` incluyen `message` y `error_code` como campos aditivos (compatibilidad legacy con `error`).

- Respuestas de ejecución soportan campos aditivos de artefacto por referencia (`docx_ref`, `pdf_ref`) además de payload inline/base64 legacy.

### Mensajes de salida frecuentes (`S→C`)

| Contrato | Productor principal |

|----------|----------------------|

| `notebook_created` | `notebook.py` |

| `notebook_loaded` | `notebook.py` |

| `notebook_saved` | `notebook.py` |

| `notebook_stream` | `notebook.py` + kernel callbacks |

| `notebook_cell_executed` | `notebook.py` |

| `notebook_docx_update` | `notebook.py` background DOCX recovery |

| `notebook_pdf_ready` | `notebook.py` background PDF |

| `notebook_execution_cancelled` | `notebook.py` |

| `notebook_clear_output` | `notebook_service.py` |

| `notebook_update_display_data` | `notebook_service.py` |

| `notebook_comm_open` / `notebook_comm_msg` / `notebook_comm_close` | `notebook_service.py` |

| `dependency_analysis_result` | `analysis.py` |

| `impact_analysis_result` | `analysis.py` |

| `sensitivity_result` | `analysis.py` |

| `optimization_progress` | `analysis.py` |

| `optimization_result` | `analysis.py` |

| `optimization_error` | `analysis.py` |

| `load_envelope_result` | `analysis.py` |

| `load_envelope_error` | `analysis.py` |

| `code_checks_result` | `analysis.py` |

| `code_checks_error` | `analysis.py` |

| `scenario_comparison_result` | `analysis.py` |

| `scenario_comparison_error` | `analysis.py` |

| `template_uploaded` | `notebook.py` |

| `template_info` | `notebook.py` |

| `template_deleted` | `notebook.py` |

| `template_style_updated` | `notebook.py` |

| `template_document_defaults_updated` | `notebook.py` |

| `template_semantic_slots_updated` | `notebook.py` |

| `template_preview_ready` | `notebook.py` |

| `template_preview_error` | `notebook.py` |

| `template_preview_cancelled` | `notebook.py` |

| `template_table_preview_ready` | `notebook.py` |

| `template_table_preview_error` | `notebook.py` |

| `template_style_created` | `notebook.py` |

| `template_format_applied` | `notebook.py` |

| `template_error` | `notebook.py` |

| `mcp_activity_event` | `mcp_manager.py` (`/api/mcp/activity/events` -> broadcast WS) |

| `mcp_mirror_event` | `mcp_manager.py` (`/api/mcp/mirror-events` -> broadcast WS) |

| `workspace_fs_event` | `file_watcher.py` |

| `error` | dispatcher/global |

| `pong` | dispatcher/global |

Notas de payload saliente:

- `template_uploaded`, `template_info`, `template_style_updated`, `template_document_defaults_updated`, `template_semantic_slots_updated`, `template_style_created` y `template_format_applied` pueden incluir metadata aditiva de fuentes/defaults del template: `default_font`, `default_font_source`, `font_catalog`, `system_font_catalog`, `builder_required_style_defaults`, `document_defaults` (`font`, `paragraph`, `font_source`, `paragraph_source`), `style_browser` (`categories`, `category_order`, `auto_selected`, `counts`) y `semantic_style_slots` como contrato Word-first persistido; cada estilo navegable puede exponer `selection_key`, `xml_font`, `xml_font_source`, `resolved_font`, `resolved_font_source`, alias `font_source`, `style_visibility` y `word_style` (`metadata`, `visibility`, `font`, `paragraph`, `list`, `table`, `raw`) para explicar la procedencia efectiva y propiedades OOXML avanzadas sin romper clientes existentes.

- `template_document_defaults_updated` devuelve el `template` completo actualizado para que el shell rehidrate `Documento (Global)` sin hacer un `template_get` extra y mantenga sincronizado `templateInfo`.

- `template_semantic_slots_updated` devuelve también el `template` completo actualizado para que el shell rehidrate la banda de slots semánticos sin un `template_get` adicional.

- `template_style_created` y `template_format_applied` pueden devolver también el `template` completo actualizado; clientes modernos deben tratarlo como ACK autoritativo de mutación igual que `template_style_updated` y no necesitan emitir `template_get` extra.

- `mcp_activity_event` es un contrato `S→C` aditivo para visualización MCP. Incluye `event_id`, `run_id`, `phase`, `status`, `tool_name`, `tool_group`, `summary`, `detail?`, `duration_ms?`, `error?`, `ts`, `client_id?`, `client_label?`, `transport?`, `resource` (`path?`, `notebook_path?`, `kernel_id?`, `cell_id?`, `execution_id?`) y `ui_hints` (`refresh_workspace`, `reload_path`, `show_agent_execution`, `refresh_preview`, `artifact`).

- El backend agrega `active_count` en cada `mcp_activity_event` para derivar badges/runs activos sin polling extra.

- `mcp_activity_event` mantiene rol de telemetría/feed/notificación; no debe usarse como replay granular de notebook/template.

- `mcp_mirror_event` es el contrato `S→C` aditivo para espejo UI granular. Incluye `run_id`, `step_id`, `tool_name`, `tool_group`, `action`, `resource`, `payload` y `ts`.

- `mcp_mirror_event.action` soporta en v1: `open_resource`, `notebook_snapshot`, `notebook_runtime_message`, `template_snapshot`, `artifact_update`, `file_mutation`.

- `mcp_mirror_event.payload` reutiliza payloads WS conocidos cuando aplica: `open_resource` transporta `{ path?, notebook_path?, kernel_id?, resource_kind?, focus_view? }`; `notebook_runtime_message` transporta mensajes `notebook_*` reales (`notebook_stream`, `notebook_clear_output`, `notebook_cell_executed`, `notebook_pdf_ready`, etc.) y mensajes de lifecycle reflejado (`notebook_kernel_reset`, `notebook_kernel_interrupted`, `notebook_kernel_shutdown`); `notebook_snapshot` transporta `{ path, notebook, kernel_id?, focus_cell_id? }`; `template_snapshot` transporta `{ kernel_id, notebook_path, template, template_token? }`; `artifact_update` transporta un bloque `artifact`; `file_mutation` transporta `{ mutation, path?, old_path?, new_path?, is_directory, file_kind }`.

- Los conflictos de espejo no se emiten como acción backend dedicada en `mcp_mirror_event`; el shell React decide bloquear o aplicar el replay usando dirty state local, tabs abiertos y recurso activo.

- `workspace_fs_event` agrupa cambios del workspace activo detectados por el watcher backend. El payload es `{ type, workspace_path, events[] }`, donde cada evento incluye `{ action, path, parentPath, oldPath?, isDirectory, hidden, ts }`. El backend omite `modified` de directorio y exclusiones duras (`.git`, `node_modules`, caches, venvs).

---

## WebSocket `/ws/lsp`

| Contrato | Dirección | Fuente | Criticidad |

|----------|-----------|--------|------------|

| JSON-RPC LSP (`initialize`, `textDocument/*`, etc.) | C↔S | `backend/app/routers/lsp.py` + `lsp_bridge.py` | high |

---

## REST críticos

| Método | Ruta | Owner |

|--------|------|-------|

| GET | `/health` | `backend/main.py` |

| GET | `/metrics` | `backend/main.py` |

| GET | `/pdf-status` | `backend/main.py` |

| GET | `/api/system/info` | `backend/main.py` |

| GET | `/api/system/home-summary` | `backend/main.py` |

| POST | `/api/system/workspace` | `backend/main.py` |

| POST | `/api/system/workspace/create` | `backend/main.py` |

| GET | `/api/files/tree` | `backend/app/routers/files.py` |

| GET | `/api/files/search` | `backend/app/routers/files.py` |

| GET | `/api/files/read` | `backend/app/routers/files.py` |

| POST | `/api/files/write` | `backend/app/routers/files.py` |

| POST | `/api/files/create` | `backend/app/routers/files.py` |

| DELETE | `/api/files/delete` | `backend/app/routers/files.py` |

| POST | `/api/files/rename` | `backend/app/routers/files.py` |

| POST | `/api/files/move` | `backend/app/routers/files.py` |

| POST | `/api/files/copy` | `backend/app/routers/files.py` |

| POST | `/api/files/duplicate` | `backend/app/routers/files.py` |

| POST | `/api/files/open-default` | `backend/app/routers/files.py` |

| GET | `/api/mcp/activity` | `backend/app/routers/mcp_manager.py` |

| POST | `/api/mcp/activity/events` | `backend/app/routers/mcp_manager.py` |

| POST | `/api/mcp/client-heartbeat` | `backend/app/routers/mcp_manager.py` |

| POST | `/api/mcp/mirror-events` | `backend/app/routers/mcp_manager.py` |

| POST | `/api/mcp/restart` | `backend/app/routers/mcp_manager.py` |

| GET | `/api/docx/download` | `backend/app/routers/docx.py` |

| GET | `/api/docx/history` | `backend/app/routers/docx.py` |

| GET | `/api/docx/quality` | `backend/app/routers/docx.py` |

| POST | `/api/docx/quality/run` | `backend/app/routers/docx.py` |

| GET | `/api/docx/quality/render` | `backend/app/routers/docx.py` |

| POST | `/api/docx/quality/clean` | `backend/app/routers/docx.py` |

| POST | `/api/docx/workbench/run` | `backend/app/routers/docx.py` |

| GET | `/api/docx/workbench/result` | `backend/app/routers/docx.py` |

| GET | `/api/docx/workbench/resource` | `backend/app/routers/docx.py` |

| GET | `/api/docx/render/resource` | `backend/app/routers/docx.py` |

| GET | `/api/docx/diff` | `backend/app/routers/docx.py` |

| GET | `/api/docx/provenance` | `backend/app/routers/docx.py` |

| GET | `/api/docx/provenance/open` | `backend/app/routers/docx.py` |

| GET | `/api/pdf/download` | `backend/app/routers/pdf.py` |

| POST | `/api/templates/upload` | `backend/app/routers/templates.py` |

| POST | `/api/templates/tokenize` | `backend/app/routers/templates.py` |

| GET | `/api/templates/export` | `backend/app/routers/templates.py` |

| POST | `/api/templates/bind` | `backend/app/routers/templates.py` |

| POST | `/api/units/convert` | `backend/app/routers/units.py` |

| GET | `/api/units/catalog` | `backend/app/routers/units.py` |

| POST | `/api/units/compatible` | `backend/app/routers/units.py` |

Notas REST:

`/api/system/info` expone el workspace activo efectivo (`workspace_root` / `workspace_path`), el `active_workspace` persistido si existe, la ruta sugerida para proyectos nuevos (`suggested_workspace_root`) y `recent_workspaces`; el backend ya no usa la carpeta de instalación como workspace por defecto.

`/api/system/home-summary` expone el snapshot shell-owned y workspace-scoped de la home compacta. Su payload top-level incluye `workspace_path`, `notebook_runtime_items[]`, `code_runtime_items[]`, `runtime_items[]`, `recent_docx_items[]`, `mcp_service`, `mcp_clients[]`, `template_inventory[]` y `updated_at`; además conserva bloques de apoyo (`overview`, `mcp_clients_summary`, `template_inventory_summary`) para métricas y agrupación. El shell lo consume como fuente de `workspaceData.operational` (`attentionItems`, carriles `Entender` / `Ejecutar` / `Entregar` y acciones rápidas) y conserva las `cards` derivadas solo como fallback frontend temporal; backend lo arma combinando un runtime registry por notebook (`kernel_id + notebook_path`) y por script (`run_id + file_path`), artefactos DOCX del workspace, actividad/heartbeats MCP y mirrors persistidos en `<workspace>/.inspyro/templates/`. Desde 2026-04-22, `notebook_runtime_items[].progress` puede transportar también `shared_resource` y debe reflejar la espera/uso del convertidor PDF global mientras el pipeline documental sigue vivo; `notebook_docx_update` ya no cierra ese progreso por sí solo y el ciclo se limpia recién en terminales documentales reales (`notebook_pdf_ready`, fallo final, cancelación o interrupción).

`/api/system/workspace` selecciona un workspace existente y lo persiste como proyecto activo de la sesión/aplicación; acepta `{ path, create_if_missing? }`.

`/api/system/workspace/create` crea y activa un nuevo workspace en la carpeta padre indicada (o en el root sugerido de proyectos del usuario si no se envía `parent_path`); espera `{ name, parent_path? }`.

`/api/pdf/download` acepta query `inline` (`true`/`false`). Usar `inline=1` para render en `iframe`; `inline=0` fuerza descarga (`Content-Disposition: attachment`).

`/api/docx/provenance` devuelve el manifiesto persistido del artefacto DOCX actual (`artifact_id`, `generated_at`, `items[]`) y respeta `Cache-Control: no-store`; cada item puede incluir además `exact_file_path`/`exact_notebook_cell_id`, `exact_line` y `user_stack[]`, manteniendo `file_path`/`notebook_cell_id`/`line` como destino `callsite`.

`/api/docx/provenance/open` es la URL estable embebida en los hyperlinks del PDF; fuera del visor controlado abre una página safe con `callsite`, `exact`, `api_name`, `precision`, `text_preview` y stack de usuario resumido.

`/api/docx/provenance/open?format=json` reutiliza la misma resolución backend, pero devuelve JSON link-first (`artifact_id`, `item`, `location_label`, `exact_location_label`, `docx_provenance_open_url`) para que el visor controlado pueda reresolver un `provenance_id` puntual cuando el manifiesto DOCX cargado quedó stale respecto del PDF visible.

`/api/templates/upload` retorna `template_token`, `size_bytes`, `sha256`; el attach real ocurre luego via `template_attach`, y la importación portable JSON del editor reutiliza exactamente esta ruta.

`/api/templates/export` retorna un envelope portable con `schema_version`, `exported_at`, `kernel_id`, `template`, `docx_base64` y `file_name`; el JSON exportado persiste `semantic_style_slots` como contrato Word-first y solo acepta `category_overrides` como compatibilidad legacy de import.

`POST /api/templates/bind` espera `{ kernel_id, notebook_path, notebook?, template_json_path? }`; exporta la plantilla activa como JSON portable `schema_version=1.1`, escribe por defecto `<notebook_stem>.inspyro-template.json` junto al `.ipynb`, parchea `metadata.inspyro.template_binding` con ruta relativa `path_base="notebook_dir"` y devuelve `{ binding, notebook, template_binding }`. El binding JSON del `.ipynb` es la fuente canónica; mirrors legacy bajo `<workspace>/.inspyro/templates/` quedan solo como fallback/migración.

`GET /api/files/tree` se consume en modo lazy desde frontend (`depth=1` por defecto útil para explorer) y retorna metadata aditiva por nodo: `hasChildren`, `writable`, `hidden`, `symlink`, `modified`, `relativePath`.

`GET /api/files/search` busca por nombre dentro del workspace/ruta solicitada y devuelve lista plana `{ path, name, relativePath, parentPath, isDirectory, extension, score, writable, hidden }`, ordenada por basename exacto/prefijo/subcadena/path.

`/api/files/create` espera `{ path, name, type }`.

`/api/files/rename` espera `{ oldPath, newName }` y sigue siendo rename same-directory.

`/api/files/move` espera `{ sourcePath, destinationPath }`.

`/api/files/copy` espera `{ sourcePath, destinationPath }`.

`/api/files/duplicate` espera `{ sourcePath }` y materializa `copy`, `copy 2`, etc. en la misma carpeta.

`/api/files/open-default` espera `{ path }`, valida que la ruta sea un archivo seguro y existente, y delega la apertura a la aplicación por defecto del sistema operativo donde corre el backend. La UI desktop prefiere `window.inspyroDesktop.openPath(path)` y usa este REST como soporte del modo web local.

`GET /api/mcp/activity` hidrata historial MCP reciente (`events`), runs activos (`active_runs`) y `active_count` para el shell frontend. Cuando la actividad viene correlacionada por heartbeat, esos eventos/runs también pueden transportar `client_id`, `client_label` y `transport`.

`POST /api/mcp/activity/events` es uso interno del servidor MCP: registra actividad estructurada y emite `mcp_activity_event` al WS principal.

`POST /api/mcp/mirror-events` es uso interno del servidor MCP: normaliza y emite `mcp_mirror_event` al WS principal para espejo UI granular.

`GET /api/docx/download` acepta `artifact_id` estable, `token` legacy o lookup del ultimo DOCX persistido por `source_path`/`kernel_id`; el lookup por `source_path`/`kernel_id` salta artefactos clasificados como vacíos, mientras `artifact_id` sigue apuntando de forma literal al blob solicitado. Si no hay artifact store pero el runtime aun conserva el DOCX actual del kernel, la ruta por `kernel_id` sirve ese fallback. El binario visible entregado por esta ruta se sanea en todas sus ramas para remover hyperlinks automáticos `/api/docx/provenance/open?...` y field codes `HYPERLINK` equivalentes; el artifact persistido sigue intacto para PDF/reconversión y no cambia el shape del contrato REST.

`GET /api/docx/history` retorna historial DOCX newest-first filtrable por `source_path` o `kernel_id`, incluyendo `artifact_id`, `created_at`, `docx_hash`, metadata de origen, `size_bytes`, `download_url`, `docx_is_empty`, `docx_warning`, `workspace_path`, `workspace_relpath`, `workspace_warning`, `docx_quality_status`, `docx_quality_score`, `docx_quality_counts`, `docx_render_status`, `docx_render_page_count`, `docx_render_cached_pages`, `docx_render_renderer` y `retention_days`; no refleja estados parciales de batch, solo generaciones persistidas finales.

`GET /api/docx/quality` lee únicamente el summary cacheado por `artifact_id` y responde `404` cuando no existe. `POST /api/docx/quality/run` ejecuta auditoría bajo demanda por `artifact_id`, `source_path` o `kernel_id`, acepta `profile` y persiste el summary. `GET /api/docx/quality/render` conserva compatibilidad legacy y devuelve PNG de una página, pero ahora usa el cache visual persistente: si el PDF canónico por `binary_hash + renderer_signature + profile` existe, no vuelve a llamar Word/LibreOffice. `POST /api/docx/quality/clean` genera una copia limpia opt-in sin reemplazar el original.

`POST /api/docx/workbench/run` es el contrato unificado para operaciones DOCX nativas (`audit`, `render_manifest`, `render_page`, `render_all_pages`, `clear_render_cache`, `clean`, `prepare_delivery`, `comments_*`, `redlines_*`, `fields_*`, `redact`, `protect`, `content_controls_*`, `diff`). Persiste `summary.json`, resources y variantes junto al artefacto. `render_manifest` lee estado visual y handles cacheados, `render_page` rasteriza una página bajo demanda, `render_all_pages` prepara todas las páginas explícitamente y `clear_render_cache` borra solo derivados visuales. `GET /api/docx/workbench/result` devuelve el summary compacto; `GET /api/docx/workbench/resource` descarga resources/variantes Workbench; `GET /api/docx/render/resource` sirve PDFs/PNGs derivados por `render_id + name`; `GET /api/docx/diff` es atajo de comparación entre dos `artifact_id`.

`POST /api/mcp/restart` envuelve `stop + start` del subprocess MCP shell-owned y limpia `active_runs` / `mcp_clients` efímeros antes de reiniciar.

`POST /api/mcp/client-heartbeat` registra o refresca clientes MCP conectados con `client_id/session_id`, `client_label`, `transport`, `workspace_path`, `last_seen_at` y `status`; el home summary agrupa esos clientes y adjunta su actividad reciente por cliente.

`POST /api/mcp/activity/events` conserva el contrato previo y añade campos aditivos `client_id`, `client_label` y `transport` para correlacionar runs/feed por cliente sin romper consumidores existentes.

`POST /api/templates/tokenize` convierte un `.docx` local seguro en `template_token` efímero para `template_attach`; la home lo usa para reatachar el espejo persistido de `<workspace>/.inspyro/templates/` antes de abrir el editor de template.

`notebook_created`, `notebook_loaded`, `notebook_attached`, `notebook_kernel_reset` y los ACKs `template_uploaded`, `template_info`, `template_deleted`, `template_style_updated`, `template_document_defaults_updated`, `template_semantic_slots_updated`, `template_style_created` y `template_format_applied` pueden incluir `template_binding` aditivo. Estados esperados: `none`, `bound`, `available`, `applied`, `updated`, `missing`, `error` e `inherited`; `missing`/`error` no bloquean ejecución del notebook.

`/api/units/convert` acepta payload aditivo `{ magnitude: number|number[]|number[][], from_unit, to_unit, options?, uncertainty? }`; retorna `converted_magnitude`, `repr`, `category`, `metadata`, `dimension` y bloque `canonical` (`from_unit`, `to_unit`, `input_from`, `input_to`). `dimension` sale de la identidad canónica normalizada, no del orden textual incidental de Pint.

`/api/units/catalog` expone el catálogo canónico de unidades (`canonical/display/pint/aliases/category/dimension`) para frontend dinámico.

`/api/units/compatible` calcula unidades compatibles por firma dimensional canónica y devuelve lista de opciones para conversión segura; evita falsos negativos entre fuerzas SI/imperiales (`N`, `kN`, `lbf`, `kgf`, `tonf`) aunque Pint serialice la dimensionalidad en distinto orden.

Errores tipados de unidades: `invalid_payload`, `invalid_magnitude`, `invalid_unit`, `unknown_unit`, `incompatible_units`, `invalid_temperature_mode`, `conversion_failed`.

---

## Reglas obligatorias de mantenimiento

Si cambia cualquier contrato WS o REST:

1. Actualizar este archivo.

2. Actualizar `docs/llm-index.yaml` en `contracts`.

3. Actualizar el módulo backend y frontend impactados.

4. Actualizar `AGENTS.md` si cambia la ruta de lectura o prioridad de fuentes.

5. Ejecutar `.\agent_debug.ps1 contracts-check` y resolver drift antes de merge.

