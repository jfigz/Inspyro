# 11 - Notebook Editor UI

> **Estado:** 🟡 En mejora continua

> **Ubicación:** `frontend/src/components/NotebookEditor.js`

> **Última actualización:** 2026-05-02

> **Changelog:** `docs/changelog/11-notebook-editor-ui.md`

---

## Propósito sistémico

Gestionar el ciclo de edición y ejecución de notebooks en frontend: celdas, selección, cola de ejecución, sincronización con `App.js`, consumo de resultados WS y aplicación imperativa de reflejos MCP sobre el notebook activo.

## 2026-05-02 - Markdown enriquecido en celdas notebook

- `MarkdownRenderer` usa carga dinámica de `marked`, `marked-katex-extension`, `marked-footnote` y `mermaid` para renderizar GFM amplio, task lists, footnotes, tablas, KaTeX y diagramas sin aumentar el primer chunk del shell.
- Las celdas `markdown` soportan matemáticas `$...$`, `$$...$$`, `\(...\)` y `\[...\]` sin transformar delimitadores dentro de inline code ni code fences; fences `mermaid` se convierten en SVG inline con fallback visible si el diagrama falla.
- El toggle `HTML/JS confiable` gobierna el modo local confiable: apagado sanitiza HTML/SVG y bloquea scripts/event handlers; encendido permite HTML completo y ejecuta scripts tras renderizar. El alcance es solo UI Notebook, sin contratos nuevos ni export DOCX/PDF.

## 2026-05-02 - Barra minimizada sin preview de código

- Las celdas `code`/`docx` colapsadas ya no muestran el source en reposo, hover ni focus; el código solo aparece al expandir la celda explícitamente.
- La barra conserva contexto de ejecución sin filtrar código: tipo (`PY`/`DOCX`), estado, conteo de resultados y, tras correr, contador `[n]` seguido por duración.
- El cambio es frontend-local y mantiene intactos outputs, Monaco bajo demanda, persistencia `.ipynb` y contratos WS/REST.

## 2026-05-01 - Scrollbars Inspyro en outputs

- `OutputRenderer` marca outputs HTML/tablas, JSON, MIME desconocido, JavaScript bloqueado y placeholders de widgets como `scroll-surface`, para que usen el overlay visual compartido en vez de scrollbars nativos claros.
- Las tablas y bloques pre de outputs pueden degradar en eje vertical u horizontal sin añadir barras permanentes: el scrollbar se revela solo al interactuar con la superficie.
- El cambio es visual/DOM interno y mantiene intactos MIME bundles, sanitización, reemplazo live por `display_id`, ejecución y contratos WS/REST.

## 2026-05-01 - Superficie de celdas sin tarjeta exterior

- El shell deja de envolver el notebook en una tarjeta central redondeada: la sección de celdas se pega al split del workspace y conserva el scroll local de `NotebookEditor`.
- El ajuste mantiene intacta la estructura de celdas, outputs hermanos, MIME bundles y contratos WS/REST; solo cambia la geometría externa del panel.

## 2026-05-01 - Outputs con contenido al borde útil

- Los outputs HTML/DataFrame eliminan padding interno duplicado para que tablas ocupen el ancho completo de la superficie de resultados.
- Los streams y `text/plain` reducen padding, dejan de crear un bloque negro propio y `.cell-output` queda como superficie abierta: sin fondo, sin borde de tarjeta y con header mínimo.
- El ajuste es visual/CSS y no cambia renderizadores, MIME bundles, outputs live ni contratos.

## 2026-05-01 - Controles de celda fuera del contenido

- La toolbar secundaria de `NotebookCell` se posiciona visualmente por encima del frame para no tapar Monaco ni la barra minimizada.
- Las celdas `code`/`docx` con código visible agregan una franja superior de ancho completo que vuelve a minimizar la celda con un click.
- El cambio conserva el rail izquierdo de ejecución y no altera outputs, MIME bundles, persistencia `.ipynb` ni contratos WS/REST.

## 2026-05-01 - Modo result-first silencioso

- Las celdas `code`/`docx` colapsadas reducen la barra de contexto a tipo, estado, duración, conteo y resultados, dejando el source fuera de la superficie colapsada.
- Las celdas pendientes, ejecutando o con error conservan metadata visible para no perder trazabilidad cuando el resultado aún no es confiable.
- El header de `.cell-output` deja visible solo el conteo; badges MIME y copia JSON pasan a metadata secundaria visible por interacción.

