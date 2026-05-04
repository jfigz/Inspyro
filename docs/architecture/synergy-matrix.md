# Matriz de Sinergias (Módulo↔Módulo)

> **Última actualización:** 2026-05-03

> **Objetivo:** exponer dependencias cruzadas e impacto de cambios para agentes IA.

---

## Matriz principal

| Módulo | Upstream (consume) | Downstream (impacta) | Riesgo principal |

|--------|---------------------|----------------------|------------------|

| `04-notebook-handlers` | `09-jupyter-kernel`, `01-document-generation-docx`, `02-websocket-manager` | `11-notebook-editor-ui`, `14-main-app`, `17-template-editor` | Bloqueo por locks/timeouts en kernel + falsos `kernel_lock_timeout` si se mezcla la espera del lock con la ejecución real + saturación de colas WS por conexión + lifecycle de kernels/templates + pérdida de correlación de artefactos si `notebook_cell_executed` no refleja `kernel_id`/`source_path` o si el mapping `kernel_id -> source_path` queda stale + shutdown espurio tras reconnect si el ownership `kernel_id -> websocket` no se rebindea en execute/control/template y el cleanup del socket viejo sigue corriendo + cancelación falsa de `Run All` si UI/backend/MCP dejan de compartir el presupuesto canónico de `600s` por celda, si el cliente deja de recibir liveness pre-terminal en celdas largas o si el terminal `notebook_cell_executed` se retrasa esperando rescate DOCX/PDF + falsos `KeyboardInterrupt` si una cancelación tardía interrumpe solo la fase documental + drift de artefactos tardíos si `notebook_docx_update`/`notebook_pdf_ready` pierden `execution_id` o llegan fuera de latest-wins, o si los mensajes tempranos dejan de incluir `kernel_id`/`source_path`/`source_kind` durante corridas paralelas + deriva de la ejecución activa si `queued` y `running` vuelven a compartir un único owner por `kernel_id` + desvío de `Docx_Documents` si el artifact store vuelve a depender del `active_workspace` global en vez del `source_path` del origen + progreso stale en Home si `shared_resource` del convertidor PDF no se limpia solo en terminales documentales reales |

| `02-websocket-manager` | `main.py` | `04-notebook-handlers`, `14-main-app`, `19-mcp-server` | Head-of-line blocking si dos productores vuelven a tocar `send_text()` directo sobre la misma conexión + pérdida de FIFO por conexión si se bypassa la cola saliente dedicada + desconexiones en cascada si la política de saturación deja de preferir recycle `1013/outgoing_queue_saturated` frente al wedge de notebooks paralelos + regresión del ruteo dual `/ws` vs `/ws/notebook` si un socket queda enlazado al manager incorrecto |

| `09-jupyter-kernel` | `jupyter_client`, `ipykernel`, `02-websocket-manager` | `04-notebook-handlers`, `06-dependency-analyzer`, `07-sensitivity-analyzer` | Contención de canales ZMQ y backlog de callbacks IOPub si no se acota + falsos `iopub_error` si lecturas benignas `Empty` se tratan como fallo duro del canal + acople residual si la ultima celda diferida vuelve a pedir `capture_docx` y espera `__INSP_NOTEBOOK_DOCX` en el reply terminal + wedge aparente si los callbacks IOPub dejan de drenar a través del writer FIFO de `02` y vuelven a competir por el `/ws` compartido |

| `17-template-editor` | `04-notebook-handlers`, `01-document-generation-docx` | `11-notebook-editor-ui`, `14-main-app` | Coherencia de preview (cache FE/BE), ownership dividido (`template_extract`/`template_preview`), correlación `request_id`, save ack-driven, adjunto por `template_attach`, fallback REST→WS estricto, cancelación stale (`template_preview_cancel`), deriva tipográfica compartida (`resolved_font`/`font_source`/`system_font_catalog`/`document_defaults`), convivencia `style_coverage` + `style_browser`, slots persistidos `semantic_style_slots` como contrato runtime Word-first, selección estable ante nombres duplicados (`selection_key`) y round-trip portable (`/api/templates/export` + `semantic_style_slots`, con `category_overrides` solo legacy) sin drift entre export/import |

