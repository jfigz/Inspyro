# 14 - Main App

> **Estado:** ✅ Núcleo estable
> **Ubicación:** `frontend/src/App.js`
> **Última actualización:** 2026-05-03
> **Changelog:** `docs/changelog/14-main-app.md`

---

## Propósito sistémico

Actuar como shell principal de la aplicación: layout global, selección de modo (code/notebook), bootstrap del workspace activo, wiring de hooks (`useFileSystem`, `useAppWebSocket`, `useMcpActivity`, `useMcpShellControls`, `useMcpMirror`), integración desktop-aware con `window.inspyroDesktop` y coordinación entre paneles, notificaciones y controles MCP. El shell mantiene dos superficies frontend-locales (`home` y `file`), pero la home persistente del workspace ya se hidrata desde un snapshot backend shell-owned (`GET /api/system/home-summary`) en vez de depender del estado montado del notebook o de stores frontend legacy.

## 2026-05-03 - Branding Inspyro PNG reproducible

- `DesktopTitleBar` reemplaza el mark MCP genérico por `frontend/public/brand/inspyro-mark-light-128.png`, derivado desde `assets/brand/inspyro-logo-source.png`.
- El logo visible del shell adopta la serpiente/espiral verde con kernel dorado en variante clara para superficies oscuras; el fallback legacy `.inspyro-logo` también usa el PNG contextual en vez del emoji.
- El frontend no importa assets fuera de `src`: `DesktopTitleBar` consume un asset público bajo `frontend/public/brand/` y el fallback CSS usa una copia derivada en `frontend/src/assets/brand/`.

## 2026-05-03 - Home como centro operativo

- `App.js` extiende `workspaceData` con `operational`, una capa frontend-local derivada del mismo `GET /api/system/home-summary`: `attentionItems`, tres carriles `Entender` / `Ejecutar` / `Entregar` y acciones rápidas, manteniendo `cards` como fallback temporal.
- `AgentWorkspaceHome` reemplaza las cuatro tarjetas/acordeones por una superficie de control compacta: header del workspace, franja `Atención`, filas navegables de un click, acciones secundarias visibles y detalle lateral/inline sin cambiar contratos REST/WS.
- `Entregar` integra DOCX y plantillas como preparación/formato, mientras `Ejecutar` integra runtimes y clientes MCP; los badges DOCX, PDF compartido/en cola, estado MCP y ejecuciones activas alimentan primero la franja de atención.
- `AgentWorkspaceHome.css` baja la saturación visual: elimina gradientes decorativos/tarjetas anidadas, usa radios contenidos, acentos por borde/dot/badge y mantiene scroll local responsivo para móvil, tablet y desktop ancho.

## 2026-05-03 - Apertura por aplicación por defecto

- `FileExplorer` agrega una acción contextual para abrir archivos con la aplicación por defecto del sistema operativo, sin mostrarla en directorios.
- `App.js` centraliza la apertura: en Desktop usa `window.inspyroDesktop.openPath(path)` y en modo web local degrada a `POST /api/files/open-default`.
- Cuando `/api/files/read` no puede cargar un archivo en el editor interno, la superficie central muestra el nombre, el motivo y un botón explícito para abrirlo con la aplicación por defecto, sin crear una tab editable falsa.

## 2026-05-03 - Entradas nativas desde Electron

- `App.js` consume acciones `open-native-file` enviadas por `desktop/main.js` cuando Windows abre `.ipynb`, `.py` o `.inspyro` mediante asociación de archivo.
- Si el archivo pertenece al workspace activo, el shell lo abre con `openWorkspaceResource`; si pertenece a otro árbol, toma la carpeta padre como workspace y reutiliza el flujo existente de `postWorkspaceAction.openFilePath`.
- Los deep links `inspyro://` quedan recibidos como acción shell-owned informativa hasta que exista una semántica pública estable para rutas internas.

## 2026-05-02 - Iconos SVG híbridos para archivos

- `ExplorerFileIcon` conserva su API pública y pasa a usar una gramática SVG común: base de documento translúcida, pictograma mínimo y paleta suave por familia de extensión.
- Las carpetas reducen el amarillo saturado y adoptan rellenos ámbar apagados con contornos ligeros; los iconos de archivo evitan logos pesados en favor de figuras representativas.
- `FileExplorer` y `FileTabs` comparten el mismo resultado visual, con sombras reducidas para bajar contaminación en el rail y en la franja de tabs sin tocar contratos ni lógica de filesystem.

## 2026-05-01 - Scrollbars Inspyro bajo hover

- `ScrollSurfaceManager` pasa a administrar overlays verticales y horizontales para `.scroll-surface`, con thumbs compartidos del sistema visual Inspyro.
- Las barras quedan ocultas en reposo y se revelan por hover, focus dentro de la sección, scroll activo o drag del thumb; el fallback nativo se tematiza para evitar barras claras del navegador.
- `PdfViewer`, Monaco y outputs del notebook quedan alineados con el mismo estándar visual sin cambiar layout shell-owned, persistencia ni contratos.

## 2026-05-01 - Pestañas de archivos integradas

- `FileTabs` deja de mantener un mapa local de emojis y reutiliza `ExplorerFileIcon`, alineando las pestañas abiertas con la iconografía SVG del explorador.
- La franja de tabs se rediseña como superficie integrada del shell: activa con acento azul sutil, inactivas silenciosas, indicador de cambios discreto y nombres largos truncados.
- Las acciones de cerrar y guardar todos pasan a botones SVG accesibles, sin modificar selección, cierre, guardado, drag/drop ni persistencia de archivos abiertos.

## 2026-05-01 - Notebook pegado al split del shell

- `App.css` elimina el padding de `.main-container` solo cuando contiene `.notebook-container`, evitando los márgenes negros alrededor de la sección de celdas.
- El panel de notebook deja de renderizarse como tarjeta redondeada; queda como superficie directa del split junto al explorer y el panel `Documento` / `Dependencias` / `Variables`.
- El carril de resize interno del modo notebook se estrecha para seguir siendo operable sin leerse como una franja lateral decorativa.

## 2026-05-01 - Terminales documentales no mantienen loaders vivos

- `App.js` entrega un callback estable a `NotebookEditor` para cambios de ejecución pendiente, evitando que renders normales del shell activen cleanup de unmount dentro del editor.
- `notebook_progress_update` documental solo alimenta `documentPipelineStatus` mientras el estado sea activo; los terminales posteriores a `notebook_pdf_ready` limpian conversión en vez de reabrir Home/Documento como `running`.
- `DocxViewer` ignora `documentPipelineStatus` terminal al derivar `effectiveConversionStatus`, por lo que `completed`/`failed` no vuelven a mostrar spinner ni aviso de generación.

## 2026-05-01 - Home filtra recursos internos y abre entregables reales

- `GET /api/system/home-summary` clasifica notebooks por rol de workspace, excluye recursos internos/generados de `_agent_runs`, `.inspyro`, `Docx_Documents`, demos/smoke y rutas fuera del workspace, y deja esos contadores visibles como metadata de scan sin alimentar CTAs principales.
- `buildWorkspaceHomeData()` usa la lista filtrada para `Entender -> Ejecutar -> Entregar`: `Notebooks` inicia colapsada, `Plantillas` muestra solo templates adjuntos, `DOCX` omite artefactos vacíos y separa `Abrir DOCX`, `Preparar entrega` y `Abrir origen`.
- `Abrir DOCX` intenta abrir la copia persistida con `window.inspyroDesktop.openPath(workspace_path)` y degrada a descarga HTTP por `artifact_id`/token/source antes de abrir el notebook origen.
- `Ir a archivos` siempre cambia a `workspaceSurface='file'` y expande el explorer aunque no haya tabs abiertas; abrir notebooks desde Home persiste snapshots runtime como cambio programático para no fabricar `DIRTY`.
- El flujo de plantillas desde Home usa estado `Cargando plantilla...` mientras se reatacha el espejo persistido y estabiliza los efectos de `TemplateEditorContainer` para evitar loops de actualización cuando `templateInfo` aún no llegó.

## 2026-04-30 - Separadores con preview imperativo

- `App.js` conserva los defaults y límites de ancho existentes, pero durante drag de mouse aplica el preview directamente sobre el DOM de explorer, editor/notebook y `VisualizationPanel`.
- El estado React (`explorerWidthPx`, `codePanelWidth`, `notebookPanelWidth`) se confirma solo al soltar el separador; el resize por teclado sigue siendo inmediato para accesibilidad.
- `Resizer` mantiene su visual y contrato público, usando `requestAnimationFrame` para agrupar deltas y callbacks `onResizeStart`/`onResizeEnd` para que el shell desactive transiciones y superficies pesadas mientras dura el drag.

## 2026-04-28 - Run All respeta celdas DOCX

- `App.js` centraliza helpers de tipo de celda y arma batches notebook con `cellType`, de modo que `Run All` shell-owned incluye celdas `docx` solo cuando DOCX/PDF está activo.
- Con DOCX/PDF apagado, el batch conserva las celdas `code`, omite `docx` y no emite `notebook_mdoc_clear`; el estado documental notebook-scoped y el último artefacto visible se preservan.
- El contexto de análisis/LSP del shell trata `docx` como Python para navegación, dependencias y ejecución, sin convertirlo en `markdown` ni degradarlo al guardar.

## 2026-04-28 - Hardening responsivo multi-superficie sin contratos nuevos

- `DesktopTitleBar` mantiene identidad, acciones contextuales, notificaciones, conexión y Agents en carriles que compactan, envuelven o truncan antes de solaparse; el área derecha deja de recortar overlays.
- `NotificationCenter` abre su dropdown desde un portal con posición fija y clamp al viewport, conservando click-outside y estado de lectura sin cambiar props ni ownership de navegación.
- `AgentWorkspaceHome`, `McpPanel`, `DocxViewer`, la superficie principal y el modo notebook reciben `min-width: 0`, scroll local y wrapping/truncado para rutas, URLs y controles largos; el Workbench DOCX también se puede abrir desde estados de DOCX descargable sin preview activa.
- Se agrega una suite Playwright `responsive-overlap` con matriz `393x852` a `1920x1080`, assertions de rectángulos dentro del viewport y pares críticos sin overlap.