## 2026-05-01 - Outputs como tarjetas hermanas

- `NotebookCell` separa el marco visual de código/DOCX en `.cell-frame` y deja `.cell-output` como hermano directo dentro de `.notebook-cell`, manteniendo la asociación lógica de la celda.
- Los estados de selección, ejecución, error y navegación resaltan el frame de código sin encerrar ni deformar la tarjeta de resultados.
- La superficie de output queda separada del frame de código para comportarse como resultado independiente dentro del flujo result-first.

## 2026-05-01 - Celdas más livianas y outputs prioritarios

- `NotebookEditor.css` reduce el gutter izquierdo de celdas `code`/`docx` a un rail fino, evitando que el marco lateral compita con tablas y streams.
- Los outputs dejan de heredar la sangría del código colapsado y ocupan el ancho completo de la celda, reforzando la intención result-first.
- La selección de celda pasa a un foco visual sin borde grueso ni reflow, manteniendo el contexto activo sin cambiar la geometría del output.

## 2026-05-01 - Cierre robusto del rail documental

- El cleanup de `NotebookEditor` reservado para unmount ya no depende de callbacks volátiles del shell; un re-render de `App.js` durante `PDF listo` no cancela el timeout que oculta la barra roja.
- Los updates documentales terminales (`completed`, `failed`, `cancelled`, `interrupted`) cierran o limpian el rail en vez de pasar por el camino de progreso `running`.
- El reset por cambio real de `filePath` se mantiene explícito para que cambiar de notebook siga limpiando ejecución, timeouts y progreso local.

## 2026-04-28 - Proporciones result-first más amplias

- El split notebook/documento queda desacoplado del editor `.py`: el editor de código conserva su proporción histórica, mientras el notebook inicia con más ancho útil para narrativa, celdas colapsadas y resultados.
- La geometría interna del notebook usa padding lateral responsivo, gutter más compacto y un mismo rail visual para markdown, barras minimizadas y outputs; esto elimina la doble sangría que estrechaba tablas y streams.
- Las superficies de resultado se expanden sobre el ancho disponible, con headers y badges más compactos para preservar legibilidad sin ocultar el panel derecho `Documento` / `Dependencias` / `Variables`.

## 2026-04-28 - Notebook result-first

- `NotebookCell` abre las celdas `code` y `docx` en modo minimizado por defecto; markdown permanece renderizado como narrativa. La selección simple no expande código: solo lo hacen acciones explícitas o navegación a una línea/celda desde dependencias/procedencia.
- La vista minimizada pasa a ser una barra informativa: tipo (`PY`/`DOCX`), estado, duración, líneas, resumen de la primera instrucción útil y badges de resultados disponibles. Monaco no se monta mientras la celda Python/DOCX está colapsada.
- Los outputs se presentan como superficie de resultado adjunta a la celda, con encabezado compacto, copia JSON icon-only, streams densos, errores con resumen y traceback plegable, tablas/HTML más legibles y media rica sin ruido de consola.
- `OutputRenderer` cubre MIME bundles relevantes de Jupyter sin ejecutar JavaScript arbitrario salvo `HTML/JS confiable`: HTML/SVG/PNG/JPEG/GIF/WebP/PDF/Markdown enriquecido/LaTeX/Plotly/Vega/JSON/widgets placeholder y fallback inspeccionable para MIME desconocido.
- `notebook_update_display_data` actualiza inline el output asociado por `display_id`, y los errores live con `cell_id` quedan también como output de la celda además del aviso global.

## 2026-04-28 - Celdas DOCX y toggle DOCX/PDF no destructivo

- `NotebookCell` trata `cell_type="docx"` como celda Python editable/ejecutable con badge DOCX, estilo visual propio y activador por celda para alternar `code <-> docx`.
- Los helpers de tipo (`isCodeCell`, `isDocxCell`, `isPythonNotebookCell`, `isRunnableNotebookCell`) centralizan la lógica para evitar comparaciones sueltas contra `cell_type === "code"`.
- `Run All` incluye `code + docx` cuando DOCX/PDF está activo; cuando está apagado omite `docx`, mantiene ejecutables las celdas `code` y bloquea el play manual de una celda DOCX.
- El toggle DOCX/PDF ya no emite `notebook_mdoc_clear`; desactivarlo solo cambia la política de ejecución local y conserva `mdoc` y el último DOCX/PDF visible.

## 2026-04-26 - Toolbar e índice sin solapes ni controles anónimos

