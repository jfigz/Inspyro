# Changelog 14 - main-app

> **Última actualización:** 2026-05-03

---

## 2026-05-03 - Branding Inspyro PNG

1. `DesktopTitleBar` consume `frontend/public/brand/inspyro-mark-light-128.png` como mark visible sobre la titlebar oscura, manteniendo el wordmark y la franja de misión existentes.
2. `.inspyro-logo` usa la copia derivada `frontend/src/assets/brand/inspyro-mark-light.png` para los puntos legacy del shell oscuro.
3. `frontend/public/index.html` mantiene el favicon `favicon.png` desde el mark original, generado desde el PNG maestro aprobado bajo `assets/brand/`.

**Archivos:** `frontend/src/components/DesktopTitleBar.js`, `frontend/src/components/DesktopTitleBar.css`, `frontend/src/App.css`, `frontend/public/index.html`, `frontend/public/favicon.png`, `frontend/public/brand/inspyro-mark-light-128.png`, `frontend/src/assets/brand/inspyro-mark-light.png`, `assets/brand/`, `tools/brand/generate_assets.py`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/llm-index.yaml`

---

## 2026-05-03 - Home como centro operativo

1. `App.js` deriva `workspaceData.operational` desde `home-summary` y la superposición shell-owned actual: atención priorizada, carriles `Entender` / `Ejecutar` / `Entregar` y acciones rápidas, conservando `cards` como fallback.
2. `AgentWorkspaceHome` pasa de cuatro tarjetas/acordeones a un centro operativo con header compacto, franja `Atención`, filas navegables de un click y panel de detalle lateral/inline.
3. DOCX y plantillas quedan integrados en `Entregar`; runtimes, notebooks/scripts y clientes MCP quedan integrados en `Ejecutar`, sin cambios REST/WS/backend.
4. `AgentWorkspaceHome.css` elimina saturación decorativa, tarjetas anidadas y radios grandes, y agrega guards responsivos para 393px, 760px, 1024px y desktop ancho.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.homeSummary.test.js`, `frontend/src/components/AgentWorkspaceHome.js`, `frontend/src/components/AgentWorkspaceHome.css`, `frontend/src/components/AgentWorkspaceHome.test.js`, `frontend/tests/responsive-overlap.spec.ts`, `frontend/tests/workspace-home-live.spec.ts`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`, `docs/changelog/14-main-app.md`

---

## 2026-05-03 - Archivos no soportados y apertura externa

1. `FileExplorer` agrega una acción contextual de archivo para abrir con la aplicación por defecto, sin exponerla en directorios.
2. `App.js` centraliza la apertura externa: Desktop usa `window.inspyroDesktop.openPath(path)` y web local usa `POST /api/files/open-default`.
3. `useFileSystem` preserva el detalle del fallo de lectura y `App.js` muestra un estado central accionable cuando el editor interno no soporta el archivo, evitando tabs editables falsas.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.css`, `frontend/src/App.dependency.test.js`, `frontend/src/components/FileExplorer.js`, `frontend/src/components/FileExplorer.test.js`, `frontend/src/hooks/useFileSystem.js`, `frontend/src/hooks/useFileSystem.test.js`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/changelog/14-main-app.md`

---

## 2026-05-02 - Iconos SVG híbridos para archivos

1. `ExplorerIcons.js` reemplaza la familia visual anterior por SVGs híbridos: hoja translúcida compartida, pictogramas mínimos y colores suaves por tipo de archivo.
2. Las carpetas pasan a una variante ámbar apagada, y archivos como `.ipynb`, `.py`, DOCX/PDF, imágenes, datos y configs quedan identificables sin logos saturados.
3. `FileExplorer.css` y `FileTabs.css` reducen el `drop-shadow` de la iconografía para que el cambio se lea más liviano tanto en el rail como en tabs.

**Archivos:** `frontend/src/components/ExplorerIcons.js`, `frontend/src/components/FileExplorer.css`, `frontend/src/components/FileTabs.css`, `docs/modules/14-main-app.md`, `docs/changelog/14-main-app.md`

---

## 2026-05-01 - Scrollbars Inspyro bajo hover por sección

1. `ScrollSurfaceManager` ahora crea overlays verticales y horizontales por superficie, actualiza thumbs en scroll/resize y soporta drag en ambos ejes.
2. `index.css` oculta los overlays en reposo, los revela por hover/focus/scroll/drag, tematiza el fallback nativo y alinea Monaco con el mismo comportamiento.
3. `PdfViewer` entra al estándar `scroll-surface`, evitando barras nativas claras dentro del panel `Documento`.

**Archivos:** `frontend/src/components/ScrollSurfaceManager.js`, `frontend/src/components/ScrollSurfaceManager.test.js`, `frontend/src/index.css`, `frontend/src/components/PdfViewer.js`, `docs/modules/14-main-app.md`

---

## 2026-05-01 - Pestañas de archivos integradas al shell

1. `FileTabs` elimina los iconos emoji propios y renderiza `ExplorerFileIcon`, por lo que las pestañas abiertas y el explorador comparten la misma iconografía por extensión.
2. La barra de pestañas adopta un diseño integrado: activo con acento azul fino, estados inactivos silenciosos, indicador de cambios ámbar sin animación y truncado estable.
3. Cerrar pestañas y guardar todos usan botones SVG accesibles, manteniendo intactos handlers, drag/drop, confirmación de cierre y guardado selectivo de archivos modificados.

**Archivos:** `frontend/src/components/FileTabs.js`, `frontend/src/components/FileTabs.css`, `frontend/src/components/FileTabs.test.js`, `docs/modules/14-main-app.md`, `docs/changelog/14-main-app.md`

---

## 2026-05-01 - Notebook pegado al split del shell

1. `App.css` quita el padding de `.main-container` en modo notebook para eliminar los márgenes laterales negros alrededor de la sección de celdas.
2. `.notebook-panel` deja de tener borde/radio de tarjeta, y el `VisualizationPanel` dentro del split notebook pierde radios superior/inferior para quedar alineado con la misma superficie.
3. El resizer interno del notebook reduce su carril visual manteniendo la interacción de resize sin introducir cambios de contrato.

**Archivos:** `frontend/src/App.css`, `docs/modules/14-main-app.md`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-05-01 - Estados terminales DOCX/PDF no reactivan loaders

1. `App.js` estabiliza el callback de ejecución pendiente que entrega a `NotebookEditor`, evitando que el shell provoque limpiezas de unmount durante re-renders normales.
2. El shell descarta `documentPipelineStatus` cuando un `notebook_progress_update` documental ya viene en estado terminal, preservando el cierre real por `notebook_pdf_ready`.
3. `DocxViewer` solo usa `documentPipelineStatus` activo para mostrar carga; estados `completed` o `failed` ya no reencienden el spinner ni el aviso de conversión.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.notebookSessions.test.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.test.js`, `docs/modules/14-main-app.md`

---

## 2026-05-01 - Home usa recursos de usuario y acciones explícitas

1. `home-summary` clasifica notebooks internos/generados y deja de usarlos para inventario, templates o CTAs principales; los DOCX vacíos tampoco cuentan como entregables listos.
2. `AgentWorkspaceHome` queda Spanish-first (`Entender -> Ejecutar -> Entregar`, `Abrir agentes`, `Plantilla adjunta`), inicia sus tarjetas colapsadas y exige acciones explícitas para navegar desde tarjetas/filas.
3. `Ir a archivos` deja de ser no-op sin tabs abiertas: cambia a la superficie de archivos y muestra explorer/editor vacío.
4. `Abrir DOCX` abre la copia persistida del workspace o descarga por endpoint de artefacto antes de degradar al notebook origen; `Preparar entrega` mantiene el foco Workbench separado.
5. Abrir notebooks desde Home conserva snapshots runtime como cambios programáticos para evitar `DIRTY` falso, y el editor de templates muestra `Cargando plantilla...` durante el reattach sin disparar el loop de `Maximum update depth`.

**Archivos:** `backend/app/services/home_compact.py`, `backend/tests/test_home_summary_backend.py`, `frontend/src/App.js`, `frontend/src/App.homeSummary.test.js`, `frontend/src/components/AgentWorkspaceHome.js`, `frontend/src/components/AgentWorkspaceHome.test.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/changelog/14-main-app.md`, `docs/llm-index.yaml`

---

## 2026-04-30 - Separadores más fluidos sin cambio visual

