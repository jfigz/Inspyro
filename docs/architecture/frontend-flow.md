# Flujo del Frontend

> **Framework:** React 18
> **Última actualización:** 2026-05-03
> **Contrato canónico:** `docs/architecture/contracts-catalog.md`

---

## Rol del frontend

1. Orquestar layout global, paneles y la home compacta shell-owned del workspace (`App.js`).
2. Gestionar edición de notebooks y archivos.
3. Resolver y sincronizar el workspace/proyecto activo contra el backend, incluyendo explorer lazy y eventos externos de filesystem.
4. Resolver `API_BASE`, `WS_URL` y `LSP_WS_URL` en same-origin para desktop/prod, preservando `localhost:3000 -> localhost:8000` solo en desarrollo con CRA.
5. Consumir eventos en tiempo real por WebSocket.
6. Enviar acciones de usuario como contratos WS/REST.
7. Representar actividad MCP estructurada, heartbeats por cliente (`client_id`/`client_label`/`transport`) y decidir, desde el shell, cuándo reflejar cambios remotos de forma segura.

---

## Componentes críticos

| Componente | Responsabilidad |
|------------|------------------|
| `App.js` | estado global, wiring de paneles, split modo-específico (`code` conserva su proporción y `notebook` inicia más ancho), bridge desktop-aware (`window.inspyroDesktop`) y owner de la cola visible de notificaciones y del batch shell-owned de `Run All` |
| `AgentWorkspaceHome.js` | centro operativo shell-owned del workspace, con header compacto, franja `Atención`, tres carriles `Entender` / `Ejecutar` / `Entregar`, detalle lateral/inline y fallback temporal desde `cards` legacy |
| `FileExplorer.js` | rail izquierdo shell-owned para árbol lazy del workspace, acción contextual de abrir archivos con aplicación por defecto y, cuando el archivo activo es `.ipynb`, secciones laterales `Explorador` e `Índice de Notebook` sobre el mismo rail |
| `NotificationCenter.js` | feed del header, agrupación temporal, read state, expansión inline y dropdown portalizado con clamp al viewport |
| `DocxViewer.js` | shell del documento, toolbar PDF, historial DOCX, procedencia exacta-first y rail derecho `Workbench DOCX` bajo demanda |
| `PdfViewer.js` | render PDF controlado con metadata client-side, destinos internos y windowing |
| `useMcpActivity.js` | feed MCP, toggle de espejo, `agentExecutionState` y badges de runs |
| `useMcpMirror.js` | arbitraje y reproducción guiada de `mcp_mirror_event` sobre notebook/template |
| `NotebookEditor.js` | ciclo notebook result-first, ejecución por celda, outputs ricos, limpieza manual de resultados y render del estado shell-owned de `Run All` |
| `TemplateEditor.js` | fachada del editor de plantillas DOCX; `TemplateEditorContainer` monta el workbench slots-first con navegación `Slots/Estilos/Diagnóstico`, edición central y rail de preview |
| `MonacoEditorLSP.js` | edición de código + contrato LSP |
| `VisualizationPanel.js` | contenedor directo del split derecho (`Documento` / `Dependencias` / `Variables`) y owner de la pestaña activa según documento o target de análisis |
| `DependencyGraph` | visualización de dependencias/sensibilidad usando el `/ws` global para `analyze_dependencies` y `analyze_impact` |

---

## Flujo de datos resumido