- `NotebookToolbar` vive mejor dentro del slot central de `DesktopTitleBar`: usa overflow horizontal compacto, labels accesibles en botones icon-only y un input real oculto para `Cargar notebook`.
- El indicador de kernel se acorta a una referencia estable y no empuja los controles de ejecución/guardado en anchos medios.
- `NotebookIndexPanel` elimina botones placeholder sin nombre accesible: los nodos sin hijos usan marcadores no interactivos y los controles de colapso conservan `aria-label` explícito.

## 2026-04-25 - Run All tolerante al socket notebook en conexión

- `NotebookToolbar` mantiene `Run All` disponible cuando el socket dedicado del notebook aún está `connecting`; la cola real pertenece a `App.js`/`useAppWebSocket` y no al estado visual de conexión del botón.
- Esto preserva el flujo de abrir varias tabs `.ipynb` y disparar `Run All` rápido: el editor visible sigue renderizando el `batchRunState` shell-owned, mientras el transporte encola `notebook_load`/`notebook_execute_cell` hasta que el socket quede listo.
- `NotebookEditor` limpia el `kernelId` shell-owned al cambiar de `filePath` y omite el primer sync si todavía contiene el kernel de la pestaña anterior; `onKernelStateChange()` reporta el `filePath` para que `App.js` pueda aislar callbacks tardíos por sesión.

## 2026-04-22 - Rail documental explícito para el convertidor PDF compartido

- `NotebookEditor` deja de inferir la espera serializada del PDF desde texto libre: consume `shared_resource` estructurado dentro de `notebook_progress_update` y muestra copy explícito `Esperando convertidor PDF compartido` o `Usando convertidor PDF compartido`.
- El editor sigue sin ser owner del lifecycle documental persistente, pero el rail rojo ya no depende de que el notebook esté visible continuamente: puede rehidratar ese estado notebook-scoped desde el shell sin mezclarlo con la fase verde.
- Las regresiones frontend fijan ambos copies y evitan volver a ocultar la contención real detrás de mensajes ambiguos del backend.

## 2026-04-21 - Editor hidratado desde shell y relay notebook-scoped

- `NotebookEditor` deja de competir con `App.js` por el ownership del runtime notebook: `initialNotebook` pasa a ser un snapshot de hidratación, no un stream vivo.
- El editor visible consume ahora los mensajes notebook ya ruteados por `App.js` mediante `consumeRemoteNotebookMessage()`, manteniendo `lastMessage` solo como fallback de compatibilidad y no como canal primario del runtime humano.
- `initialNotebookToken` deja de significar “hubo un cambio runtime” y pasa a significar “rehidrata el editor ahora”; los cambios runtime normales del shell ya no deben forzar remount/reemplazo del editor montado en el mismo `path`.
- El objetivo es que dos notebooks en paralelo puedan alternar pestañas sin perder el snapshot vivo de la libreta oculta ni dejar la visible pegada en la primera celda por una doble resolución de mensajes.

## Índice de notebook como sección lateral (2026-04-19)

- `NotebookEditor` no renderiza el índice por sí mismo, pero sí provee la superficie de navegación que el shell necesita para montar esa sección lateral: ids de celda estables, snapshot hidratable y acciones imperativas (`navigateToCode()` / `focusCell()`).
- El índice shell-owned reutiliza la misma libreta activa que ve el editor, no una lectura paralela del archivo; por eso el editor debe aceptar hidratación runtime desde `App.js` sin reprocesar `lastMessage` stale ni degradar a un snapshot anterior.
- La navegación lanzada desde el explorer debe terminar en el editor visible con el mismo contrato que ya usa el grafo o `Modo origen`: seleccionar la celda correcta, hacer scroll y degradar best-effort por línea cuando el `cellId` original ya no existe.

## Runtime persistente por tab (2026-04-19)