1. `App.js` mueve el drag de separadores a una ruta de preview imperativo sobre DOM para explorer, editor/notebook y panel derecho, confirmando `setState` solo en `onResizeEnd`.
2. `VisualizationPanel` expone una ref interna (`panelRef`) para que el shell pueda ajustar el ancho sin agregar wrappers que alteren el layout responsivo.
3. La clase temporal `app-shell-layout-resizing` desactiva transiciones de ancho y pointer-events de superficies pesadas durante drag, preservando estética en reposo.
4. Se agrega `Resizer.test.js` para fijar batching por `requestAnimationFrame`, cleanup de clases y resize por teclado; `shell-layout.spec.ts` valida que el ancho cambia antes de soltar el mouse y queda dentro de límites.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.css`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/components/Resizer.test.js`, `frontend/tests/shell-layout.spec.ts`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/changelog/14-main-app.md`, `docs/llm-index.yaml`

---

## 2026-04-28 - Run All shell-owned respeta celdas DOCX

1. `App.js` centraliza la selección de celdas Python mediante helpers compartidos y conserva `docx` dentro del runtime notebook, stripping de outputs y sesiones shell-owned.
2. El `Run All` lanzado desde el shell incluye celdas DOCX solo cuando DOCX/PDF está activo; con el toggle apagado ejecuta solo cálculo y mantiene el documento visible previo.
3. Las regresiones de sesiones notebook cubren que las celdas DOCX participen del batch con `cellType` y que el apagado no dispare limpieza documental.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.notebookSessions.test.js`, `frontend/src/utils/notebookCellTypes.js`, `docs/modules/14-main-app.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-28 - Hardening responsivo y guards anti-solape

1. `DesktopTitleBar` deja de recortar el bloque derecho y compacta notificaciones/Agents antes de que identidad, acciones contextuales, conexión y controles MCP se superpongan.
2. `AgentWorkspaceHome`, `McpPanel`, `DocxViewer`, el layout principal y el modo notebook agregan límites responsivos, scroll local y wrapping/truncado para rutas, URLs, pills y toolbars largos; `DocxViewer` deja de ocultar el Workbench cuando solo existe DOCX descargable sin preview activa.
3. Se incorpora `tests/helpers/layout.ts` y la suite `responsive-overlap.spec.ts`, con assertions de viewport y no-overlap para titlebar, dropdown de notificaciones, Home, archivo, notebook y panel Agents.

**Archivos:** `frontend/src/App.css`, `frontend/src/components/DesktopTitleBar.css`, `frontend/src/components/AgentWorkspaceHome.css`, `frontend/src/components/McpPanel.css`, `frontend/src/components/McpStatusButton.css`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.css`, `frontend/src/components/DocxViewer.test.js`, `frontend/tests/helpers/layout.ts`, `frontend/tests/responsive-overlap.spec.ts`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/changelog/14-main-app.md`

---

## 2026-04-26 - Home muestra Run All shell-owned en tiempo real

1. `App.js` superpone `notebookSessionsByPath` activos sobre `homeSummary` al construir `workspaceData`, evitando que Home muestre `Sin ejecución activa` mientras tres notebooks siguen corriendo desde el shell.
2. El overlay convierte `batchRunState` en filas `running` con porcentaje por notebook y conserva `documentPipelineStatus.sharedResource` para exponer `PDF en cola` / `PDF compartido` durante la fase documental.
3. `App.notebookSessions.test.js` agrega regresión para tres `Run All` lanzados con sockets notebook aún conectando y valida que Home muestre `3 activos` con filas/progreso aislados.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.notebookSessions.test.js`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`

---

## 2026-04-26 - Barrido UI/UX de shell y superficies principales

1. `App.js` limpia `dependencyTarget` al cambiar `filePath`, evita notificaciones para prompts vacíos y mantiene el estado contextual dentro de `VisualizationPanel`.
2. `DesktopTitleBar`, `NotebookToolbar`, `NotificationCenter`, `McpStatusButton` y `AgentWorkspaceHome` reciben truncado/overflow estable para evitar solapes en header, toolbar y tarjetas con rutas largas.
3. `FileActionDialog` deja `Nombre` vacío al crear archivos/carpetas, mientras `FileExplorer` y Quick Open separan basename y ruta secundaria para lectura compacta.
4. `DocxViewer` distingue preview activo, DOCX histórico descargable y ausencia de documento; `McpPanel` añade nombres accesibles a cierre y acciones icon-only.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.css`, `frontend/src/components/DesktopTitleBar.css`, `frontend/src/components/NotebookToolbar.js`, `frontend/src/components/NotebookToolbar.css`, `frontend/src/components/FileActionDialog.js`, `frontend/src/components/FileExplorer.js`, `frontend/src/components/FileExplorer.css`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.css`, `frontend/src/components/AgentWorkspaceHome.css`, `frontend/src/components/McpPanel.js`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/changelog/14-main-app.md`

---

## 2026-04-25 - Workbench DOCX en visor, Home e historial

1. `DocxViewer` cambia el rail de calidad a `Workbench DOCX` con tabs `Calidad`, `Visual`, `Revision`, `Publicacion`, `Campos` y `Diff`, consumiendo `/api/docx/workbench/run` bajo demanda.
2. La pestaña `Visual` queda conectada al cache persistente: muestra estado/motor/páginas cacheadas, refresca `render_manifest`, renderiza una página o todas y limpia derivados visuales solo por acción explícita.
3. El historial DOCX permite elegir una versión de comparación, mostrar badges de calidad/visual y descargar resources/variantes solo por acción explícita.
4. `AgentWorkspaceHome` actualiza el CTA documental a `Preparar entrega`, preservando el montaje liviano sin auditorías ni renders pesados automáticos.
5. Se agrega CSS compacto para tabs y resources del Workbench sin introducir landing ni tarjetas anidadas.
6. `DocxViewer` evita falsos éxitos en render visual: prioriza metadata `docx_render_*` frente a estados genéricos y no muestra confirmación si `render_page` falla o no devuelve resultado.
7. `useAppWebSocket` elimina el helper muerto de recorte de cola que generaba warning de build, sin cambiar contratos WS ni la semántica de colas por bucket.

**Archivos:** `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.css`, `frontend/src/components/DocxViewer.test.js`, `frontend/src/components/AgentWorkspaceHome.js`, `frontend/src/hooks/useAppWebSocket.js`, `frontend/src/utils/docxArtifacts.js`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-22 - Colas notebook por socket, hidratación segura y Home con PDF compartido

1. `useAppWebSocket` deja de tratar `notebookMessageQueue` como buffer plano global y pasa a recortarla por bucket `socket/path`, preservando terminales y artefactos tardíos de notebooks distintos bajo ráfaga.
2. `App.js` endurece la hidratación del notebook activo usando ownership por `path`: si `notebookSyncState.path` no coincide con la sesión visible, el shell no adopta ese snapshot y evita contaminación cruzada al cambiar de tab o volver desde `Home`.
3. `AgentWorkspaceHome`, `DocxViewer` y el shell documental pasan a mostrar la espera/uso del convertidor PDF compartido desde `shared_resource`, dejando visible en Home el estado `PDF en cola` / `PDF compartido` de notebooks ocultos.

**Archivos:** `frontend/src/App.js`, `frontend/src/hooks/useAppWebSocket.js`, `frontend/src/App.notebookSessions.test.js`, `frontend/src/App.homeSummary.test.js`, `frontend/src/hooks/useAppWebSocket.test.js`, `frontend/src/components/DocxViewer.js`, `docs/modules/14-main-app.md`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/system-context.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-04-20 - Logging opt-in y visores documentales más silenciosos

1. `frontendLogger` pasa a ser la capa compartida de trazas frontend y deja `Run All`, hooks websocket/filesystem, editor y template bajo `REACT_APP_INSPYRO_DEBUG=1`, evitando ruido de consola por defecto.
2. `DocxViewer` reclasifica los `404` esperables de historial DOCX, `pdf_ref` y manifiesto de procedencia como estado “aún no disponible”, mantiene fallback local y reserva `console.error` para fallas reales.
3. `PdfViewer` mueve `pdfjs-dist/webpack` a carga bajo demanda y `DocxViewer` hace lo mismo con `mammoth`, reduciendo costo inicial del shell cuando el usuario no abre `Documento`.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/PdfViewer.js`, `frontend/src/components/NotebookEditor.js`, `frontend/src/components/notebook/NotebookCell.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/hooks/useAppWebSocket.js`, `frontend/src/hooks/useFileSystem.js`, `frontend/src/hooks/useWebSocket.js`, `frontend/src/utils/frontendLogger.js`, `frontend/src/utils/frontendLogger.test.js`, `frontend/src/components/DocxViewer.test.js`, `frontend/src/components/PdfViewer.test.js`, `frontend/src/App.notebookSessions.test.js`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `AGENTS.md`

---

## 2026-04-19 - Rebind real, batch shell-owned y consumo one-shot de template open

1. `App.js` amplía la sesión notebook por `path` para incluir `runtimeNotebook`, estado batch de `Run All` y seguimiento de `notebook_*` aun cuando `NotebookEditor` está oculto.
2. La navegación normal `Home <-> file` reutiliza la sesión notebook local sin mandar `notebook_attach_kernel`; el attach queda reservado a recovery explícito o reconexión real, evitando ruido contra backends que aún no exponen ese contrato.
3. `templateOpenRequest` pasa a consumirse una sola vez al entrar en `DocxViewer`, evitando replays de apertura de template y arranques accidentales de kernel al remount.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/components/NotebookEditor.js`, `frontend/src/App.notebookSessions.test.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/14-main-app.md`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/system-context.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-19 - Sync documental del Índice de Notebook como sección lateral