| `01-document-generation-docx` | `docx_builder`, `pdf_converter` | `04-notebook-handlers`, `17-template-editor` | Fallos de conversión Word/LibreOffice + drift entre artifact store DOCX persistente, fallback runtime por `kernel_id` y descarga legacy por token + pérdida total de imágenes si el rebuild OOXML no rehidrata relaciones/media + regresión a `Calibri/Consolas` si el kernel no reusa `builder_required_style_defaults` o si `docDefaults` globales no quedan materializados en `styles.xml` + captions `SEQ/REF` mal anclados si el bookmark no envuelve el número efectivo + clasificación tardía o ausente de DOCX vacíos que contamine historial/latest + hyperlinks de procedencia no aplicados o manifiestos `provenance_id -> artifact_id` fuera de sync + fuga de hyperlinks automáticos de procedencia o field codes `HYPERLINK` hacia cualquier salida Word-visible (`doc_export`, token, `/api/docx/download`) si la sanitización de entrega diverge del artifact interno raw + head-of-line blocking entre notebooks paralelos si `notebook_docx_update` / `notebook_pdf_ready` vuelven a inflar el WS con base64 inline pese a existir `docx_ref` / `pdf_ref` estable + contención invisible del convertidor PDF si la espera del camino Word-capable vuelve a ocurrir dentro del executor compartido en vez de la cola async dedicada + drift entre `builder.document` proxy rastreado y `builder.document_raw` si el escape hatch se usa fuera de casos excepcionales + Workbench DOCX incoherente si `docx_core`, `docx_quality`, `docx_render_cache`, variants/resources y endpoints `/api/docx/workbench/*` dejan de compartir `artifact_id + binary_hash` como identidad + reconversiones innecesarias si `render_page` no reusa el PDF canónico por `binary_hash + renderer_signature + profile` |

| `06-dependency-analyzer` | AST + contexto notebook/archivo + resolución lazy de imports locales del workspace + índice conservador de consumidores `.py` en impacto | `12-dependency-graph-ui`, `07-sensitivity-analyzer` | Divergencia estático vs runtime + optimización sin candidatos factibles + resolución errónea de raíz si el caller sintetiza `line/column` inexistentes + degradación multiarchivo si falta `file_path` real o el workspace activo + truncado silencioso del índice workspace si no se propaga `analysis_complete=false`/metadata + drift semántico si la UI deja de reflejar `full_name`/`is_external`/`location.file` o si referencias dotted vuelven a resolverse por sufijo sin instancia/import inequívoco |

| `07-sensitivity-analyzer` | fórmulas y valores runtime | `12-dependency-graph-ui` | evaluación insegura/incompleta |

| `03-file-system-api` | FS local + watcher del workspace | `14-main-app`, `11-notebook-editor-ui` | rutas inválidas, drift entre el workspace visible y el workspace activo persistido, árbol lazy inconsistente si `hasChildren`/`relativePath` divergen, `workspace_fs_event` ruidoso sin batching y condiciones de carrera/I-O bloqueante si no se delega a ejecutor |

| `08-lsp-bridge` | `pylsp` | `13-monaco-editor` | desincronización de documento virtual |

| `12-dependency-graph-ui` | `06-dependency-analyzer`, `07-sensitivity-analyzer`, `11-notebook-editor-ui`, `14-main-app` | `11-notebook-editor-ui`, `14-main-app` | drift entre ranks LR, umbrales de complejidad, vista agregada `Resumen` (`dependencyGraphOverview`), orden de puertos y ruteo ortogonal local (`lane_id`/`shared_trunk_id`) que reintroduzca cruces, detours externos innecesarios, paths curvos, modo denso tardío en grafos complejos o conteos/aristas agregadas inconsistentes frente a `Todo` |

