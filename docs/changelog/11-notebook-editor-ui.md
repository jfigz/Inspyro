# Changelog 11 - notebook-editor-ui

> **Última actualización:** 2026-05-02

---

## 2026-05-02 - Markdown enriquecido en celdas notebook

1. `MarkdownRenderer` pasa a un pipeline async con `marked`, `marked-katex-extension`, `marked-footnote` y `mermaid`, manteniendo el bundle inicial liviano.
2. Las celdas `markdown` renderizan GFM amplio, tablas, task lists, footnotes, KaTeX con `$...$`, `$$...$$`, `\(...\)` y `\[...\]`, más fences `mermaid` como SVG inline con fallback inspeccionable.
3. El toggle existente se renombra a `HTML/JS confiable`: con OFF sanitiza HTML/diagramas y bloquea scripts/eventos; con ON permite HTML local confiable y ejecuta `<script>` deliberadamente.
4. La cobertura queda frontend-local: no agrega contratos WS/REST ni cambia exportación DOCX/PDF.

**Archivos:** `frontend/src/components/notebook/MarkdownRenderer.js`, `frontend/src/components/notebook/MarkdownRenderer.test.js`, `frontend/src/components/notebook/NotebookCell.js`, `frontend/src/components/NotebookEditor.css`, `frontend/src/components/NotebookToolbar.js`, `frontend/package.json`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/frontend-flow.md`, `docs/llm-index.yaml`

---

## 2026-05-02 - Barra minimizada sin preview de código

1. `NotebookCell` elimina el preview de source de la barra colapsada en reposo, hover y focus; el código queda visible solo al expandir la celda.
2. La metadata colapsada muestra el contador de ejecución como `[n]` antes de la duración, y conserva estado/resultados sin filtrar código.
3. La regresión focal valida celdas pendientes, ejecutadas, DOCX y con error sin snippet, además del orden `[n]` -> timer y la expansión manual de Monaco.

**Archivos:** `frontend/src/components/notebook/NotebookCell.js`, `frontend/src/components/NotebookEditor.css`, `frontend/src/components/notebook/NotebookCell.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-05-01 - Outputs usan scrollbars Inspyro bajo hover

1. `OutputRenderer` agrega `scroll-surface` a HTML/tablas, JSON, MIME desconocido, JavaScript bloqueado y placeholder de widgets para evitar scrollbars nativos claros en resultados.
2. Los outputs anchos o largos ahora se integran al overlay compartido vertical/horizontal, visible solo en hover/focus, durante scroll o drag.
3. La regresión focal valida que HTML y JSON quedan marcados como superficies scrollables sin tocar render MIME ni contratos notebook.

**Archivos:** `frontend/src/components/OutputRenderer.js`, `frontend/src/components/OutputRenderer.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-05-01 - Superficie de celdas sin tarjeta exterior

1. El modo notebook deja de presentar `.notebook-panel` como una tarjeta con radio/borde exterior, reduciendo el ruido alrededor de la sección de celdas.
2. El cambio es visual y conserva `NotebookEditor`, celdas, outputs, renderizadores MIME y contratos de ejecución sin alteraciones.

**Archivos:** `frontend/src/App.css`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-05-01 - Outputs con contenido al borde útil

1. `NotebookEditor.css` elimina el padding interno acumulado de `.output-display_data` y `.output-html`, haciendo que tablas/DataFrames usen todo el ancho de la superficie de resultados.
2. Los streams y `text/plain` bajan a padding mínimo, dejan de pintar un bloque negro propio y `.cell-output` pasa a superficie abierta sin fondo ni borde de tarjeta.
3. El cambio mantiene intactos `OutputRenderer`, MIME bundles, reemplazo live por `display_id` y contratos de ejecución.

**Archivos:** `frontend/src/components/NotebookEditor.css`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-05-01 - Controles de celda fuera del contenido

1. `NotebookEditor.css` desplaza la toolbar secundaria de celda por encima del frame para que no cubra Monaco ni la barra minimizada.
2. `NotebookCell` agrega una franja superior de colapso en celdas `code`/`docx` con código visible, permitiendo volver a minimizar con un click de ancho completo.
3. La regresión focal valida que una celda expandida pueda volver a estado minimizado sin mutar el source.

**Archivos:** `frontend/src/components/notebook/NotebookCell.js`, `frontend/src/components/NotebookEditor.css`, `frontend/src/components/notebook/NotebookCell.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-05-01 - Modo result-first silencioso