1. Se documenta a `App.js` como owner de la sección `Índice de Notebook` del rail lateral, dejando explícito que el rail izquierdo ofrece secciones separadas para árbol del workspace y estructura navegable de la `.ipynb` activa sin contratos nuevos.
2. El changelog de arquitectura alinea ese índice con la sesión shell-owned por `path`, `workspaceSurface`, `home` persistente y el pipeline de navegación `open file -> navigateToCode/focusCell`.
3. También se sincronizan riesgos E2E para cubrir drift entre árbol, libreta activa y selección de celdas al volver desde `home` o rehidratar tabs.

**Archivos:** `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/modules/14-main-app.md`

---

## 2026-04-19 - Shell owner del runtime por tab/path

1. `App.js` conserva sesiones notebook por `path` (`kernelState + documentState`) y estado `.py` por archivo (`run_id + output + documentState`), permitiendo volver desde Home o cambiar de tab sin perder procesos vivos.
2. Cerrar una tab running se vuelve la frontera explícita de lifecycle: notebooks envían `notebook_shutdown_kernel`, scripts `.py` envían `cancel_code_execution`, y el resto de tabs queda intacto.
3. Home deja visible ese estado vivo usando `notebook_runtime_items + code_runtime_items`, de modo que notebooks y scripts puedan retomarse aunque el editor ya no esté montado.

**Archivos:** `frontend/src/App.js`, `frontend/src/hooks/useAppWebSocket.js`, `frontend/src/hooks/useFileSystem.js`, `frontend/src/components/NotebookEditor.js`, `backend/app/routers/notebook_execution.py`, `backend/app/services/home_compact.py`, `backend/main.py`, `docs/modules/14-main-app.md`, `docs/modules/11-notebook-editor-ui.md`, `docs/modules/05-code-execution.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`

---

## 2026-04-19 - Sync documental del ownership de notificaciones en el shell

1. La documentación del módulo ahora deja explícito que `App.js` es el owner de la cola visible de notificaciones y de la resolución de `target` metadata entre `home`, `file`, documento, template y panel `Agents`.
2. Se alinea el wording de arquitectura para distinguir navegación explícita por notificación vs expansión inline del feed, sin atribuirle a `NotificationCenter` ownership de routing.
3. También se sincronizan riesgos/salidas del shell para reflejar el impacto sobre `workspaceSurface` y sobre el flujo MCP/home.

**Archivos:** `docs/modules/14-main-app.md`, `docs/modules/15-notification-center.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`, `docs/changelog/14-main-app.md`, `docs/changelog/15-notification-center.md`

---

## 2026-04-19 - Shell del editor de template alineado a slots semánticos

1. `TemplateEditorContainer` separa la navegación de estilos Word reales (`style_browser`) de la banda persistida `semantic_style_slots`, que pasa a ser el contrato runtime visible del editor.
2. El import/export portable del shell sube a `schema_version=1.1`, persiste `semantic_style_slots` y acepta `category_overrides` solo como compatibilidad legacy de import.
3. `useTemplateMessageHandler` rehidrata también `template_semantic_slots_updated`, evitando `template_get` extra después de guardar la selección Word-first.