- `NotebookEditor` deja de ser el owner del lifecycle del kernel entre navegaciones: `App.js` le pasa `initialKernelId`, snapshot runtime y estado batch por `path`; el editor visible actúa como vista hidratada del runtime shell-owned.
- Cambiar a `home`, abrir otro archivo o alternar tabs ya no dispara `notebook_shutdown_kernel`; el unmount limpia solo estado local y refs pendientes, mientras el shell sigue absorbiendo `notebook_*`.
- El editor acepta `notebook_attached`, trata `initialKernelId` como runtime válido para `executeCell`/`Run All`, consume el relay shell-owned por `consumeRemoteNotebookMessage()` y evita reprocesar un `lastMessage` stale al remount de una sesión shell-owned.
- En `Run All`, `NotebookEditor` ya no es owner del batch visible: renderiza el `batchRunState` shell-owned, emite señales de avance y refleja el estado activo, pero el ownership de continuidad, cierre y supervivencia entre superficies pertenece a `App.js`.
- `onKernelStateChange()` sigue reportando `kernelId`, `kernelInterrupted` y `hasNotebook`, pero ahora también funciona como fallback acotado para destrabar `waiting_kernel`: el shell puede adoptar un `kernelId` visible del editor solo cuando no compite contra un `notebook_load` nuevo aún pendiente.
- `notebook_shutdown_kernel` sigue existiendo, pero queda reservado a acciones explícitas: toolbar, cierre de tab o teardown intencional del shell.

## Recuperación documental tardía y fallback de navegación (2026-04-18)

- `NotebookEditor` deja de tratar `notebook_pdf_ready` como un payload “solo PDF”: ahora repropaga también `docx_artifact_id`, `docx_provenance_ref`, `docx_provenance_available`, `source_path` y `source_kind`, para que `App.js` pueda rehidratar procedencia aunque `notebook_docx_update` se haya perdido o llegado stale.
- El editor sigue reenviando patches documentales notebook-first hacia el shell, pero `App.js` pasa a ser el owner canónico del `documentState/documentActions`; `NotebookEditor` ya no compite con `useAppWebSocket` por la autoridad del documento notebook.
- `applyNotebookDocumentPayload()` sintetiza `docx_provenance_ref` desde `docx_artifact_id` cuando el backend aún no envía el URL explícito, evitando que el visor PDF nuevo quede apuntando al manifiesto de una generación previa.
- `navigateToCode()` agrega una degradación line-based cuando el `cellId` exacto/callsite ya no existe en la libreta abierta: el editor elige la mejor celda candidata por tipo + cantidad de líneas y conserva el resaltado de línea/columna en vez de fallar seco.

## Rail secuencial de proceso (2026-04-13)

- `NotebookEditor` reemplaza la línea superior mínima por un rail visible y etiquetado: verde para la corrida de celdas y rojo para la generación documental posterior.

- En `Run All`, la barra verde avanza por `code cells completed / total`; en ejecución individual se mantiene indeterminada hasta `notebook_cell_executed`.

- La barra roja se alimenta de `notebook_progress_update` estructurado (`progress_scope=document`) y arranca solo después de que la barra verde alcanzó el 100%; `notebook_docx_update` y `notebook_pdf_ready` actualizan artefactos, pero no reabren la fase verde.

- `notebook_cell_executed` ya no necesita traer DOCX/PDF inline para cerrar la fase verde; el editor considera el documento como una fase posterior, no como parte del terminal de ejecución.

## Presupuesto canónico por celda (2026-04-15)

- `NotebookEditor` deja de calcular un techo local de `180s`: ahora envía `execution_timeout_s=600` en `notebook_execute_cell` y usa un watchdog local de `600s + 5s` de gracia para el terminal WS.

- Esto mantiene alineado al cliente humano con backend y MCP, evitando que la UI mate celdas largas legítimas antes de que el kernel o el relay terminen.

## Entradas y salidas contractuales

### Entradas

- Props desde `14-main-app` (`sendMessage`, `lastMessage`, estado global, callbacks y `agentExecutionState` para reflejo MCP contextual).

- Mensajes WS: `notebook_*` (incluyendo `notebook_attached`), `dependency_analysis_result`, `impact_analysis_result`, `sensitivity_result`, `template_*` relevantes.

- Runtime IOPub esperado en vivo: `notebook_stream`, `notebook_clear_output`, `notebook_update_display_data`, `notebook_comm_*`.

### Salidas

- Requests WS: `notebook_create`, `notebook_load`, `notebook_save`, `notebook_execute_cell` con `cell_type` aditivo, `notebook_cancel_execution`, `notebook_interrupt_kernel`, `notebook_reset_kernel`, `notebook_shutdown_kernel` (solo explícito), `notebook_mdoc_clear` solo por acción explícita, `analyze_dependencies`, `analyze_impact`.

- Callbacks al padre: estado de kernel, cambios de notebook, datos de visualización, limpieza explícita de runtime notebook y target de dependencias.