1. `NotebookCell` distingue celdas colapsadas con outputs exitosos de celdas pendientes/error: las primeras ocultan el snippet en reposo y las segundas conservan contexto visible.
2. `NotebookEditor.css` baja el contraste y altura de la franja colapsada, añade snippet secundario en hover/focus y mantiene responsive sin solapes.
3. El header de outputs deja solo el conteo como información primaria y mueve badges MIME + copia JSON a acciones secundarias.

**Archivos:** `frontend/src/components/notebook/NotebookCell.js`, `frontend/src/components/NotebookEditor.css`, `frontend/src/components/notebook/NotebookCell.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-05-01 - Outputs como tarjetas hermanas

1. `NotebookCell` introduce `.cell-frame` para que el marco de código/DOCX deje de envolver la superficie de resultados.
2. `.cell-output` queda como hermano directo del frame y recibe borde/radio propios, preservando el vínculo con la celda pero separando la lectura visual del output.
3. Los estados visuales (`selected`, `executing`, error y navegación por línea) se aplican al frame para evitar que deformen o encierren los resultados.

**Archivos:** `frontend/src/components/notebook/NotebookCell.js`, `frontend/src/components/NotebookEditor.css`, `frontend/src/components/notebook/NotebookCell.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-05-01 - Celdas más livianas y outputs full-bleed

1. `NotebookEditor.css` reduce el gutter izquierdo de celdas `code`/`docx` y reemplaza el panel lateral por un rail fino para quitar peso visual al marco.
2. Los outputs se renderizan full-bleed dentro de la celda, por lo que streams, tablas HTML y resultados ricos recuperan el ancho que antes consumía la sangría del código.
3. El estado seleccionado cambia a outline/glow sin aumentar el borde, evitando saltos de layout y manteniendo el énfasis en la superficie de resultados.

**Archivos:** `frontend/src/components/NotebookEditor.css`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-05-01 - Rail documental cierra en terminales reales

1. `NotebookEditor` separa el cleanup real de unmount del ciclo normal de re-render del shell, evitando que un callback nuevo de `App.js` cancele el timeout que oculta la barra roja.
2. `notebook_progress_update` documental con estado terminal (`completed`, `failed`, `cancelled` o `interrupted`) ahora cierra el rail con la misma semántica que `notebook_pdf_ready`.
3. Las regresiones cubren el caso de PDF listo seguido de re-render del padre y el caso de un progreso documental terminal tardío.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-04-28 - Notebook más ancho y proporciones pulidas