| `14-main-app` | `03-file-system-api`, `04-notebook-handlers`, `15-notification-center`, `19-mcp-server` | `11-notebook-editor-ui`, `12-dependency-graph-ui`, `13-monaco-editor`, `15-notification-center`, `17-template-editor` | desalineación entre telemetría MCP, replay granular opt-in, dirty state local, autoactivación del espejo tras `start/restart`, activación de tabs desde caché, batches `workspace_fs_event`, estado lazy del explorer, workspace activo backend/UI, `workspaceSurface` mal sincronizado entre `home` y `file`, `Agent Workspace Home` no persistente, `Entender -> Ejecutar -> Entregar` no visible como loop central, franja `Atención` stale o carril `Entender` vacío por depender solo de runtimes vivos e ignorar `template_inventory`, diálogos controlados de explorer, navegación grafo→archivo sin highlight consistente, índice de notebook bajo `FileExplorer` stale o apuntando a otra `.ipynb`, orientación/layout del grafo no sincronizada con el panel embebido, narrativa visible `Agents` vs backend MCP real y estrategia latest-wins/historial si el shell vuelve a rereleer tabs abiertos, ignora `mirrorEnabled` o registra payloads DOCX nulos/stale como documentos nuevos, `McpPanel` deja de comportarse como inspector avanzado, o `mcp_mirror_event` roba el foco desde `home` + drift entre la metadata `target` de notificaciones y el resolver de `App.js`, de modo que un click navegue al recurso equivocado, cambie `workspaceSurface` sin intención o pierda la diferencia entre CTA y expansión inline + fuga de template entre notebooks si `templateInfo`/`templateBlob`/`templateOpenRequest` salen otra vez de `notebookSessionsByPath` o si el reattach vuelve a usar estado shell-global + ruteo notebook no determinista si `App.js` ignora `entry.path` del socket `/ws/notebook`, si pierde la prioridad `payload -> socket path -> execution_id -> kernel_id`, si vuelve a compartir un único cursor entre la cola global y la cola notebook dedicada, si la cola notebook vuelve a recortarse como buffer plano compartido, o si la hidratación vuelve a aceptar `notebookData` cuyo `path` no coincide con la sesión activa y contamina tabs al alternar notebooks rápidos + `Modo origen` roto si el visor PDF, el manifiesto de procedencia y `handleNavigateToCode` dejan de compartir el mismo contrato, si la resolución puntual por `provenance_id` no puede refrescarse, si `notebook_pdf_ready` tardío no recompone `docx_artifact_id`/`docx_provenance_*`/`source_path`, o si el shell abre una `.ipynb` objetivo pero no completa luego la navegación a celda/línea o su fallback best-effort por línea + drift entre `DocxViewer` y `PdfViewer` si divergen `onDocumentMetaChange`/`onCurrentPageChange`/`requestedPage`/`fitMode`, si el render windowed deja offsets inconsistentes, si `pdf-status` deja de revalidarse cuando `Documento` vuelve a estar visible, si `Home` deja de reflejar `shared_resource` para notebooks ocultos que aún esperan el convertidor PDF global, o si reaparece el loop de callbacks que reinicia la carga por identidad en vez de por fuente real + drift en primer arranque si `ProjectLauncher` siembra el ejemplo, abre el notebook y arranca Agents fuera de orden |

| `18-engineering-units` | `pint`, `09-jupyter-kernel`, `04-notebook-handlers` | `11-notebook-editor-ui`, `12-dependency-graph-ui`, `01-document-generation-docx` | drift catálogo backend/frontend + aliases conflictivos (`tonf/tf`, `Nm/m·N`, `rpm/turn/min`) + falsos negativos de compatibilidad si se compara la dimensionalidad por string + captura intermitente de variables + parseo DOCX agresivo sin validación |

| `15-notification-center` | eventos de `App.js`, actividad MCP estructurada | experiencia del usuario | saturación de mensajes, mezcla pobre entre notificaciones legacy y externas, o drift entre expansión inline, affordances visuales y metadata `target` si el renderer vuelve a tomar decisiones de navegación que pertenecen al shell |

| `19-mcp-server` | `04-notebook-handlers`, `03-file-system-api`, `01-document-generation-docx`, `06-dependency-analyzer`, `07-sensitivity-analyzer`, `17-template-editor`, `18-engineering-units` | clientes MCP externos (Claude, GPT, Gemini, etc.) + `14-main-app`/`15-notification-center` via relay de actividad y espejo | drift de contratos REST/WS + correlación rota por `request_id`/`execution_id` + timeout MCP no propagado al backend o desalineado del presupuesto notebook-first de `600s` + regresión del scoping por `session_id` + artifacts link-first inconsistentes + `file_mutation` incompleto + `notebook_load`/hard reset reenviando outputs embebidos gigantes al kernel o manteniendo timeouts fijos inadecuados en notebooks grandes + relay tardío MCP incompleto si pierde `notebook_docx_update` antes de `notebook_pdf_ready` + batches que cierran antes de que el `execution_id` público ya tenga su DOCX final visible, abriendo carreras con rerenders de template o mutaciones posteriores + roots MCP incompatibles con el workspace activo o colgados por hosts que no responden `list_roots()` + onboarding roto si `mcp.instructions`, resources/templates/prompts o `completion/complete` pierden sincronía + fuga de bucket si una tool notebook deja de capturar `session_id` al inicio y resuelve bridge/locks/background tasks tarde |