1. El shell web resuelve `API_BASE`: si corre bajo CRA en `:3000`, apunta al backend `:8000`; si corre servido por FastAPI en desktop/prod, usa `window.location.origin`.
2. El shell consulta `/api/system/info` y toma del backend el workspace activo efectivo.
3. Si no existe `active_workspace`, `App.js` entra en modo launcher y ofrece crear un proyecto nuevo o abrir uno reciente antes de montar el layout IDE.
4. FileExplorer puede abrir o crear workspace mediante `/api/system/workspace` y `/api/system/workspace/create`.
5. FileExplorer consume `/api/files/tree` en modo lazy, usa `/api/files/search` para quick open, muta el filesystem con endpoints explícitos de `move/copy/duplicate` y ofrece abrir archivos con la aplicación por defecto mediante `window.inspyroDesktop.openPath(path)` o `POST /api/files/open-default` en web local.
6. Si `/api/files/read` no puede cargar un archivo como texto/notebook editable, `App.js` mantiene la superficie `file`, muestra un estado central con el motivo y ofrece la misma apertura por aplicación por defecto sin crear una tab editable falsa.
7. Cuando el archivo activo es `.ipynb`, `App.js` deriva un índice de notebook frontend-local desde la sesión shell-owned del path activo y lo publica como otra sección del rail lateral, al mismo nivel que `FileExplorer`, sin introducir contratos REST/WS nuevos.
7. Ese índice se alimenta del mismo snapshot runtime/persistable que rehidrata `NotebookEditor`, por lo que mantiene estabilidad de ids aun si el editor se desmonta, si el usuario vuelve desde `home` o si llega una snapshot same-path desde el shell.
8. Un click del índice es navegación shell-owned: si hace falta, `App.js` vuelve a `workspaceSurface='file'`, garantiza que el notebook correcto esté activo y delega el salto fino a `NotebookEditor` vía `actionsRef.navigateToCode()` / `focusCell()`, sin rereleer el archivo ni crear un kernel nuevo.
9. Hook WS/REST envía requests de archivos, notebook o MCP usando ese contexto activo.
10. Backend responde por contrato.
11. `lastMessage` actualiza estado React.
12. `workspace_fs_event` permite recargar tabs limpios y refrescar carpetas cargadas sin reconstruir todo el árbol; si el archivo está dirty, el shell marca conflicto en vez de sobrescribir.
13. `App.js` normaliza la cola visible de notificaciones (`title/message/type/progress/actions/target`), deduplica por `id` y arbitra cuándo un evento queda solo en el feed interno o además dispara una notificación nativa desktop.
14. En notebooks, `App.js` también es owner del batch shell-owned de `Run All`: conserva la corrida por `path`, la mantiene viva fuera del mount de `NotebookEditor` y decide cuándo esa corrida queda completada, fallida o interrumpida para el shell.
15. `NotebookEditor` consume y renderiza ese estado shell-owned de `Run All`, además de emitir señales de avance/correlación (`execution_id`, progreso, terminales válidos), pero no conserva la autoridad final del batch al desmontarse o al cambiar de superficie.
16. La vista del notebook es result-first: markdown queda como narrativa visible y se renderiza con GFM amplio, KaTeX, footnotes, task lists, tablas, HTML local y Mermaid; el toggle `HTML/JS confiable` permite scripts solo bajo confianza explícita. Las celdas Python/DOCX arrancan colapsadas, Monaco se monta bajo acción explícita y la superficie principal de cada celda son sus resultados. El split inicial favorece al notebook frente al panel derecho y la geometría interna reduce gutters/padding para que outputs, tablas y barras minimizadas usen más ancho real. Los MIME bundles ricos se renderizan o se muestran como placeholders/fallbacks inspeccionables.
17. Los eventos live de outputs mantienen continuidad visual: `notebook_update_display_data` reemplaza por `display_id` y los errores con `cell_id` se anexan también inline en la celda, aunque el shell siga mostrando notificaciones globales.
16. El binding de kernel para `Run All` también es shell-owned: `App.js` correlaciona `notebook_load`/`notebook_attach_kernel` por `request_id`, resuelve `waiting_kernel` por ack lifecycle, por señales WS de ejecución válidas o por `kernelId` reportado por el editor cuando ese fallback no pisa un `load` nuevo pendiente. La sincronización `NotebookEditor -> App.js` de kernel viaja anclada al `filePath`: el editor no reporta el kernel anterior durante el primer render posterior a un cambio de tab, y el shell rutea callbacks tardíos hacia la sesión reportada en vez de contaminar la pestaña activa. El arranque no depende de que `getNotebookConnectionStatus(path)` ya sea `connected`: `useAppWebSocket.sendNotebookMessage()` abre/usa el socket dedicado y encola `notebook_load`/`notebook_execute_cell` mientras está `connecting`, para que varios notebooks abiertos rápido no pierdan su `Run All` inicial.
17. `queued -> running` queda centralizado en un único auto-dispatcher del shell; si el kernel no aparece a tiempo, `App.js` dispara un timeout visible y limpia el batch en vez de dejar el rail pegado en `Iniciando kernel`.
18. `NotificationCenter` renderiza ese feed, agrupa por tiempo, marca leídas al abrir el dropdown y decide entre CTA navegable o expansión inline según el contenido de cada card; la resolución real del `target` permanece en `App.js`. El dropdown vive en un portal fijo al `body`, se reposiciona por viewport y no depende del overflow del `DesktopTitleBar`.
19. Para actividad MCP, `App.js` hidrata `/api/mcp/activity`, usa `mcp_activity_event` para feed/notificaciones/estado del agente y usa `mcp_mirror_event` para reproducir cambios granulares solo si `mirrorEnabled=true`; el modo espejo arranca en `OFF` cuando no existe preferencia previa, respeta el valor persistido y se autoactiva si el usuario hace `start/restart` MCP desde la propia UI.
20. Cuando `workspaceSurface === 'home'`, `App.js` hidrata `GET /api/system/home-summary`, transforma ese payload backend en `workspaceData` UI-friendly y hace polling controlado solo mientras la home está visible; al pasar a `workspaceSurface='file'` desmonta ese polling y conserva solo refresh adicional al volver foco/online/visibility cuando la home reaparece.
21. La home ya no depende de `templateInfo`, `docxHistoryEntries` ni del mount de `NotebookEditor`: usa `overview`, `notebook_runtime_items[]`, `code_runtime_items[]`, `recent_docx_items[]`, `mcp_service`, `mcp_clients[]` y `template_inventory[]` como snapshot workspace-scoped del shell. Antes de renderizar, `App.js` filtra recursos internos/generados (`_agent_runs`, `.inspyro`, `Docx_Documents`, demos/smoke), omite DOCX vacíos y superpone `notebookSessionsByPath` con `batchRunState` o `documentPipelineStatus` activo para que `Run All` shell-owned aparezca en Home en tiempo real aunque el resumen backend llegue rezagado o idle.
22. `App.js` deriva además `workspaceData.operational` como capa frontend-local compatible con `cards`: `attentionItems` prioriza errores, ejecuciones activas, PDF compartido/en cola, DOCX pendientes de calidad/render y estado MCP; `lanes` conserva la esencia `Entender`, `Ejecutar`, `Entregar`; `quickActions` expone accesos a archivos, agentes, último DOCX y primer notebook útil.
22. `AgentWorkspaceHome` renderiza ese modelo como centro operativo: una acción principal de atención, filas navegables de un click en tres carriles, acciones secundarias visibles y un panel de detalle lateral/inline para metadata; si `operational` no existe, adapta la forma legacy `cards` sin cambiar contratos REST/WS.
23. `Entregar` integra tanto DOCX como plantillas: `Abrir DOCX`, `Preparar entrega`, `Abrir origen` y apertura de template reatado mantienen acciones explícitas, abren la copia persistida con `window.inspyroDesktop.openPath(workspace_path)` cuando existe y degradan a descarga HTTP o tokenización (`POST /api/templates/tokenize`) solo cuando corresponde.
24. `Ejecutar` integra notebooks/scripts activos y `Clientes MCP`: puede abrir `Agents` con filtro por `client_id/client_label`, reutilizando el mismo panel avanzado y el mismo feed de actividad; `useMcpActivity` y `McpPanel` preservan además `transport` para diferenciar el origen del cliente.
25. Si la UI corre bajo Electron, `index.js` emite `renderer_bootstrap_ready`, instala reporters para `window.onerror`/`unhandledrejection` y monta `RendererRoot`; ese root reporta `renderer_app_ready` o `renderer_app_failed`, mientras `App.js` solo reporta el workspace activo al shell y consume `desktop:menu-action` para abrir workspaces, guardar, ejecutar notebook, alternar paneles, controlar MCP o resolver entradas nativas (`open-native-file`/`open-native-url`) sin duplicar lógica de negocio en el main process.
26. Cuando Electron recibe un archivo asociado (`.ipynb`, `.py`, `.inspyro`), `App.js` lo abre directamente si pertenece al workspace activo; si no, selecciona la carpeta padre como workspace y reutiliza `postWorkspaceAction.openFilePath` para abrirlo después del cambio de proyecto.
27. La title bar deja de ser un header web genérico y pasa a ser un componente desktop-aware (`DesktopTitleBar`) de una sola franja: branding a la izquierda, acciones contextuales del archivo activo al centro (toolbar notebook o `Ejecutar código`) y `NotificationCenter` + estado de conexión + `McpStatusButton` a la derecha, respetando drag regions del shell; el token visual visible consume `frontend/public/brand/inspyro-mark-light-128.png`, generado desde el PNG maestro en `assets/brand/`, y el fallback CSS usa la variante clara derivada bajo `frontend/src/assets/brand/`.
25. En modo notebook, el header ya no usa una subbarra ni pills `Notebook/Kernel`: `NotebookToolbar` vive en el slot central, conserva el indicador de kernel como única referencia visible del runtime y degrada por overflow horizontal antes de crear una segunda banda visual; el dropdown de acciones poco frecuentes sigue exponiendo mutaciones locales del documento (por ahora, `Eliminar outputs`).
26. El frontend emite notificaciones nativas solo para eventos relevantes (DOCX/PDF listos, fallos MCP, `Run All` completado o fallido), manteniendo `NotificationCenter` como feed interno estable.
27. La disponibilidad del convertidor PDF ya no ocupa espacio permanente en la title bar: `DocxViewer` la expone como mensaje contextual y discreto dentro de la pestaña `Documento`, y `App.js` revalida `/pdf-status` al conectar, al volver a mostrar `Documento` y al reintentar PDF para no dejar stale ese estado contextual.
28. Dentro de `Documento`, `DocxViewer` es el owner del estado UX del lector PDF (`currentPage`, `requestedPage`, `zoomPercent`, `fitMode`, `outline`), mientras `PdfViewer` resuelve client-side `numPages`, outline real, destinos internos del PDF y la página visible actual sin introducir contratos backend nuevos; la publicación de metadata/página usa refs estables para no reabrir la carga por cambios de identidad de callbacks.
29. `DocxViewer` expone una toolbar compacta mixta: acciones primarias visibles (`DOCX`, `PDF`, `Plantilla`), controles discretos icon-only para el lector y menús secundarios (`Historial DOCX`, selector de vista, limpiar) basados en `DropdownMenu`.
30. La toolbar de `DocxViewer` agrega el botón icon-only `Calidad`, muestra badges `OK`/`Avisos`/`Revisar` y abre un rail derecho `Workbench DOCX` con tabs `Calidad`, `Visual`, `Revision`, `Publicacion`, `Campos` y `Diff`. Sus acciones llaman `/api/docx/workbench/run` bajo demanda para analizar por perfil, refrescar `render_manifest`, renderizar una página o todas las páginas, preparar entrega limpia, revisar comentarios/redlines, gestionar fields/SDTs y comparar versiones; el backend conserva summaries/resources por artefacto y el frontend no dispara auditoría pesada ni render visual al montar.
31. `PdfViewer` renderiza el documento en modo windowed/lazy con un buffer corto alrededor de la página visible o solicitada; `DocxViewer` usa esa metadata para exponer `X / Y`, input corto de página, zoom manual, `100%`, `Fit ancho` e `Índice`, y conserva el PDF anterior visible mientras el nuevo commit termina para evitar blanking.
31. `VisualizationPanel` mantiene `DocxViewer` montado aunque la pestaña `Documento` no esté visible, pero pasa `isVisible` al viewer para que `PdfViewer` solo se monte cuando `Documento` está realmente a la vista y no mida layout dentro de un contenedor oculto; al volver a mostrar la pestaña, el shell reinyecta la página solicitada sin recrear el viewer por mero cambio de callbacks.
32. Cuando el panel nace ya enfocado a dependencias (`dependencyTarget` preexistente o `requestedView='dependencies'`), `VisualizationPanel` inicializa esa pestaña en el primer paint y evita un mount transitorio del lector PDF que luego deba desmontarse en el mismo ciclo.
33. `PdfViewer` mantiene una cola global de teardown para `pdf.js`: un `getDocument(...)` nuevo no debe arrancar mientras otro viewer del shell sigue destruyendo su `PDFDocumentLoadingTask` o `PDFDocumentProxy`.
34. El bundle frontend empaqueta sus fuentes (`Source Sans 3`, `Source Code Pro`) y deja de depender de Google Fonts remotas, habilitando operación offline dentro del shell desktop.
35. El shell documental evita ruido falso-negativo: `DocxViewer` trata los `404` esperables de historial DOCX, `pdf_ref` o procedencia como “artefacto aún no disponible”, no como error duro, y mantiene fallback local cuando existe estado vivo o historial previo.
36. El logging frontend verbose queda opt-in mediante `REACT_APP_INSPYRO_DEBUG=1`; fuera de ese modo, trazas de `Run All`, websocket, editor y template permanecen silenciosas para no esconder errores reales entre ruido.
37. Las superficies scrollables visibles del shell (`launcher`, explorer, notebook, paneles MCP, template editor, overlays y paneles embebidos) comparten ahora una misma clase `scroll-surface`; fuera de Monaco el shell monta un overlay scrollbar administrado por frontend para garantizar tamaño/hover consistente incluso cuando el scrollbar nativo del runtime no acepta tema visible.
38. Los separadores de resize del shell convergen en un único componente `Resizer`, con hit area más amplia y grip homogéneo; el drag de mouse usa preview imperativo sobre los anchos DOM visibles y solo confirma estado React al soltar, mientras teclado conserva actualización inmediata. Los splits siguen calculándose contra el contenedor real en vez de `window.innerWidth`.
39. En el panel de dependencias, `DependencyGraph` pasa a un layout desktop-first con toolbar compacta, canvas central, rail secundario dependiente del ancho real e inspector docked; `More` se renderiza en portal y deja de competir con overlays del canvas.
40. La estabilización posterior del grafo D3 desacopla render y viewport: fullscreen, filtros, minimap y resizes invalidan transforms manuales viejos, el fit se calcula sobre `content-group` real y el render de flechas abandona `mask + marker-end` en favor de cuerpos bajo nodos y puntas geométricas explícitas sobre nodos, estables a cualquier zoom y sin animaciones de opacidad que puedan dejar edges invisibles tras interacción.
41. El layout del grafo de dependencias pasa a `LR`: las dependencias crecen horizontalmente, los ranks se alinean en columnas verticales, `edgePorts` prioriza puertos laterales y `nodeSizing`/`nodeVisualProfile` fijan dimensiones según el contenido real del nodo (runtime, checks, procedencia, badges y ubicación).
42. El pipeline de aristas del grafo deja de usar curvas y abandona el planner global: `edgeRouter` resuelve recorridos ortogonales por corredores locales con `lane_id`/`shared_trunk_id`, `d3Layout` abre más espacio entre columnas donde hay más demanda de carriles y los detours same-rank/back-edge salen por corredores externos dedicados.
43. `DependencyGraph`, `D3DependencyGraph`, `Panels.js`, `nodeVisualProfile.js` y `dependencyGraphOverview.js` comparten la estrategia UX de grafos densos: `Large graph auto` activa por nodos, aristas o densidad alta para casos como `capacity_ratio`; la vista inicial `Resumen` agrupa por target/scope/archivo y agrega aristas, `Todo` queda descrito como mapa completo, `Camino` y `Vecinos` conservan detalle local, la búsqueda enfoca antes de filtrar, el banner de calidad no abre rail por defecto y el fullscreen bloquea scroll del body sin cambiar el contrato WS.
44. En modo notebook, `VisualizationPanel` es el flex item directo de `.notebook-container`; bajo viewports angostos el contenedor apila notebook y visualización, oculta el resizer y mantiene las tabs `Documento` / `Dependencias` / `Variables` visibles dentro del viewport.
45. Las solicitudes de dependencias originadas en notebook y código agregan `requestToken` frontend-local para distinguir repeticiones del mismo símbolo; `VisualizationPanel` usa esa identidad para autoabrir `dependencies` sin cambiar el contrato WS ni mover `analyze_dependencies` / `analyze_impact` fuera del `/ws` global.
46. El menú contextual de `MonacoEditorLSP` captura la posición exacta del clic derecho y las acciones de dependencias/impacto usan ese token antes de degradar al cursor, evitando análisis sobre una posición vieja del caret.
47. El barrido UI/UX del 2026-04-26 endurece las superficies shell-owned sin cambiar contratos: `DesktopTitleBar`, `NotebookToolbar` y `NotificationCenter` degradan por truncado/overflow antes de solaparse; `FileExplorer` y Quick Open separan basename/ruta; `DocxViewer` distingue preview activo de DOCX descargable histórico; y `VisualizationPanel` limpia targets stale por `filePath` para que prompts de dependencias queden inline y no como notificaciones persistentes.
48. Los diálogos y modales del shell deben exponer controles nombrados y sin CTA duplicados: `Nuevo archivo` parte con nombre vacío, `NotebookIndexPanel` evita botones placeholder sin nombre, `McpPanel` nombra sus acciones icon-only y el editor de plantillas vacío muestra una acción primaria DOCX y una secundaria JSON en una sola zona.
49. El hardening responsivo del 2026-04-28 agrega guards de layout reales: titlebar, Home, archivo, notebook, Agents, DOCX/Workbench y dependencias deben mantener controles críticos dentro del viewport, con scroll local en superficies secundarias y sin pares de controles superpuestos.
50. El rediseño del Template Editor del 2026-05-01 aplica la misma regla a plantillas: header único sin footer duplicado, navegación por utilidad (`Slots`, `Estilos`, `Diagnóstico`), preview Word como rail de apoyo y guards responsive sobre desktop, 1024px, 760px y móvil.