1. `App.js` separa el estado del split de código y notebook: el editor `.py` conserva `45/55`, mientras el notebook inicia con una proporción más amplia para celdas/resultados.
2. `NotebookEditor.css` reduce el padding lateral fijo y el gutter interno, alineando markdown, barras minimizadas y outputs sobre un rail visual más ancho.
3. Los outputs, tablas y previews colapsados ganan espacio útil y degradan mejor en móvil sin ocultar el panel derecho de documento/dependencias.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/NotebookEditor.css`, `frontend/src/App.notebookSessions.test.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/frontend-flow.md`, `docs/llm-index.yaml`

---

## 2026-04-28 - Notebook result-first y outputs ricos

1. `NotebookCell` inicia celdas `code` y `docx` colapsadas, mantiene markdown renderizado y monta Monaco solo cuando el usuario expande o una navegación explícita requiere código visible.
2. La barra minimizada resume tipo, estado, duración, líneas, primera instrucción útil y resultados disponibles; la superficie de output se rediseña como entregable legible con encabezado, copia JSON y estilos dedicados para streams, errores, tablas y media.
3. `OutputRenderer` amplía cobertura de MIME bundles Jupyter (JPEG/GIF/WebP/PDF/Markdown/fallback desconocido además de HTML/SVG/PNG/LaTeX/Plotly/Vega/JSON/widgets) y bloquea JavaScript como contenido inspeccionable.
4. `App.js` y `NotebookEditor` reemplazan outputs live por `display_id` en `notebook_update_display_data` y reflejan errores IOPub inline en la celda.

**Archivos:** `frontend/src/components/notebook/NotebookCell.js`, `frontend/src/components/OutputRenderer.js`, `frontend/src/components/NotebookEditor.css`, `frontend/src/components/NotebookEditor.js`, `frontend/src/App.js`, `frontend/src/components/notebook/NotebookCell.test.js`, `frontend/src/components/OutputRenderer.test.js`, `frontend/src/components/NotebookEditor.test.js`, `frontend/src/App.notebookSessions.test.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/frontend-flow.md`, `docs/llm-index.yaml`

---

## 2026-04-28 - Activador por celda DOCX y toggle no destructivo

1. El editor trata `docx` como celda Python editable/ejecutable, con helper centralizado de tipos, chip visual y activador por celda para alternar `code <-> docx`.
2. `Run All` ejecuta celdas `code + docx` cuando DOCX/PDF está activo y omite `docx` cuando está apagado; el play manual de una celda DOCX queda bloqueado en ese modo.
3. Apagar DOCX/PDF deja de enviar `notebook_mdoc_clear`, por lo que la UI conserva el último artefacto DOCX/PDF visible mientras el usuario itera cálculos.

**Archivos:** `frontend/src/utils/notebookCellTypes.js`, `frontend/src/App.js`, `frontend/src/components/NotebookEditor.js`, `frontend/src/components/notebook/NotebookCell.js`, `frontend/src/components/NotebookEditor.test.js`, `frontend/src/components/notebook/NotebookCell.test.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/feature-threads.md`

---

## 2026-04-26 - Toolbar e índice accesibles en el shell compacto

1. `NotebookToolbar` conserva sus acciones dentro del slot central con overflow horizontal, nombres accesibles y un control real para cargar notebooks.
2. `NotebookIndexPanel` deja de renderizar botones vacíos para placeholders de árbol y mantiene nombres de colapso/expansión en los nodos interactivos.
3. Las regresiones focalizadas cubren botones nombrados y toolbar compacta sin cambiar contratos notebook.

**Archivos:** `frontend/src/components/NotebookToolbar.js`, `frontend/src/components/NotebookToolbar.css`, `frontend/src/components/NotebookToolbar.test.js`, `frontend/src/components/NotebookIndexPanel.js`, `frontend/src/components/NotebookIndexPanel.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-04-22 - Copy explícito del convertidor PDF compartido

1. `NotebookEditor` deja de depender de texto libre para inferir la serialización del PDF y pasa a renderizar el rail documental desde `shared_resource`.
2. El rail rojo muestra explícitamente `Esperando convertidor PDF compartido` o `Usando convertidor PDF compartido`, manteniendo esa semántica alineada con el shell y con `DocxViewer`.
3. Se agregan regresiones frontend para fijar ambos estados y evitar recaídas hacia copy ambiguo del backend.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `frontend/src/components/DocxViewer.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/modules/14-main-app.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-19 - Hidratación shell-owned y guard anti-replay al remount

1. `NotebookEditor` pasa a tratar `initialKernelId` como runtime válido para `executeCell` y `Run All`, evitando relanzar `notebook_load` cuando el shell ya conserva una sesión viva.
2. El listener de `lastMessage` agrega un guard de hidratación shell-owned para no reprocesar snapshots stale al volver desde `Home` o al remount del mismo `path`.
3. Las regresiones frontend fijan ambos casos: mount con sesión shell-owned y `Run All` reusando kernel persistente sin bootstrap extra.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `frontend/src/App.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/modules/14-main-app.md`, `docs/architecture/system-context.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-19 - Sync documental del backend de navegación para el Índice de Notebook

1. Se documenta que `NotebookEditor` no renderiza la sección `Índice de Notebook` del rail lateral, pero sí provee el backend de navegación que esa sección consume (`navigateToCode()` / `focusCell()`).
2. La sincronización deja explícito que el índice usa la misma hidratación shell-owned por `path`, con ids estables y sin reprocesar `lastMessage` stale sobre una libreta más nueva.
3. También se agrega el riesgo de celdas stale cuando el editor pierde estabilidad de ids o acepta una snapshot anterior después de volver desde `home`.

**Archivos:** `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/modules/14-main-app.md`

---

## 2026-04-19 - `NotebookEditor` deja de matar el kernel al navegar

