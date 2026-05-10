# Feature Threads (E2E)

> **Última actualización:** 2026-05-10

> **Objetivo:** documentar sinergias entre módulos siguiendo flujos funcionales end-to-end.

---

## Thread 1: Ejecución de celda + DOCX/PDF

### Objetivo

Ejecutar una celda de notebook, transmitir outputs en tiempo real y publicar artefactos DOCX/PDF.

### Secuencia

1. Frontend envía `notebook_execute_cell` por `/ws/notebook` con `execution_id` opcional, `cell_type` aditivo y `execution_timeout_s=600`; `/ws` queda reservado al shell global (`workspace_fs_event`, `mcp_*`, control general, `.py`) y la UI conserva solo una gracia corta local para esperar el terminal WS.

2. Frontend conserva una sesión notebook por tab/path; ir a `Home`, cambiar de tab u abrir otro archivo no debe apagar el kernel actual. En la navegación normal dentro de la misma sesión renderer/WS, `App.js` reutiliza snapshot local + `initialKernelId` y sigue absorbiendo `notebook_*` aunque `NotebookEditor` esté desmontado. El shell resuelve el destino con esta prioridad: `source_path/notebook_path/path` del payload, luego `entry.path` del propio socket `/ws/notebook`, luego correlación shell-owned por `execution_id` y finalmente por `kernel_id`, de modo que corridas paralelas desfasadas no dejen un notebook oculto “pegado”. Además, el shell mantiene siempre actualizado el snapshot runtime por `path`, incluso cuando el notebook está visible, y el editor activo consume esos mensajes por relay explícito en vez de depender de rehidratación continua por props. Desde 2026-04-22, esa rehidratación también valida ownership por `path`: `App.js` solo adopta `notebookData` cuyo `notebookSyncState.path` coincide con la sesión activa, evitando contaminar una libreta recién activada con el snapshot todavía visible de otra. `notebook_attach_kernel` queda reservado a recovery explícito o reconexión real, no a cada cambio de superficie. `previous_kernel_id` queda reservado a rebuilds explícitos.

3. `backend/main.py` prioriza control plane (`interrupt/reset/shutdown/cancel`) y enruta trabajo por colas acotadas por conexión (`work` + `preview`) con workers dedicados; desde 2026-04-20 existe además un dispatcher `/ws/notebook` separado con su propio `ConnectionManager`, de modo que una ráfaga documental/template de notebook A no sature ni cierre el transporte shell de notebook B.

4. `notebook.py` instrumenta código y usa lock por `kernel_id`. `INSPYRO_LOCK_TIMEOUT` acota solo la adquisición de ese lock; la ejecución real queda gobernada por `execution_timeout_s` o por `INSPYRO_NOTEBOOK_EXECUTION_TIMEOUT=600`. Cualquier request notebook/template/control válida que llegue con `kernel_id` rebindea primero ese kernel al websocket notebook actual y cancela cleanup pendiente del socket previo, evitando que un reconnect legítimo deje al runtime elegible para shutdown mientras la nueva conexión ya lo está usando. Si es una ejecución en batch intermedia (`skip_pdf=True`), la instrumentación elude el rescate `doc_export` global del documento, no persiste artefactos DOCX y evita inflar el historial mientras el lote sigue corriendo.

5. `jupyter_kernel.py` ejecuta, stream de outputs y señal `idle`; callbacks IOPub se desacoplan con backlog acotado para no acoplar ejecución a latencia de red/UI. La captura de variables runtime evita `repr()` inseguro sobre proxies COM/interop y degrada a snapshot seguro si el namespace contiene objetos no serializables. Si `execute_reply` vence, el manager cancela los readers IOPub pendientes antes de devolver `SHELL_REPLY_TIMEOUT`; si el kernel no llega a `idle` en startup o health check, se marca `KERNEL_NOT_READY` y solo se intenta un restart/recreate automático. El snapshot runtime ya no transporta DOCX por `user_expressions`: el reply terminal queda limitado a estado de ejecución, no a artefactos documentales. Desde 2026-04-19, esa independencia también depende de `services/websocket_manager.py`: toda salida WS del notebook se encola FIFO por conexión y solo un writer task puede tocar `send_text()` sobre el `/ws` compartido.

6. Si la celda usa la API DOCX (`build_doc`, `doc_begin`, `doc_reset`, `Heading`, etc.) o declara tipo lógico `cell_type="docx"`, el adaptador MCP/WS trata la celda como Python documental y puede activar `emit_docx` para preparar el runtime correctamente; esa instrumentación importa `doc_start_cell`/`doc_finish_cell`, compila el código del usuario con filename sintético `<inspyro-notebook:{cell_id}>` y envuelve `build_doc` / `doc_block` / `doc_begin` para propagar `notebook_cell_id` incluso cuando el usuario llama la API DOCX directamente. El `finally` ya no exporta DOCX/PDF inline: solo cierra `doc_end()` / `doc_finish_cell()` y deja la materialización documental al job post-terminal. En `execute_all_cells` el adaptador calcula ese intent una sola vez para todo el batch y replica la semántica del UI humano (`skip_pdf=True` salvo en la última celda ejecutable). La detección por fuente sigue como compatibilidad para notebooks legacy, pero los notebooks nuevos deben marcar report cells con `metadata.inspyro.cell_kind="docx"` al persistir.

7. Cuando el código usa captions de figuras/tablas (`figure`, `image`, `table`, `dataframe`, `caption(number=True)`), `docx_builder` emite campos Word `SEQ` y bookmarks sobre el número efectivo, dejando además un valor visible inicial para visores que no refresquen campos.

8. Después del terminal de la última celda exportable, `notebook.py` encola un único job documental por `kernel_id`; ese coordinador aplica una ventana corta de estabilización y usa política latest-wins para invalidar emisiones tardías de ejecuciones anteriores. El export DOCX clasifica si el body quedó realmente vacío y, solo cuando hay contenido útil, persiste un artefacto estable por generación final (`artifact_id`, `source_path`, `kernel_id`, `execution_id`) antes de coordinar la conversión PDF con `INSPYRO_NOTEBOOK_PDF_TIMEOUT=600`. Si el binario coincide con uno anterior se reutiliza el blob por hash, pero no se pierde la entrada histórica. En el flujo MCP batch, `execute_all_cells` no se considera cerrado hasta que el `execution_id` público del lote pueda resolver ese DOCX final.

9. `docx_builder.session` ya no depende de snapshots XML-only: serializa metadata de relaciones OOXML/medios por fragmento, rehidrata `rId`s durante el rebuild, captura procedencia dual `callsite + exact` por mutación visible (`provenance_id`, `file_path` o `notebook_cell_id`, `line`, `exact_*`, `api_name`, `precision`, `user_stack`) y envuelve el contenido visible trazable con hyperlinks estables `/api/docx/provenance/open?provenance_id=...` antes de exportar, evitando DOCX/PDF sin imágenes por relaciones colgantes y habilitando navegación PDF -> código. El `callsite` persistido deja además de promocionar wrappers técnicos `ipykernel_*` cuando el stack ya contiene una celda notebook o un archivo real más útil. Esos hyperlinks permanecen en la copia interna/persistida que alimenta el PDF, pero toda salida Word-visible (`doc_export(format='docx'|'bytes'|'path')`, payload WS, token legacy y `/api/docx/download`) se sanea después para no transferir la procedencia automática al Word descargable.

10. Frontend recibe `notebook_stream` y un `notebook_cell_executed` correlacionado por `execution_id` como mensaje terminal de la ejecución principal; los mensajes tempranos reenviados desde IOPub y el heartbeat `notebook_progress_update` incluyen además `kernel_id`, `source_path` y `source_kind` como metadata aditiva de ruteo. `App.js` actualiza el snapshot runtime shell-owned con esos mensajes para notebooks visibles y ocultos, y el editor activo los consume desde `consumeRemoteNotebookMessage()` ya ruteados por el shell. El payload terminal incluye `kernel_id`, puede marcar `variables_snapshot_degraded`/`execution_diagnostics` cuando el snapshot runtime cayó en fallback y, para la última celda exportable, ya no espera exportar DOCX/PDF inline ni leer `__INSP_NOTEBOOK_DOCX` desde el reply terminal antes de cerrar.