| `24-desktop-shell` | `14-main-app`, `08-lsp-bridge`, `19-mcp-server` | `14-main-app`, `03-file-system-api`, `04-notebook-handlers`, `08-lsp-bridge`, `19-mcp-server` | drift entre dev server y same-origin desktop + runtime Python portable faltante o sin dependencias críticas (`pylsp`, `fastmcp`, `mcp`) + backend staged contaminado con estado local/caches/probes + instalador NSIS sin metadata/asociaciones nativas + backend sidecar huérfano + serving SPA roto si `frontend/build` no existe + navegación externa sin aislamiento en Electron + archivos asociados abiertos fuera del workspace correcto + splash bloqueada si no llega `renderer_bootstrap_ready` + ventana negra si el renderer falla antes de `renderer_app_ready` sin fallback visible + recents/bounds stale si el shell-state no se sincroniza + shortcuts duplicados entre menú nativo y listeners web + branding shell/splash/header fuera de sync si la narrativa visible `Agents`/brand mark diverge entre Electron, React y assets empaquetados |

---

## Actualización 2026-05-03 - Home como centro operativo

1. `14-main-app` transforma el mismo `homeSummary` en `workspaceData.operational`: franja `Atención`, carriles `Entender` / `Ejecutar` / `Entregar` y acciones rápidas, manteniendo `cards` solo como fallback temporal de render.
2. `AgentWorkspaceHome` deja las tarjetas/acordeones como modelo legacy y pasa a filas navegables con detalle lateral/inline; el riesgo cruzado principal es perder la prioridad de atención, duplicar navegación implícita o romper compatibilidad con snapshots antiguos que aún no traigan `operational`.
3. `17-template-editor`, `01-document-generation-docx` y `19-mcp-server` siguen sin contratos nuevos: plantillas se consumen dentro de `Entregar`, clientes MCP dentro de `Ejecutar` y los badges DOCX/PDF/MCP siguen derivados de payloads existentes.

---

## Actualización 2026-04-28 - Celdas DOCX nativas

1. `04-notebook-handlers` preserva `cell_type="docx"` al cargar/guardar notebooks, migra suavemente fuentes legacy con APIs DOCX detectables y sigue tratando `emit_docx` como modo documental de la corrida, no como alias exclusivo del tipo de celda.
2. `11-notebook-editor-ui` y `14-main-app` ejecutan `code + docx` cuando DOCX/PDF está activo y omiten `docx` cuando está apagado; la desactivación no llama `notebook_mdoc_clear` ni invalida el último artefacto visible.
3. `19-mcp-server` acepta `docx` en `notebook_create(cells=...)` y `notebook_sync_cells`, reporta ese tipo en listing/get/find y agrega `include_docx=false` en `execute_cell`/`execute_all_cells` para iteración de cálculo sin generación documental.
4. El riesgo cruzado principal es una deriva invisible entre UI humana, backend y MCP: si un agente escribe report cells como `code`, se pierde la omisión barata; si un cliente apaga DOCX/PDF limpiando `mdoc`, se rompe la continuidad del documento visible.

---

## Actualización 2026-04-26 - Home con Run All shell-owned

1. `14-main-app` superpone `notebookSessionsByPath` activos sobre `homeSummary` para que la superficie Home muestre corridas `Run All` locales en tiempo real, incluso cuando el backend aún reporta un snapshot idle.
2. `04-notebook-handlers` conserva la serialización real del convertidor Word/PDF como `shared_resource` y alinea la ruta directa de exportación DOCX con `status="waiting"` cuando el recurso está ocupado.
3. El riesgo cruzado principal es que Home vuelva a depender solo de `GET /api/system/home-summary`, ocultando notebooks que siguen corriendo en el shell aunque los kernels y sockets estén sanos.

---

## Actualización 2026-04-25 - Workbench DOCX