## 2026-04-26 - Barrido visual shell-owned sin contratos nuevos

- `App.js` limpia targets de dependencias cuando cambia el `filePath` activo y deja prompts como `Selecciona un simbolo...` en estado inline, no como notificación persistente.
- `DesktopTitleBar`, `NotebookToolbar`, `NotificationCenter`, `McpStatusButton` y la Home compacta reciben reglas de overflow/truncado para evitar solapes entre titlebar, toolbar contextual, badges y nombres largos.
- `FileActionDialog` crea archivos/carpetas con `Nombre` vacío aunque haya un recurso seleccionado; `FileExplorer` y Quick Open muestran basename principal + ruta secundaria con ellipsis estable.
- `DocxViewer` separa `sin preview activa`, `DOCX histórico descargable` y `documento ausente`; `McpPanel` nombra su cierre y acciones icon-only para que el modal Agents no exponga botones anónimos.

## 2026-04-26 - Home refleja Run All shell-owned en vivo

- `buildWorkspaceHomeData()` fusiona el snapshot backend de `GET /api/system/home-summary` con `notebookSessionsByPath`: si una sesión local tiene `batchRunState` o `documentPipelineStatus` activo, Home la promueve como runtime `running` aunque el resumen backend todavía llegue `idle`.
- La tarjeta `Notebooks`, el meta superior y la etapa `Run` del journey usan ese overlay shell-owned para mostrar contadores y porcentaje por notebook en tiempo real durante tres `Run All` lanzados en rápida sucesión.
- El overlay conserva la misma semántica documental que el backend: si el notebook ya salió de la fase verde y espera/usa el convertidor PDF global, Home muestra `PDF en cola` o `PDF compartido` desde `shared_resource`.
- La regresión `App.notebookSessions.test.js` fija que tres corridas shell-owned aparezcan en Home como `3 activos` con filas y progreso propios, incluso cuando el payload backend no trae actividad vigente.

## 2026-04-25 - Workbench DOCX operativo

- `DocxViewer` evoluciona el rail `Calidad DOCX` a `Workbench DOCX`, con tabs densos para `Calidad`, `Visual`, `Revision`, `Publicacion`, `Campos` y `Diff`.
- El rail ejecuta operaciones bajo demanda contra `/api/docx/workbench/run`: analizar por perfil, refrescar `render_manifest`, renderizar página/todas las páginas, extraer comentarios/redlines, preparar entrega limpia, listar/envolver SDTs, reportar/flatten fields y comparar versiones.
- La pestaña `Visual` muestra estado `sin preparar/parcial/completo/error`, motor Word/LibreOffice, páginas cacheadas y acciones para renderizar o limpiar derivados visuales; consume handles `/api/docx/render/resource` y no PNG/base64 inline.
- `DocxViewer` prioriza `docx_render_status`/`docxRenderStatus` sobre estados genéricos de operación y solo notifica éxito de render cuando el Workbench devuelve un resultado válido; una falla REST o Workbench queda visible como error, no como falso OK.
- El historial DOCX permite elegir una versión de comparación para diff textual/visual y muestra badges de calidad/estado visual; los recursos generados se consumen por `resource_uri` y se descargan explícitamente, sin blobs inline durante el render normal.
- `AgentWorkspaceHome` cambia el CTA de DOCX a `Preparar entrega`: muestra último entregable, calidad/publicación/visual cuando existe cache y enfoca el Workbench sin disparar auditorías ni renders pesados al montar.
- El diseño se mantiene operativo y compacto: toolbar icon-only, badges por versión, rail lateral reutilizado y acciones explícitas por tab.

## 2026-04-24 - Calidad DOCX visible y accionable

- `DocxViewer` suma un control icon-only de `Calidad` en la toolbar y un rail derecho `Calidad DOCX` con score, conteos, secciones de auditoría, preview PNG por página, descarga de copia limpia y reintento.
- El estado documental canónico (`docxArtifacts.js` + `documentState`) ahora conserva `docxQualityStatus`, `docxQualityScore` y `docxQualityCounts`; `VisualizationPanel` los pasa al visor sin inventar estado local paralelo.
- `AgentWorkspaceHome` muestra el estado de calidad del último artefacto DOCX y ofrece `Revisar calidad`, que navega a `Documento` con `focus='quality'` para abrir directamente el rail en vez de abrir Word/Explorer. Desde 2026-04-25 el CTA visible pasa a `Preparar entrega` y abre el Workbench.
- La auditoría pesada sigue bajo demanda: el shell solo consume summaries cacheados y dispara `POST /api/docx/quality/run` cuando el usuario lo pide.

## 2026-04-22 - Colas notebook por socket y progreso documental visible en Home

- `useAppWebSocket` deja de recortar `notebookMessageQueue` como un buffer plano compartido: la retención ahora se preserva por bucket `socket/path`, manteniendo orden local y evitando que una ráfaga de notebook A evicte terminales o artefactos tardíos de notebook B.
- `App.js` endurece la hidratación del notebook activo: solo adopta `notebookData` cuando `notebookSyncState.path` coincide con la sesión activa, cerrando la contaminación cruzada entre tabs al alternar notebooks rápidos o volver desde `Home`.
- `documentPipelineStatus` permanece notebook-scoped fuera del editor visible y `AgentWorkspaceHome` pasa a reflejar `progress_scope=document + shared_resource`, con badges como `PDF en cola` o `PDF compartido` para notebooks ocultos que siguen esperando/ocupando el convertidor global.
- El inicio shell-owned de `Run All` ya no se aborta por `getNotebookConnectionStatus(path) !== 'connected'`: `sendNotebookMessage()` crea o reutiliza el `/ws/notebook` dedicado y encola `notebook_load`/`notebook_execute_cell` mientras conecta, evitando que tres tabs abiertas y ejecutadas en rápida sucesión pierdan los primeros arranques.
- `handleActiveNotebookKernelStateChange()` acepta el `filePath` reportado por `NotebookEditor` y actualiza esa sesión, no necesariamente la pestaña activa; esto evita que un sync tardío de kernel/progreso contamine otro notebook durante cambios rápidos de tab.

## 2026-04-21 - Shell como owner único del runtime notebook

- `App.js` pasa a ser la única fuente de verdad del runtime notebook por `path`: actualiza `runtimeNotebook` tanto para notebooks visibles como ocultos y deja de tratar el notebook visible como una excepción fuera del snapshot shell-owned.
- La sesión notebook separa ahora `runtimeVersion` de `editorHydrationToken`: el shell puede absorber mensajes runtime continuamente sin forzar rehidratación del editor activo en cada `stream`/`execute_result`/terminal.
- `processNotebookQueueMessage()` sigue resolviendo el destino notebook en el shell y, cuando el target está visible, reenvía además el mensaje ya ruteado a `NotebookEditor.consumeRemoteNotebookMessage()`; el editor deja de competir con un segundo resolvedor basado en `lastMessage`.
- El resultado buscado es que dos `Run All` en paralelo puedan alternar tabs rápido sin perder avance del notebook oculto ni dejar al visible pegado visualmente en la primera celda.

## 2026-04-20 - Logging frontend opt-in y shell documental más silencioso

- El shell introduce `frontend/src/utils/frontendLogger.js` como logger compartido: las trazas verbose quedan apagadas por defecto y solo se habilitan cuando `REACT_APP_INSPYRO_DEBUG=1`.
- `App.js`, `NotebookEditor`, `NotebookCell`, `useWebSocket`, `useAppWebSocket`, `useFileSystem` y el editor de template pasan a usar esa capa común para no inundar consola durante el flujo normal ni durante la suite frontend.
- `DocxViewer` deja de tratar como error duro los `404` esperables de historial DOCX, `pdf_ref` o manifiesto de procedencia cuando el artefacto remoto todavía no existe para la fuente activa; ahora hace fallback local limpio, diferencia “aún no disponible” de “falló la carga” y mantiene `console.error` solo para fallas reales.
- `PdfViewer` mueve `pdfjs-dist/webpack` a carga bajo demanda y `DocxViewer` hace lo mismo con `mammoth`, reduciendo el costo inicial del shell cuando el usuario no abre la pestaña `Documento`.

## 2026-04-20 - Aislamiento total por notebook

- `useAppWebSocket` expone ahora dos planos de transporte: `/ws` global para shell/MCP/`.py` y un pool `/ws/notebook` con un socket por notebook abierto, más `sendNotebookMessage()` / `getNotebookConnectionStatus()` / `getNotebookLastMessage()`.

- `App.js` procesa `notebookMessageQueue` con metadata del entry (`path`/`socketKey`) y resuelve destino notebook con prioridad determinista `payload source_path/notebook_path/path -> entry.path del socket /ws/notebook -> execution_id -> kernel_id`; `entry.path` no se usa para eventos globales ni para MCP.

- El shell separa además los cursores internos de la cola global y de la cola notebook dedicada, evitando que el cambio de fuente de mensajes salte entradas notebook válidas o deje sesiones ocultas pegadas en loops de `waiting_kernel`/recovery.

- El shell ya no omite la actualización de `runtimeNotebook` cuando el target está visible: toda mutación runtime entra al snapshot shell-owned y el editor activo la consume por relay explícito en vez de depender de rehidratación continua por props.

- `App.js` deja de mantener `templateInfo`, `templateBlob` y `templateOpenRequest` como estado shell-global. Desde ahora esos campos viven dentro de `notebookSessionsByPath`, junto con `lastTemplateAttach`, y solo la sesión notebook dueña puede reatachar o abrir su plantilla.

- `useTemplateMessageHandler` pasó a ser notebook-aware: resuelve destino por `kernel_id` / `request_id` / `path` y actualiza solo la sesión propietaria, incluso cuando el notebook está oculto.

- `VisualizationPanel` y `DocxViewer` reciben la plantilla desde la sesión notebook activa, mientras `NotebookEditor` consume `connectionStatus`/`sendMessage` del socket notebook dedicado y usa `lastMessage` solo como fallback; el camino primario del runtime visible pasa a ser el relay shell-owned.