11. Después del terminal `notebook_cell_executed`, backend inicia en background el pipeline documental completo (`queued` -> `docx_export` -> `docx_ready` -> `pdf_convert`) y publica `notebook_docx_update` / `notebook_pdf_ready` tardíos con el mismo `execution_id`; `Run All` no debe reinterpretar ese diferido como interrupción, una ejecución más nueva del mismo kernel debe reemplazar cualquier emisión documental stale de la anterior y, cuando ya exista una descarga estable, esos artefactos deben viajar link-first por WS. Desde 2026-04-20 ese flujo tardío viaja por el socket notebook dedicado y la copia visible en `Docx_Documents` se materializa según el `source_path` del notebook/archivo origen, no según el último `active_workspace` global observado por el backend. Desde 2026-04-22, `notebook_progress_update` puede incluir además `shared_resource={ kind: "pdf_converter", scope: "global", status: "waiting"|"running" }` para hacer explícita la serialización real del convertidor PDF compartido.

12. `NotebookEditor` usa un rail superior secuencial: primero una barra verde para la corrida de celdas (`Run All` determinista por conteo de celdas; ejecución individual indeterminada) y, solo cuando aplica, una barra roja posterior para el pipeline `DOCX -> PDF`. Ambos estados se alimentan del mismo `execution_id`, pero nunca se muestran a la vez. Cuando `shared_resource.kind="pdf_converter"` aparece en la fase roja, el rail ya no infiere copy desde texto libre: muestra explícitamente `Esperando convertidor PDF compartido` o `Usando convertidor PDF compartido`. El toggle DOCX/PDF del frontend controla si `Run All` incluye celdas `docx`; al apagarlo se omiten esas celdas, el botón play de una celda DOCX queda bloqueado y no se envía `notebook_mdoc_clear`, de modo que `mdoc` y el último DOCX/PDF visible se preservan.

13. `App.js`, `VisualizationPanel` y `DocxViewer` mantienen un `documentPipelineStatus` estructurado separado del resultado de ejecución. Ese estado sigue siendo notebook-scoped aunque la libreta quede oculta o el usuario vuelva a `Home`, y solo se limpia en terminales documentales reales. Las notificaciones de `Run All completado` / `Notebook interrumpido` quedan asociadas a la fase verde, mientras que `Documento listo` / `Error generando documento` pertenecen a la fase roja. Desde 2026-04-26, `AgentWorkspaceHome` no espera solo a `home-summary`: `App.js` superpone `notebookSessionsByPath` activos para mostrar tres `Run All` shell-owned con contador/progreso propio aunque el backend todavía no haya consolidado el resumen.

14. `DocxViewer` descarga por `fetch -> blob`, reintenta contra la ruta estable por `source_path`/`kernel_id` si una ref temporal expira y muestra historial DOCX newest-first de 30 días para notebooks/archivos que tengan origen persistente. Las entradas históricas vacías (`docx_is_empty=true`) siguen visibles con warning, pero el botón principal `DOCX` y el lookup backend por `source_path`/`kernel_id` las saltan en favor del último artefacto no vacío. El DOCX visible ya no debe heredar hyperlinks automáticos de procedencia ni field codes `HYPERLINK` automáticos, aunque el artifact persistido sí los conserve para PDF/reconversión. Cada generación final visible queda materializada además dentro del workspace activo en `<workspace>/Docx_Documents/Docx_document_YYYY-MM-DD_HH-mm-ss-SSS.docx`; si no hay workspace activo o el destino no puede verificarse como contenido en el proyecto, backend degrada al artifact store global con warning no bloqueante. `notebook_docx_update`, `notebook_pdf_ready` y `/api/docx/history` pueden transportar `workspace_path`/`workspace_relpath`/`workspace_warning`, y en desktop el botón principal `DOCX` abre primero esa copia persistida vía `window.inspyroDesktop.openPath(path)` antes de degradar a descarga HTTP o blob. El visor PDF controlado usa `pdfjs-dist` directo, resuelve client-side `numPages`, outline real y destinos internos del PDF, renderiza en modo windowed/lazy con buffer corto para PDFs largos y expone en `DocxViewer` una toolbar compacta mixta: acciones primarias `DOCX` / `PDF` / `Plantilla`, controles discretos icon-only para el lector y menús secundarios para historial, selector de vista y limpieza, sin agregar contratos backend nuevos. `PdfViewer` solo se monta cuando la pestaña `Documento` está realmente visible, evitando mediciones dentro de contenedores ocultos y corrigiendo canvas en blanco o spinners infinitos al volver a mostrar la vista; la carga del documento no se reabre por cambios de identidad de callbacks del padre y el swap mantiene el PDF previo visible hasta el commit nuevo. El índice del PDF deja de vivir en un dropdown y pasa a un rail lateral izquierdo tipo Chrome, docked en anchos grandes y overlay en anchos angostos; el rail conserva el outline aplanado, pero cada bookmark mantiene además `destinationKey`/`anchorTopRatio` para navegar al destino exacto y resaltar la sección activa aunque varias entradas compartan la misma página. `Modo origen` solo se activa cuando el PDF trae annotations de procedencia y abre un rail derecho persistente con `callsite`, `exact`, `api_name`, `precision`, `text_preview` y `user_stack` sin tapar el documento; el click PDF prioriza `exact`, cae a `callsite` si hace falta, puede reresolver `provenance_id` puntuales por `/api/docx/provenance/open?format=json`, reescribe hyperlinks absolutos stale al `API_BASE` activo aunque el PDF haya quedado horneado con otro origen y, cuando el fragmento pertenece a una libreta `.ipynb`, reutiliza `source_path` para abrir primero el notebook correcto y luego enfocar la celda/línea. Si `notebook_docx_update` no llega o queda stale pero `notebook_pdf_ready` sí publica `docx_artifact_id`/`docx_provenance_*`/`source_path`, el shell rehidrata esa metadata tardía desde el propio `notebook_pdf_ready` en vez de seguir atado al DOCX previo. Si el `cellId` ya no existe al abrir la libreta destino, `NotebookEditor` degrada a navegación best-effort por línea para no perder por completo el click del PDF. El historial local del shell solo agrega entradas con identidad estable real o base64 inline efectivo, y purga legacy inválido al rehidratar. La disponibilidad del convertidor PDF se muestra como nota contextual en la vista `Documento`, no como badge global del header, y desde 2026-04-22 el shell también la refleja de forma notebook-scoped en `Home`: `AgentWorkspaceHome` puede mostrar badges/progreso como `PDF en cola` o `PDF compartido` usando `progress_scope=document + shared_resource`, incluso cuando el notebook está oculto. `App.js` revalida `/pdf-status` al conectar, al volver a mostrar `Documento` y al reintentar PDF. Las mutaciones notebook que rehacen el documento (`delete`, `move`, `set_order`) ya no exportan DOCX/PDF dentro del lock del kernel: aplican la mutación y reusan el mismo pipeline documental latest-wins post-lock que la ejecución final, con timings estructurados (`kernel_export_ms`, `transport_read_ms`, `transport_cleanup_ms`, `sanitize_ms`, `artifact_store_ms`, `legacy_store_ms`, `terminal_to_docx_ms`, `docx_to_pdf_ms`). El relay MCP mantiene también `notebook_docx_update`/`notebook_progress_update`/`notebook_pdf_ready` tardíos cuando los artefactos terminan después del terminal de ejecución.

15. El Workbench DOCX queda desacoplado del pipeline pesado por defecto: `DocxViewer` puede cargar un summary cacheado y `render_manifest` al abrir el rail `Workbench DOCX`, pero solo ejecuta auditoría, render PNG, limpieza, revisión de comentarios/redlines, fields/SDTs, redacción/protección o diff cuando el usuario lo pide. Backend resuelve el DOCX por `artifact_id`, `source_path` o `kernel_id`, persiste summaries/resources junto al artefacto, mantiene el original inmutable y expone `docx_quality_status`/`docx_quality_score`/`docx_quality_counts` más `docx_render_status`/`docx_render_page_count`/`docx_render_cached_pages` en `/api/docx/history` para que Home e historial muestren badges sin convertir documentos durante el montaje. El render visual usa `docx_render_cache.py`: PDF canónico por `binary_hash + renderer_signature + profile`, PNGs por página/zoom, endpoint `/api/docx/render/resource` y limpieza explícita de derivados visuales.

16. Si el usuario cancela/timeout, frontend envía `notebook_cancel_execution` y backend responde `notebook_execution_cancelled`.

### Módulos involucrados

- `14-main-app.md`

- `11-notebook-editor-ui.md`

- `04-notebook-handlers.md`

- `09-jupyter-kernel.md`

- `01-document-generation-docx.md`

### Fallos críticos

- Contención de locks por kernel.

- Head-of-line blocking del dispatcher si no se priorizan mensajes de control.