- API expuesta por `actionsRef`: `addCode`, `addMarkdown`, `executeAll`, `interrupt`, `reset`, `shutdown`, `save`, `load`, `clearOutputs`, `getNotebook`, `getPersistableNotebook`, `getExecutionState`, `navigateToCode`, `focusCell`, `replaceNotebookSnapshot`, `consumeRemoteNotebookMessage`.

## Dependencias y sinergias

### Upstream

- `14-main-app` como owner del shell global.

- `04-notebook-handlers` para contratos de ejecución.

### Downstream

- `12-dependency-graph-ui` consume target de dependencia.

- `17-template-editor` comparte contexto de kernel y visualización.

## Estado compartido y concurrencia

1. Estado local: notebook visible, kernel activo, celda en ejecución y cola de pendientes; el runtime persistente por `path` ya no vive aquí, sino en `App.js`.

2. Control de concurrencia frontend con refs para ejecuciones pendientes y `executeAll`.

3. Presupuesto fijo y explícito de `600s` por celda, más una gracia corta de transporte para distinguir timeout local de timeout real del backend.

4. Sincronización explícita con `App.js` para prevenir desalineación de archivo activo, remounts espurios y pérdida de snapshot cuando otro notebook sigue ejecutándose en paralelo.

5. Correlación por `execution_id` para filtrar respuestas stale de ejecución/PDF y cancelar por timeout sin mezclar resultados.

6. Cambio incremental por `cell_id` (índice en memoria) para evitar recorridos O(n) de toda la libreta en cada chunk de stream.

7. Navegación de código desde el grafo: selección/scroll de celda + resaltado temporal de línea objetivo.

8. En desktop, `runActiveCell` se expone a `App.js` para que el menú nativo ejecute la celda seleccionada o haga fallback a la primera celda de código; el listener web de `Ctrl+Enter` se desactiva cuando Electron ya provee ese acelerador.

9. `executeAll` emite eventos de batch hacia `App.js` para notificaciones y telemetría UI; el editor reporta el avance, pero el shell decide la notificación visible y el cierre shell-owned de `Run All`.

8. Banner transitorio de "agente MCP actuando" cuando el shell decide reflejar una operación remota sobre el notebook activo y limpio.

9. API imperativa para espejo remoto same-path: snapshots completos, runtime messages `notebook_*` y enfoque de celda sin depender de rehidratar `initialNotebook`.

10. Limpieza local de resultados: una acción de toolbar puede borrar outputs, `execution_count` y metadata runtime persistible de todas las celdas de código sin pedir soporte extra al backend.

11. `Run All` mantiene refs locales (`executeAllRunIdRef` + `pendingExecutionsRef`) para seguir renderizando la corrida visible y correlacionar mensajes; ese estado local ya no reemplaza al `batchRunState` shell-owned que conserva `App.js`.

12. Los timeouts de ejecución ahora reportan qué `cell_id` quedó sin mensaje terminal para diferenciar un kernel lento de un cierre WS faltante.

13. `notebook_cell_executed` puede transportar `variables_snapshot_degraded` + `execution_diagnostics`; el editor los propaga a consumidores de visualización sin alterar la continuidad de la ejecución.

14. `notebook_progress_update` refresca la liveness del `execution_id` pendiente mientras corre la recuperación documental tardía, evitando cancelaciones falsas de `Run All` por timeout local.

15. `notebook_docx_update` y `notebook_pdf_ready` se tratan como artefactos tardíos del mismo `execution_id`: actualizan visor/descargas, pero no reemplazan el rol terminal de `notebook_cell_executed`.

16. Si `notebook_reset_kernel` falla y el backend no deja el kernel reutilizable, el editor puede reconstruir la sesión cargando de nuevo el notebook local sobre un kernel nuevo, sin perder el snapshot persistible en memoria.

17. El editor propaga `path` en create/load/execute para que backend pueda anclar historial DOCX persistente al notebook real, y trata `docx_ref`, `docx_file_token` y `docx_artifact_id` como payload documental válido aunque no llegue base64 inline.

18. `NotebookCell` expone una acción primaria fija dentro de un gutter izquierdo integrado a la celda: la ejecución visible ya no depende del hover-toolbar, mantiene `Ctrl+Enter` y reserva el estado de “ejecutando” al `cell_id` realmente activo mientras el resto de celdas siguen pudiendo encolarse sin ruido visual global.

19. El viewport principal del notebook adopta la clase compartida `scroll-surface`; fuera de Monaco el scroll visible lo pinta un overlay administrado por frontend, manteniendo el mismo estándar visual del shell sin depender del scrollbar nativo del host.