## 2026-04-19 - Índice de Notebook como sección lateral

- `App.js` documenta ownership explícito sobre una sección `Índice de Notebook` frontend-local cuando la pestaña activa es `.ipynb`; el rail izquierdo deja de ser solo árbol de archivos y pasa a ofrecer secciones laterales separadas para `filesystem` y `estructura navegable del notebook activo`.
- El índice no relee el `.ipynb` ni inspecciona el DOM del editor: se deriva desde la misma sesión shell-owned por `path` (`runtimeNotebook` o snapshot persistible vigente) que usa `NotebookEditor`, por lo que sobrevive a `home`, cambios de tab y remounts del editor.
- La navegación también queda shell-owned: un click del índice reactiva el recurso correcto si hace falta y delega el salto fino a `NotebookEditor` mediante `navigateToCode()` / `focusCell()`, reutilizando ids estables de celda y sin abrir contratos WS/REST nuevos.

## 2026-04-19 - Runtime persistente por archivo/tab

- `App.js` pasa a ser owner del runtime por recurso: conserva sesiones notebook por `path` (`kernelState + documentState`) y estado `.py` por archivo (`run_id + output + documentState`) aunque el editor activo se desmonte.
- Ir a `home`, cambiar de tab, abrir otro archivo o volver desde la home ya no cancela kernels ni jobs `.py`; el shell solo oculta la superficie visible y preserva draft + runtime por tab.
- Cerrar una tab running sí dispara la acción explícita correspondiente: `notebook_shutdown_kernel` para notebooks y `cancel_code_execution` para `.py`, sin afectar otros tabs.
- `App.js` conserva también `runtimeNotebook`, progreso batch y estado de ejecución por notebook; mientras `NotebookEditor` está oculto, el shell sigue aplicando `notebook_stream`, `notebook_cell_executed`, mutaciones de celdas y progreso de documento sobre esa sesión shell-owned.
- Cuando llegan mensajes notebook sin `path` explícito durante corridas paralelas desfasadas, `App.js` puede rehidratar la sesión oculta correcta usando `execution_id` shell-owned como fallback de correlación, evitando que un notebook hidden quede “pegado” esperando streams o terminales de otra sesión.
- Al reactivar una tab notebook con `kernel_id` ya conocido dentro de la misma sesión renderer/WS, `App.js` reutiliza la sesión local por `path` y `NotebookEditor` se rehidrata desde `initialKernelId` + snapshot local sin crear un kernel nuevo; `notebook_attach_kernel` queda reservado a recovery explícito o reconexión real.
- `Run All` deja de depender del mount continuo del editor: la secuencia batch vive en la sesión shell-owned y puede seguir avanzando aunque el usuario esté en `Home`.
- El shell se beneficia ahora de un transporte documental notebook-first más liviano: si el backend ya tiene `docx_ref` / `pdf_ref` estable, `App.js` no debería recibir blobs DOCX/PDF inline por WS para ese flujo, reduciendo fricción entre notebooks paralelos sobre la misma conexión.
- `App.js` es el owner del batch visible de `Run All`: conserva `batchRunState` por `path`, decide qué corrida sigue activa tras navegación/remounts y resuelve el cierre shell-owned de la corrida aun cuando el editor ya no esté montado.
- El arranque de kernel para `Run All` queda correlacionado por `request_id` shell-owned: `App.js` registra cada `notebook_load`/`notebook_attach_kernel`, promueve `waiting_kernel` por lifecycle ack, por señales de ejecución válidas o por `kernelId` reportado por el editor cuando esa señal no corresponde a un `load` nuevo todavía pendiente.
- `waiting_kernel` ya no puede quedar colgado indefinidamente: `App.js` arma un timeout shell-owned alineado con el editor, falla visible si no aparece evidencia de kernel listo y evita doble dispatch de la primera celda dejando `queued -> running` bajo un único auto-dispatcher.
- La tarjeta principal de Home consume `notebook_runtime_items + code_runtime_items + template_inventory`, mezclando runtimes vivos con notebooks descubiertos del workspace para no quedar vacía cuando todavía no hay ejecución activa.

## 2026-04-19 - Home compacta shell-owned y orientada a origen

- `App.js` agrega `homeSummary` como estado canónico de Inicio, lo hidrata con `GET /api/system/home-summary` y hace polling solo mientras `workspaceSurface === 'home'`, con refresh extra en `focus`, `online` y `visibilitychange`.
- `AgentWorkspaceHome` deja de armar su contenido principal desde `templateInfo`, `docxHistoryEntries` o el estado montado de `NotebookEditor`; consume `workspaceData` agregado y deriva un bloque persistente `Entender -> Ejecutar -> Entregar`. Esa primera iteración usaba secciones fijas por origen; desde 2026-05-03 el render vigente se expresa como centro operativo con `Atención` y carriles.
- La home usa `summary.overview` como capa de copy/contadores y `template_inventory` como inventario canónico de notebooks del workspace; si `notebook_runtime_items` llega vacío, la tarjeta `Notebooks` sigue mostrando notebooks descubiertos y ofrece `Ir a archivos` solo como fallback.
- La home navega solo por acciones explícitas: las tarjetas expanden/colapsan, las filas primero revelan detalle y luego navegan, DOCX separa `Abrir DOCX` de `Abrir origen`, clientes MCP abren `Agents` filtrado por cliente y `Plantillas` abre el editor de template reatachado.
- El shell abre DOCX persistidos del proyecto con `window.inspyroDesktop.openPath(workspace_path)` cuando existe `workspace_path`; si no hay copia materializada dentro del workspace, degrada al flujo HTTP/blob existente.
- Al abrir un template desde home, `App.js` tokeniza el espejo persistido (`POST /api/templates/tokenize`) y reatacha ese template al kernel antes de disparar la apertura del editor, evitando depender de `template_token` efímeros del upload original; mientras carga, el editor muestra `Cargando plantilla...`.

## 2026-04-19 - App como owner de navegación de notificaciones

- `App.js` documenta ahora ownership explícito sobre la cola visible de notificaciones: normaliza `title/message/type/progress`, deduplica por `id`, decide descarte global y arbitra la convivencia entre feed interno y notificaciones nativas desktop.
- La metadata opcional `target` se resuelve en el shell, no en `NotificationCenter`: la navegación real hacia `home`, `file`, notebook/celda, documento, template o panel `Agents` depende de helpers de `App.js` (`openWorkspaceResource`, `handleNavigateToCode`, `focusDocxView`, `setWorkspaceSurface`, etc.).
- La semántica de click deja de tratar todas las cards igual: una entrada con `target` puede actuar como CTA navegable del shell; una entrada larga sin destino usa expansión inline dentro del feed; botones de acción y dismiss conservan semántica aislada.
- Las notificaciones de `Run All` también quedan shell-owned: `App.js` decide cuándo publicar `Run All completado` / `Run All fallido` / `Notebook interrumpido`, evitando depender del ciclo de vida visual de `NotebookEditor` para cerrar o anunciar la corrida batch.

## Template editor Word-first (2026-04-19)

- `TemplateEditorContainer` mantiene ahora dos capas separadas: `style_browser` para navegar/editar estilos Word reales y una banda de `semantic_style_slots` persistidos como contrato runtime.
- El shell ya no exporta ni rehidrata `category_overrides` como estado de negocio; el JSON portable usa `schema_version=1.1` con `semantic_style_slots`, manteniendo compatibilidad de import con `category_overrides` legacy.
- `useTemplateMessageHandler` rehidrata también `template_semantic_slots_updated`, permitiendo que el editor y el shell converjan sobre el mismo template reflejado sin `template_get` extra.

## 2026-04-19 - Apertura directa de dependencias y teardown global seguro de `pdf.js`

- `VisualizationPanel` ya no arranca siempre en `docx`: si entra con `dependencyTarget` activo, inicializa directamente la pestaña `dependencies` y evita montar transitoriamente `DocxViewer`/`PdfViewer` antes del auto-switch.
- `PdfViewer` endurece el lifecycle entre instancias: el teardown global de `PDFDocumentLoadingTask`/`PDFDocumentProxy` se serializa antes de nuevos `getDocument(...)`, cerrando la carrera `PDFWorker.fromPort - the worker is being destroyed` incluso cuando el visor anterior se desmonta en otro subtree del shell.
- Se agregan regresiones frontend dedicadas para fijar ambos casos: apertura del panel de dependencias sin visibilidad inicial del documento y espera explícita del destroy previo antes de reabrir otro PDF.

## 2026-04-18 - Reposicionamiento open source y launcher agent-first

- `ProjectLauncher` deja de ser un simple selector de workspace: pasa a una pantalla de misión English-first con tres entradas fijas (`Start with Agent`, `Start from example`, `Open project`) y copy pública alineada al posicionamiento "AI-native engineering workspace".
- `App.js` agrega siembra reproducible del demo canónico open source: crea un workspace nuevo, materializa archivos del ejemplo estructural, abre `beam_report.ipynb` y puede arrancar la superficie visible de agentes sin introducir contratos nuevos.
- `DesktopTitleBar` abandona el branding basado solo en `🐍`: ahora usa wordmark + brand mark, mantiene una franja de misión (`Understand the project`, `Run calculations`, `Ship reports`) cuando no hay archivo contextual y deja las acciones notebook/código como slot operativo secundario.
- `McpStatusButton` y `McpPanel` siguen consumiendo el backend MCP actual, pero la superficie visible del producto pasa a presentarse como `Agents` y `Agent Mirror`/`Live Agent View`; MCP queda explícito solo como protocolo subyacente o detalle técnico.

## 2026-04-18 - Workspace agent-first persistente con `home` y `file`