- Timeouts de ejecución o conversión PDF.

- Respuesta grande sin degradación (payload trimming).

- Snapshot runtime degradado por objetos COM/interop no serializables.

- Cancelación falsa de `Run All` si el terminal `notebook_cell_executed` espera rescate DOCX/PDF en vez de cerrar primero.

- Refs DOCX expirada/stale si se rompe la persistencia por `artifact_id` o el fallback estable por `source_path`/`kernel_id`.

- Drift entre el tipo lógico `docx` (`metadata.inspyro.cell_kind="docx"` en disco) y la política DOCX/PDF si frontend, backend y MCP vuelven a tratar DOCX como simple `code`, o si apagar DOCX/PDF borra `mdoc` en vez de omitir celdas documentales.

- DOCX vacíos publicados como “último documento” si falla la clasificación post-export o si frontend/backend dejan de saltarlos al resolver latest.

- Pérdida de imágenes si el rebuild OOXML deja `a:blip`/`r:id` sin relación o sin `word/media/*`.

- Drift entre `DocxViewer` y `PdfViewer` si divergen `requestedPage`, `currentPage`, `fitMode` u `outline`, o si el render windowed deja offsets/página visible inconsistentes al volver a mostrar `Documento`, o si vuelve el loop de callbacks que reinicia la carga por identidad en lugar de por fuente real y el teardown deja tareas async vivas.

- Drift de calidad DOCX si el summary cacheado no queda atado a `artifact_id + binary_hash`, si Home/Historial promocionan badges de un artefacto distinto al descargado, o si el frontend dispara auditoría/render pesado al montar en vez de mantenerlo bajo demanda.

---

## Thread 2: Análisis de dependencias e impacto

### Objetivo

Inferir dependencias de símbolos y su impacto usando contexto de celdas/notebook o archivos `.py`, incluyendo imports locales del workspace.

### Secuencia

1. `NotebookEditor` o `MonacoEditor` disparan `analyze_dependencies` / `analyze_impact` con `request_id`, `file_path` y `line`/`column` opcionales; si la ubicación falta, el frontend omite ambos campos y el backend preserva la ausencia de raíz sintética `1:0`.

2. `analysis.py` delega a `dependency_service`, que mantiene el contrato WS actual y deja el detalle de resolución en `dependency_analyzer.py`.

3. `dependency_analyzer.py` parsea el código actual y, cuando `file_path` pertenece al workspace activo, expande imports Python locales (`import`, `import as`, `from`, `from .`, star imports y reexports por `__init__.py`) abriendo módulos `.py` de forma lazy y cacheada por ruta absoluta + hash.

4. En `analyze_impact` con origen `.py` real, el backend indexa consumidores `.py` del workspace para encontrar impacto hacia archivos posteriores; si falta `file_path` real, degrada a intra-file/cross-cell.

5. Sobre ese grafo base, el backend puede inyectar puentes interprocedurales conservadores `argumento real -> parámetro formal` para funciones/métodos/constructores locales, pero solo cuando el callsite y el callee se resuelven de forma estática y existe un único callsite resoluble por callee en el contexto activo.

6. El resolvedor AST entiende `alias.attr` e instancias locales (`instancia -> clase -> __init__/self.attr -> método`), mantiene imports externos/no resolubles como nodos terminales `IMPORT` y llena `location.file`, `line` y `column` reales cuando la definición vive en otro archivo.

7. Opcionalmente el router enriquece nodos con runtime variables desde kernel si existe contexto ejecutable.

8. Frontend recibe `dependency_analysis_result` o `impact_analysis_result`, descarta respuestas stale por `request_id`, renderiza el grafo en orientación horizontal (`LR`) con columnas por rank, tarjetas semánticas basadas en contenido y ruteo ortogonal local (`lane_id`/`shared_trunk_id`) sin curvas ni carriles globales. Para grafos complejos activa `Large graph` por nodos, aristas o densidad alta, abre spacing adaptativo y usa una vista inicial `Resumen` que agrupa por target/scope/archivo y agrega aristas; `Todo`, `Camino` y `Vecinos` mantienen el detalle completo sin cambiar el contrato WS. También permite navegar a una celda del notebook actual o abrir/enfocar un tab `.py` cuando `location.file` apunta a otro archivo del workspace.

### Módulos involucrados

- `12-dependency-graph-ui.md`

- `11-notebook-editor-ui.md`

- `13-monaco-editor.md`

- `14-main-app.md`

- `06-dependency-analyzer.md`

### Fallos críticos

- `file_path` ausente o fuera del workspace: el análisis debe degradar a intra-file/cross-cell sin intentar resolver otros archivos.
- Índice workspace truncado por límite de archivos: `analysis_complete=false` y metadata `workspace_scan_truncated` deben hacerlo visible.

- Imports externos, stdlib o módulos no resolubles no deben expandirse ni contaminar el grafo con falsos positivos.

- Si un helper/método aparece con múltiples callsites resolubles, el backend debe omitir el puente `argumento -> parámetro` para evitar contaminación entre callers.

- Navegación grafo→archivo sin `location.file` o sin highlight válido no debe romper la UI; el fallback es warning local y permanencia en el grafo.

- Drift entre layout y render de nodo: si `nodeSizing` y `D3DependencyGraph` dejan de compartir la misma geometría, reaparecen aristas mal alineadas y clipping visual.

- Drift entre orden de puertos, spacing entre ranks, complejidad de grafo y routing local: si `graphComplexity`, `edgePorts`, `d3Layout` y `edgeRouter` dejan de compartir el mismo modelo LR, reaparecen cruces innecesarios, fallback externos excesivos, curvas por degradación accidental o grafos densos tratados como casos pequeños.

- Drift entre el grafo original y la vista agregada: si `dependencyGraphOverview` pierde el mapping `node_id -> grupo`, `Resumen` puede mostrar conteos o aristas agregadas inconsistentes frente a `Todo`/`Vecinos`.

- `07-sensitivity-analyzer.md`

### Fallos críticos

- Contexto incompleto de celdas.

- Diferencia entre estado estático (AST) y runtime real.

---

## Thread 3: Template Editor y efectos sobre kernel

### Objetivo

Subir/editar plantilla DOCX, renderizar previews y aplicar cambios sin bloquear ejecución del notebook.

### Secuencia

1. Frontend sube plantilla por REST (`POST /api/templates/upload`) y luego envía `template_attach`; `template_upload` WS queda como ruta legacy de compatibilidad y solo se usa ante fallo de transporte/no disponibilidad del upload REST, no ante errores HTTP funcionales. El export portable usa `GET /api/templates/export`, y la importación JSON decodifica `docx_base64` y vuelve a usar upload + attach sin introducir contratos WS nuevos. Desde 2026-05-08 el vínculo persistible canónico vive dentro del `.ipynb` en `metadata.inspyro.template_binding` y apunta a un JSON portable relativo al directorio del notebook, creado por `POST /api/templates/bind`; al cargar/recrear kernel, backend aplica ese JSON si existe y reporta `missing`/`error` sin bloquear ejecución. Cuando solo existe un mirror legacy en el workspace, Home reabre primero la `.ipynb` origen, tokeniza el mirror `.docx` por `POST /api/templates/tokenize` y muestra migración a JSON; el mirror nunca pasa por el lector interno de archivos binarios.

2. El rail principal de preview construye en frontend un DOCX de ejemplo unico con header/footer, titulos, cuerpo, captions, codigo, listas, tabla con estilo y tabla directa. Ese Blob se renderiza con `docx-preview`, hace foco por seccion activa y se regenera al cambiar estilo, slot, categoria, tabla directa o template.

3. `notebook.py` orquesta `template_service` y módulos especializados (`template_extract`, `template_preview`, `template_style_apply`) con previews en background por semáforos.

4. En render manual, frontend llama `POST /api/templates/sample-preview/render-word` con el mismo DOCX base64 y `preview_key`; backend responde paginas PNG completas o warnings no bloqueantes si Word falla/no existe. `template_preview_style` con `force_refresh=true` queda como compatibilidad legacy para clientes no migrados.

5. `POST /api/templates/sample-preview/open-default` guarda el mismo DOCX temporal validado y lo abre con la aplicacion por defecto. Los previews legacy todavia pueden cancelarse con `template_preview_cancel`; backend aplica politica latest-wins por (`kernel_id`, `preview_key`/`request_id`) para esos clientes.