---

## Riesgos de sincronización

1. Estado stale entre `App.js` y componentes hijos (especialmente notebook/template).
2. Respuestas tardías de preview que sobrescriben estado reciente.
3. Reconexión WS con kernel/template no rehidratados.
4. Recarga contextual insegura de archivo/notebook activo cuando un agente MCP modifica el mismo recurso.
5. Snapshots same-path o runtime messages MCP perdidos si el shell no espera a que el notebook objetivo quede realmente activo antes de aplicarlos.
6. Drift entre el workspace que muestra la UI y el workspace activo que reporta backend/MCP.
7. Arranque en un workspace stale si el shell intenta restaurar una carpeta desde cache local sin validarla contra backend.
8. Drift entre origen de la ventana y `API_BASE`/WS/LSP si la detección `CRA vs same-origin` se rompe.
9. Duplicidad de aceleradores entre listeners web y menú nativo si el renderer no reconoce el shell desktop.
10. Shell-state local (`recentWorkspaces`, bounds) desalineado con el backend si `reportWorkspace()` no se emite tras un cambio real de proyecto.
11. Drift entre la metadata `target` que construye `App.js` y la semántica visual de `NotificationCenter`, produciendo clicks ambiguos entre navegar y expandir inline o cambios no deseados de `workspaceSurface`.
12. Drift entre el árbol del workspace y la sección `Índice de Notebook` del rail lateral si el shell deja de regenerar la estructura desde el snapshot activo correcto, si conserva entradas de otra `.ipynb` o si la navegación intenta enfocar una celda que ya cambió de `id`.
13. Drift entre el `batchRunState` shell-owned de `Run All` y lo que renderiza `NotebookEditor` si el shell deja de conservar la corrida por `path`, si el editor recupera ownership local al remontar, si las notificaciones visibles vuelven a depender del mount del editor o si la UI vuelve a bloquear el arranque durante el estado transitorio `connecting` del socket notebook dedicado.
14. Drift entre la calidad/Workbench DOCX cacheada y la versión activa si el frontend usa `source_path` como identidad en vez de `artifact_id + binary_hash`, si promociona badges de un artefacto distinto al que descarga o si descarga un resource de Workbench/render cache sin validar `artifact_id`, `workbench_id` o `render_id`.
15. Drift result-first si la selección de celdas vuelve a montar Monaco automáticamente, si Markdown enriquecido pierde GFM/LaTeX/Mermaid o ejecuta JS sin `HTML/JS confiable`, si los outputs ricos se pierden por MIME no reconocido o si `display_id` deja de reemplazar resultados live y duplica estados parciales.