1. El lifecycle persistente del kernel se mueve a `App.js`: `NotebookEditor` acepta `initialKernelId`, procesa `notebook_attached` y deja de enviar `notebook_shutdown_kernel` en cambio de archivo o unmount.
2. El filtrado de mensajes notebook pasa a priorizar `path` y luego `kernel_id`, evitando mezclar runtime entre notebooks vivos cuando el editor se remonta.
3. El shutdown del kernel queda reservado a acciones explícitas del usuario o del shell al cerrar la tab.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `frontend/src/App.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/modules/14-main-app.md`, `docs/architecture/feature-threads.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`

---

## 2026-04-18 - `App` pasa a ser owner canónico del estado documental

1. `App.js` absorbe el estado público `documentState/documentActions` de la pestaña `Documento`, mientras `useAppWebSocket.js` baja a transporte/eventos y deja de reconstruir por su cuenta la API documental legacy.
2. `VisualizationPanel.js` deja de aceptar la forma flatten antigua para DOCX/PDF y consume una sola interfaz documental estable, compartida con `NotebookEditor` y con el visor PDF/DOCX.
3. `NotebookEditor.js` mantiene su rol de editor/ejecutor, pero ya no es owner del estado final del documento; las regresiones frontend fijan la separación entre ejecución notebook, artefactos tardíos y shell documental.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/NotebookEditor.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/hooks/useAppWebSocket.js`, `frontend/src/utils/docxArtifacts.js`, `frontend/src/App.documentState.test.js`, `frontend/src/hooks/useAppWebSocket.test.js`, `frontend/src/components/VisualizationPanel.test.js`, `frontend/src/components/NotebookEditor.test.js`, `frontend/src/utils/docxArtifacts.test.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/modules/14-main-app.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-15 - `NotebookEditor` deja de cancelar a 180s y propaga `execution_timeout_s=600`

1. El watchdog local del editor deja el techo histórico de `180s` y pasa a un presupuesto fijo de `600s` por celda, con `5s` extra de gracia para el terminal WS.
2. `NotebookEditor` empieza a reenviar `execution_timeout_s=600` en cada `notebook_execute_cell`, manteniendo alineado el presupuesto efectivo entre UI, backend y MCP.
3. Se agregan regresiones frontend para fijar tanto el nuevo payload enviado como la espera efectiva más allá de la marca de `180s`.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`, `AGENTS.md`

---

## 2026-04-13 - La barra verde ya no espera exportación DOCX para cerrarse

1. `NotebookEditor` toma `notebook_cell_executed` como cierre definitivo de la fase verde aunque la última celda exportable todavía no haya generado DOCX/PDF.
2. El estado documental queda latente cuando llega `document/queued` durante el hold verde y recién se hace visible como barra roja cuando la fase de ejecución desaparece.
3. Se refuerzan regresiones frontend para asegurar que el rail rojo dependa del progreso documental tardío y no de payload documental inline en el terminal.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/feature-threads.md`

---

## 2026-04-13 - Rail verde/rojo secuencial para notebooks con documento

1. `NotebookEditor` reemplaza la línea superior mínima por un rail secuencial: verde para la corrida de celdas y rojo para el pipeline `DOCX -> PDF`.
2. `Run All` usa progreso determinista por celdas completadas, la ejecución individual usa un rail verde indeterminado y la barra roja entra solo después de que la verde cerró al 100%.
3. El editor propaga `documentPipelineStatus` al shell y agrega regresiones para fijar la secuencia verde->rojo sin reactivar timeouts ni cancelaciones falsas.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.css`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-13 - Liveness por `execution_id` y artefactos tardíos separados del terminal

1. `NotebookEditor` refresca el timeout local al recibir `notebook_progress_update` del `execution_id` activo, tanto durante celdas largas (`Ejecutando celda...`) como mientras corre la recuperación documental tardía.

2. `notebook_docx_update` y `notebook_pdf_ready` quedan relegados a actualización de visor/artefactos; el editor vuelve a depender de `notebook_cell_executed` como terminal de ejecución.

3. Se agregan regresiones frontend para fijar el refresco de liveness y que los artefactos tardíos no reabran la lógica de timeout/cancelación.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-07 - Hidratación runtime explícita e ids estables de celdas

1. `NotebookEditor` deja de arrancar desde `useState(initialNotebook)` y pasa a hidratar el snapshot inicial por un camino explícito de runtime, cerrando el falso `DIRTY` que aparecía al abrir notebooks existentes o al reflejar snapshots same-path.

2. La carga inicial, `notebook_loaded`, `notebook_created` y `replaceNotebookSnapshot()` quedan fuera del flujo persistible de `onNotebookChange`, por lo que ya no fabrican conflictos locales frente a `workspace_fs_event` o espejo MCP.

3. `normalizeNotebook()` genera ids deterministas cuando faltan `cell.id`, preserva/backfillea `metadata.inspyro_id` y reduce remounts espurios de `NotebookCell`/Monaco.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/modules/14-main-app.md`, `docs/architecture/feature-threads.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`