6. En estilos de tabla, backend separa propiedades OOXML-safe (`styles.xml`) de defaults runtime (`table_style_runtime_defaults`); `tblLook/tblLayout/tblW` se capturan fuera del estilo, se sanean automáticamente en plantillas legacy y se recomponen sobre `resolved_table_format`. Cuando una tabla de muestra usa `tblStyle`, `template_apply_table_format` resuelve ese estilo Word fuente y solo reemplaza propiedades presentes, preservando bordes/sombreado/márgenes del estilo destino si la tabla no trae formato directo equivalente. Antes de reutilizar la plantilla también se reparan declaraciones `xmlns:*` faltantes en cualquier parte OOXML cuando `mc:Ignorable` queda apuntando a prefixes no declarados.

7. Cambios de template fuerzan recarga de sesión DOCX en kernel junto con `semantic_style_slots`, `table_style_runtime_defaults` y `builder_required_style_defaults`; cuando el usuario edita `Documento (Global)`, backend materializa `w:docDefaults` reales en `styles.xml` y `docx_builder` pasa a heredar esa base para `doc.text()` y estilos requeridos faltantes, sin volver a `Calibri/Consolas`. Al usar el `.docx` como base runtime, el builder conserva estilos, encabezados, pies y `sectPr`, pero limpia el body de la plantilla antes de insertar contenido generado. Las reextracciones posteriores a `template_update_style` o `template_update_document_defaults` preservan `semantic_style_slots` por `style_id`, para no romper plantillas Word localizadas con IDs como `Textoindependiente` o `Ttulo1`.

8. La extracción del template añade `document_captions`, mantiene `style_coverage` como resumen requerido, publica `word_capabilities` como matriz canónica de campos Word/OOXML y suma `style_browser` como vista navegable de todos los estilos detectados (`titles`, `headings`, `body`, `lists`, `tables`, `code`, `captions`, `other`) con `category_order`, `counts` y `auto_selected`.

9. Frontend sincroniza `templateInfo`, `templateBinding`, correlaciona por `request_id`/`preview_key`, mantiene el draft local de `StyleEditPanel` hasta recibir el ack correlado (`template_style_updated`, `template_document_defaults_updated` o `template_semantic_slots_updated`) y trata el `template` del ACK como payload autoritativo para rehidratar selección por `style_id`/slot, previews y dirty state. Desde 2026-04-20 ese ownership ya no es shell-global: `templateInfo`, `templateBlob`, `templateBinding` y `templateOpenRequest` viven dentro de `notebookSessionsByPath`, el reattach usa solo el blob de la sesión activa y un `template_*` de notebook A no puede mutar la UI ni el reattach de notebook B. La barra lateral ahora separa una banda persistida de `semantic_style_slots` como contrato Word-first del runtime y, por debajo, un navegador por categorías detectadas que usa `selection_key` compuesto para tolerar nombres duplicados; en tablas de muestra, el panel diferencia `tblStyle` fuente de formato directo y ofrece asignar ese estilo como `table_default`. Cards, panel y parser avanzado comparten además `resolved_font`/`font_source`, y la UI muestra aviso no bloqueante si la familia no aparece en el `system_font_catalog` del host. `Word completo` se edita mediante pestañas tipadas (`Rápido`, `Fuente`, `Párrafo`, `Listas`, `Tabla`, `Identidad`, `Raw OOXML`) que emiten los mismos bloques aditivos `word_style`/`style_visibility`; el JSON raw queda como escape hatch. La sección `Documento (Global)` no dispara preview Word dedicada: su source of truth pasa a ser el DOCX/PDF generado con la plantilla materializada. El export portable preserva `semantic_style_slots`, aceptando `category_overrides` solo como compatibilidad legacy de import. Cada ACK autoritativo de template sobrescribe automáticamente el JSON vinculado cuando el kernel tiene binding activo. Cuando falla la conversión PDF y existe `word_error`, la UI lo muestra explícitamente.

10. Si una preview de tabla falla o expira, el frontend limpia el estado interno de “ya solicitada” y permite reintento explícito sin recargar la plantilla.

11. El banco exhaustivo del Template Editor valida este flujo end-to-end con fixtures DOCX sintéticas, upload+attach con dedupe, edición rápida/Word-complete, export/import portable, cierre/reapertura, generación de DOCX desde notebook y Workbench `audit`/`render_all_pages`; los resultados se trazan en `output/template-editor-bank/<run-id>/summary.{json,md}`.

12. El banco `template-binding-bank` valida el subflujo notebook-first del binding JSON: persistencia `.ipynb` + JSON hermano, Home canónico frente a legacy, warning UI por JSON perdido, ausencia de dirty falso y MCP stateful (`bind_template_to_notebook`, `notebook_load`, `update_template_style`, `execute_all_cells`); los resultados se trazan en `output/template-binding-bank/<run-id>/summary.{json,md}`.

### Módulos involucrados

- `17-template-editor.md`

- `04-notebook-handlers.md`

- `09-jupyter-kernel.md`

- `01-document-generation-docx.md`

### Fallos críticos

- Ráfagas de preview bloqueando mensajes críticos.

- Estado stale de preview/cache tras aplicar formato.

- Corrupción de `styles.xml` si se serializan propiedades de instancia de tabla como si fueran propiedades de estilo.

- Drift entre `Normal` inferido y `docDefaults` reales si una mutación global no se materializa en `styles.xml`.

- Corrupción de headers/footers u otras partes OOXML si una mutación XML previa deja `mc:Ignorable` con prefixes sin declarar en el root.

- Contención con ejecución de celda sobre mismo kernel.

- Upload REST funcionalmente rechazado (`400`/`413`/`422`) no debe derivar en fallback WS que oculte el error real.

- Confusión de usuario si no se explicita el estado transitorio de la preview.

- Drift entre el DOCX de ejemplo JS, el render Word nativo y `Abrir DOCX` si no comparten exactamente el mismo Blob/base64 y `preview_key`.

- Colisiones por estilos duplicados si frontend/backend no preservan `selection_key` estable o si el export/import portable pierde `semantic_style_slots` o deja slots stale tras reextraer la plantilla.

- Falsa confianza en pruebas unitarias si no se valida también que el DOCX generado con la plantilla editada pasa auditoría OOXML/Workbench y render visual no vacío.

---

## Thread 4: Edición de archivos y ciclo de guardado

### Objetivo

Gestionar apertura/edición/guardado de archivos notebook y no notebook.

### Secuencia

1. Frontend usa REST `api/files/*` para árbol lazy, búsqueda por nombre y mutaciones explícitas.

2. `FileExplorer` crea, renombra, mueve, copia, duplica y elimina archivos/carpetas mediante diálogos/menú contextual controlados por el shell; el flujo ya no depende de `prompt()` nativo del navegador.

3. Los archivos que no se pueden leer como notebook/texto editable no abren una tab falsa: `App.js` muestra un estado central con botón para abrirlos con la aplicación por defecto, usando el bridge desktop o `POST /api/files/open-default` en web local.

4. `App.js` mantiene tabs, archivo activo y autosave.

5. Cuando el archivo activo es `.ipynb`, el shell deriva un índice de notebook frontend-local desde la misma sesión shell-owned por `path` y lo expone como otra sección del rail lateral, al mismo nivel que `FileExplorer`, sin nuevos contratos públicos.

6. Un click en ese índice reactiva la superficie `file` si hace falta, garantiza la tab/path correcta y delega el salto fino a `NotebookEditor` mediante `navigateToCode()` / `focusCell()`, reutilizando el mismo contrato de navegación notebook ya usado por grafo y procedencia PDF.

7. En notebooks, `NotebookEditor` sincroniza cambios con `App.js`.

8. Al guardar notebook, se envía `notebook_save` solo con cambios persistibles; outputs/runtime se mantienen fuera del payload persistido.

9. Si una ruta abierta cambia por rename/delete, `useFileSystem` actualiza o cierra tabs por `path` para mantener coherencia con el árbol, con el índice de notebook shell-owned y con los reflejos MCP.

10. Backend ejecuta I/O pesado de archivos en ejecutores (`run_in_executor`) para no bloquear el event loop.

10. Frontend marca cambios por dirty flags/versionado (sin `JSON.stringify` completo en cada cambio).

11. `useFileSystem` etiqueta además el origen de `notebookData` (`runtime` vs `persistable`) y `NotebookEditor` hidrata snapshots/cargas runtime fuera del flujo de guardado; abrir un `.ipynb`, recargarlo same-path o reflejar una snapshot MCP ya no debe fabricar `DIRTY`.

12. Cuando el watcher emite varios `workspace_fs_event` para el mismo archivo dirty, el shell conserva el conflicto visual pero solo advierte una vez por path hasta que el conflicto desaparece.