1. `01-document-generation-docx` ahora separa `docx_core` como núcleo OOXML compartido, `docx_quality/workbench.py` como fachada operativa y `docx_render_cache.py` como cache visual persistente: auditoría por perfiles, render manifest/página/todas, limpieza, comentarios/redlines, fields, redacción/protección, SDTs y diff dependen de `docx_artifacts`, `pdf_converter` y `backend/app/routers/docx.py`.
2. `14-main-app` consume summaries/resources en `DocxViewer`, historial y `AgentWorkspaceHome`; el riesgo cruzado principal es promocionar badges o descargar resources de un artefacto/render distinto al que se visualiza.
3. `17-template-editor` consume la inspección de content controls para el panel `Campos` y guía acciones de envolver/probar/validar sin crear una ruta paralela de generación.
4. `19-mcp-server` expone solo tools compactas (`check_document_quality`, `run_document_workbench`, `compare_document_versions`, `manage_document_review`, `prepare_document_delivery`) para que agentes vean errores y handles sin inflar contexto con DOCX/PNG/XML inline; las operaciones visuales devuelven `resource_uri` de `/api/docx/render/resource`.

---

## Impacto por tipo de cambio

### 0. Cambio frontend-local de shell workspace

1. Si el cambio se limita a `workspaceSurface`, `AgentWorkspaceHome`, la jerarquía `Entender -> Ejecutar -> Entregar`, la franja `Atención` o la democión visual de files/notebooks, trátalo como un cambio de shell frontend-local.

2. El índice de notebook bajo `FileExplorer` también entra en esta categoría: documenta ownership shell-owned en `14-main-app.md` + `11-notebook-editor-ui.md`, sincroniza `feature-threads.md` + `synergy-matrix.md` y evita inventar contratos públicos nuevos de WS/REST/MCP.

3. No asumas contratos públicos nuevos de WS/REST/MCP para Stage 2; sincroniza `14-main-app.md`, `feature-threads.md`, `synergy-matrix.md`, `llm-index.yaml` y valida que `mcp_mirror_event` siga actualizando estado sin robar el foco desde `home`.

4. Si el cambio toca notificaciones del shell, documenta explícitamente quién es owner de `target` metadata (`App.js`) y quién solo renderiza/expande inline (`NotificationCenter`).

### 1. Cambio en contratos WS

1. Revisar `backend/main.py` dispatcher.

2. Actualizar `contracts-catalog.md` + `llm-index.yaml`.

3. Revisar módulos backend y frontend consumidores.

4. Si MCP consume ese contrato, revisar `backend/mcp_server/bridge.py`, `backend/mcp_server/session_state.py` y tools afectadas.

### 2. Cambio en concurrencia de kernel/template

1. Revisar `04-notebook-handlers` + `09-jupyter-kernel` + `17-template-editor`.

2. Validar bloqueos, semáforos y timeouts; no mezclar `INSPYRO_LOCK_TIMEOUT` con el presupuesto temporal de ejecución real de la celda.

3. Verificar prioridad de control (`interrupt/reset/shutdown/notebook_cancel_execution`) sobre tareas pesadas por conexión.

4. Confirmar manejo de saturación (`connection_queue_full`) y cleanup de workers al desconectar.

5. Verificar que execute/control/template rebindeen `kernel_id -> websocket` en reconnects legítimos y que el shell siga pudiendo rutear mensajes notebook por `entry.path` cuando el payload todavía no trae `source_path`.

### 3. Cambio en DOCX/PDF

1. Revisar `01-document-generation-docx` + `04-notebook-handlers`.

2. Verificar degradación graceful cuando PDF no está disponible.

3. Verificar rutas de descarga, hash/caché y lookup estable por `artifact_id`, `source_path` y `kernel_id`.

4. Validar fallback entre payload inline, artifact store persistente y referencias (`docx_ref`/`pdf_ref`, `docx_file_token`).

5. Confirmar historial DOCX newest-first (`/api/docx/history`) y pruning por retención sin borrar versiones recientes; en frontend, deduplicar historial local por identidad estable (`artifact_id || downloadUrl || docxHash`) y no por eventos transitorios.

6. Validar que `Run All` persista solo el DOCX final del batch y no agregue entradas intermedias cuando `skip_pdf=true`.

7. Si MCP descarga artefactos, validar lookup por `token`/`ref` y que el shell reemplace refs stale con estrategia latest-wins.