- `App.js` introduce un estado frontend-local `workspaceSurface: 'home' | 'file'` para separar la home persistente del workspace y la superficie puntual de archivos.
- Cuando existe `active_workspace`, el shell aterriza por defecto en `Agent Workspace Home`; `ProjectLauncher` solo aparece cuando todavía no hay workspace activo.
- `AgentWorkspaceHome` reutiliza estado ya existente del shell (`workspaceSession`, `openFiles`, `activeFile`, `mcpStatus`, `activity`, `activeRuns`, `mirrorEnabled`, `agentExecutionState`, `docxHistoryEntries`, `templateInfo`) y no introduce contratos públicos nuevos.
- Esa primera etapa quedó superada: desde 2026-04-19 la home ya usa `GET /api/system/home-summary` y el shell conserva runtimes por tab/path fuera del mount del editor.
- `Entender -> Ejecutar -> Entregar` se convierte en el loop visible central del producto: el home resume proyecto, estado de agentes, runs, plantillas y artefactos, mientras notebooks, explorer y tabs quedan como herramientas secundarias.
- `McpPanel` permanece como inspector avanzado, pero la superficie central de agentes se desplaza al home; `mcp_mirror_event` ya no debe robar el foco hacia archivos mientras el usuario permanece en `home`.
- No hay cambios de contratos WS/REST/MCP en esta etapa: el ajuste es solo de composición frontend, jerarquía visual y navegación interna.

## 2026-04-18 - Header único con acciones contextuales del archivo

- `DesktopTitleBar` deja de renderizar una jerarquía de dos niveles: ahora usa una sola barra superior con branding a la izquierda, acciones contextuales del archivo activo al centro y `NotificationCenter` + estado de conexión + `McpStatusButton` a la derecha.
- La tarjeta del proyecto activo y las pills `Notebook` / `Kernel ...` desaparecen del header; en notebook, el único indicador visible del runtime pasa a ser el `kernel-indicator` interno de `NotebookToolbar`.
- `App.js` deja de pasar `currentWorkspace`, `activeFile` y `notebookKernelState` al title bar solo para presentación; el shell conserva el mismo wiring de acciones notebook/código, pero la decisión visual del slot contextual queda reducida a `hasContextualFile + mode + notebookToolbarProps`.
- `NotebookToolbar.css` se endurece para vivir dentro del slot central del header: conserva el orden actual de acciones, evita recrear una subbarra dedicada y degrada mediante overflow horizontal cuando el ancho útil del shell se reduce.

## 2026-04-18 - Recuperación tardía de procedencia DOCX desde `notebook_pdf_ready`

- `App.js` endurece el merge documental tardío: un `notebook_pdf_ready` que llegue sin `notebook_docx_update` previo ya no pierde `docx_artifact_id`, `docx_provenance_ref`, `docx_provenance_available`, `docx_hash` ni `source_path/source_kind`.
- `docxArtifacts.js` deja de nullear metadata DOCX vigente cuando el payload tardío solo trae un subconjunto de claves; si llega `docx_artifact_id` sin `docx_provenance_ref`, deriva el manifiesto estable desde `/api/docx/provenance?artifact_id=...`.
- `DocxViewer` suma trazas de desarrollo sobre el pipeline de click (`manifest loaded -> provenance summary -> link clicked -> item resolved -> navigation target/result`) para diagnosticar drift entre PDF visible, manifiesto y navegación real sin volver a tocar el DOCX descargable.
- Cuando el PDF pertenece a una libreta `.ipynb` distinta del archivo activo, el shell abre primero ese notebook y delega la navegación real a `NotebookEditor`, preservando `Modo origen` aun si la metadata DOCX llegó tarde.

## 2026-04-18 - Estado documental canónico, rail exacto y apertura DOCX de proyecto

- `docxArtifacts.js` pasa a concentrar el merge canónico del estado documental (`applyDocumentStatePayload`, `applyDocxArtifactPayload`, `applyPdfArtifactPayload`, `createEmptyDocumentState`) para que `App.js` y `useAppWebSocket` no reconstruyan formas distintas del mismo documento.
- `App.js` deja de compartir un único `currentDocxHistory/currentDocxSourcePath` entre editor y notebook: ahora mantiene bundles separados `documentState/documentActions` por superficie y filtra historial local/remoto por origen real del documento, reduciendo drift entre archivo activo y artefactos tardíos; `useAppWebSocket` ya no es owner del documento notebook.
- `VisualizationPanel` deja de aceptar la API flatten legacy de DOCX/PDF y consume únicamente esos bloques `documentState` + `documentActions`, manteniendo la UX pública del shell.
- `DocxViewer` reemplaza el dropdown del índice por un rail lateral izquierdo tipo Chrome: en ancho `>= 1100px` queda docked, debajo de ese breakpoint pasa a overlay, se cierra al seleccionar una sección y, en overlay, abrir el índice cierra el rail de procedencia para no dejar el PDF ilegible.
- El índice ya no vive solo por página: `PdfViewer` resuelve destino exacto de cada bookmark (`destinationKey`, `anchorTopRatio`) y `DocxViewer` usa esos datos para navegar al bookmark real y para derivar la sección activa aun cuando varias entradas compartan la misma página.
- `PdfViewer` elimina código muerto local (`pageRefs`) y `DocxViewer` unifica el reset del lector PDF para no duplicar limpieza de `currentPage`, `outline`, `zoom`, `fitMode` y selección de procedencia entre swaps de documento.
- Cuando backend publica `workspace_path/workspace_relpath`, el botón principal `DOCX` abre el archivo persistido de `Docx_Documents` vía `window.inspyroDesktop.openPath(path)` en desktop; en web o ante degradación sigue usando descarga `fetch -> blob` desde la copia persistida más fresca.

## 2026-04-17 - Procedencia PDF exacta-first y resolución puntual

- `DocxViewer` deja de navegar por default al `callsite` cuando el usuario hace click en `Modo origen`: ahora prioriza `exact` y solo cae a `callsite` si la navegación exacta no existe o falla.
- Si el `provenance_id` clicado no está en el manifiesto ya cargado, el shell ya no muestra el warning inmediatamente; reconsulta la procedencia puntual contra `/api/docx/provenance/open?format=json`, injerta ese fragmento en el manifiesto local y recién entonces navega.
- Esa reconsulta puntual ya no confía en el host/puerto absoluto incrustado en el PDF: si el hyperlink fue horneado con `127.0.0.1:8000` pero la app actual corre contra otro backend/origen, `DocxViewer` reescribe `/api/docx/provenance/open` hacia `API_BASE` antes de abrir o resolver la procedencia.
- El visor ya no depende ciegamente del `provenanceId` precocinado por el overlay del PDF: si ese campo no viene pero el URL sí contiene `provenance_id`, `DocxViewer` lo deriva del hyperlink y sigue el flujo normal de resolución puntual.
- Cuando la procedencia solo trae `notebook_cell_id`, `DocxViewer` completa el target con `sourcePath` del documento y `App.js` pasa a soportar explícitamente el flujo “abrir notebook -> navegar a celda”, en vez de tratar esa navegación como si fuera un archivo de código plano.
- Las fallas del resolver dejan trazas internas clasificadas (`resolver_404`, `missing_manifest_item`, `missing_navigation_target`, con contexto `stale_origin` cuando corresponde) para distinguir drift de origen, manifiesto stale o destino no navegable sin cambiar el mensaje corto visible al usuario.
- Esto elimina el caso degradado donde el PDF visible y el manifiesto DOCX quedaban desalineados por una generación distinta, o donde el hyperlink viejo seguía apuntando a un backend ya inexistente, y terminaba en “No se pudo resolver la procedencia del fragmento seleccionado.” aun cuando el `provenance_id` seguía siendo válido.

## 2026-04-15 - Reparación robusta del loop de callbacks y montaje visible-only

- `PdfViewer` deja de reiniciar la carga por cambios de identidad de callbacks del padre: la recarga depende solo de la fuente real del PDF y la publicación de metadata/página usa refs estables, evitando el loop `PdfViewer -> DocxViewer -> PdfViewer` que provocaba flashes grises y el error de `pdf.js` `Cannot resolve callback`.
- `DocxViewer` conserva el ownership local del estado UX del lector (`currentPage`, `requestedPage`, `zoomPercent`, `fitMode`, `outline`) y mantiene el modelo `visible-only`: la vista se monta de nuevo solo cuando `Documento` está realmente visible, reinyecta la página solicitada y conserva la página actual sin reseteos innecesarios.
- El swap de documento pasa a ser `without blanking`: el PDF anterior se mantiene visible mientras el nuevo se carga y solo se promueve el documento nuevo cuando el commit está listo, evitando el parpadeo rápido de la hoja y la pantalla negra intermedia.
- `PdfViewer` endurece el teardown con generación explícita y drenaje de tareas async: `getDocument`, `getPage`, `getOutline`, `getAnnotations` y renders quedan atados a la generación activa, y el `destroy()` solo ocurre una vez que esa generación queda invalidada y sus tareas fueron limpiadas.
- `VisualizationPanel` sigue manteniendo `DocxViewer` montado para conservar el estado UX, pero `PdfViewer` no permanece vivo dentro de un contenedor oculto; la vista vuelve a montar el PDF solo cuando `Documento` está visible de verdad.
- `App.js` sigue revalidando `/pdf-status` al conectar, al volver a mostrar `Documento` y al reintentar PDF en notebook para no dejar stale el estado contextual del convertidor.

## 2026-04-13 - Estado documental separado de la corrida del notebook

- `App.js` agrega `documentPipelineStatus` al estado notebook y lo propaga a `VisualizationPanel` / `DocxViewer` sin mezclarlo con el terminal de ejecución.
- `VisualizationPanel` y `DocxViewer` consumen ese estado estructurado para mostrar mensajes/spinners contextuales de documento, mientras el rail principal vive arriba en `NotebookEditor`.
- El shell conserva la semántica de notificaciones: `Run All completado` / `Notebook interrumpido` describen la fase verde; `Documento listo` / `Error generando documento` describen la fase roja.

## 2026-04-14 - `DocxViewer` descarta previews PDF stale al cambiar de generación

- `DocxViewer` ya no conserva el `pdfBlobUrl` anterior cuando entra una generación DOCX nueva que todavía no publicó `pdf_ref` ni `pdfBase64`; el visor limpia la preview vieja y vuelve a mostrar el estado documental actual.
- Si un `pdf_ref` temporal responde `404` o un token ya expiró, el shell deja de pasar esa URL muerta directo a `pdf.js`; ahora la trata como error de carga local, muestra retry y evita el `MissingPDFException` visible para el usuario.
- Esto mantiene alineados el panel `Documento` y el coordinador latest-wins: un DOCX nuevo no puede seguir mostrando ni reutilizando el PDF temporal de una generación anterior.