13. `FileExplorer` no refresca el árbol por cada `modified` de archivo: los eventos que no cambian la estructura ya no reconsultan la carpeta padre, evitando jitter visual del root al abrir varios notebooks rápido.

### Módulos involucrados

- `14-main-app.md`

- `11-notebook-editor-ui.md`

- `03-file-system-api.md`

### Fallos críticos

- Desincronización `activeFile.path` vs notebook en memoria.

- Sección `Índice de Notebook` del rail lateral apuntando a otra libreta o a una celda stale si el shell deja de regenerarla desde la sesión shell-owned activa.

- Guardado concurrente con cambios de tabs.

---

## Thread 4A: Bootstrap y activación de workspace

### Objetivo

Permitir que el usuario entre al producto desde una narrativa agent-first, abra o cree un workspace/proyecto desde la UI, o materialice el demo canónico open source, persistiendo ese contexto en backend para que frontend, REST, notebooks y MCP operen sobre la misma carpeta activa.
La etapa actual ya no es solo composición frontend-local: la home persistente se hidrata desde un summary backend shell-owned (`GET /api/system/home-summary`) y la navegación de templates/MCP usa apoyo REST adicional (`/api/mcp/restart`, `/api/mcp/client-heartbeat`, `/api/templates/tokenize`).

### Secuencia

1. `App.js`/`FileExplorer` consultan `GET /api/system/info` al iniciar para obtener `workspace_root`, `active_workspace`, `suggested_workspace_root` y `recent_workspaces`.

2. Si existe `active_workspace`, `App.js` entra a `workspaceSurface='home'`, consulta `GET /api/system/home-summary` y monta `AgentWorkspaceHome` como superficie persistente shell-owned; `ProjectLauncher` solo aparece cuando todavía no hay workspace activo.

3. Si no existe `active_workspace`, `ProjectLauncher` muestra una pantalla de misión con tres rutas fijas: `Start with Agent`, `Start from example` y `Open project`.

4. Si el usuario quiere cambiar de proyecto, `FolderSelector` navega carpetas vía `GET /api/files/tree`.

5. Para abrir un proyecto existente, frontend envía `POST /api/system/workspace` con `{ path }`.

6. Para crear un proyecto nuevo, frontend envía `POST /api/system/workspace/create` con `{ name, parent_path? }`.

7. Si el usuario elige `Start from example`, `App.js` crea un workspace nuevo, siembra el ejemplo estructural canónico (`beam_report.ipynb`, `beam_design.py`, `inputs/beam_case.json`) usando solo endpoints existentes de workspace/files y luego entra en la home persistente con el notebook principal listo.

8. Si el usuario elige `Start with Agent`, el shell encadena la selección/creación del workspace con la apertura de la superficie `Agents` y, cuando hace falta, arranca el servicio local sin crear contratos nuevos.

9. `backend/app/services/home_compact.py` mantiene un registro runtime por notebook (`kernel_id + notebook_path`) y por script (`run_id + file_path`), descubre notebooks de usuario del workspace, clasifica y excluye recursos internos/generados (`_agent_runs`, `.inspyro`, `Docx_Documents`, demos/smoke), persiste asociaciones notebook-template en `<workspace>/.inspyro/templates/index.json` con copias espejo `.docx`, agrega solo DOCX no vacíos del workspace, publica `overview` shell-owned y agrupa clientes MCP con heartbeat + actividad reciente por cliente.

10. `App.js` consume ese payload agregado y deriva `workspaceData.operational` como capa frontend-local compatible con `cards`: `attentionItems`, tres carriles `Entender` / `Ejecutar` / `Entregar` y `quickActions`, sin cambiar el contrato de `GET /api/system/home-summary`.

11. `AgentWorkspaceHome` renderiza esa capa como centro operativo: header compacto, franja `Atención`, filas navegables de un click, acciones secundarias visibles y panel de detalle lateral/inline; si `operational` no existe, adapta la forma legacy `cards` para mantener compatibilidad temporal.

12. Mientras `workspaceSurface === 'home'`, `App.js` hace polling del summary, refresca al volver foco/online/visibility y evita depender de `templateInfo`, `docxHistoryEntries` o del estado montado de `NotebookEditor` para poblar la home; al salir a `workspaceSurface='file'` ese polling se desmonta por completo.

13. Archivos, notebooks, explorer y tabs siguen disponibles dentro del mismo workspace, pero pasan a ser herramientas secundarias respecto de la home persistente; `Ir a archivos` siempre mueve a `workspaceSurface='file'` aunque no haya tabs abiertas, y cuando la superficie vuelve a `file` con una `.ipynb` activa, el rail lateral recompone además la sección `Índice de Notebook` sin releer el archivo.

14. Abrir una `.ipynb` o cualquier archivo desde home o explorer mueve el shell a `workspaceSurface='file'`, pero no cancela runtimes ya abiertos; el shell solo cambia de superficie visible.

15. Cerrar una tab running sí es la frontera de lifecycle: notebooks envían `notebook_shutdown_kernel`, scripts `.py` envían `cancel_code_execution`, y Home deja de mostrar ese runtime cuando desaparece la tab.

16. Desde `home`, las notificaciones y CTAs explícitos del shell son rutas válidas para saltar a `file` o enfocar documento/template/agentes; la actividad pasiva y el espejo MCP no deben cambiar `workspaceSurface` por sí solos.

17. El carril `Entender` mezcla notebooks con runtime, scripts `.py` activos y notebooks descubiertos por `template_inventory`; si `notebook_runtime_items` llega vacío pero el workspace ya tiene notebooks inventariados, la home sigue mostrando esos notebooks y reserva `Ir a archivos` solo como fallback.

18. El carril `Entregar` integra DOCX y plantillas: separa `Abrir DOCX`, `Preparar entrega` y `Abrir origen`, abre la copia persistida mediante `window.inspyroDesktop.openPath(workspace_path)` cuando existe, degrada a descarga HTTP por `artifact_id`/token/source cuando corresponde y, para templates, resuelve la `.ipynb` origen antes de tokenizar mirrors `.docx` por `POST /api/templates/tokenize`; si falta origen verificable, no abre el editor en falso estado vacío.

19. El carril `Ejecutar` integra `Clientes MCP`: usa `client_id` / `client_label` / `transport` provenientes de `POST /api/mcp/client-heartbeat` y `POST /api/mcp/activity/events` para mostrar estado operativo y abrir `Agents` filtrado a ese cliente desde una acción explícita.

20. `backend/main.py` delega en `workspace_service`, persiste el workspace activo fuera de la carpeta de instalación y devuelve el nuevo `workspace_root`.

21. `FolderSelector` expone el path actual del diálogo y confirma los cambios de nivel de carpeta antes de abrir/crear el workspace, evitando drift visual y automatizaciones frágiles en desktop/móvil.

22. Frontend actualiza `currentWorkspace`, monta el explorer lazy, guarda solo preferencias locales (`show_hidden`) y deja el estado canónico del workspace en backend.

23. `file_watcher.py` observa el `active_workspace`, agrupa eventos y difunde `workspace_fs_event`; `App.js` recarga tabs limpios, marca conflictos sobre tabs dirty y `FileExplorer` refresca solo carpetas cargadas. Si un archivo/tab desaparece por delete real, el shell corta también su runtime asociado.

24. Las sesiones MCP posteriores consultan `get_system_info` y descubren ese mismo workspace activo, evitando crear notebooks dentro del directorio de instalación de Inspyro.

### Módulos involucrados

- `14-main-app.md`

- `03-file-system-api.md`

- `19-mcp-server.md`

### Fallos críticos

- Drift entre `localStorage` y el workspace persistido por backend.

- Intento de activar una ruta inexistente o no permitida por seguridad.

- Crear workspaces dentro de una carpeta padre inesperada por falta de feedback en UI.

- Drift entre la ruta de ejemplo sembrada por `ProjectLauncher` y el workspace activo efectivo si la siembra, apertura del notebook o arranque de agentes se disparan fuera de orden.

- Watcher no disponible o eventos del filesystem perdidos, obligando a refresh manual.

- Navegación accidental desde `home` si una notificación o CTA reutiliza metadata `target` stale y cambia `workspaceSurface` sin acción explícita del usuario.

---

## Thread 5: Unidades de ingeniería (runtime + conversión + DOCX)

### Objetivo

Visualizar `Quantity` enriquecidas en panel/grafo, convertirlas vía REST y preservar tipografía de unidades en DOCX.