8. Revisar que el rebuild OOXML preserve `word/media/*` y relaciones válidas en `document.xml`, headers y footers antes de convertir a PDF.

9. Confirmar que las celdas que escriben o mutan el informe estén marcadas `cell_type="docx"` y que `include_docx=false`/DOCX-PDF OFF omitan esas celdas sin limpiar `mdoc` ni tocar el último DOCX/PDF visible.

10. Confirmar que el lookup latest por `source_path`/`kernel_id` salte artefactos `docx_is_empty=true`, mientras el historial los mantiene visibles con warning y solo para descarga explícita.

11. Confirmar que `docx_provenance_ref` y `docx_provenance_available` sobrevivan tanto en historial REST como en eventos WS, y que el visor solo habilite `Modo origen` cuando el PDF entregue annotations reales de procedencia.

12. Confirmar que todo DOCX Word-visible (`doc_export`, `docx_file_b64`, token legacy y `GET /api/docx/download`) salga sin hyperlinks automáticos `/api/docx/provenance/open` ni field codes `HYPERLINK` equivalentes, mientras el artifact persistido y la reconversión PDF siguen consumiendo el DOCX original con procedencia intacta.

13. Confirmar que una degradación IOPub cierre primero con `notebook_cell_executed` y publique `notebook_docx_update`/`notebook_pdf_ready` después, sin disparar cancelaciones falsas en frontend.

14. Confirmar que la ultima celda exportable diferida ejecute con `capture_docx=false`, de modo que la fase verde termine por el terminal de la celda y no por la lectura de `__INSP_NOTEBOOK_DOCX`.

15. En MCP, confirmar que `execute_all_cells` no devuelva éxito documental hasta que `get_document_docx` y `inspyro://artifacts/{kernel_id}/docx/{execution_id}` puedan resolver el `execution_id` público del batch.

16. Para Workbench DOCX, confirmar que `GET /api/docx/quality` solo lea summaries existentes, que `POST /api/docx/quality/run` persista por `artifact_id + binary_hash`, que `GET /api/docx/quality/render` use cache visual DOCX→PDF→PNG y no reconvierta si ya existe PDF canónico, que `POST /api/docx/quality/clean` genere una copia limpia sin reemplazar el original y que `/api/docx/workbench/*` persista summaries/resources/variantes sin blobs inline por defecto.

### 4. Cambio en pipeline de preview de Template Editor

1. Revisar `17-template-editor` + `04-notebook-handlers`.

2. Validar consistencia entre `preview_key` (incluida firma de tabla) y cache backend por `kernel_id`.

3. Confirmar trazabilidad de refresh manual con `force_refresh=true` y señalización visual de estado (fallback CSS temporal vs render Word real).

4. Confirmar ruta recomendada REST upload (`/api/templates/upload`) + attach WS (`template_attach`) con fallback legacy `template_upload` solo ante fallo de transporte/no disponibilidad; validar también el export portable (`GET /api/templates/export`) y que la importación JSON reutilice upload + attach.

5. Verificar que `style_coverage` siga siendo el resumen requerido mientras `style_browser` gobierna la navegación detectada, el auto-selected por categoría y los overrides manuales.

6. Verificar cleanup de previews activas en timeout/unmount/cambio de pestaña, pruning del registro latest-wins por kernel y estabilidad de `selection_key` cuando existen nombres de estilo duplicados.

### 5. Refactor estructural de módulos backend

1. Si se toca `notebook.py`, validar que la fachada siga exportando handlers desde `notebook_execution.py`, `notebook_kernel_control.py` y `notebook_template.py`.

2. Si se toca dominio template, preferir `app/services/template/*` como fuente principal y mantener `template_service.py` como fachada estable para compatibilidad.

3. Ejecutar benchmark mixto (`./agent_debug.ps1 stress-ws`) tras cambios de concurrencia para comparar latencia y estabilidad.

### 6. Cambio en contratos de análisis/optimización

1. Revisar `backend/app/routers/analysis.py` + `backend/app/contracts/ws_models.py` + `backend/main.py`.

2. Sincronizar docs canónicas (`contracts-catalog.md`, `llm-index.yaml`) y regenerar `frontend/src/contracts/wsMessageTypes.generated.js`.

3. Validar correlación por `request_id` en UI para evitar mezcla de resultados (`optimization_*`, `*_result`, `*_error`).