## 2026-04-08 - Descarga DOCX revalida history/latest sin caché

- `DocxViewer` deja de usar `fetch()` cacheable para `GET /api/docx/history` y para el botón principal `DOCX`; ambas rutas se consumen ahora con `cache: "no-store"`.
- El shell sigue priorizando la entrada más fresca entre `payload vivo + historial fusionado`, pero ahora vuelve a rehidratar historial remoto cuando cambia `docxUpdatedAt` o cuando llega un `pdf_ref`/`pdf_hash` nuevo del mismo notebook.
- Esto cubre el caso degradado donde la preview PDF sí se actualiza, pero la metadata DOCX en memoria todavía no; el botón `DOCX` puede recuperar la última versión real desde historial remoto sin depender de un refresh manual o de cambiar de pestaña.

## 2026-04-10 - `Modo origen` en Documento

- `App.js`, `useAppWebSocket`, `NotebookEditor` y `docxArtifacts.js` propagan ahora `docx_provenance_available`/`docx_provenance_ref` tanto en estado vivo como en historial fusionado.
- `VisualizationPanel` pasa `onNavigateToCode` a `DocxViewer`, reutilizando el pipeline existente de navegación a archivo/celda/línea desde el shell.
- `DocxViewer` sustituye el `iframe` PDF por un visor controlado con `PdfViewer.js` (`pdfjs-dist` directo): render canvas por página, overlay de annotations y toggle `Modo origen`.
- `PdfViewer.js` serializa ahora el teardown de `PDFDocumentLoadingTask` / `PDFDocumentProxy` antes de abrir un PDF nuevo, evitando la carrera `PDFWorker.fromPort - the worker is being destroyed` cuando el shell cambia rápido de documento o rehidrata una preview PDF más fresca.
- Cuando `Modo origen` está activo y el PDF trae links de procedencia, el shell navega primero a `exact` si existe, cae a `callsite` solo como degradación y abre un rail derecho persistente con `callsite`, `exact`, `api_name`, `precision`, `text_preview` y `user_stack` sin tapar el documento.

## Historial DOCX vacío visible pero no promocionado (2026-03-27)

- `DocxViewer` sigue mostrando en el historial versiones DOCX clasificadas como vacías (`docx_is_empty=true`), pero las marca con warning visual y deja de considerarlas candidatas para el botón principal `DOCX`.
- Si el usuario descarga explícitamente una de esas versiones desde historial, la UI mantiene la descarga pero avisa que se trata de un DOCX vacío referencial.
- El payload runtime vacío ya no reemplaza el estado vivo del último documento válido, porque el shell solo promueve artefactos con identidad estable real y no vacíos.

## Entradas y salidas contractuales

> **Nota:** `workspaceSurface` sigue siendo frontend-local, pero la home ya consume contratos REST públicos adicionales (`/api/system/home-summary`, `/api/templates/tokenize`) y reutiliza `/api/mcp/restart` / `/api/mcp/client-heartbeat` a través del summary backend.

### Entradas
- REST de sistema (`/api/system/info`, `/api/system/workspace`, `/api/system/workspace/create`).
- REST de home compacta (`/api/system/home-summary`).
- REST de archivos (`/api/files/*`).
- REST MCP de hidratación (`GET /api/mcp/activity`).
- REST DOCX de hidratación/descarga (`GET /api/docx/history`, `GET /api/docx/download`).
- REST auxiliar de template persistido (`POST /api/templates/tokenize`).
- Mensajes WS recibidos por `useAppWebSocket` y `lastMessage`, incluyendo `notebook_attached`, `execution_started`, `mcp_activity_event`, `mcp_mirror_event` y `workspace_fs_event`; el shell consume `mcp_activity_event` como feed y aplica `mcp_mirror_event` solo cuando el modo espejo está habilitado, sin autoenfocar archivos desde `home`.

### Salidas
- Requests WS de alto nivel (`notebook_create`, `notebook_load`, `notebook_attach_kernel`, `execute_code`, `cancel_code_execution`, `clear_mdoc`, `force_reconvert_pdf`, `template_upload`, `template_attach`, `template_update_document_defaults` vía Template Editor).
- Upload REST de template (`POST /api/templates/upload`) como ruta preferida para archivos grandes.
- Requests de control de sesión/latencia desde `NotebookEditor` integrado (`notebook_cancel_execution`, `notebook_shutdown_kernel`, `template_preview_cancel`).
- Propagación de callbacks a componentes hijos (`NotebookEditor`, `VisualizationPanel`, `NotificationCenter`).
- Limpieza centralizada del estado runtime de visualización notebook cuando el editor solicita borrar outputs locales.
- Notificaciones externas normalizadas y feed de agentes visible en `McpPanel` y en la home persistente.
- Cola visible de notificaciones administrada por `App.js`, incluyendo `target` metadata opcional y resolución de navegación explícita entre `workspaceSurface='home'|'file'`, documento, template y agentes.
- Branding desktop-aware en `DesktopTitleBar` con brand mark + wordmark + franja de misión, y estado de disponibilidad PDF mostrado de forma contextual en `DocxViewer`, en vez de quedar anclado como badge permanente del header global.
- Feed de agentes visible y operativo (`activity`, `activeRuns`, badges, notificaciones, `agentExecutionState`) con `Agent Mirror` persistido en `localStorage`, default `OFF` si no existe preferencia previa, toggle manual habilitado y autoactivación al iniciar o reiniciar la sesión de agentes desde la UI.
- Activación de tabs ya abiertos desde caché local del shell; `reloadFile` y `reloadFileByPath` quedan como las rutas explícitas que vuelven a leer contenido desde backend.
- Flujos de archivo controlados por diálogo/menú contextual (`create`/`rename`/`delete`/`move`/`copy`/`duplicate`) dentro de `FileExplorer`, evitando prompts nativos fuera del control del shell.
- Sección `Índice de Notebook` shell-owned en el rail lateral, reutilizando el pipeline `open file -> activate tab -> navigateToCode/focusCell` para saltos estructurales dentro de la libreta activa.
- Aplicación de `workspace_fs_event`: recarga tabs limpios en background, marca conflictos en tabs dirty y reinyecta el batch hacia `FileExplorer` para refresco granular del árbol.
- `useFileSystem` expone además el origen de `notebookData` (`runtime` vs `persistable`) para que `NotebookEditor` no tenga que adivinar si un prop nuevo vino de carga/snapshot o de una edición humana ya aceptada por el shell.

## Iconografía del explorer