### Secuencia

1. Usuario ejecuta celda con variables de ingeniería (`F = 14.5*kN`, `rho = 7850*kg/m**3`).

2. `notebook_service.py` inyecta preámbulo de unidades con sentinel `__INSP_UNITS_READY__` y alias seguro `u` para evitar colisiones por guard frágil.

3. `jupyter_kernel.py` serializa `Quantity` con campos legacy + canónicos (`unit_canonical`, `unit_display`, `unit_pint`, `aliases`) y fallback al último snapshot válido cuando falla captura de variables.

4. Frontend carga catálogo dinámico (`GET /api/units/catalog`) y resuelve unidades compatibles por firma dimensional canónica (`POST /api/units/compatible`) con fallback local.

5. Conversión rápida usa `POST /api/units/convert` con magnitud escalar/vector/matriz, normalización fuerte de aliases (`tonf/tf`, `rpm/turn/min`, `Nm/m·N`, `°C/degC`) y respuesta trazable (`dimension` + `canonical`) sin depender del orden textual de Pint.

6. `analysis.py` enriquece nodos de dependencia con unidad/categoría/descripcion runtime priorizando `unit_display`.

7. En export DOCX, `DocBuilder.text()` valida token de unidad antes del parseo tipográfico agresivo y mantiene fallback seguro a texto plano.

### Módulos involucrados

- `18-engineering-units.md`

- `11-notebook-editor-ui.md`

- `12-dependency-graph-ui.md`

- `01-document-generation-docx.md`

- `04-notebook-handlers.md`

### Fallos críticos

- Payload inválido o unidades incompatibles en `POST /api/units/convert`.

- Drift entre catálogo backend y tokens frontend si falla carga dinámica y fallback no cubre alias nuevos.

- Metadata runtime incompleta al enriquecer nodos (fallback a metadata estática).

- Parseo agresivo de unidades en DOCX sin validación previa de token (mitigado con validación + fallback plano).

---

## Thread 6: Optimización paramétrica y escenarios de ingeniería

### Objetivo

Explorar alternativas de diseño (objetivo + restricciones), evaluar envolventes, checks activos y comparar escenarios base/candidatos.

### Secuencia

1. Frontend abre el panel de optimización del grafo y envía `optimize_design` con `objective`, `variables`, `constraints`, `formulas`, `current_values`.

2. `analysis.py` ejecuta el servicio de optimización y emite `optimization_progress` (inicio/fin) + `optimization_result`.

3. Frontend puede solicitar `analyze_load_envelope` para identificar combinaciones gobernantes por output.

4. Frontend puede solicitar `run_code_checks` para convertir verificaciones en restricciones activas priorizadas.

5. Frontend puede solicitar `compare_scenarios` para delta absoluto/% vs baseline.

6. El usuario refina variables/restricciones y repite iteración con correlación por `request_id`.

### Módulos involucrados

- `06-dependency-analyzer.md`

- `07-sensitivity-analyzer.md`

- `12-dependency-graph-ui.md`

- `11-notebook-editor-ui.md`

- `18-engineering-units.md`

### Fallos críticos

- Payload de optimización inválido o incompleto.

- Fórmulas no evaluables (síntaxis/dependencias).

- Sin candidatos factibles bajo restricciones duras.

- Resultados stale no correlacionados por `request_id`.

---

## Thread 7: Servidor MCP — Interacción IA ↔ Inspyro

### Objetivo

Permitir que un modelo de IA externo (Claude, GPT, Gemini, etc.) interactúe con todas las funcionalidades de Inspyro a través del protocolo MCP estándar usando solo la conexión MCP, con onboarding autosuficiente, actividad estructurada visible en la UI y reproducción guiada de notebook/template "como si un humano operara la interfaz", sin sobrescribir recursos locales dirty.

### Secuencia

1. Cliente MCP externo se conecta al servidor MCP local en `:8100` (Streamable HTTP o stdio), hace `initialize` y recibe instrucciones para leer primero `inspyro://manifest` y luego `inspyro://guides/start-here`. Antes de configurar un cliente nuevo, la UI y el propio MCP exponen `inspyro://guides/client-configuration` y `/api/mcp/status.configuration` con endpoint HTTP, preset `stdio`, perfil `authoring`, modo recomendado `stateful-http`, URLs backend reales y rutas de ejemplo neutrales que no filtran workspaces privados.

2. El cliente usa `resources/read`, `resources/templates/list`, `prompts/get` y `completion/complete` para autoorientarse: configuración de cliente, onboarding, workflow notebook, API DOCX, lifecycle de artefactos, templates, units/analysis, recuperacion de errores, ejemplo E2E y lecturas puntuales de archivo/celda/artefacto/run, sin depender del repo; esa capa AI-first ya explicita que `timeout` y `timeout_per_cell` arrancan en `600s` y son ajustables a discrecion para flujos COM/SAP2000/Word pesados. En la guía DOCX y prompts MCP, las fórmulas quedan estandarizadas sobre `builder.math_latex(...)` y `builder.create_math_latex_element(...)`, y la revisión de calidad queda como paso opt-in posterior al artefacto: `check_document_quality(run=true)` cuando se necesita feedback textual y `missing_quality` se recupera corriendo la auditoría. El perfil MCP por defecto pasa a ser `authoring`, que promueve `notebook_create(cells=...)` o `notebook_load(include_source=True)` seguidos de `notebook_sync_cells`, ahora también expone `list_session_notebooks`/`inspyro://session/notebooks` para descubrir kernels vivos, `close_session_notebook` como cierre explícito, `list_cells`/`get_cell`/`find_in_notebook` para notebooks grandes y `execute_all_cells(background=true)` -> `get_run_status(run_id)` o `inspyro://runs/{run_id}` -> `resume_run`/`cancel_run` para corridas largas.

3. `server.py` recibe invocaciones via JSON-RPC 2.0; cada tool queda envuelta por un helper de actividad que intenta publicar `annotations`, `tags` y `task` metadata, y emite `started/completed/failed`.

4. `bridge.py` y `session_state.py` se resuelven por `session_id`, de modo que cada cliente MCP mantiene su propio bridge REST/WS, sus propios notebooks/artefactos/runs y no comparte estado operativo con otras sesiones HTTP.

5. `bridge.py` traduce la invocacion a REST (`GET/POST /api/*`) o WS (`notebook_*`, `analyze_*`, etc.) hacia el backend en `:8000`, correlacionando requests discretos por `request_id`.

6. Para ejecucion de celdas, `bridge.py` suscribe streams por `execution_id` para no mezclar `notebook_stream`, `notebook_clear_output` o `notebook_pdf_ready` entre ejecuciones concurrentes; ademas mantiene observers internos para relayar mensajes tardíos del mismo `execution_id` aun después de `notebook_cell_executed`.

7. Las tools de notebook detectan uso de la API DOCX en `source` y fuerzan `emit_docx` cuando corresponde, evitando exportes omitidos por falta de preámbulo. El flujo público se simplifica alrededor de `notebook_create`, `notebook_load`, `list_session_notebooks`, `notebook_sync_cells`, `execute_cell`, `execute_all_cells`, `get_run_status`, `cancel_run`, `resume_run`, `notebook_save` y `close_session_notebook`: `notebook_sync_cells` sincroniza la lista ordenada final de celdas, reutiliza `cell_id` cuando existe, crea IDs nuevas cuando faltan y limpia `outputs`/`execution_count` de celdas de código modificadas salvo que se pida preservarlas. `notebook_create` y `notebook_load` aceptan `reuse_if_loaded` y `close_others` para hacer explícito si deben reciclar un kernel ya vivo o cerrar el resto de notebooks de la sesión. El `timeout` de la tool se propaga al backend como `execution_timeout_s`, de modo que el bridge MCP y el kernel compartan el mismo presupuesto temporal efectivo; además MCP serializa localmente por `kernel_id` para que dos corridas del mismo notebook no se solapen aunque notebooks distintos sí puedan correr en paralelo.

8. `session_state.py` recuerda por sesion `kernel_id -> notebook_path`, un inventario público de notebooks vivos, estado local del kernel (`idle/running/error/disconnected`), ejecuciones activas con heartbeat, progreso por celda, `current_child_execution_id`, `last_output_preview`, evidencia compacta de recovery por `execution_id` (terminal observado o artefacto exacto), aliases `child_execution_id -> execution_id` batch y los ultimos artefactos DOCX/PDF para que `get_run_status`, `list_session_notebooks`, `notebook_save`, `get_document_pdf`, `get_document_docx` y los `ui_hints` apunten al recurso real; `notebook_save` solo refleja snapshot granular cuando hace save-as.