20. La hidratación de `initialNotebook` pasa a clasificarse por origen (`runtime` vs `persistable`): primer mount, `notebook_loaded`, `notebook_created`, `replaceNotebookSnapshot()` y snapshots same-path ya no pueden disparar `onNotebookChange` persistible ni fabricar un `DIRTY` local.

21. `normalizeNotebook()` garantiza ids de celda estables aun cuando el `.ipynb` llegue sin `cell.id`; el editor conserva o backfillea `metadata.inspyro_id` y evita remounts espurios de `NotebookCell`/Monaco por fallback volátil.

22. El editor visible no destruye por sí mismo el kernel al desmontarse; el runtime persistente vive en el shell y vuelve por `initialKernelId`. `notebook_attach_kernel` queda como capacidad backend para rebind explícito o recuperación futura, no como paso obligatorio en cada cambio de superficie.

23. El filtrado WS local ya no es el owner principal del destino notebook humano: el shell resuelve `source_path/notebook_path/path -> entry.path -> execution_id -> kernel_id` y entrega al editor visible el mensaje ya ruteado.

24. La sección `Índice de Notebook` del rail lateral depende de esa misma estabilidad: `navigateToCode()` y `focusCell()` deben seguir resolviendo la libreta shell-owned correcta aun después de volver desde `home`, cambiar de tab o recibir una snapshot runtime same-path.

25. Las celdas DOCX son Python cells documentales: participan del contexto LSP/análisis junto con `code`, pero se pueden omitir de `Run All` cuando DOCX/PDF está desactivado.

26. El código de celdas Python/DOCX queda subordinado al resultado: el estado visual inicial es colapsado, `MonacoEditorLSP` se monta bajo demanda y la barra minimizada debe conservar suficiente contexto para auditar la celda sin ocupar el rol principal del notebook. El layout usa un split inicial más generoso para notebook y gutters compactos para que outputs/tablas ocupen el ancho disponible antes de degradar a scroll interno.

27. La superficie de outputs es parte de la celda y debe conservar todos los MIME bundles relevantes; JavaScript de outputs no se ejecuta, widgets quedan como placeholder inspeccionable y `display_id` mantiene continuidad de resultados live.

## Fallos frecuentes y observabilidad

### Fallos frecuentes

- Mezcla de mensajes entre notebooks vivos si se rompe el filtrado por `path`/`kernel_id`.

- Estado stale de kernel tras reconexión.

- Timeouts de ejecución en notebooks pesados.

- Rehidratación omitida por dirty state local cuando el agente MCP modifica el notebook activo.
- Índice del notebook apuntando a celdas stale si el editor deja de preservar ids estables o si reacepta un `lastMessage` viejo sobre una hidratación shell-owned más nueva.

- Divergencia entre runtime WS humano y replay MCP si no se mantiene paridad de handlers `notebook_*`.

- `NotebookCell` con `source` stale si una snapshot remota actualiza el contenido de una celda existente sin cambiar su `cell.id`.

- Reset de kernel aparentemente exitoso pero con cliente ZMQ roto, dejando la toolbar en estado inconsistente hasta recargar manualmente el notebook.

- Refs DOCX stale si el editor deja de propagar la `path` actual o si un payload `docx_ref`-only deja de resolverse como documento descargable.

- Falso positivo de notebook `DIRTY` si se pierde la clasificación `runtime/persistable` y una hidratación inicial, recarga same-path o snapshot MCP vuelve a recorrer el flujo de `onNotebookChange` como si fuera edición humana.

- Remounts innecesarios de celdas/Monaco si el fallback de ids deja de ser estable para notebooks cargados desde disco sin `cell.id`.

- Reapertura accidental de Monaco al seleccionar celdas, degradando el flujo result-first y el rendimiento en notebooks largos.

- Pérdida silenciosa de MIME bundles o de `update_display_data` si `OutputRenderer`, `App.js` y `NotebookEditor` dejan de mantener paridad sobre outputs ricos.

### Observabilidad

- Logs en consola de desarrollo (`NODE_ENV !== production`).

- Señales de estado vía `onStatusMessage`.

## Archivos fuente y puntos de entrada

- `frontend/src/components/NotebookEditor.js` (componente principal)

- `frontend/src/components/notebook/NotebookCell.js`

- `frontend/src/components/notebook/MarkdownRenderer.js`

- `frontend/src/components/OutputRenderer.js`