- `FileExplorer` usa iconos SVG temáticos por extensión o familia de archivo, priorizando silueta visible a tamaño pequeño por sobre detalle interno fino.
- Carpetas: icono dedicado amarillo para estado cerrado/abierto.
- Python: `.py`, `.pyi`.
- Notebook: `.ipynb`.
- PowerShell: `.ps1`, `.psm1`, `.psd1`.
- Shell: `.sh`, `.bash`, `.zsh`.
- JavaScript: `.js`.
- TypeScript: `.ts`.
- React: `.jsx`, `.tsx`.
- JSON: `.json`.
- Markdown: `.md`.
- Texto plano: `.txt`.
- Datos tabulares: `.csv`, `.tsv`.
- Configuración: `.yml`, `.yaml`, `.toml`, `.ini`, `.cfg`, `.conf`.
- Markup/vector: `.html`, `.xml`, `.svg`.
- Estilos: `.css`, `.scss`, `.less`.
- Word: `.docx`.
- PDF: `.pdf`.
- Imagen raster: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`.
- Logs: `.log`.
- Entorno: `.env`.
- Fallback genérico: cualquier extensión no mapeada usa un icono simple de documento.

## Dependencias y sinergias

### Upstream
- `03-file-system-api` para exploración/edición de archivos.
- `04-notebook-handlers` para ejecución notebook/template.
- `15-notification-center` para estado visible al usuario.
- `19-mcp-server` vía relay estructurado de actividad y espejo (`/api/mcp/activity*`, `/api/mcp/mirror-events`, `mcp_activity_event`, `mcp_mirror_event`); el shell hidrata feed siempre y aplica replay granular solo bajo `mirrorEnabled`.

### Downstream
- `11-notebook-editor-ui` y `13-monaco-editor` según archivo activo.
- `17-template-editor` en `VisualizationPanel`.

## Estado compartido y concurrencia

1. Estado global UI: `workspaceSurface`, tabs, archivo activo, paneles colapsables, estado de conexión y navegación persistente a `home`.
2. Estado de workspace: `currentWorkspace` visible en shell, sincronizado con `active_workspace` persistido por backend; cuando existe proyecto activo el shell entra en `Agent Workspace Home`, y solo cae a un launcher inicial agent-first cuando no hay workspace activo. `home` no depende de `localStorage` para rehidratar el arranque y su snapshot canónico vive en `homeSummary`.
3. Estado notebook compartido: kernel status, flags de ejecución, snapshot runtime notebook-shell-owned por `path`, datos de visualización y refs de artefactos (`docx_ref`/`pdf_ref`), con resolución de `pdf_ref` a URL backend y render embebido vía `blob`; el ruteo shell-owned de mensajes notebook prioriza `source_path/notebook_path/path`, luego `entry.path` del socket `/ws/notebook`, después `execution_id` y finalmente `kernel_id`, y los `artifact_update` de espejo limpian estados stale de conversión/error para que el visor no quede cargando indefinidamente.
4. Persistencia de template en frontend notebook-scoped (`templateInfo`, `templateBlob`, `templateOpenRequest`, `lastTemplateAttach`) dentro de `notebookSessionsByPath`, con reattach automático restringido a la sesión dueña.
5. Feed MCP en memoria (`activity`, `activeRuns`, `runningCount`) con `mirrorEnabled` persistido por el shell: si no hay preferencia previa arranca en `false`, el usuario puede alternarlo manualmente y las acciones UI `start/restart` de la superficie `Agents` lo fuerzan a `true`; en `home`, el replay solo actualiza contexto y no secuestra el foco central.
6. `useFileSystem` activa tabs ya abiertos desde `fileContentsRef` sin rereleer `/api/files/read`; las únicas recargas reales permitidas del shell quedan en `reloadFile`, `reloadFileByPath`, refresh manual del explorer y eventos externos de filesystem.
7. `templateInfo` y `templateBlob` siguen siendo source of truth frontend para template, pero ya no viven en un store shell-global: cada notebook mantiene su copia particionada por `path`, incluso cuando el cambio proviene de MCP o de un socket notebook oculto.
8. En desktop, `App.js` ya no es dueño del handshake de arranque del renderer: `index.js` emite `renderer_bootstrap_ready`, `RendererRoot` informa `renderer_app_ready` o `renderer_app_failed`, y `App.js` se limita a reportar el workspace real al shell, consumir `desktop:menu-action` y arbitrar qué eventos merecen notificación nativa además del `NotificationCenter`.
9. `visualizationViewRequest` permite forzar `VisualizationPanel` a `docx`, `dependencies` o `variables` sin remount del panel.
10. `Agent Workspace Home` consume `workspaceData` derivado de `homeSummary` (`notebook_runtime_items`, `code_runtime_items`, `runtime_items`, `recent_docx_items`, `mcp_service`, `mcp_clients`, `template_inventory`) como resumen operativo shell-owned del workspace, mientras `FileExplorer` y `FileTabs` pasan a rol secundario por defecto.
11. `mcp_mirror_event` no provoca apertura o foco automático de archivos cuando la superficie activa es `home`; cualquier salto a `file` requiere una acción explícita del usuario desde una CTA, un archivo o un artefacto.
12. `App.js` conserva `notebookSessionsByPath` y `codeExecutionStateByPath`; ese estado sobrevive a `workspaceSurface='home'`, a cambios de tab y a la apertura de otros archivos.
13. Cada sesión notebook separa `runtimeVersion` de `editorHydrationToken`: el primero registra mutaciones runtime shell-owned y el segundo solo fuerza rehidratación explícita del editor cuando realmente hace falta.
14. El ruteo notebook shell-owned usa primero `source_path/notebook_path/path` del payload, luego `entry.path` del socket `/ws/notebook`, después correlación por `execution_id` y al final por `kernel_id`; el objetivo es no descartar mensajes tempranos válidos solo porque todavía no traen `path` explícito.
15. La sección `Índice de Notebook` del rail lateral se deriva desde esa misma sesión por `path`; si cambia el snapshot activo, el shell debe regenerar la estructura y limpiar selecciones que hayan quedado apuntando a otra `.ipynb` o a una celda ya inexistente.
15. `useFileSystem` expone helpers path-based (`reloadFileByPath`, `renameOpenFile`, `removeOpenFile`) y caches de draft por `path`, permitiendo que el shell guarde o reabra tabs no activos sin depender del foco.
16. Cerrar una tab es la frontera de lifecycle: el shell corta solo el runtime asociado a ese recurso y deja intactos el resto de kernels/jobs activos.
17. `useFileSystem` mantiene también `externalStaleFiles` y `externalConflictFiles`, permitiendo que el shell y `FileExplorer` decoren cambios externos del filesystem sin sobrescribir ediciones locales.
18. Cola de notificaciones externas centralizada en `App.js`, combinando eventos legacy con eventos MCP estructurados.
19. `App.js` mantiene cursores separados para la cola WS global y la cola notebook dedicada; cambiar entre ambos orígenes no debe omitir mensajes pendientes ni rehidratar dos veces el mismo payload.
20. Coordinación de actualizaciones para evitar mezcla de respuestas de contextos distintos.
21. Autosave desacoplado: cambios runtime de outputs no disparan persistencia de notebook.
22. El merge de visualización notebook preserva `variables` cuando llegan actualizaciones posteriores de DOCX/PDF, evitando vaciar el panel de variables por sobrescritura parcial del payload.
23. `App.js` mantiene historial DOCX local transitorio por `source_path`, lo fusiona con `/api/docx/history` en `DocxViewer`, lo deduplica por identidad estable (`artifact_id || downloadUrl || docxHash`) y preserva `docx_artifact_id` + `docxUpdatedAt` en el estado vivo para arbitrar latest-wins por generación real.
22. `DocxViewer` filtra de la resolución latest-wins principal las entradas `docx_is_empty=true`, aunque sigan visibles en el menú de historial con su warning.
18. `DocxViewer` no infiere una conversión PDF activa solo porque exista DOCX estable o historial local/remoto; el overlay “Generando PDF...” y el aviso “PDF tardando...” se muestran únicamente ante señales explícitas de conversión/fetch PDF en curso, y una generación DOCX nueva limpia cualquier preview PDF stale si todavía no existe una fuente PDF vigente para esa misma corrida.
19. El botón `Plantilla` del visor DOCX sigue disponible aunque el toolbar entre al modo “documento/historial” por tener DOCX estable o historial local/remoto; si todavía no existe `kernelId`, el shell usa `onRequestKernelStart` para iniciar el kernel antes de abrir el modal.
20. El botón principal `DOCX` prioriza la entrada más fresca del conjunto `payload vivo + historial DOCX fusionado` (`/api/docx/history` + fallback local), salta entradas vacías y, cuando existe `workspace_path`, abre primero la copia persistida del proyecto; si esa ruta no existe o no puede abrirse, degrada a la descarga HTTP más fresca.
21. `templateInfo` que vive en el shell puede incluir ahora `default_font_source`, `system_font_catalog`, `resolved_font_source` por estilo y el bloque top-level `document_defaults`; `TemplateEditorContainer` usa esa metadata para pintar cards con la misma fuente efectiva del panel, hidratar `Documento (Global)` y advertir faltantes del host sin sustituir la familia real del template.
22. `useTemplateMessageHandler` rehidrata el shell tanto con `template_style_updated` como con `template_document_defaults_updated`, evitando un `template_get` extra después de editar defaults globales del documento.
23. `App.js` trata scrollbars y resizers como infraestructura compartida del shell: las superficies visibles usan `scroll-surface`, el runtime monta un manager de overlay scrollbar fuera de Monaco, los splits código/notebook miden contra refs del contenedor activo, el drag de mouse usa preview imperativo sin `setState` por frame y los handles reciben `data-testid` estable para E2E.
24. `App.js` deduplica los warnings de `workspace_fs_event` por archivo en conflicto: mientras un path siga dirty/conflicted, el `NotificationCenter` advierte una sola vez y limpia esa sesión de warning cuando el conflicto desaparece, se cierra el tab o el archivo vuelve a limpio.
25. El dirty notebook del shell deja de depender de inferencias implícitas: `setNotebookData(..., { origin })` diferencia cargas runtime, snapshots remotos y cambios persistibles locales antes de tocar `modifiedFiles`.
26. `FileExplorer` deduplica cargas concurrentes de la misma carpeta y deja de refrescar la raíz solo porque llegó un `workspace_fs_event` `modified` sobre un archivo; los refresh estructurales quedan reservados a cambios que alteran el árbol (`created`, `deleted`, `moved`) o a refresh manual explícito.
27. `DocxViewer` mantiene el estado del lector PDF dentro de la pestaña `Documento`; `App.js` no centraliza `currentPage`, `outline`, `requestedPage`, `zoomPercent` ni `fitMode`, pero sí revalida el estado contextual del convertidor cuando la vista vuelve a estar visible o el usuario reintenta la reconversión.
28. `DocxViewer` mantiene el estado UX aun cuando la pestaña `Documento` está oculta, pero suspende el montaje real de `PdfViewer` mientras `VisualizationPanel` no la muestre; así evita que `pdfjs` mida o rerenderice dentro de un contenedor con `display:none`.
29. `PdfViewer` expone metadata de documento y navegación (`onDocumentMetaChange`, `onCurrentPageChange`, `requestedPage`, `requestedLocation`, `zoomPercent`, `fitMode`) mientras conserva `onLinkActivate` para links externos/procedencia; los destinos internos del PDF se resuelven y consumen dentro del propio viewer con `destinationKey`/`anchorTopRatio`, y la carga solo se reabre cuando cambia la fuente real del PDF, no cuando cambia la identidad de callbacks del padre.

## Fallos frecuentes y observabilidad

### Fallos frecuentes
- Desincronización entre `activeFile` y callbacks de notebook.
- Rehidratación incompleta de template tras reinicio de kernel.
- Errores silenciosos de estado PDF si no se refresca `pdf-status`.
- Reintroducir replay MCP sin respetar el gate `mirrorEnabled` o sin preservar la activación desde caché volvería a amplificar aperturas y recargas redundantes.
- Activar un tab ya abierto mediante fetch en vez de caché vuelve a disparar `/api/files/read` y, combinado con refreshes del explorer, puede recrear ciclos de lectura.
- Drift entre tabs abiertos y mutaciones MCP por ruta (`write`/`rename`/`delete`) si los helpers path-based dejan de mantenerse alineados con `openFiles`/`activeFile`.
- Cancelar por error un runtime al navegar a `home` o al cambiar de tab si el shell deja de ser owner del lifecycle y vuelve a delegarlo al mount del editor.
- UI stale tras reciclado de backend/runtime si el WebSocket agota sus reintentos y el shell deja de refrescar estado MCP sin intervención manual.
- Workspace mostrado por `FileExplorer` desalineado respecto del workspace activo que reporta backend/MCP.
- Drift entre árbol de archivos, índice de notebook y libreta activa si `App.js` deja de regenerar el índice shell-owned desde el snapshot correcto o si el salto fino deja de pasar por `navigateToCode()` / `focusCell()`.
- Uso de controles nativos del navegador para operaciones de archivo, que rompe automatización, feedback y consistencia visual del shell.
- Falso positivo de descarga DOCX exitosa si el shell vuelve a `a.click()` directo y deja de validar el `fetch -> blob` o de reintentar contra la ruta estable por `source_path`/`kernel_id`.
- Inflado falso del historial DOCX si el shell vuelve a promover payloads con claves DOCX nulas/stale o usa `source_path` como identidad de documento en vez de una identidad estable real.
- Promoción accidental de una entrada `docx_is_empty=true` como latest del botón principal `DOCX` si el visor deja de filtrarlas antes de arbitrar newest-first.
- Falso positivo de “Generando PDF...” si el visor vuelve a usar la mera existencia de DOCX estable/historial como proxy de conversión PDF activa.
- Pérdida del botón `Plantilla` si el toolbar completo vuelve a condicionarlo a `kernelId`, dejando sin salida el caso “hay historial DOCX, pero aún no se ha iniciado el kernel”.
- Descarga stale del botón principal `DOCX` si el visor vuelve a priorizar `docxDownloadUrl` actual por sobre la última entrada persistida del historial fusionado.
- Drift entre `DocxViewer` y `PdfViewer` si divergen `requestedPage`, `currentPage`, `fitMode` u `outline`, si el render windowed deja offsets/página visible inconsistentes al volver a mostrar `Documento`, si el viewer vuelve a montarse dentro de un contenedor oculto y pierde el layout útil, o si se reintroduce el loop de recarga por identidad de callbacks y el teardown deja tareas async vivas.
- Tormenta de notificaciones por `workspace_fs_event` si el shell vuelve a emitir un warning nuevo por cada batch del watcher en vez de deduplicar por archivo mientras el conflicto siga activo.
- Conflicto MCP falso si `useFileSystem` pierde el origen de `notebookData` y vuelve a marcar `modifiedFiles` durante una carga inicial, una recarga same-path o una snapshot runtime del notebook.
- Drift entre `NotificationCenter` y `App.js` si la metadata `target`, la expansión inline y los callbacks de navegación dejan de compartir la misma semántica; el síntoma típico es un click que expande cuando debía navegar, o que roba el foco desde `home` sin intención explícita.
- Drift entre asociaciones nativas y workspace activo si `open-native-file` vuelve a tratar archivos externos como rutas internas sin seleccionar primero su carpeta padre como workspace.

### Observabilidad
- Estado de conexión y controles MCP en `DesktopTitleBar`.
- Disponibilidad del convertidor PDF expuesta como nota contextual y discreta dentro de la vista `Documento` (`DocxViewer`), no como badge permanente del shell global.
- Mensajes de estado centralizados por `NotificationCenter`, con App como owner del routing contextual cuando una notificación trae `target`.
- Botón `Agents` split (`McpStatusButton`) con badge de runs activos, toggle embebido de `Live Agent View` y quick actions comunes (`start/stop` por shift-click o panel), gobernados por el mismo handler del shell.
- Panel `Agents` con pestaña `Activity` como feed principal de runs activos e historial reciente.

## Archivos fuente y puntos de entrada

- `frontend/src/App.js`
- `frontend/src/components/AgentWorkspaceHome.js`
- `frontend/src/components/AgentWorkspaceHome.css`
- `frontend/src/components/DesktopTitleBar.js`
- `frontend/src/components/DesktopTitleBar.css`
- `frontend/src/components/DocxViewer.js`
- `frontend/src/components/PdfViewer.js`
- `frontend/src/components/FileExplorer.js`
- `frontend/src/components/FileTabs.js`
- `frontend/src/components/ExplorerIcons.js`
- `frontend/src/components/FolderSelector.js`
- `frontend/src/components/ProjectLauncher.js`
- `frontend/src/components/McpPanel.js`
- `frontend/src/components/McpStatusButton.js`
- `frontend/public/favicon.png`
- `frontend/public/brand/inspyro-mark-128.png`
- `frontend/public/brand/inspyro-mark-light-128.png`
- `frontend/src/assets/brand/inspyro-mark.png`
- `frontend/src/assets/brand/inspyro-mark-light.png`
- `assets/brand/`
- `tools/brand/generate_assets.py`
- `frontend/src/index.js`
- `frontend/src/boot/RendererRoot.js`
- `frontend/src/boot/rendererDesktopBridge.js`
- `frontend/src/hooks/useAppWebSocket.js`
- `frontend/src/hooks/useFileSystem.js`
- `frontend/src/hooks/useMcpActivity.js`
- `frontend/src/hooks/useMcpShellControls.js`
- `frontend/src/hooks/useMcpMirror.js`
- `frontend/src/hooks/useWebSocket.js`
- `frontend/src/hooks/useTemplateMessageHandler.js`
- `frontend/src/utils/frontendLogger.js`
- `frontend/src/contracts/wsMessageTypes.generated.js`
- `frontend/scripts/generate_ws_types.mjs`

Puntos de entrada UI:
- home persistente del workspace (`workspaceSurface='home'`) cuando existe `active_workspace`
- superficie `file` para editor/notebook con retorno visible a Home
- render condicional por modo (`code` vs `notebook`)
- launcher inicial de proyecto cuando no existe `active_workspace`
- handlers de template y visualización
- health check inicial de PDF

## 2026-04-07 - Espejo MCP opt-in y boot renderer robusto

1. `App.js` delega la política MCP de shell en `useMcpShellControls`, eliminando el acoplamiento entre `handleMcpQuickAction` y `setMirrorEnabled` que podía romper el render inicial por orden de hooks.
2. `useMcpActivity` sigue siendo la source of truth del toggle persistido `mirrorEnabled`; el valor arranca en `OFF` solo si no existía preferencia previa, y `start/restart` exitosos desde la propia UI vuelven a forzarlo a `true`.
3. `useFileSystem` conserva la activación de tabs abiertos desde caché y deja `reloadFile`/`reloadFileByPath` como rutas explícitas de recarga real, mientras `FileExplorer` sigue sin refrescar el árbol por mero cambio de `activeFilePath`.
4. `frontend/src/index.js` pasa a emitir `renderer_bootstrap_ready`, instala listeners globales para `window.onerror`/`unhandledrejection` y monta `RendererRoot` como contenedor estable por encima de `App`.
5. `RendererRoot` envuelve a `App` con un boundary raíz: si el shell monta bien informa `renderer_app_ready`; si falla durante bootstrap informa `renderer_app_failed` y muestra una pantalla fatal visible dentro de Electron, reemplazando la antigua ventana negra.
6. `focusDocxView` vuelve a usar `visualizationViewRequest`, eliminando el warning por `setVisualizationViewRequest` muerto y permitiendo que el espejo MCP enfoque `docx` sin remount del panel.

## Resumen de cambios recientes

1. Consolidación del wiring entre editor, visualización y toolbar de notebook.
2. Re-upload automático de template al cambiar `kernel_id`.
3. Mejoras de validación para evitar sobrescritura de estado entre archivos.
4. Integración más consistente de eventos de estado de conversión PDF.
5. Cleanup de warnings frontend en shell principal: eliminación de estado/handlers muertos y ajuste de dependencias `useEffect`/`useCallback` en componentes de soporte.
6. Componentes pesados (`MonacoEditor`, `NotebookEditor`, `VisualizationPanel`, `FileExplorer`) pasan a carga diferida con `React.lazy` para reducir costo inicial de render.
7. Manejo de mensajes template extraído a hook dedicado (`useTemplateMessageHandler`) para desacoplar `App.js`.
8. El header compacto se reemplaza por `DesktopTitleBar`, que integra branding, estado de conexión, toolbar notebook/código, `NotificationCenter` y `McpStatusButton` respetando drag regions del shell Electron.
9. `App.js` reporta workspace/notificaciones al shell desktop, consume `desktop:menu-action` y coordina shortcuts/acciones nativas sin reimplementar lógica de negocio en Electron.
10. El shell suma `workspaceSurface`, `Agent Workspace Home` y el loop visible `Entender -> Ejecutar -> Entregar`, relegando editor/notebook/explorer/tabs a herramientas secundarias mientras `McpPanel` queda como inspector avanzado.
11. La documentación del shell deja explícito que `App.js` es el owner de la cola de notificaciones y de la navegación por `target`, mientras `NotificationCenter` queda como renderer del feed con expansión inline para mensajes largos.
8. `useWebSocket` endurece lifecycle diferenciando desconexión manual de reconexión automática.
9. `useFileSystem` corrige wrapper de `warn` para evitar recursión infinita en runtime y mantener logging condicional estable.
10. `useAppWebSocket` y `useTemplateMessageHandler` migran tipos WS críticos a constantes compartidas generadas (`wsMessageTypes.generated.js`) para reducir typos y drift cliente/contrato.
11. Se elimina remount forzado por `key` en `VisualizationPanel` notebook para reducir commits innecesarios.
12. `NotebookEditor` incorpora correlación por `execution_id` (con cancelación), y `useFileSystem` migra a dirty flags/versionado para evitar `JSON.stringify` completo por cambio.
13. Ciclo de cambio de notebook endurecido: create/load conserva `previous_kernel_id` solo para rebuilds explícitos; Home, cambio de tab u apertura de otro archivo ya no deben matar el kernel vivo.
14. Pipeline de template prioriza upload REST + `template_attach`; `template_upload` queda como fallback legacy.
15. Visualización DOCX/PDF soporta referencias de artefactos (`docx_ref`, `pdf_ref`) para evitar payloads WS gigantes.
16. `NotebookEditor` separa estado runtime de estado persistible y reduce escrituras de autosave durante ejecución continua.
17. `DocxViewer` normaliza `pdf_ref`, fuerza `inline=1` para previews y descarga por `blob` para evitar forzar download en navegadores.
18. `DocxViewer` elimina flicker de PDF durante reconversión: mantiene PDF anterior visible mientras se genera el nuevo, elimina auto-switch HTML↔PDF y suprime spinner sobre PDF existente.
19. `DocxViewer` corrige dependencia de efecto PDF (`hasDocx`) para evitar estado stale al limpiar/retener preview durante reconversión.
20. `OutputRenderer` sanitiza explícitamente `image/svg+xml` con `DOMPurify` antes de renderizar `dangerouslySetInnerHTML`.
21. Hardening de toolchain frontend: `react-scripts` pasa a `devDependencies`, actualización de runtime libs (`vega*`, `mammoth`, `dompurify`, `katex`) y parche persistente de `react-dev-utils` para eliminar warning `fs.F_OK` en Node 22.
22. Estado de seguridad NPM: `npm audit --omit=dev` en 0; permanecen vulnerabilidades moderadas en dependencias `dev` del stack CRA, cuya eliminación total requiere migrar el toolchain.
23. Compatibilidad CRA5 restaurada en desarrollo: `overrides.webpack-dev-server` vuelve a `4.15.2` (desde `5.2.3`) para alinear `react-scripts@5.0.1` con su API esperada y evitar el error de esquema (`onAfterSetupMiddleware`) en `npm start`.
24. `App.js` enruta `onNavigateToCode` desde `DependencyGraph` hacia `NotebookEditor` mediante `notebookActionsRef.navigateToCode`, habilitando navegación directa a celda/línea por doble clic en nodos del grafo.
25. `useMcpActivity` queda como source of truth del estado MCP de shell: hidrata `/api/mcp/activity`, consume `mcp_activity_event`, persiste `mirrorEnabled`, expone `agentExecutionState` y deja el default en `OFF` solo cuando no existe preferencia previa.
26. `App.js` vuelve a montar `useMcpMirror`; el replay granular de `mcp_mirror_event` queda opt-in por toggle manual y se autoactiva al iniciar o reiniciar MCP desde la UI.
27. `App.js` conserva `visualizationViewRequest` para foco local del panel y lo usa de nuevo para `focusDocxView`, de modo que `artifact_update` o `open_resource(focus_view=docx)` puedan redirigir la visualización sin remount.
28. `useAppWebSocket` ignora `mcp_mirror_event` para evitar doble manejo, y `App.js` unifica notificaciones externas en vez de depender de `statusMessage/statusType`.
29. `useWebSocket` pasa a reconexión indefinida con backoff acotado y recuperación inmediata en `focus`/`online`/`visibilitychange`, evitando refresh manual tras reinicios del backend.
30. `App.js` desacopla el polling de `/api/mcp/status` del estado del WebSocket para que el botón/panel MCP sigan reflejando `running/stopped` aunque el socket principal esté reintentando conexión.
31. `useWebSocket` ignora eventos (`open/message/error/close`) de sockets obsoletos para evitar estados falsos de `Conectado` con `wsRef` nulo y pérdida silenciosa de acciones `execute_code`/`notebook_*` tras reconexiones o remounts de desarrollo.
32. `useFileSystem` deduplica aperturas concurrentes del mismo recurso y `useMcpMirror` marca `step_id` en vuelo, evitando tabs duplicados cuando el espejo MCP recibe ráfagas `open_resource` / `mcp_mirror_event`.
33. `App.js` sanea `notebookExecutionData` cuando llega un `artifact_update` final de MCP: limpia `conversionStatus`, errores y payloads stale de PDF/DOCX antes de aplicar `pdfRefUrl`/`docxDownloadUrl`, evitando spinners infinitos en modo espejo.
34. `FileExplorer` y `FolderSelector` pasan a trabajar contra un workspace activo real del backend: consultan `/api/system/info`, permiten abrir un proyecto existente (`/api/system/workspace`) o crear uno nuevo (`/api/system/workspace/create`) y dejan la carpeta de instalación fuera del flujo normal del usuario.
35. `App.js` incorpora un launcher inicial agent-first: si backend no reporta `active_workspace` y no hay tabs abiertas, el shell oculta explorador/editor, ofrece rutas `Start with Agent` / `Start from example` / `Open project`, lista `recent_workspaces` y reutiliza `FolderSelector` para abrir o crear el workspace antes de entrar al workspace shell completo.
36. El header de notebook agrega un dropdown de acciones poco frecuentes conectado a `NotebookEditor` para limpiar outputs locales y resetear el panel DOCX/PDF/variables sin introducir contratos WS nuevos.
37. `useMcpMirror` pasa a obedecer `mirrorEnabled` de forma estricta; al desactivar el modo espejo deja de aplicar snapshots/runtime granulares y vacia la cola en memoria para no reinyectar eventos stale al reactivar.
38. `useFileSystem` activa tabs ya abiertos desde caché local y evita rereads al seleccionar/reabrir recursos ya presentes en `openFiles`.
39. `reloadFileByPath` queda como recarga explícita real aun para tabs no activos, mientras `FileExplorer` deja de refrescar por mero cambio de archivo activo.
40. `artifact_update` y `open_resource` del flujo `reconvert_pdf` pueden autoenfocar `docx` incluso si el notebook objetivo no era el activo, siempre que el target esté limpio.
41. `FileExplorer` reemplaza `prompt()` por diálogos controlados para crear, renombrar y eliminar archivos/carpetas, con feedback y selección estables para UI humana y E2E.
42. `App.js` preserva `variables` al fusionar payloads de visualización posteriores a la ejecución, evitando que `notebook_pdf_ready` o artefactos tardíos borren el panel de variables.
43. `useAppWebSocket` ignora `pong` explícitamente para eliminar ruido de “mensaje no manejado” en consola durante el heartbeat normal del shell.
44. `ProjectLauncher`, `FolderSelector`, `FileExplorer`, `VisualizationPanel` y los controles MCP agregan anclas `data-testid` estables para automatización Playwright sin introducir contratos públicos nuevos.
45. `useAppWebSocket`, `App.js` y `DocxViewer` endurecen el flujo DOCX: aceptan payloads `docx_ref`-only/token-only, hacen que `artifact_id` gane sobre URLs genéricas por `source_path`, resuelven fallback estable por `source_path`/`kernel_id`, reemplazan refs stale con estrategia latest-wins y descargan por `fetch -> blob`.
46. `DocxViewer` agrega historial DOCX visible en toolbar y empty state, fusionando historial backend (`/api/docx/history`) con historial local persistido por `App.js` para permitir descargar versiones previas del mismo notebook/archivo.
47. `docxArtifacts.js`, `App.js` y `useAppWebSocket` ya no cuentan como “nuevo DOCX” los mensajes que solo arrastran campos DOCX nulos/stale; el historial local se normaliza, purga entradas legacy inválidas y se hidrata solo desde identidades estables reales o base64 inline efectivo.
48. `FileExplorer` migra a árbol lazy con quick open, clipboard interno (`copy/cut/paste`), `move/copy/duplicate` explícitos, drag-and-drop entre carpetas, toggle `show hidden`, reveal del archivo activo, iconografía SVG temática por extensión/familia (`py`, `ipynb`, `ps1`, `sh`, `js`, `ts`, `jsx/tsx`, `json`, `md`, `txt`, `csv/tsv`, `yml/yaml/toml/ini/cfg/conf`, `html/xml/svg`, `css/scss/less`, `docx`, `pdf`, `png/jpg/jpeg/gif/webp`, `log`, `env`) y refresh granular por `workspace_fs_event`.
49. `App.js` y `useFileSystem` aplican batches `workspace_fs_event` para recargar tabs limpios, marcar conflictos externos en tabs dirty y propagar decoraciones `stale/conflict` al explorer sin colapsar la expansión.
50. `DesktopTitleBar` converge a una sola franja superior: elimina la tarjeta del proyecto y las pills `Notebook/Kernel`, centra las acciones contextuales del archivo activo y deja el bloque de notificaciones/estado/MCP fijo a la derecha.
51. La disponibilidad del convertidor PDF sale del bloque derecho del header y pasa a `DocxViewer`, donde se muestra como mensaje contextual dentro de `Documento`.
52. Shell layout UI homogeniza scrollbars visibles y el componente `Resizer`: explorer, launcher, paneles de visualización, overlays MCP y superficies auxiliares comparten la misma semántica visual; el drag del split usa `requestAnimationFrame`, ancho del contenedor real y preview DOM imperativo para reducir saltos sin re-renderizar paneles pesados por cada movimiento.
53. `useFileSystem` expone `notebookSyncState` y `NotebookEditor` consume `initialNotebookOrigin`/`initialNotebookToken`, cerrando el falso `DIRTY` que aparecía al abrir notebooks existentes o al reflejar snapshots MCP same-path.
54. `App.js` ya no inunda `NotificationCenter` cuando el watcher reporta varias veces el mismo archivo dirty: los conflictos externos se avisan una vez por path y se rearman solo cuando el conflicto realmente desaparece y reaparece.
55. `FileExplorer` estabiliza el árbol raíz bajo apertura rápida de notebooks: deduplica `loadFolder(path)` en vuelo, evita refreshes redundantes tras estabilizar `rootPath` y no vuelve a pintar el estado `loading` del root por eventos `modified` de archivos que no cambian la estructura.
56. `DocxViewer` cambia a visor PDF controlado, consume `docx_provenance_ref`/`docx_provenance_available`, habilita `Modo origen` solo cuando el PDF trae annotations válidas y abre un rail derecho persistente con la procedencia resuelta del fragmento clicado (`exact` por defecto + fallback a `callsite` y re-resolución puntual por backend si el manifiesto local quedó stale).
57. `PdfViewer` añade metadata client-side del PDF (`numPages`, `outline`, `hasOutline`, `currentPage`), navegación interna por bookmarks/destinos, render windowed/lazy para PDFs largos y overlays accesibles sin depender de contratos backend nuevos.
58. `DocxViewer` compacta la experiencia del lector con iconografía SVG discreta, acciones secundarias en `DropdownMenu` y montaje visible-only del `PdfViewer` para evitar bugs de visualización al ocultar/mostrar la pestaña `Documento`.
59. `App.js` queda documentado además como owner de la sección `Índice de Notebook` del rail lateral, derivándola desde la sesión shell-owned activa y reutilizando `navigateToCode()` / `focusCell()` para navegación estructural sin recargas extra del `.ipynb`.
60. El shell agrega `frontendLogger` y deja el tracing frontend verbose bajo `REACT_APP_INSPYRO_DEBUG=1`, evitando ruido de `Run All`, websocket, editor y template en desarrollo normal y en tests.
61. `DocxViewer` y `PdfViewer` endurecen el flujo documental sin tocar contratos: `404` esperables pasan a estado “aún no disponible”, `pdf.js` y `mammoth` se cargan bajo demanda y el viewer conserva fallback limpio cuando el artefacto remoto todavía no existe.

Detalle histórico: `docs/changelog/14-main-app.md`.