9. El servidor MCP reporta telemetría por `POST /api/mcp/activity/events`, heartbeats visibles por `POST /api/mcp/client-heartbeat` y eventos granulares de espejo por `POST /api/mcp/mirror-events`; el espejo cubre `open_resource`, snapshots de notebook/template, runtime notebook, lifecycle de kernel, `artifact_update` y `file_mutation`.

10. Las tools de filesystem emiten `file_mutation` para `write/create/rename/delete`, con metadata suficiente para que el shell refresque explorer y tabs limpios sin reabrir ciegamente archivos nuevos.

11. `reconvert_pdf` emite `open_resource` con `focus_view='docx'` cuando el `kernel_id` sigue asociado a un notebook y luego publica `artifact_update` para el PDF regenerado; `check_document_quality`, `run_document_workbench`, `compare_document_versions`, `manage_document_review`, `prepare_document_delivery` y `export_clean_document_docx` quedan como acciones documentales explícitas, mientras `get_document_docx/pdf` siguen siendo link-first por defecto. Las operaciones visuales MCP (`render_manifest`, `render_page`, `render_all_pages`) devuelven solo summaries/handles `/api/docx/render/resource`, no PNG/base64 inline.

12. El backend persiste un ring buffer de actividad, mantiene runs activos, agrupa clientes MCP por heartbeat y difunde `mcp_activity_event` para feed/notificaciones y `mcp_mirror_event` para replay guiado del shell; cuando existe heartbeat previo, `mcp_activity_event` puede salir enriquecido con `client_id`, `client_label` y `transport` aunque la tool no los haya reenviado explícitamente.

13. `App.js` hidrata el historial con `GET /api/mcp/activity`; `useMcpActivity` mantiene feed, badges, notificaciones y `agentExecutionState`, persiste `mirrorEnabled` en `localStorage`, arranca en `OFF` si no había preferencia previa y respeta el valor guardado cuando existe.

14. El shell convierte solo ciertos eventos de actividad en notificaciones visibles y puede adjuntar `target` metadata cuando existe un destino claro (`home`, archivo, notebook/celda, `docx`, template o panel `Agents`); la cola sigue siendo owner de `App.js`.

15. `NotificationCenter` renderiza ese feed, agrupa por tiempo y usa expansión inline para mensajes largos sin `target`; si existe `target`, el click primario se documenta como navegación explícita resuelta por `App.js`, no como replay automático.

16. `App.js` vuelve a montar `useMcpMirror`: `mcp_mirror_event` se aplica solo cuando el modo espejo está activo, el toggle manual sigue disponible en la UI y las acciones `start/restart` iniciadas desde la UI fuerzan `mirrorEnabled=true`.

17. Mientras `workspaceSurface==='home'`, `mcp_mirror_event` puede actualizar actividad, runs y artefactos, pero no autoabre archivos ni roba el foco central; cualquier salto a `file` requiere una acción explícita del usuario, por ejemplo un CTA del home o un click de notificación con `target`.

18. La UI central de agentes vive en `AgentWorkspaceHome`; `McpPanel` queda como inspector avanzado sobre el mismo backend MCP. Su pestaña `Configuración` consume `/api/mcp/status.configuration` y muestra presets copiables para Codex, Claude Code/Desktop, VS Code, Cursor y HTTP genérico, diferenciando servicio HTTP iniciado/detenido de clientes `stdio` que lanzan su propio proceso. Desde el carril `Ejecutar`, `App.js` abre `Agents` con un filtro local por `client_id/client_label`, y el panel reduce tanto `activeRuns` como `activity` a ese cliente hasta limpiar el filtro. Desde 2026-05-03, Home funciona como centro operativo Spanish-first: filtra notebooks internos/generados antes de construir CTAs, prioriza la franja `Atención`, organiza `Entender` / `Ejecutar` / `Entregar` como carriles navegables, separa `Abrir DOCX` / `Preparar entrega` / `Abrir origen`, integra plantillas en `Entregar` y mantiene `Ir a archivos` como ruta útil aunque no existan tabs abiertas.

19. `useFileSystem` activa tabs ya abiertos desde caché local y `FileExplorer` deja de refrescar el árbol por `activeFilePath`, evitando el ciclo redundante `tree/read/tree/read` al abrir o alternar archivos incluso con replay MCP habilitado.

20. `NotebookEditor` clasifica `open_resource`, `notebook_loaded`, `notebook_created` y `notebook_snapshot` same-path como hidratación runtime; esos reflejos no deben entrar al flujo persistible ni bloquear el espejo con un dirty falso.

21. La recarga real de contenido queda reservada a `reloadFile`, `reloadFileByPath`, refresh manual del explorer y `workspace_fs_event`; el backend sigue sin emitir `mirror_conflict` porque no conoce el dirty state real del shell.

22. Upload de templates usa REST multipart (`/api/templates/upload`) y adjunto WS por `template_attach` + `template_token`; para documentos, el MCP resuelve el artefacto correcto por `token`/`ref` real del backend, devuelve un handle link-first (`resource_uri`, `portable_resource_uri`, `resource_scope`, `hash`, `size_bytes`), persiste el artefacto en token store incluso cuando también puede inlinearlo y solo retorna base64 inline cuando el caller lo pide explícitamente y el tamaño lo permite. `get_document_docx(include_quality=true)` solo adjunta el summary compacto cacheado si existe, sin disparar auditoría. En batches documentales, `execute_all_cells` espera además a que ese handle ya exista para el `execution_id` público antes de devolver éxito al cliente.

23. Cuando el shell recibe artefactos DOCX reflejados por MCP, `App.js` aplica estrategia latest-wins sobre la URL actual, limpia refs stale y conserva historial local solo para payloads con identidad estable real o inline efectivo; `DocxViewer` puede complementar ese historial consultando `/api/docx/history`.

24. Si el cliente necesita materializar el artefacto en una ruta local estable, `export_document_docx` y `export_document_pdf` escriben el archivo dentro de los roots MCP visibles, crean directorios padres cuando corresponde y emiten `file_mutation` para que el shell refleje el cambio. Si necesita una copia publicable, `prepare_document_delivery` usa el Workbench, respeta `overwrite=false`, devuelve handles compactos/summary, adjunta un manifest visual compacto si existe y nunca reemplaza el DOCX original; `export_clean_document_docx` queda como compatibilidad directa sobre `/api/docx/quality/clean`.

25. Las tools de filesystem siguen el workspace activo del backend, pero si el host MCP expone roots el adaptador intersecta ambos y rechaza rutas fuera de esos roots; aunque también pueden operar sobre `.ipynb`, la guidance AI-first sigue recomendando el camino notebook-first del MCP para preservar mejor la semántica y el estado del notebook.

26. Las completions MCP se alimentan con estado de sesion, cache de template, roots/workspace y catalogo de unidades; cuando el runtime low-level no propaga `session_id`, el adaptador usa un fallback acotado al unico bucket activo para no perder discoverability en clientes in-memory.

27. El cliente MCP recibe la respuesta JSON-RPC o un error estructurado si faltan sesión, artefacto, recovery o correlación; si el servidor corre en `--stateless-http`, las tools notebook-first que dependen de persistencia de sesión fallan de forma temprana con `NOTEBOOK_SESSION_REQUIRES_STATEFUL_MCP` en vez de degradar a kernels invisibles o `missing_notebook_session` tardíos. Si el restart backend falla, el cliente puede usar `reset_kernel(hard=true)` o el fallback automático documentado en `inspyro://guides/error-recovery`.

28. Si una celda o batch notebook-first pierde el stream WS antes del cierre limpio, las tools MCP reconcilian el resultado con el terminal ya observado o con el artefacto exacto del `execution_id`; cuando la recuperación es exitosa exponen `recovered_after_disconnect`, `recovery_reason`, `outputs_degraded` y `variables_degraded`, pero no agregan contratos backend nuevos.

### Módulos involucrados

- `19-mcp-server.md`

- `14-main-app.md`

- `15-notification-center.md`

- `04-notebook-handlers.md`

- `03-file-system-api.md`

- `01-document-generation-docx.md`

- `06-dependency-analyzer.md`

- `07-sensitivity-analyzer.md`

- `17-template-editor.md`

- `18-engineering-units.md`

### Fallos críticos

- Backend Inspyro no disponible al iniciar el servidor MCP.

- Drift entre `mcp.instructions`, resources y prompts que deje a una IA externa sin onboarding suficiente.