**Archivos:** `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/hooks/useTemplateMessageHandler.js`, `frontend/src/contracts/wsMessageTypes.generated.js`, `docs/modules/14-main-app.md`, `docs/modules/17-template-editor.md`, `docs/changelog/14-main-app.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-04-19 - Apertura de dependencias sin remount transitorio del visor PDF

1. `VisualizationPanel.js` deja de asumir `docx` como vista inicial universal: cuando llega con `dependencyTarget` activo, parte directamente en `dependencies` y evita el mount fugaz del shell documental antes del auto-switch.
2. `PdfViewer.js` endurece el lifecycle entre instancias del shell: el destroy previo reserva una cola global antes de drenar tareas y un nuevo `getDocument(...)` espera a que termine ese teardown, cerrando el error `PDFWorker.fromPort - the worker is being destroyed`.
3. Se agregan regresiones específicas en `VisualizationPanel.test.js` y `PdfViewer.test.js` para fijar ambos comportamientos.

**Archivos:** `frontend/src/components/VisualizationPanel.js`, `frontend/src/components/PdfViewer.js`, `frontend/src/components/VisualizationPanel.test.js`, `frontend/src/components/PdfViewer.test.js`, `docs/modules/14-main-app.md`, `docs/modules/12-dependency-graph-ui.md`, `docs/architecture/frontend-flow.md`, `docs/changelog/14-main-app.md`, `docs/changelog/12-dependency-graph-ui.md`

---

## 2026-04-18 - Reposicionamiento open source y launcher agent-first

1. `ProjectLauncher.js` deja atrás el copy de "workspace requerido" y pasa a una pantalla de misión English-first con tres rutas explícitas: `Start with Agent`, `Start from example` y `Open project`.
2. `App.js` suma un seed reproducible del demo open source: crea un workspace nuevo, escribe el ejemplo estructural canónico (`beam_report.ipynb`, `beam_design.py`, `inputs/beam_case.json`) y puede abrir el notebook + arrancar la superficie visible de agentes sin tocar contratos.
3. `DesktopTitleBar.js` reemplaza el branding basado solo en `🐍` por wordmark + brand mark y una franja de misión (`Understand the project`, `Run calculations`, `Ship reports`) cuando el shell no tiene archivo contextual activo.
4. `McpStatusButton.js` y `McpPanel.js` siguen operando sobre el mismo backend MCP, pero el producto pasa a mostrar `Agents` y `Live Agent View` como nombres visibles de la superficie UI; `NotebookEditor.js` ajusta también el banner de actividad para eliminar la referencia directa a MCP.
5. Se agregan regresiones específicas para el launcher y para el header/split control actualizado.

**Archivos:** `frontend/src/App.js`, `frontend/src/data/exampleWorkspaceSeed.js`, `frontend/src/components/ProjectLauncher.js`, `frontend/src/components/ProjectLauncher.css`, `frontend/src/components/ProjectLauncher.test.js`, `frontend/src/components/DesktopTitleBar.js`, `frontend/src/components/DesktopTitleBar.css`, `frontend/src/components/DesktopTitleBar.test.js`, `frontend/src/components/McpStatusButton.js`, `frontend/src/components/McpStatusButton.test.js`, `frontend/src/components/McpPanel.js`, `frontend/src/components/McpPanel.css`, `frontend/src/components/NotebookEditor.js`, `frontend/public/favicon.png`, `desktop/main.js`, `desktop/splash.html`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `.github/ISSUE_TEMPLATE/*`, `examples/structural-report-demo/*`, `docs/modules/14-main-app.md`, `docs/modules/24-desktop-shell.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

## 2026-04-18 - Stage 2 persistent agent-first workspace shell

1. `App.js` separa el workspace activo en un estado frontend-local `workspaceSurface: 'home' | 'file'`, aterriza por defecto en `home` cuando existe `active_workspace` y vuelve a esa superficie al cerrar el último archivo.
2. `AgentWorkspaceHome` pasa a ser la superficie principal del workspace y hace visible `Entender -> Ejecutar -> Entregar`; archivos, notebooks, explorer y tabs quedan explícitamente como herramientas secundarias del mismo workspace.
3. La experiencia principal `Agents` se mueve al home; `McpPanel` permanece como inspector avanzado y `mcp_mirror_event` sigue actualizando estado sin secuestrar el foco hacia archivos mientras el usuario está en `home`.
4. Stage 2 es frontend-local: no agrega ni modifica contratos públicos WS/REST/MCP.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/AgentWorkspaceHome.js`, `frontend/src/components/AgentWorkspaceHome.css`, `frontend/src/components/FileExplorer.js`, `frontend/src/components/FileTabs.js`, `frontend/src/components/McpPanel.js`, `frontend/src/components/McpStatusButton.js`, `docs/modules/14-main-app.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`, `docs/changelog/14-main-app.md`

## 2026-04-18 - Header único con acciones contextuales del archivo

1. `DesktopTitleBar.js` deja atrás la composición en dos niveles: la shell pasa a una sola barra superior con branding a la izquierda, slot contextual centrado para el archivo activo y bloque `NotificationCenter` + conexión + MCP a la derecha.
2. La tarjeta del proyecto activo y las pills `Notebook` / `Kernel ...` se eliminan; en notebook, el único indicador visible del kernel queda dentro de `NotebookToolbar`, evitando duplicidad visual en el header.
3. `NotebookToolbar.css` se ajusta para convivir dentro del slot central sin crear una subbarra extra, manteniendo el orden de acciones actual y degradando con overflow horizontal cuando falta ancho.
4. `App.js` limpia props de presentación que ya no necesitaba pasar al title bar y agrega una regresión dedicada (`DesktopTitleBar.test.js`) para fijar la ausencia de la barra antigua y la ubicación del contexto notebook/código.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/DesktopTitleBar.js`, `frontend/src/components/DesktopTitleBar.css`, `frontend/src/components/DesktopTitleBar.test.js`, `frontend/src/components/NotebookToolbar.css`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`

---

## 2026-04-18 - Estado documental unificado, índice exacto y apertura DOCX de proyecto

1. `App.js` queda como owner canónico de `documentState/documentActions`, eliminando el shim flatten que `VisualizationPanel.js` usaba para sostener la pestaña `Documento`.
2. `DocxViewer.js` y `PdfViewer.js` pasan de un outline solo por `pageNumber` a un modelo destination-aware (`destinationKey`, `anchorTopRatio`, `requestedLocation`), con rail lateral estilo Chrome que navega al bookmark exacto y decide `docked/overlay` por el ancho útil del viewport PDF.
3. El botón `DOCX` cambia de semántica en desktop: primero intenta abrir el archivo persistido en `Docx_Documents` mediante `window.inspyroDesktop.openPath(path)` y solo degrada a descarga cuando falta una ruta workspace-backed usable.
4. La capa de historial/artefactos frontend conserva ahora `workspace_path`, `workspace_relpath` y `workspace_warning`, lo que mantiene consistente la experiencia entre documento vivo, historial DOCX y fallback web.
5. Se amplían regresiones de `DocxViewer`, `PdfViewer`, `VisualizationPanel`, procedencia y hooks para fijar la navegación exacta, la rehidratación tardía de metadatos documentales y la apertura desktop del DOCX persistido.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/PdfViewer.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/utils/docxArtifacts.js`, `frontend/src/App.documentState.test.js`, `frontend/src/App.provenance.test.js`, `frontend/src/components/DocxViewer.test.js`, `frontend/src/components/PdfViewer.test.js`, `frontend/src/components/VisualizationPanel.test.js`, `frontend/src/hooks/useAppWebSocket.test.js`, `frontend/src/utils/docxArtifacts.test.js`, `docs/modules/14-main-app.md`, `docs/modules/11-notebook-editor-ui.md`, `docs/modules/24-desktop-shell.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-17 - Procedencia PDF exacta-first con apertura de notebook destino

1. `DocxViewer.js` deja de depender solo del manifiesto ya cargado: si el `provenance_id` clicado no está disponible, reconsulta `/api/docx/provenance/open?format=json`, injerta el fragmento resuelto y vuelve a navegar sin mostrar el warning prematuro.
2. La navegación de `Modo origen` pasa a priorizar `exact`; además, cuando la procedencia solo trae `notebook_cell_id`, el visor completa el target con `sourcePath` del documento para no perder el notebook de origen.
3. El resolver frontend deja de obedecer el host/puerto absoluto incrustado en el PDF: si el hyperlink fue generado contra `127.0.0.1:8000` pero la sesión actual corre en otro origen, `DocxViewer` reescribe `/api/docx/provenance/open` al `API_BASE` activo antes de resolver o abrir la procedencia; si el overlay no trae `provenanceId`, el visor lo deriva del propio URL.
4. El flujo interno de errores deja de ser opaco: el shell clasifica en logs `resolver_404`, `missing_manifest_item`, `missing_navigation_target` y conserva `stale_origin` como contexto de drift sin cambiar el mensaje corto visible al usuario.
5. `App.js` agrega un pending-navigation notebook-first: ahora puede abrir una `.ipynb` objetivo y completar después el foco de celda/línea cuando `NotebookEditor` ya expuso `actionsRef`, en vez de quedarse solo en “abrir archivo”.
6. `backend/app/routers/docx.py` mantiene la página HTML segura en `/api/docx/provenance/open`, pero agrega `?format=json` para resolver fragmentos puntuales desde el visor controlado sin introducir una ruta REST nueva.

**Archivos:** `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.test.js`, `frontend/src/App.js`, `frontend/src/App.dependency.test.js`, `backend/app/routers/docx.py`, `backend/tests/test_docx_artifacts.py`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-04-15 - Fix robusto del loop de callbacks y pantalla negra en `Documento`

1. `PdfViewer.js` deja de depender de la identidad de callbacks del padre para decidir recargas: la carga del PDF ahora se gobierna solo por la fuente real del documento, con metadata publicada por refs estables para evitar el loop `PdfViewer -> DocxViewer -> PdfViewer` que provocaba flashes grises y el error de `pdf.js` `Cannot resolve callback`.
2. `DocxViewer.js` mantiene el modelo `visible-only`, conserva el estado UX del lector y reinyecta `requestedPage` solo en transiciones reales de visibilidad, no por replay incidental de metadata.
3. El cambio de documento pasa a ser `swap without blanking`: el PDF anterior se conserva mientras el nuevo confirma carga, y `PdfViewer` invalida generaciones viejas antes de destruir recursos, drenando tareas async (`getDocument`, `getPage`, `getOutline`, `getAnnotations`) para no dejar callbacks huérfanos en `pdf.js`.
4. `VisualizationPanel.js` sigue manteniendo montado el shell documental, pero evita que `PdfViewer` viva dentro de un contenedor oculto; `App.js` no introduce cambios de backend ni de contratos WS/REST.

**Archivos:** `frontend/src/components/PdfViewer.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/App.js`, `frontend/src/components/PdfViewer.test.js`, `frontend/src/components/DocxViewer.test.js`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-04-15 - Toolbar PDF compacta y montaje visible-only del viewer

1. `DocxViewer.js` reemplaza la toolbar textual del lector por una barra compacta mixta: acciones primarias `DOCX` / `PDF` / `Plantilla`, controles icon-only SVG para zoom/fit/índice/modo origen y menús secundarios (`Historial DOCX`, selector de vista, limpiar) vía `DropdownMenu`.
2. `VisualizationPanel.js` pasa `isVisible` a `DocxViewer`, y el visor deja de mantener `PdfViewer` montado dentro de un contenedor oculto; ahora solo monta el PDF real cuando la pestaña `Documento` está visible, reinyectando la página solicitada al volver.
3. Esto corrige el caso de canvas en blanco / spinner infinito al alternar pestañas y reduce el footprint visual del toolbar en paneles estrechos sin tocar contratos backend ni WS.

**Archivos:** `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.css`, `frontend/src/components/DocxViewer.test.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/components/DropdownMenu.js`, `frontend/src/components/Icons.js`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-04-15 - Viewer PDF con metadata client-side, navegación y revalidación contextual

1. `PdfViewer.js` expone metadata real del documento desde `pdfjs` (`numPages`, `outline`, `hasOutline`), resuelve destinos internos del PDF y publica la página visible actual para que `DocxViewer` pueda gobernar la UX del lector sin subir ese estado a `App.js`.
2. `DocxViewer.js` agrega toolbar PDF con contador de páginas, `Ir a página`, `Zoom -`, `Zoom +`, `100%`, `Fit ancho` e `Índice`; el estado local del lector (`currentPage`, `requestedPage`, `zoomPercent`, `fitMode`, `outline`) se resetea al cambiar la fuente PDF.
3. `PdfViewer.js` deja de rasterizar todas las páginas a la vez: ahora calcula offsets propios y renderiza en modo windowed/lazy con buffer corto alrededor de la página visible o solicitada, manteniendo overlays accesibles y navegación interna por bookmarks/destinos.
4. `VisualizationPanel.js` mantiene `DocxViewer` montado aunque la pestaña `Documento` no esté visible, y `App.js` revalida `/pdf-status` al reconectar, al volver a mostrar `Documento` y al reintentar la reconversión PDF, evitando estados stale del convertidor.

**Archivos:** `frontend/src/components/PdfViewer.js`, `frontend/src/components/PdfViewer.test.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.test.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/App.js`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-04-14 - `PdfViewer` serializa destroy de pdf.js entre recargas

1. `PdfViewer.js` deja de iniciar un `pdfjs.getDocument()` nuevo mientras el `PDFDocumentLoadingTask.destroy()` anterior sigue pendiente; el teardown ahora se serializa entre cambios rápidos de `pdfUrl`.
2. Esto corrige la carrera `PDFWorker.fromPort - the worker is being destroyed` que aparecía al rehidratar un PDF nuevo antes de que pdf.js terminara de destruir el worker anterior.
3. Se agrega una regresión frontend dedicada para fijar que un cambio rápido de PDF espera a que termine el `destroy()` previo antes de abrir el siguiente documento.

**Archivos:** `frontend/src/components/PdfViewer.js`, `frontend/src/components/PdfViewer.test.js`, `docs/modules/14-main-app.md`

---

## 2026-04-14 - `DocxViewer` limpia previews PDF stale y no reinyecta `pdf_ref` muertos

1. `DocxViewer.js` deja de conservar el `pdfBlobUrl` anterior cuando una generación DOCX nueva ya limpió su fuente PDF actual; si no hay `pdf_ref` ni `pdfBase64` vigentes, el visor vacía la preview en vez de seguir mostrando el PDF previo.
2. Cuando un `pdf_ref` temporal falla con `404` o un token expirado, el shell ya no entrega esa URL rota a `pdf.js`; la trata como error local de carga, muestra retry explícito y evita el `MissingPDFException` en la vista.
3. Se agregan regresiones frontend para fijar el caso “nuevo DOCX sin PDF aún no debe heredar la preview vieja” y el caso “`pdf_ref` temporal faltante no debe seguir abriéndose como si fuera un PDF válido”.

**Archivos:** `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.test.js`, `docs/modules/14-main-app.md`

---

## 2026-04-13 - El shell ya no interpreta el documento como parte del terminal de ejecución

1. `documentPipelineStatus` pasa a representar un pipeline realmente posterior al `notebook_cell_executed` final, en vez de un simple reflejo visual mientras la última celda seguía trabajando.
2. `VisualizationPanel` / `DocxViewer` continúan mostrando contexto documental, pero el shell asume que los artefactos finales pueden llegar completamente después del terminal de ejecución.
3. Esto mantiene consistente la separación entre notificaciones de notebook y notificaciones del documento final.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/components/DocxViewer.js`, `docs/modules/14-main-app.md`, `docs/architecture/feature-threads.md`

---

## 2026-04-13 - `documentPipelineStatus` separa shell documental de la corrida notebook

1. `App.js` agrega `documentPipelineStatus` al estado notebook y lo propaga a `VisualizationPanel` / `DocxViewer` sin mezclarlo con el terminal de ejecución.
2. `DocxViewer` sigue mostrando mensajes contextuales de documento, pero ahora se alimenta del estado estructurado del pipeline en vez de competir con la barra superior del editor.
3. El shell preserva la separación semántica entre notificaciones de `Run All` y notificaciones del documento final.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/hooks/useAppWebSocket.js`, `docs/modules/14-main-app.md`, `docs/llm-index.yaml`

---

## 2026-04-08 - `DocxViewer` revalida historial remoto al cambiar DOCX/PDF del notebook

1. El botón principal `DOCX` y la hidratación de `/api/docx/history` pasan a usar `fetch(..., { cache: "no-store" })`, eliminando reutilización de respuestas viejas por parte del navegador o del shell.
2. `DocxViewer` rehidrata historial remoto no solo cuando cambia `sourcePath`/`kernelId`, sino también cuando entra un `docxUpdatedAt` nuevo o un `pdf_ref`/`pdf_hash` nuevo del mismo notebook.
3. Esto evita que el visor siga descargando el artefacto anterior cuando el PDF del último run ya llegó, pero la metadata DOCX viva quedó stale o incompleta en memoria.
4. Se agregan regresiones frontend para descargas repetidas `source_path`-based, refresh por `docxUpdatedAt`, refresh de rescate por `pdf_ref` y una E2E notebook que vuelve a descargar el DOCX después de modificar el `.ipynb`.

**Archivos:** `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.test.js`, `frontend/tests/notebook-docx.spec.ts`, `frontend/tests/helpers/ui.ts`, `docs/modules/14-main-app.md`, `docs/changelog/14-main-app.md`

---

## 2026-04-07 - Dirty notebook robusto y warnings de conflicto deduplicados

1. `useFileSystem` pasa a exponer el origen de `notebookData` (`runtime` vs `persistable`) y `App.js` propaga esa metadata a `NotebookEditor`, evitando que una carga inicial, recarga same-path o snapshot MCP vuelva a marcar el notebook como modificado.
2. El shell sigue bloqueando el espejo MCP cuando existe dirty humano real, pero deja de fabricar conflictos falsos al abrir notebooks limpios.
3. `App.js` deduplica los avisos de `workspace_fs_event` por archivo: mientras un path siga en conflicto, el `NotificationCenter` solo muestra una advertencia visible por sesión de conflicto.
4. `FileExplorer` deduplica cargas concurrentes de carpeta y deja de refrescar el árbol raíz por eventos `modified` de archivo, eliminando el parpadeo del indicador `...` al abrir varios notebooks rápidos en la raíz del workspace.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.test.js`, `frontend/src/hooks/useFileSystem.js`, `frontend/src/hooks/useFileSystem.test.js`, `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `frontend/src/components/FileExplorer.js`, `frontend/src/components/FileExplorer.test.js`, `docs/modules/14-main-app.md`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/feature-threads.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`

---

## 2026-04-07 - Espejo MCP opt-in, boot renderer robusto y smoke de arranque

1. La política MCP de shell se extrae a `useMcpShellControls`, evitando que `App.js` vuelva a depender del orden interno de hooks para `setMirrorEnabled` y eliminando la regresión que dejaba el renderer en negro durante el primer render.
2. `useMcpActivity` mantiene `mirrorEnabled` persistido en `localStorage`, con `default OFF` solo si no existía preferencia previa; `start/restart` exitosos desde UI vuelven a forzarlo a `true`.
3. `useFileSystem` conserva la activación de tabs desde caché y `FileExplorer` mantiene el corte del loop `tree/read/tree/read`, dejando `reloadFile` y `reloadFileByPath` como recargas reales explícitas.
4. `frontend/src/index.js` y `frontend/src/boot/RendererRoot.js` introducen un arranque renderer en dos fases (`renderer_bootstrap_ready` + `renderer_app_ready`/`renderer_app_failed`) con fallback fatal visible y reporters globales de errores.
5. Se agregan regresiones de mount real (`src/App.mount.test.js`, `src/index.test.js`, `src/boot/RendererRoot.test.js`) y un smoke Electron reproducible (`desktop/scripts/smoke-renderer.cjs`) para impedir que vuelva a colarse un renderer vacío.
6. `focusDocxView` vuelve a usar `visualizationViewRequest`, eliminando el warning por `setVisualizationViewRequest` sin uso y restaurando el foco DOCX desde replay MCP.

**Archivos:** `frontend/src/App.js`, `frontend/src/index.js`, `frontend/src/App.test.js`, `frontend/src/App.mount.test.js`, `frontend/src/index.test.js`, `frontend/src/boot/RendererRoot.js`, `frontend/src/boot/RendererRoot.test.js`, `frontend/src/boot/rendererDesktopBridge.js`, `frontend/src/hooks/useMcpShellControls.js`, `frontend/src/hooks/useMcpShellControls.test.js`, `frontend/src/hooks/useMcpActivity.js`, `frontend/src/hooks/useMcpActivity.test.js`, `frontend/src/hooks/useMcpMirror.js`, `frontend/src/hooks/useMcpMirror.test.js`, `frontend/src/hooks/useFileSystem.js`, `frontend/src/hooks/useFileSystem.test.js`, `frontend/src/components/FileExplorer.js`, `frontend/src/components/FileExplorer.test.js`, `frontend/src/components/McpPanel.js`, `frontend/src/components/McpPanel.test.js`, `frontend/src/components/McpStatusButton.js`, `frontend/src/components/McpStatusButton.test.js`, `desktop/main.js`, `desktop/preload.js`, `desktop/splash-preload.js`, `desktop/splash.html`, `desktop/scripts/smoke-renderer.cjs`, `desktop/package.json`, `docs/modules/14-main-app.md`, `docs/modules/24-desktop-shell.md`, `docs/architecture/feature-threads.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`, `docs/changelog/24-desktop-shell.md`

---

## 2026-04-05 - Shell desktop-aware, title bar híbrida y notificaciones nativas

1. `App.js` reemplaza el header compacto por `DesktopTitleBar`, integrando branding, estado de conexión, toolbar notebook/código, `NotificationCenter` y `McpStatusButton` en una barra compatible con drag regions del shell Electron.
2. El shell principal consume `desktop:menu-action`, reporta el workspace activo con `window.inspyroDesktop.reportWorkspace()`, confirma `notifyRendererReady()` y arbitra notificaciones nativas para DOCX/PDF, `Run All` y fallos MCP.
3. El flujo desktop desacopla shortcuts y acciones nativas del renderer sin mover lógica de negocio al proceso principal de Electron.
4. La jerarquía visual del header se refina con tarjeta de proyecto activo y branding visible `🐍`, mientras la disponibilidad del convertidor PDF sale del header y pasa a `DocxViewer` como estado contextual de la pestaña `Documento`.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/DesktopTitleBar.js`, `frontend/src/components/DesktopTitleBar.css`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/public/favicon.png`, `desktop/main.js`, `desktop/preload.js`, `desktop/splash.html`, `docs/modules/14-main-app.md`, `docs/modules/24-desktop-shell.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/system-context.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-29 - Explorer lazy, quick open, sync por `workspace_fs_event` e iconografía temática

1. `FileExplorer` pasa a un store por `path` con árbol lazy, búsqueda quick open por nombre, clipboard interno (`copy/cut/paste`), `move/copy/duplicate`, drag-and-drop, reveal del archivo activo e iconografía SVG temática por extensión/familia, con cobertura dedicada para carpetas, `py/pyi`, `ipynb`, `ps1/psm1/psd1`, `sh/bash/zsh`, `js`, `ts`, `jsx/tsx`, `json`, `md`, `txt`, `csv/tsv`, `yml/yaml/toml/ini/cfg/conf`, `html/xml/svg`, `css/scss/less`, `docx`, `pdf`, imágenes raster, `log` y `env`.
2. `App.js` escucha `workspace_fs_event`, recarga tabs limpios en background, marca conflictos externos sobre tabs dirty y reexpone el batch al explorer para refresco granular sin colapsar la expansión.
3. `useFileSystem` agrega estado `externalStaleFiles` / `externalConflictFiles`, soporta renames/removes por prefijo y aplica batches externos sobre archivos/directorios abiertos.

**Archivos:** `frontend/src/components/FileExplorer.js`, `frontend/src/components/FileExplorer.css`, `frontend/src/components/FileExplorer.test.js`, `frontend/src/hooks/useFileSystem.js`, `frontend/src/hooks/useFileSystem.test.js`, `frontend/src/hooks/useAppWebSocket.js`, `frontend/src/App.js`, `docs/modules/14-main-app.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-03-27 - Historial DOCX vacío visible, pero fuera del CTA principal

1. `DocxViewer` mantiene visibles en historial las entradas `docx_is_empty=true`, pero las marca con warning y deja de usarlas como candidatas del botón principal `DOCX`.
2. La descarga explícita desde historial sigue disponible para esas versiones, aunque la UI avisa que se trata de un DOCX vacío referencial.
3. El estado latest-wins del shell queda alineado con el lookup backend por `source_path`/`kernel_id`, priorizando siempre el último artefacto no vacío.

**Archivos:** `frontend/src/components/DocxViewer.js`, `frontend/src/utils/docxArtifacts.js`, `docs/modules/14-main-app.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-24 - Shell hidrata y confirma `Documento (Global)` sin round-trip extra

1. `TemplateEditorContainer` envía `template_update_document_defaults` desde la selección `Documento (Global)` y conserva el estado dirty hasta recibir el ack correlado.
2. `useTemplateMessageHandler` hidrata `templateInfo` directamente con `template_document_defaults_updated`, evitando un `template_get` adicional tras editar defaults globales.
3. El shell ahora mantiene `document_defaults` dentro de `templateInfo`, por lo que el panel global se reabre con los valores materiales que Word usará en el DOCX final.

**Archivos:** `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/hooks/useTemplateMessageHandler.js`, `frontend/src/contracts/wsMessageTypes.generated.js`, `docs/modules/14-main-app.md`, `docs/modules/17-template-editor.md`

---

## 2026-03-24 - Template Editor muestra la misma fuente efectiva y advierte faltantes del host

1. `TemplateEditorContainer` deja de pintar las cards de estilo con `style.font` parcial y pasa a usar la misma `resolved_font` efectiva que el panel de edición.
2. El shell propaga `system_font_catalog` dentro de `templateInfo`, permitiendo que `StyleEditPanel` avise cuando una familia no se detecta en el equipo sin cambiar el nombre real del template.
3. Se agrega una regresión frontend para fijar que las cards usen la fuente efectiva heredada por theme/docDefaults.

**Archivos:** `frontend/src/components/template-editor/fontUtils.js`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/StyleEditPanel.test.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/components/TemplateEditor.css`, `docs/modules/14-main-app.md`, `docs/modules/17-template-editor.md`

---

## 2026-03-24 - Spinner PDF solo con conversión realmente activa

1. `DocxViewer` deja de mostrar el overlay “Generando PDF...” y el aviso “PDF tardando...” cuando el notebook recién cargado solo tiene DOCX estable/historial, pero no existe una conversión PDF activa ni un `pdf_ref` en carga.
2. La decisión visual pasa a depender de señales explícitas (`conversionStatus` o fetch real del `pdf_ref`) en vez de inferirse desde `hasDocx`.
3. Se agrega una regresión frontend para fijar el caso “history-only no debe parecer conversión PDF”.

**Archivos:** `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.test.js`, `docs/modules/14-main-app.md`

---

## 2026-03-24 - Botón Plantilla visible antes de arrancar kernel aunque exista historial DOCX

1. `DocxViewer` deja de ocultar el botón `Plantilla` en el toolbar completo cuando hay historial DOCX o descarga estable pero aún no existe `kernelId`.
2. El botón reutiliza `handleTemplateButtonClick`, de modo que puede pedir `onRequestKernelStart` antes de abrir el modal en vez de exigir un kernel ya iniciado.
3. Se agrega una regresión frontend para fijar el caso “history present + no kernel + template button visible”.

**Archivos:** `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.test.js`, `docs/modules/14-main-app.md`

---

## 2026-03-24 - El botón DOCX principal descarga el último artefacto persistido

1. `DocxViewer` deja de priorizar una `docxDownloadUrl` actual stale cuando ya existe una entrada más nueva en el historial DOCX fusionado.
2. El botón principal `DOCX` usa primero la entrada newest-first del historial para descargar el artefacto persistido más reciente y mantener coherencia con el PDF vigente mostrado en el panel.
3. Se agrega una regresión frontend para fijar el caso “URL actual vieja + historial nuevo => descarga el DOCX nuevo”.

**Archivos:** `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.test.js`, `docs/modules/14-main-app.md`

---

## 2026-03-23 - Historial DOCX local solo con identidad estable real

1. `docxArtifacts.js`, `useAppWebSocket` y `App.js` dejan de considerar “nuevo DOCX” los payloads que solo arrastran claves DOCX nulas o stale; la deduplicación local ahora usa `artifact_id || downloadUrl || docxHash`.
2. `DocxViewer` normaliza/purga entradas legacy inválidas al rehidratar `localStorage` y sigue combinando ese fallback local con `/api/docx/history`.
3. Esto elimina el conteo inflado de historial durante ejecuciones largas y deja una sola entrada nueva por generación DOCX final real.

**Archivos:** `frontend/src/App.js`, `frontend/src/hooks/useAppWebSocket.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/utils/docxArtifacts.js`, `frontend/src/utils/docxArtifacts.test.js`, `frontend/src/App.test.js`, `docs/modules/14-main-app.md`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-23 - Descarga DOCX estable, retry por ruta fija e historial visible en UI

1. `useAppWebSocket` y `App.js` aceptan payloads DOCX `docx_ref`-only/token-only, resuelven URL estable por `artifact_id`/`source_path` y reemplazan referencias stale con estrategia latest-wins.
2. `App.js` mantiene historial DOCX local por `source_path`, lo persiste en `localStorage` y lo combina con el historial backend para que notebooks, modo código y replay MCP compartan la misma semántica de descarga.
3. `DocxViewer` deja de anunciar éxito por `a.click()` directo: ahora descarga por `fetch -> blob`, reintenta contra la ruta estable por `source_path`/`kernel_id` si la ref actual falla y expone un menú de historial DOCX tanto en toolbar como en empty state.
4. `VisualizationPanel` propaga `docxHistory`, `sourcePath`, `sourceKind` y `docxFileToken` al visor para unificar el comportamiento entre notebook UI, modo código y artefactos reflejados por MCP.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.test.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/NotebookEditor.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/hooks/useAppWebSocket.js`, `frontend/src/utils/docxArtifacts.js`, `docs/modules/14-main-app.md`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-15 - Hardening del shell para E2E real y file actions controladas

1. `FileExplorer` reemplaza `prompt()` por diálogos controlados para crear, renombrar y eliminar archivos/carpetas, mejorando feedback humano y automatización Playwright.
2. `App.js` preserva el panel de variables cuando llegan payloads tardíos de DOCX/PDF y evita el borrado accidental de `variables`.
3. `useAppWebSocket` deja de registrar `pong` como mensaje no manejado.
4. Launcher, selector de carpetas, explorer, visualización y controles MCP agregan `data-testid` estables para la suite E2E real.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/FileExplorer.js`, `frontend/src/components/FolderSelector.js`, `frontend/src/components/ProjectLauncher.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/components/McpPanel.js`, `frontend/src/components/McpStatusButton.js`, `frontend/src/hooks/useAppWebSocket.js`, `docs/modules/14-main-app.md`, `docs/modules/16-ui-automation-guide.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-14 - Espejo granular MCP para files/documents y toggle estricto

1. `App.js` pasa `mirrorEnabled`, `triggerWorkspaceRefresh` y nuevos helpers path-based de `useFileSystem` hacia `useMcpMirror`, para que el replay granular cubra `files` y `documents` ademas de `notebook/templates`.
2. `useMcpMirror` deja de aplicar snapshots/runtime cuando `mirrorEnabled=false`, vacia la cola pendiente al apagar el modo espejo y agrega manejo de `file_mutation` para recargar tabs limpios, retargetear renames y cerrar deletes sin forzar foco.
3. `useMcpActivity` amplía `GRANULAR_MIRROR_GROUPS` a `files` y `documents`, quedando como feed/notificaciones para esos grupos en lugar de recargar contenido por hints parciales.
4. `useFileSystem` agrega `reloadFileByPath`, `renameOpenFile` y `removeOpenFile` para operar sobre tabs no activos sin depender del archivo enfocado.
5. Se agregan regresiones unitarias para `useMcpMirror`, `useMcpActivity` y `useFileSystem`, incluyendo rename/delete de archivo abierto, write sin cambio de foco y desactivación estricta del espejo.

**Archivos:** `frontend/src/App.js`, `frontend/src/hooks/useMcpMirror.js`, `frontend/src/hooks/useMcpActivity.js`, `frontend/src/hooks/useFileSystem.js`, `frontend/src/hooks/useMcpMirror.test.js`, `frontend/src/hooks/useMcpActivity.test.js`, `frontend/src/hooks/useFileSystem.test.js`, `docs/modules/14-main-app.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-13 - Dropdown de acciones poco frecuentes en notebook

1. El header de notebook agrega un dropdown dedicado a acciones de baja frecuencia, separado del menú de configuración, con `Eliminar outputs` como primera operación disponible.
2. `App.js` centraliza `clearNotebookRuntimeData()` para vaciar el estado DOCX/PDF/variables del panel derecho cuando el editor limpia resultados locales del notebook.
3. Se agregan regresiones unitarias para el wiring del toolbar y para la limpieza integral de runtime en `NotebookEditor`.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/NotebookToolbar.js`, `frontend/src/components/NotebookToolbar.css`, `frontend/src/components/NotebookToolbar.test.js`, `docs/modules/14-main-app.md`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/frontend-flow.md`

---

## 2026-03-11 - Launcher inicial para crear o abrir proyecto

1. `App.js` incorpora un estado de arranque sin proyecto activo: si backend no reporta `active_workspace` y no hay tabs abiertas, el shell deja de mostrar editor/explorador y presenta una pantalla inicial con CTA de `Nuevo proyecto`, `Abrir proyecto` y lista de recientes.
2. `ProjectLauncher` reutiliza el contrato de workspace del backend (`suggested_workspace_root`, `recent_workspaces`) y deriva la UX de arranque desde la fuente de verdad del backend en lugar de rehidratar un workspace stale desde `localStorage`.
3. `useFileSystem` deja de levantar el workspace inicial desde storage local, mientras `FileExplorer` solo sincroniza `active_workspace`, limpia el arbol cuando no hay proyecto activo y reporta el payload de sistema completo al shell.
4. Se agregan regresiones unitarias sobre la normalizacion del payload de workspace y la condicion que activa el launcher.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.css`, `frontend/src/App.test.js`, `frontend/src/components/ProjectLauncher.js`, `frontend/src/components/ProjectLauncher.css`, `frontend/src/components/FileExplorer.js`, `frontend/src/hooks/useFileSystem.js`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`

---

## 2026-03-11 - Workspace activo persistido y creación desde UI

1. `FileExplorer` deja de tratar el workspace como una selección solo local y pasa a sincronizarlo con backend mediante `GET /api/system/info` y `POST /api/system/workspace`.
2. `FolderSelector` incorpora flujo de “Crear y abrir” para generar un workspace nuevo dentro de la carpeta elegida sin obligar al usuario a trabajar dentro de la carpeta de instalación de Inspyro.
3. Backend persiste el workspace activo fuera del árbol instalado, expone `active_workspace`, `suggested_workspace_root` y `recent_workspaces`, y convierte ese contexto en la fuente de verdad que consumen UI y MCP.
4. Se agregan pruebas de backend para selección/creación de workspace y se documenta el nuevo contrato REST.

**Archivos:** `backend/main.py`, `backend/app/services/workspace_service.py`, `backend/tests/test_system_workspace_api.py`, `frontend/src/components/FileExplorer.js`, `frontend/src/components/FolderSelector.js`, `frontend/src/components/FolderSelector.css`, `docs/architecture/contracts-catalog.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/modules/14-main-app.md`, `docs/llm-index.yaml`

---

## 2026-03-10 - Dedupe de tabs en espejo MCP

1. `useFileSystem` ahora colapsa aperturas concurrentes del mismo `path`, evitando tabs duplicados cuando varias acciones MCP intentan abrir el mismo notebook antes de que el shell consolide `openFiles`.
2. `useMcpMirror` marca `step_id` en vuelo para no reprocesar el mismo `mcp_mirror_event` si entra a la vez por `lastMessage` y `messageQueue`.
3. Se agregan regresiones frontend que cubren apertura same-path concurrente y deduplicación de un mismo `step_id` durante el replay MCP.

**Archivos:** `frontend/src/hooks/useFileSystem.js`, `frontend/src/hooks/useMcpMirror.js`, `frontend/src/hooks/useFileSystem.test.js`, `frontend/src/hooks/useMcpMirror.test.js`, `docs/modules/14-main-app.md`

---

## 2026-03-08 - Arbitraje granular de espejo MCP en shell

1. `App.js` separa telemetría y replay: `useMcpActivity` queda para feed/runs/toggle/`agentExecutionState`, mientras `useMcpMirror` consume `mcp_mirror_event`.
2. El shell autoabre y enfoca notebooks limpios tocados por MCP, pero bloquea el espejo cuando la ruta objetivo está dirty y emite un conflicto visible.
3. `handleMcpArtifact` y el estado global de template pasan a aceptar snapshots/artefactos reflejados sin depender del `lastMessage` humano.
4. `VisualizationPanel` acepta `requestedView` para forzar `docx` cuando un cambio MCP afecta template o artefactos exportados.

**Archivos:** `frontend/src/App.js`, `frontend/src/hooks/useMcpActivity.js`, `frontend/src/hooks/useMcpMirror.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/hooks/useAppWebSocket.js`, `docs/modules/14-main-app.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-03-08 - Guardas contra sockets WS obsoletos

1. `useWebSocket` ahora ignora callbacks `open/message/error/close` de instancias viejas cuando ya existe un socket más nuevo en `wsRef.current`.
2. El shell deja de quedar en falso estado `Conectado` con `wsRef` nulo tras remounts/reintentos de desarrollo, evitando pérdida silenciosa de `execute_code` y `notebook_*`.
3. Se agrega prueba unitaria que reproduce un `close` stale después de una reconexión exitosa y verifica que `sendMessage` siga usando el socket activo.

**Archivos:** `frontend/src/hooks/useWebSocket.js`, `frontend/src/hooks/useWebSocket.test.js`, `docs/modules/14-main-app.md`

---

## 2026-03-08 - Reconexión WS auto-recuperable y polling MCP independiente

1. `useWebSocket` deja de agotarse tras 5 intentos y mantiene reconexión indefinida con backoff exponencial acotado.
2. El shell fuerza reintento inmediato al volver `focus`, `online` o `visibilitychange`, reduciendo la necesidad de refresh manual tras reinicios del backend/runtime.
3. `App.js` consulta `/api/mcp/status` de forma periódica e independiente del WebSocket principal, para que el estado `running/stopped` de MCP no quede congelado mientras el socket reintenta.

**Archivos:** `frontend/src/hooks/useWebSocket.js`, `frontend/src/hooks/useWebSocket.test.js`, `frontend/src/App.js`, `docs/modules/14-main-app.md`

---

## 2026-03-07 - Feed MCP estructurado y Modo espejo UI

1. `App.js` incorpora `useMcpActivity` para hidratar `/api/mcp/activity`, consumir `mcp_activity_event` y derivar `activity`, `activeRuns`, `runningCount` y `mirrorEnabled`.
2. Se agrega el `Modo espejo MCP` persistido en `localStorage`; el feed MCP siempre sigue visible, pero el toggle decide si el shell rehidrata cambios del recurso activo.
3. `McpStatusButton` pasa a split control con badge de runs activos y mini-toggle embebido; `McpPanel` prioriza una pestaña `Actividad` con historial y badge de "Reflejado".
4. `App.js` deja de depender del flujo `statusMessage/statusType` y centraliza una cola externa de notificaciones para mezclar mensajes legacy con eventos MCP estructurados.

**Archivos:** `frontend/src/App.js`, `frontend/src/hooks/useMcpActivity.js`, `frontend/src/components/McpStatusButton.js`, `frontend/src/components/McpPanel.js`, `frontend/src/components/NotificationCenter.js`, `docs/modules/14-main-app.md`, `docs/modules/15-notification-center.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-02-21 — Wiring de navegación grafo → editor desde App

1. `App.js` deja de pasar `onNavigateToCode: null` al panel de dependencias y conecta callback real hacia `notebookActionsRef.current.navigateToCode`.
2. Se agrega manejo de error UI con `NotificationCenter` cuando la navegación no puede resolver celda/línea destino.
3. Se alinea la integración entre módulos `14-main-app`, `11-notebook-editor-ui` y `12-dependency-graph-ui`.

**Archivos:** `frontend/src/App.js`, `docs/modules/14-main-app.md`, `docs/changelog/11-notebook-editor-ui.md`, `docs/changelog/12-dependency-graph-ui.md`

---

## 2026-02-19 — Compatibilidad CRA5: rollback de `webpack-dev-server` a v4

1. Se corrige incompatibilidad de arranque en desarrollo cambiando `overrides.webpack-dev-server` de `5.2.3` a `4.15.2` para alineación con `react-scripts@5.0.1`.
2. Se regenera lockfile/dependencias del frontend y se valida que `npm start` ya no falle por `unknown property 'onAfterSetupMiddleware'`.
3. Se mantiene la postura de seguridad de producción: `npm audit --omit=dev` permanece en 0 vulnerabilidades; las moderadas restantes siguen acotadas a cadena `dev` del stack CRA.

**Archivos:** `frontend/package.json`, `frontend/package-lock.json`, `docs/modules/14-main-app.md`

## 2026-02-19 — Hardening de seguridad frontend y saneamiento SVG

1. `OutputRenderer` ahora sanitiza payload `image/svg+xml` con perfil SVG de `DOMPurify` antes de usar `dangerouslySetInnerHTML`.
2. `DocxViewer` agrega `hasDocx` a dependencias del efecto de preview PDF para evitar condiciones stale al alternar entre docx/pdf durante reconversión.
3. Se actualizan dependencias runtime (`vega`, `vega-embed`, `vega-lite`, `mammoth`, `dompurify`, `katex`) y `react-scripts` pasa a `devDependencies`.
4. Se incorpora parche persistente (`patch-package`) para `react-dev-utils/checkRequiredFiles.js` reemplazando `fs.F_OK` por `fs.constants.F_OK` en Node 22+.
5. `npm audit --omit=dev` queda en 0 vulnerabilidades; persisten vulnerabilidades moderadas en cadena `dev` de `react-scripts` (eslint/schema-utils/ajv), mitigables sólo con migración de toolchain.

**Archivos:** `frontend/src/components/OutputRenderer.js`, `frontend/src/components/DocxViewer.js`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/patches/react-dev-utils+12.0.1.patch`, `docs/modules/14-main-app.md`

## 2026-02-10 — Fix de flicker PDF en DocxViewer

1. `DocxViewer` mantiene el PDF anterior visible mientras se genera el nuevo en lugar de destruir el blob URL prematuramente (causa primaria del blink).
2. Se elimina auto-switch HTML↔PDF durante conversión que causaba cambio de vista visible.
3. Spinner de conversión ya no se superpone sobre un PDF existente (`!pdfBlobUrl` guard).

**Archivos:** `frontend/src/components/DocxViewer.js`, `docs/modules/14-main-app.md`

## 2026-02-10 - Upload REST de template, refs PDF/DOCX y autosave desacoplado

1. `TemplateEditorContainer` migra ruta principal de upload a `POST /api/templates/upload` y envía `template_attach` por WS; `template_upload` queda como fallback legacy.
2. `useAppWebSocket`, `App` y `DocxViewer` soportan refs aditivas de artefacto (`docx_ref`, `pdf_ref`) para render/download sin base64 masivo.
3. `NotebookEditor` separa runtime de outputs respecto al notebook persistible y evita propagar cambios runtime al autosave.
4. `useFileSystem` prioriza snapshot persistible (`getPersistableNotebook`) para reducir escrituras repetitivas durante ejecución de celdas.

**Archivos:** `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/App.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/NotebookEditor.js`, `frontend/src/hooks/useAppWebSocket.js`, `frontend/src/hooks/useFileSystem.js`, `docs/modules/14-main-app.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

## 2026-02-10 - Preview PDF embebido desde `pdf_ref`

1. `DocxViewer` normaliza `pdf_ref`, fuerza `inline=1` en preview y descarga el binario como `blob` para asegurar render embebido en `iframe`.
2. La descarga explícita de PDF usa `inline=0` para mantener el comportamiento de archivo adjunto.

**Archivos:** `frontend/src/components/DocxViewer.js`, `docs/modules/14-main-app.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

## 2026-02-10 - Cleanup proactivo de kernel anterior desde flujo de cambio de archivo

1. `NotebookEditor` envía `previous_kernel_id` en `notebook_create`/`notebook_load` para permitir shutdown temprano del kernel anterior en backend.
2. Se conserva compatibilidad de contrato: payload aditivo sin romper clientes existentes.
3. Se reduce riesgo de kernels huérfanos en cambios rápidos de notebook/tab.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `backend/app/contracts/ws_models.py`, `backend/app/routers/notebook.py`, `docs/modules/14-main-app.md`, `docs/architecture/contracts-catalog.md`

## 2026-02-09 - Correlación de ejecuciones y mejoras de rendimiento UI notebook

1. `NotebookEditor` incorpora `execution_id` por celda, filtra respuestas stale y usa `notebook_cancel_execution` en timeouts.
2. Se elimina remount forzado del panel de visualización notebook (se quita `key` versionada en `App.js`).
3. `useFileSystem` migra a dirty flags/versionado para evitar comparaciones `JSON.stringify` completas en cada cambio.
4. Pipeline de preview de estilos envía `template_preview_cancel` al invalidar requests en vuelo.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/App.js`, `frontend/src/hooks/useFileSystem.js`, `frontend/src/components/template-editor/hooks/useStylePreviewPipeline.js`, `docs/modules/14-main-app.md`

## 2026-02-09 - Tipos WS compartidos generados para reducir typos

1. Se agrega generador `frontend/scripts/generate_ws_types.mjs` (fuente: `docs/llm-index.yaml`) y artefacto `frontend/src/contracts/wsMessageTypes.generated.js`.
2. `useAppWebSocket` y `useTemplateMessageHandler` reemplazan strings hardcodeados de mensajes críticos por constantes compartidas.
3. Se añade script `npm run generate:ws-types` para regeneración determinística local/CI.

**Archivos:** `frontend/scripts/generate_ws_types.mjs`, `frontend/src/contracts/wsMessageTypes.generated.js`, `frontend/src/hooks/useAppWebSocket.js`, `frontend/src/hooks/useTemplateMessageHandler.js`, `frontend/package.json`, `docs/modules/14-main-app.md`

## 2026-02-08 - Fix de logger recursivo en `useFileSystem`

1. Se corrige `warn` en el logger interno para evitar recursión (`logger.warn` llamándose a sí mismo) que detonaba `RangeError: Maximum call stack size exceeded`.
2. Se mantiene el logging condicionado por `REACT_APP_DEBUG_FILESYSTEM` sin cambios de contrato del hook.

**Archivos:** `frontend/src/hooks/useFileSystem.js`, `docs/modules/14-main-app.md`

## 2026-02-07 - Carga diferida del shell y lifecycle WS robusto

1. `App.js` migra componentes pesados a `React.lazy` (`MonacoEditor`, `NotebookEditor`, `VisualizationPanel`, `FileExplorer`) para bajar costo de primer render.
2. Se extrae manejo de mensajes template desde `App.js` a `useTemplateMessageHandler`.
3. `useWebSocket` diferencia desconexión manual de reconexión automática y limpia timers huérfanos.

**Archivos:** `frontend/src/App.js`, `frontend/src/hooks/useWebSocket.js`, `frontend/src/hooks/useTemplateMessageHandler.js`, `docs/modules/14-main-app.md`

## 2026-02-07 - Cleanup de warnings del shell principal

1. `App.js`: se removieron estados derivados no usados.
2. `DocxViewer.js`: se removieron handlers/estado de template no conectados al flujo actual.
3. `FileExplorer.js` y `FolderSelector.js`: se corrigieron dependencias de `useEffect` para evitar warnings de hooks.
4. `Icons.js`: se reemplazó export default anónimo por objeto nombrado.
5. Se preservó comportamiento funcional del shell y del flujo de template/notebook.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/FileExplorer.js`, `frontend/src/components/FolderSelector.js`, `frontend/src/components/Icons.js`, `docs/modules/14-main-app.md`

## 2026-02-06 - Normalización documental LLM-first

1. Se reestructuró el módulo para reflejar ownership de estado global y contratos WS.
2. Se incorporó explícitamente el flujo de persistencia/rehidratación de template por kernel.
3. Se alineó el módulo con `llm-index.yaml` y el catálogo de contratos.

**Archivos:** `docs/modules/14-main-app.md`, `docs/llm-index.yaml`