- `frontend/src/components/notebook/deriveEngineeringVars.js` (utilidad pura: parseo de outputs a variables de ingeniería)

- `frontend/src/components/notebook/useCellOperations.js` (hook: CRUD de celdas y change-reason tracking)

- `frontend/src/components/NotebookEditor.css`

Puntos de entrada de interacción:

- `executeCell()`

- `executeAll()`

- `saveNotebook()`

- handlers de `lastMessage`

- `replaceNotebookSnapshot()`

- `consumeRemoteNotebookMessage()`.

## Resumen de cambios recientes

1. Refuerzo del flujo de inicialización de kernel con promesas y timeout.

2. Mejor control de cola de ejecución y cancelación por cambio de archivo.

3. Integración más robusta con navegación a dependencias y resaltado de código.

4. Sincronización más estricta con `App.js` para evitar race conditions de archivo activo.

5. Cleanup de warnings en `NotebookEditor.js`/`NotebookCell.js`: eliminación de estado y helpers muertos, ajuste de dependencias `useCallback/useEffect` y normalización de archivo sin BOM.

6. Contrato runtime alineado con backend para recibir `clear_output`, `update_display_data` y `comm_*` sin eventos huérfanos.

7. Se agrega `execution_id` por celda + `notebook_cancel_execution` para controlar timeouts y descartar respuestas tardías.

8. `NotebookEditor` expone `runActiveCell` y eventos de batch (`Run All` completado/fallido) para que el shell desktop pueda mapear menú nativo y notificaciones sin duplicar control de ejecución.

8. Al cambiar de archivo o desmontar ya no se envía shutdown automático; el kernel persiste por tab y solo se destruye en acciones explícitas del shell o del usuario. `previous_kernel_id` queda reservado a rebuilds intencionales.

9. Descomposición del componente: `deriveEngineeringVarsFromOutputs` extraído a utilidad pura `deriveEngineeringVars.js`; operaciones CRUD de celdas extraídas a hook `useCellOperations.js`, reduciendo acoplamiento y mejorando mantenibilidad.

10. Hardening de mantenibilidad en el handler WS: eliminación de refs no usadas y cleanup de dependencias `useCallback` para mantener `verify` sin warnings de hooks.

11. Migración de 5 `console.log`/`console.warn` directos a `logger` condicional para filtrar logs en producción (`NODE_ENV !== 'production'`).

12. Optimización agresiva del bundle con `React.lazy` y `<Suspense>` para aislar componentes pesados (`MonacoEditorLSP`, `marked`, `DOMPurify`, `KaTeX`).

13. Eficiencia de renderizado usando `React.memo` para `NotebookCell` y factorizando dependencias estables con `useCallback` en `NotebookEditor` para evitar re-renders globales al escribir.

14. Exposición de `navigateToCode` vía `actionsRef` para que `App.js` pueda enrutar doble clic del grafo hacia celda/línea concreta; ese mismo contrato queda documentado ahora como backend de la nueva sección `Índice de Notebook` del rail lateral, evitando una segunda vía de navegación notebook-specific dentro del shell.

15. Serialización canónica de `cell.source` al solicitar análisis de dependencias/impacto para evitar desalineación de `lineno` en notebooks cargados desde `.ipynb`.

16. Soporte visual para `agentExecutionState`: banner contextual durante acciones MCP sobre el notebook activo sin reinyectar streams en vivo.

17. `actionsRef` expone `replaceNotebookSnapshot`, `consumeRemoteNotebookMessage` y `focusCell` para que el shell reaplique snapshots same-path y runtime MCP sin recargar el archivo.

18. El handler WS suma paridad para `notebook_cell_deleted`, `notebook_cell_moved` y `notebook_order_set`, y reutiliza `applyNotebookDocumentPayload` para no bifurcar el tratamiento de artefactos DOCX/PDF.

19. `NotebookCell` resincroniza su estado local de editor cuando MCP reemplaza el `source` de la misma celda, evitando que el código visible quede stale mientras los outputs ya reflejan la ejecucion remota.

20. `replaceNotebookSnapshot()` actualiza `notebookRef` en el mismo tick antes de enfocar la celda pedida por MCP, evitando el warning falso “No se pudo ubicar la celda...” cuando la snapshot ya contiene la celda pero el render aún no terminó; el mensaje de navegación faltante queda genérico para no atribuir el fallo erróneamente al panel de dependencias.