### 7. Cambio en telemetría MCP o espejo UI

1. Revisar `backend/mcp_server/activity.py`, `backend/mcp_server/mirror.py`, `backend/app/services/mcp_activity.py`, `backend/app/services/mcp_mirror.py` y `backend/app/routers/mcp_manager.py`.

2. Sincronizar `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md` y `docs/llm-index.yaml` con `mcp_activity_event`, `mcp_mirror_event`, `/api/mcp/activity*` y `/api/mcp/mirror-events`.

3. Regenerar `frontend/src/contracts/wsMessageTypes.generated.js`.

4. Validar guardas de dirty state y activación desde caché en `useMcpActivity`, `useFileSystem` y `NotebookEditor` para no pisar cambios locales ni rereleer tabs abiertos.

5. Validar explícitamente el wiring de `mcp_mirror_event` en `App.js`, que respete `mirrorEnabled` y que no reactive ciclos `tree/read` en `FileExplorer`.

6. Confirmar que el toggle MCP siga habilitado, que el default sea `OFF` sin preferencia previa y que `start/restart` iniciados desde UI autoactiven el espejo.

7. Si además existe `workspaceSurface`, confirmar que `mcp_mirror_event` no autoabra archivos ni quite el foco a `home`; el salto a `file` debe venir de una acción explícita del usuario.

8. Si las notificaciones MCP incorporan `target`, validar que el click primario siga siendo una acción explícita del usuario y no un replay encubierto del espejo.

### 8. Cambio en onboarding/discoverability MCP

1. Revisar `backend/mcp_server/server.py`, `backend/mcp_server/resources/inspyro_resources.py`, `backend/mcp_server/prompts/inspyro_prompts.py` y las docstrings MCP de `tools/notebook.py`, `tools/documents.py`, `tools/templates.py` y `tools/units.py`.

2. Mantener sincronizados perfiles y nombres publicos: `authoring` por defecto, `analysis/files/admin` opt-in, resources/prompts/templates MCP estables y sin reintroducir edición `.ipynb` por file tools genéricos.

3. Si cambió el scoping MCP, revisar tambien `backend/mcp_server/bridge.py`, `backend/mcp_server/session_state.py`, `backend/mcp_server/runtime.py` y `docs/architecture/system-context.md`.

4. Actualizar `docs/modules/19-mcp-server.md`, `docs/changelog/19-mcp-server.md`, `docs/architecture/feature-threads.md` y `docs/llm-index.yaml`.

5. Ejecutar `backend/tests/test_mcp_ai_first.py` y `./agent_debug.ps1 mcp-smoke` para validar que una IA sin repo puede descubrir el flujo correcto, incluidas completions MCP.

### 9. Cambio en shell desktop o empaquetado same-origin

1. Revisar `desktop/main.js`, `desktop/preload.js`, `desktop/scripts/*.mjs`, `backend/main.py` y `frontend/src/config/endpoints.js`.

2. Validar que `frontend/build` siga siendo servible en `/` y `/static` sin romper `/api/*`, `/ws`, `/ws/lsp` ni `/docs`.

3. Confirmar que Electron mantenga `contextIsolation=true`, `nodeIntegration=false`, `sandbox=true` y single-instance lock.

4. Validar splash/boot stages, fases `renderer_bootstrap_ready`/`renderer_app_ready`/`renderer_app_failed`, persistencia de bounds/maximized, `Open Recent` y supresión de notificaciones nativas cuando la ventana está enfocada.

5. Si cambia el runtime empaquetado o el bridge shell↔renderer, actualizar `docs/modules/24-desktop-shell.md`, `docs/architecture/system-context.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md` y `docs/llm-index.yaml`.

6. Para releases distribuibles, ejecutar `npm run stage` con un Python portable verificable, confirmar que `desktop/.stage/backend` no incluya estado mutable del backend y usar `npm run smoke:packaged` sobre `dist/win-unpacked` para validar imports Python, `/health`, LSP, MCP y bridge desktop antes del instalador.

---

## Checklist de riesgos antes de merge

1. ¿Hay contratos WS nuevos sin documentación canónica?

2. ¿Se rompió alguna relación upstream/downstream crítica?

3. ¿Hay cambios de ownership de estado no documentados?

4. ¿Se actualizó `docs/llm-index.yaml`?