---

## 2026-04-05 - Bridge de ejecución notebook hacia el shell desktop

1. `NotebookEditor` expone `runActiveCell` para que `App.js` pueda mapear `Ctrl+Enter` y el menú nativo de Electron sobre la celda seleccionada, con fallback útil a la primera celda de código cuando aplica.

2. `executeAll` pasa a emitir eventos de batch (`completed` / `failed`) hacia el shell principal, permitiendo notificaciones y telemetría UI sin sacar la lógica de ejecución fuera del editor.

3. El listener web de `Ctrl+Enter` se desactiva en runtime desktop para no duplicar el acelerador que ya provee el menú nativo del shell Electron.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/App.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/modules/24-desktop-shell.md`, `docs/architecture/frontend-flow.md`, `docs/llm-index.yaml`

---

## 2026-03-29 - Botón de ejecución migrado a un gutter izquierdo integrado

1. `NotebookCell` saca la acción primaria de ejecutar/renderizar de la toolbar flotante y la integra a un gutter técnico dentro de la celda, usando un botón redondo compacto y sobrio que escala con más fuerza al hover y mantiene el disparo por click o `Ctrl+Enter`.

2. El estado visual de ejecución se restringe a la celda activa: el gutter concentra contador y duración visible de la última corrida debajo del botón, sin dejar un objeto verde flotante fuera del bloque ni contaminar el resto de celdas.

3. Se agrega una prueba unitaria para asegurar que el nuevo control lateral sigue invocando `onExecute` con el `cell_id` y `source` correctos.

**Archivos:** `frontend/src/components/notebook/NotebookCell.js`, `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.css`, `frontend/src/components/notebook/NotebookCell.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-03-23 - El notebook UI ya no promueve payloads DOCX nulos como documento nuevo

1. La documentación del módulo fija que `NotebookEditor` sigue reenviando `path` y resolviendo `docx_ref`/`docx_file_token`/`docx_artifact_id`, pero la promoción a historial queda en el shell solo cuando existe identidad estable real o base64 inline efectivo.

2. Esto evita que mensajes notebook con campos DOCX nulos/stale inflen el contador visible mientras el batch sigue ejecutándose.

**Archivos:** `docs/modules/11-notebook-editor-ui.md`, `docs/modules/14-main-app.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-23 - Resolución DOCX estable por ref/token/artifact y provenance por path

1. `NotebookEditor` reenvía `path` en `notebook_create`, `notebook_load` y `notebook_execute_cell` para que backend ligue descargas e historial DOCX al notebook persistido.

2. El handler documental pasa a tratar `docx_ref`, `docx_file_token` y `docx_artifact_id` como payload válido aunque no llegue `docx_file_b64`, unificando la resolución con `buildDocxDownloadUrlFromPayload`.

3. Esto mantiene paridad entre flujo humano y replay MCP, y evita que el panel DOCX quede “sin descarga” cuando el backend sólo entrega referencia estable.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-03-15 - Fallback duro ante fallo de reset de kernel

1. `NotebookEditor` reconstruye la sesión con un kernel nuevo cuando `notebook_reset_kernel` falla y el backend deja el cliente inutilizable.

2. El notebook visible conserva su snapshot persistible local y no obliga a recargar manualmente el archivo para seguir trabajando.

3. Se agrega una regresión unitaria para proteger la recuperación tras `notebook_reset_kernel_failed`.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-03-13 - Propagación UI de snapshot runtime degradado

1. `NotebookEditor` reexpone `variablesSnapshotDegraded` y `executionDiagnostics` en `onVisualizationData` cuando `notebook_cell_executed` llega con snapshot runtime degradado.

2. El editor mantiene intacta la continuidad de `executeAll`; el nuevo dato es aditivo y sirve para diferenciar snapshot parcial de ejecución fallida.

3. Se agregó test frontend para asegurar que el payload degradado llega a consumidores de visualización.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-03-13 - Limpieza manual de outputs desde el header

1. `NotebookEditor` expone `clearOutputs` vía `actionsRef` para borrar outputs, `execution_count` y metadata runtime (`execution_duration*`) de todas las celdas de código sin introducir contratos WS nuevos.

2. La limpieza reutiliza la misma normalización del snapshot persistible (`getPersistableNotebook`) para que UI y guardado del `.ipynb` queden alineados.

3. Al borrar resultados, el editor también solicita al shell limpiar el estado visual DOCX/PDF/variables y el target de dependencias, dejando el notebook visible como no ejecutado.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`