- Drift entre prompts/templates y `completion/complete` que ofrezca sugerencias stale de `notebook_path`, `kernel_id`, `style_name` o `cell_id`.

- Timeout en ejecuciones de celda largas (configurable via `INSPYRO_MCP_CELL_TIMEOUT`).

- Consumo excesivo de tokens si un cambio rompe el modo liviano por defecto y vuelve a serializar notebooks/outputs completos inline.

- Reconexión WS fallida tras cierre inesperado del backend.

- Regresión de scoping por sesión que mezcle kernels, artefactos o ejecuciones entre clientes concurrentes.

- Servidor MCP en `--stateless-http` usado por error para workflows notebook-first, dejando `kernel_id` no reutilizables entre requests.

- Presets de cliente o subprocess MCP apuntando a backend `:8000` cuando desktop empaquetado usa puerto dinámico; deben derivarse de `/api/mcp/status.configuration` y de `INSPYRO_BACKEND_*`.

- `missing_artifact` cuando se pide PDF/DOCX sin export previa o sin `token`.

- `missing_quality` cuando se pide cache de calidad DOCX antes de ejecutar `check_document_quality(run=true, profile="agent")`.

- Reutilizar `resource_uri` session-scoped desde otra sesion MCP, en vez de usar `portable_resource_uri` o exportar a path explícito.

- `KERNEL_RESET_FAILED` o drift de `kernel_id` si el backend obliga a reconstruir la sesión durante un hard reset y el cliente sigue usando el kernel viejo.

- Drift de contrato REST/WS si el adaptador MCP no se actualiza junto al backend.

- Pérdida del relay `POST /api/mcp/activity/events` o `POST /api/mcp/mirror-events` si backend/MCP divergen.

- Orden incorrecto o pérdida de `mcp_mirror_event` durante ejecuciones largas.

- Drift entre `useMcpActivity` y `useMcpMirror` que vuelva a recargar `files/documents` por hints de actividad, rompa la política `default OFF + persistencia`, o deje de autoactivar el espejo tras `start/restart` iniciados desde UI.

- Roots MCP incompatibles con el workspace activo, bloqueando operaciones de files aunque el backend esté sano.

- Contexto objetivo sucio: el espejo se bloquea deliberadamente y la UI puede quedar visualmente atrasada hasta refresh manual.

- Metadata `target` stale o semántica de click ambigua en notificaciones, provocando que el usuario expanda inline cuando esperaba navegar, o que una card cambie `workspaceSurface` sin representar el recurso correcto.

---

## Thread 8: Arranque desktop same-origin

### Objetivo

Ejecutar Inspyro como aplicación de escritorio sin navegador externo, manteniendo frontend, REST, WebSocket, LSP y MCP sobre el mismo backend local.

### Secuencia

1. `desktop/main.js` crea una splash local y expone estados de boot/error English-first (`Initializing shell`, `Starting local backend`, `Waiting for backend health`, `Loading interface`, `Starting renderer`, `Mounting interface`, `Ready`, `Renderer did not start`, `Renderer failed to start`) antes de revelar la ventana principal o mantener diagnóstico visible.

2. En desarrollo, Electron espera `http://127.0.0.1:3000` y `http://127.0.0.1:8000/health`, y luego abre la UI React dentro de Electron.

3. En producción, Electron toma el lock de instancia única, resuelve un puerto backend disponible y levanta `backend/main.py` como sidecar oculto con `INSPYRO_DESKTOP=1`, `INSPYRO_SERVE_FRONTEND=1`, `INSPYRO_FRONTEND_BUILD_DIR` y `INSPYRO_BACKEND_PORT`.

4. `backend/main.py` sirve el build del frontend en `/` y `/static`, mantiene `/api/*`, `/ws`, `/ws/lsp`, `/docs` y desactiva CORS de desarrollo por default.

5. `frontend/src/config/endpoints.js` resuelve `API_BASE`, `WS_URL` y `LSP_WS_URL` en same-origin para desktop/prod, y conserva el fallback `:3000 -> :8000` para CRA.

6. `preload.js` expone `window.inspyroDesktop` con `isDesktop`, `version`, `openExternal(url)`, `openDevTools()`, `reloadRenderer()`, `reportWorkspace(path)`, `reportRendererPhase(phase, payload)`, `emitDesktopNotification(payload)`, `onMenuAction(handler)` y `notifyRendererReady()` como alias legacy, sin habilitar `nodeIntegration`.

7. `frontend/src/index.js` emite `renderer_bootstrap_ready` apenas corre el bundle, instala reporters globales de error y monta `RendererRoot`; ese boundary raíz informa `renderer_app_ready` o `renderer_app_failed`, mientras `App.js` monta la title bar desktop-aware, reporta el workspace activo al shell, consume `desktop:menu-action` y desacopla shortcuts nativos del renderer para evitar duplicidad de aceleradores. El branding visible del shell se sincroniza desde el PNG maestro de `assets/brand/` hacia favicon original, titlebar/splash con mark claro, icono Electron/Windows en tile oscuro y Word add-in.

8. En builds empaquetados, Electron registra el protocolo `inspyro://` y asociaciones `.ipynb`, `.py` y `.inspyro`; si el proceso recibe rutas/deep links antes de que React esté listo, las retiene hasta `renderer_app_ready`. `App.js` abre archivos dentro del workspace activo o selecciona su carpeta padre como workspace antes de abrirlos.

9. El shell persiste `windowBounds`, estado maximizado y `recentWorkspaces` en `desktop-shell-state.json`, reconstruye el menú nativo con `Open Recent` y restaura bounds válidos al abrir una nueva sesión.

10. `desktop/main.js` enruta acciones del menú nativo hacia React (workspace, guardar, notebook, paneles, MCP) y centraliza notificaciones nativas, suprimiéndolas cuando la ventana está enfocada.

11. `desktop/scripts/stage-resources.mjs` arma el staging del instalador copiando backend, `frontend/build` y runtime Python portable, pero excluye estado local/caches/probes de desarrollo y sincroniza/verifica imports críticos de Python para backend, notebooks, LSP y Agents antes de que `electron-builder` empaquete NSIS.

12. El frontend deja de cargar Google Fonts remotas y empaqueta `Source Sans 3` + `Source Code Pro`, habilitando operación offline real.

13. Electron distingue `did-finish-load`, `renderer_bootstrap_ready`, `renderer_app_ready`, `renderer_app_failed`, `renderer_unhandled_error` y `ready-to-show`; ya no revela la ventana por timeout ciego, y si el arranque falla mantiene splash diagnóstica o muestra el fallback fatal visible del renderer en vez de una ventana negra.

14. `desktop/scripts/smoke-packaged.cjs` valida `dist/win-unpacked` con recursos staged, imports Python, renderer visible, `/health`, `/ws/lsp`, lifecycle MCP y bridge `window.inspyroDesktop` antes de considerar el build distribuible.

15. Al cerrar la app, Electron apaga el sidecar backend para no dejar procesos huérfanos ni puertos abiertos.

### Módulos involucrados

- `24-desktop-shell.md`

- `14-main-app.md`

- `03-file-system-api.md`

- `04-notebook-handlers.md`

- `08-lsp-bridge.md`

- `19-mcp-server.md`

### Fallos críticos

- Runtime Python portable ausente o inválido al empaquetar.
- Runtime Python staged sin dependencias de LSP/Agents (`pylsp`, `fastmcp`, `mcp`) o contaminado con estado local del backend.

- `frontend/build` faltante cuando el backend intenta servir la SPA.

- Deriva de origen (`window.location.origin` vs `localhost:8000`) que rompa REST/WS/LSP.

- Navegación externa no interceptada desde Electron.

- Sidecar backend que no se cierre al salir o que muera inesperadamente en runtime.

- Renderer que no llegue a `renderer_bootstrap_ready`, que falle antes de `renderer_app_ready` sin dejar fallback visible, o que vuelva a permitir un reveal ciego hacia ventana negra.

- Drift entre `recentWorkspaces` persistidos por Electron y el workspace canónico del backend.

- Duplicidad de shortcuts (`Ctrl+Enter`, `Ctrl+S`) si el renderer no reconoce que corre bajo shell desktop.

- Asociaciones `.ipynb`/`.py`/`.inspyro` que abren rutas fuera del workspace activo sin seleccionar primero un workspace coherente.

---

## Regla de actualización

Si cambia un flujo E2E, actualizar en la misma sesión:

1. Este archivo.

2. `docs/architecture/synergy-matrix.md`.

3. `docs/llm-index.yaml` (`flows`).