21. Nuevo `clearOutputs()` reutiliza la misma normalización persistible del guardado para limpiar outputs, `execution_count`, metadata runtime (`execution_duration*`) y estado visual DOCX/PDF/variables desde el header del shell.

22. `notebook_cell_executed` deja de mezclar el modo batch con la cola manual: `executeAll` avanza solo por `execution_id`, pendientes activos y mensajes terminales válidos.

23. Los timeouts de ejecución muestran la celda afectada cuando falta el mensaje terminal, reduciendo diagnósticos ambiguos de “pegado” en `Run All`.

24. El payload de visualización ahora reexpone `variablesSnapshotDegraded` y `executionDiagnostics` cuando el backend degrada el snapshot runtime, permitiendo distinguir ejecución exitosa de snapshot parcial sin trabar `Run All`.

25. El flujo de reset endurece su recuperación: ante `notebook_reset_kernel_failed`, `NotebookEditor` recrea la sesión usando el snapshot local del notebook y evita dejar el documento abierto en un estado muerto.

26. `NotebookEditor` unifica la resolución documental con `buildDocxDownloadUrlFromPayload`, aceptando `docx_ref`, `docx_file_token` y `docx_artifact_id` como caminos válidos para DOCX y priorizando `artifact_id` cuando convive con una URL genérica estable.

27. Los mensajes `notebook_create`, `notebook_load` y `notebook_execute_cell` reenvían `path` al backend para ligar descargas e historial DOCX al notebook persistido.

28. El editor deja la decisión de historial DOCX al shell global: los mensajes notebook con claves DOCX nulas/stale no deben contarse como documentos nuevos mientras no traigan identidad estable real o contenido inline efectivo.

29. Los payloads de visualización notebook preservan `docx_artifact_id` y una marca de frescura (`docxUpdatedAt`) por generación para que el shell arbitre descargas latest-wins contra historial remoto/local sin recaer en rutas stale.

30. La UI de celda migra la acción primaria de ejecutar/renderizar a un botón redondo pequeño integrado al gutter izquierdo; el hover-toolbar queda para acciones secundarias, el botón amplía su hit area visual al hover y el gutter conserva tanto el contador de ejecución como la duración de la última corrida debajo del botón.

31. `NotebookEditor` pasa a consumir el estándar global de scroll del shell mediante `scroll-surface`, evitando un tema paralelo de scrollbar y manteniendo la interacción homogénea con `TemplateEditor`, explorer y paneles laterales.

32. La hidratación inicial del notebook deja de arrancar desde `useState(initialNotebook)` y pasa por un camino explícito de runtime; esto elimina el falso `DIRTY` al abrir notebooks existentes o al aplicar snapshots remotos same-path.

33. `replaceNotebookSnapshot`, `notebook_loaded`/`notebook_created` y las recargas runtime same-path comparten la misma semántica de “snapshot no persistible”, cerrando la causa raíz del conflicto falso con `workspace_fs_event` bajo espejo MCP.

34. El editor genera ids deterministas cuando faltan `cell.id`, preservando `metadata.inspyro_id` para reducir remounts y onChange espurios asociados a relayouts del shell o de Monaco.

35. `applyNotebookDocumentPayload()`, `notebook_cell_executed` y `notebook_pdf_ready` propagan ahora `docx_provenance_available`/`docx_provenance_ref` hacia `App.js`; el editor no resuelve el click PDF -> código, pero sí preserva el contrato documental que habilita `Modo origen` en `DocxViewer`, incluyendo la distinción `callsite + exact` que luego consume el rail derecho.

36. `NotebookEditor` refresca timeouts locales al recibir `notebook_progress_update` del `execution_id` activo, tanto en la ejecución larga pre-terminal como en la recuperación documental tardía, y trata `notebook_docx_update`/`notebook_pdf_ready` como updates documentales tardíos, no como sustitutos del terminal `notebook_cell_executed`.

37. `NotebookEditor` queda documentado como backend de navegación de la nueva sección `Índice de Notebook` del rail lateral: el shell no crea una segunda lógica de enfoque, sino que reutiliza `navigateToCode()` / `focusCell()` sobre la misma libreta shell-owned.

38. La experiencia de notebook adopta modo result-first: markdown visible y enriquecido, código Python/DOCX colapsado por defecto, Monaco bajo demanda y outputs tratados como entregables visuales con cobertura amplia de MIME bundles y errores live inline.

Detalle histórico: `docs/changelog/11-notebook-editor-ui.md`.