---

## 2026-03-11 - Fix de foco MCP same-path y warning espurio de celda

1. `replaceNotebookSnapshot` ahora sincroniza `notebookRef` antes de `setNotebook`, de modo que `focusCell()` pueda resolver la celda recién reflejada por MCP en el mismo tick.

2. Esto elimina el warning falso “No se pudo ubicar la celda...” que aparecía en notificaciones aunque la snapshot remota ya hubiera llegado correctamente.

3. El mensaje de navegación sin destino deja de hablar de “dependencia” para no inducir a error cuando el origen es un foco MCP o cualquier otra navegación programática.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-03-08 - APIs imperativas para replay MCP same-path

1. `NotebookEditor` expone `replaceNotebookSnapshot`, `consumeRemoteNotebookMessage` y `focusCell` via `actionsRef` para que el shell reaplique snapshots y runtime MCP sobre el notebook activo.

2. El handler de mensajes suma paridad para `notebook_cell_deleted`, `notebook_cell_moved` y `notebook_order_set`, evitando que el replay MCP pierda pasos de edición humana.

3. Se factoriza `applyNotebookDocumentPayload` para compartir la actualización de DOCX/PDF entre WS normal y mensajes remotos reinyectados por el shell.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-03-08 - Resincronización de source remoto en celdas existentes

1. `NotebookCell` ya no espera un cambio de `cell.id` para refrescar el editor interno; ahora también reaplica snapshots remotas cuando el `source` de la misma celda cambia por MCP.

2. Esto corrige el caso donde la UI mostraba código stale con `\n` literales mientras los outputs ya reflejaban la ejecución remota más reciente.

3. Se agrega una prueba unitaria focalizada para proteger la resincronización del editor frente a futuros refactors.

**Archivos:** `frontend/src/components/notebook/NotebookCell.js`, `frontend/src/components/notebook/NotebookCell.test.js`, `docs/modules/11-notebook-editor-ui.md`

---

## 2026-03-07 - Banner de actividad MCP contextual

1. `NotebookEditor` acepta `agentExecutionState` desde `App.js` para mostrar una marca visual cuando una tool MCP actúa sobre el notebook activo.

2. La representación es deliberadamente terminal: no reinyecta streams MCP en vivo, solo comunica que el agente está operando y deja la sincronización final al reload seguro del `.ipynb`.

3. El banner desaparece cuando el run MCP termina o cuando el usuario cambia de notebook/contexto activo.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.css`, `docs/modules/11-notebook-editor-ui.md`

## 2026-02-21 - Corrección de mapeo de líneas para navegación desde grafo

1. Se normaliza la serialización de `cell.source` antes de enviar `source_code` y `notebook_context` al backend de análisis, evitando líneas desplazadas cuando el `.ipynb` trae saltos embebidos por línea.

2. `navigateToCode` ahora clamp-ea la línea destino al rango real de la celda para evitar saltos fuera de rango.

3. Se propaga columna de navegación al editor para posicionamiento más preciso del cursor al llegar al destino.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/notebook/NotebookCell.js`, `frontend/src/components/MonacoEditorLSP.js`

## 2026-02-21 - Navegación grafo → código vía `actionsRef`

1. `NotebookEditor` ahora expone `navigateToCode` en `actionsRef` para que `App.js` enrute doble clic del grafo hacia celda/línea concreta.

2. La navegación prioriza `cell_id` (fallback a `cellIndex`), hace scroll al destino, selecciona la celda y aplica resaltado temporal de línea.