---

## Controles recomendados

1. Correlación por `request_id` en operaciones largas.
2. Invalidación explícita de cachés de preview/template.
3. Timeouts y limpieza en `useEffect` de unmount/cambio de contexto.
4. Mantener rutas frontend tocadas sin warnings de ESLint (hooks deps, código muerto y exports anónimos).
5. `useWebSocket` debe distinguir cierre manual vs reconexión automática para evitar loops al desmontar.
6. Carga diferida (`React.lazy`) en paneles pesados para reducir costo de primer render del shell.
7. Wrappers de logging en hooks deben delegar a `console.*` y no autoreferenciar su propia API para evitar recursión en runtime.
8. El tracing frontend verbose debe permanecer opt-in (`REACT_APP_INSPYRO_DEBUG=1`) para que `console.error` siga reservada a fallas reales y no quede enterrada entre ruido de depuración.
9. Los cambios MCP remotos deben pasar por un arbitraje explícito de shell (`useMcpMirror`) antes de tocar explorador, archivo activo, notebook, template o previews.
10. El backend debe ser la source of truth del workspace activo; `localStorage` solo actúa como cache de conveniencia del shell y no debe levantar un proyecto por si solo al iniciar.
11. Las fuentes críticas deben viajar en el bundle para que el shell desktop no dependa de `fonts.googleapis.com` ni de conectividad externa.
12. Los shortcuts nativos de Electron deben prevalecer en desktop; los listeners web equivalentes tienen que apagarse o desacoplarse cuando `window.inspyroDesktop.isDesktop=true`.
13. El renderer desktop-aware debe separar `renderer_bootstrap_ready` de `renderer_app_ready`: Electron no debe tratar “bundle cargado” como equivalente a “app montada”, y el shell no debe inferir proyectos activos desde cache local sin validación del backend.
14. Los resizers del shell deben medir y limitar su drag respecto del split activo real para evitar saltos de ancho al convivir con explorer colapsable, launcher y layout notebook/código; durante drag de mouse no deben re-renderizar notebooks, Monaco ni visores pesados por cada movimiento.
15. Los paneles secundarios del grafo (`Legend`, `Minimap`, `Diagnostics`, `Comparison`) no deben depender de overlays absolutos para desktop embebido; el header y sus menús tienen que mantenerse clickeables aun con filtros abiertos.
16. El grafo no debe reintroducir curvas por degradación de densidad: large graph mode tiene que seguir en ruteo ortogonal, activarse por complejidad real y usar vista `Resumen` + gaps/layout ampliados antes de sacrificar legibilidad.
17. `DocxViewer` y `PdfViewer` deben mantener sincronizado su contrato local (`onDocumentMetaChange`, `onCurrentPageChange`, `requestedPage`, `zoomPercent`, `fitMode`); si divergen o si cambian callbacks por identidad en vez de por fuente real, la toolbar PDF queda stale aunque el backend siga sano y el viewer puede entrar en loop de recarga.
18. `PdfViewer` no debe volver a permanecer montado dentro de un contenedor oculto (`display:none`): el shell debe suspenderlo cuando `Documento` no está visible para evitar mediciones con ancho `0`, canvas en blanco, overlays fuera de lugar y el error `Cannot resolve callback` al destruir/recrear tareas async de `pdf.js` demasiado pronto.
19. `DocxViewer` debe resolver el click de `Modo origen` contra el `provenance_id` realmente visible en el PDF; si el manifiesto cargado no contiene ese fragmento, el shell debe reconsultar la procedencia puntual por backend y priorizar `exact` antes de degradar a `callsite`.
20. Cuando la procedencia resuelta apunta a una celda de notebook y no trae `file_path`, el shell debe degradar a `sourcePath` del documento para poder abrir la `.ipynb` correcta antes de delegar `navigateToCode`; `App.js` no puede quedarse solo en “abrir archivo” para estos destinos.
21. Los hyperlinks de procedencia incrustados en PDFs deben tolerar drift de origen entre generaciones y sesiones: aunque el documento haya quedado horneado con `http://127.0.0.1:8000`, el shell debe reescribir `/api/docx/provenance/open` al `API_BASE` activo antes de resolver o abrir la procedencia, incluyendo el camino sin `sourceMode`.
22. Las cargas documentales pesadas deben mantenerse bajo demanda: `pdf.js` solo cuando existe `pdfUrl` y `mammoth` solo cuando el usuario pide `Ver HTML`, para no castigar launcher, home, explorer o notebook sin documento abierto.
21. Abrir dependencias no debe provocar un primer paint en `docx` seguido de auto-switch: ese mount transitorio puede reactivar el lifecycle del PDF justo antes de desmontarlo.
22. El teardown de `pdf.js` debe reservar el worker global antes de drenar tareas async del viewer; si la serialización se registra demasiado tarde, otro `getDocument(...)` puede entrar mientras el worker anterior todavía está destruyéndose.
23. Si una notificación trae `target`, la resolución debe seguir perteneciendo a `App.js`; `NotificationCenter` no debe recuperar ownership de navegación ni convertir el CTA principal en una acción implícita difícil de distinguir de la expansión inline.
24. La sección `Índice de Notebook` del rail lateral debe seguir siendo frontend-local: no debe introducir lecturas extra del `.ipynb`, depender del DOM renderizado del editor ni competir con `navigateToCode()`/`focusCell()` por el ownership del salto fino.
25. La auditoría y el Workbench DOCX deben permanecer bajo demanda y asociados al artefacto estable; `DocxViewer` puede cargar summaries y `render_manifest` cacheados al abrir el rail, pero no debe convertir/renderizar páginas pesadas ni generar variantes durante el montaje normal del shell.
26. El panel de visualización debe seguir siendo el elemento directo del split en código y notebook; introducir wrappers con `.visualization-panel` alrededor de `VisualizationPanel` puede sacar `Dependencias` del viewport en anchos reducidos.
27. Las acciones contextuales de dependencias en Monaco deben resolver primero el token bajo el clic derecho y usar `requestToken`/identidad completa para repetir análisis del mismo símbolo sin depender de cambios aparentes en `symbol`.
28. Los estados visuales derivados del recurso activo deben estar anclados a `filePath`/origen estable; cambiar entre `.ipynb`, `.py` y Home no debe conservar placeholders, targets de dependencias, chips DOCX o CTAs de plantilla pertenecientes al recurso anterior.
29. Los overlays del header, en especial `NotificationCenter`, deben portalizarse o ajustarse con clamp al viewport cuando el contenedor padre pueda envolver, truncar o recortar; los tests responsivos deben validar viewport y no solapes, no solo snapshots visuales.
30. La experiencia notebook result-first debe validarse en desktop y móvil: código colapsado inicialmente, Markdown enriquecido visible, outputs visibles, MIME bundles inspeccionables, errores inline y sin solapes entre gutters, barras minimizadas y superficies de resultado.

---

## Lectura complementaria

1. `docs/architecture/system-context.md`
2. `docs/architecture/feature-threads.md`
3. `docs/modules/14-main-app.md`
4. `docs/modules/11-notebook-editor-ui.md`
5. `docs/modules/17-template-editor.md`