3. Se añadió cleanup explícito de timeout de resaltado en cambio de archivo y unmount para evitar estado stale.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/App.js`, `docs/modules/11-notebook-editor-ui.md`

## 2026-02-21 - Corrección de contexto multi-celda para Análisis de Impacto

1. **Contexto Diferenciado:** `handleShowDependencyTree` ahora suministra todas las celdas útiles del notebook (en lugar de solo las previas) cuando el modo solicitado del grafo es de impacto. Esto permite al analizador en el backend proyectar las dependencias directas de una variable elegida a lo largo de todo el documento.

**Archivos:** `frontend/src/components/NotebookEditor.js`

---

## 2026-02-19 - Migración de console.log directos a logger condicional

1. Se reemplazaron 5 instancias de `console.log`/`console.warn` directos por `logger.log`/`logger.warn` para respetar el filtro de producción (`NODE_ENV !== 'production'`).

2. Afecta handlers de `notebook_cell_executed`, safety check de RunAll, y función `executeCell`.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `docs/modules/11-notebook-editor-ui.md`

## 2026-02-19 - Cleanup de hooks y refs no usadas en handler WS

1. Se eliminó `cellIndexMapRef` no utilizado tras la extracción de `useCellOperations`.

2. Se ajustó el arreglo de dependencias de `handleWebSocketMessage` para remover una dependencia innecesaria (`deriveEngineeringVarsFromOutputs`) y estabilizar el lint de hooks.

3. No hubo cambios de contrato WS ni de flujo funcional de ejecución.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `docs/modules/11-notebook-editor-ui.md`

## 2026-02-10 - Descomposición de NotebookEditor en módulos extraídos

1. `deriveEngineeringVarsFromOutputs` se extrae a utilidad pura `notebook/deriveEngineeringVars.js`, sin dependencias React.

2. Operaciones CRUD de celdas (`updateCell`, `addCell`, `deleteCell`, `moveCell`, `patchCellById`, `updateCellOutput`) se extraen a hook `notebook/useCellOperations.js`.

3. `NotebookEditor.js` reduce complejidad y mejora mantenibilidad/testabilidad sin cambiar el contrato expuesto al padre.

4. Sin cambios de contrato: los props y callbacks expuestos al padre permanecen iguales.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/notebook/deriveEngineeringVars.js`, `frontend/src/components/notebook/useCellOperations.js`, `docs/modules/11-notebook-editor-ui.md`

## 2026-02-10 - Correlación de ejecución y cleanup agresivo por cambio de notebook

1. `NotebookEditor` agrega `execution_id` por celda para filtrar respuestas stale y correlacionar `notebook_cell_executed`/`notebook_cell_error`/`notebook_pdf_ready`.

2. En timeout de ejecución se envía `notebook_cancel_execution` para liberar el flujo de control sin esperar fin natural de la celda.

3. Al cambiar de archivo y en unmount se fuerza `notebook_shutdown_kernel`; create/load ahora soportan `previous_kernel_id` para cleanup temprano del kernel anterior.

4. Actualizaciones de celdas en stream pasan a parche incremental por `cell_id` para evitar recorridos completos por cada chunk.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `docs/modules/11-notebook-editor-ui.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

## 2026-02-07 - Alineación de runtime iopub con backend

1. Se consolida la expectativa contractual de eventos `notebook_clear_output`, `notebook_update_display_data` y `notebook_comm_*` en el flujo del editor.

2. Se elimina riesgo de eventos runtime no consumidos por desalineación entre backend/frontend.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `backend/app/services/notebook_service.py`, `docs/modules/11-notebook-editor-ui.md`

## 2026-02-07 - Cleanup de warnings en ejecución notebook y celda

1. Se eliminaron handlers/helpers no usados en `NotebookEditor.js` y estado no utilizado en `NotebookCell.js`.

2. Se ajustaron dependencias de hooks (`useCallback`/`useEffect`) para evitar warnings de `react-hooks/exhaustive-deps`.

3. Se normalizó `NotebookEditor.js` sin BOM para cumplir regla `unicode-bom` del lint frontend.

**Archivos:** `frontend/src/components/NotebookEditor.js`, `frontend/src/components/notebook/NotebookCell.js`, `docs/modules/11-notebook-editor-ui.md`

## 2026-02-06 - Normalización documental LLM-first

1. Se actualizó el módulo a estructura canónica con foco en contratos y estado compartido.

2. Se documentó sincronización con `App.js` y riesgos de ejecución concurrente en frontend.

3. Se enlazó explícitamente con módulos de dependencias y template.

**Archivos:** `docs/modules/11-notebook-editor-ui.md`, `docs/modules/14-main-app.md`

