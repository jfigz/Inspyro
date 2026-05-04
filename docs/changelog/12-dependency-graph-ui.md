# Changelog 12 - dependency-graph-ui

> **Última actualización:** 2026-04-26

## 2026-04-26 - Estado contextual de dependencias sin ruido

1. `App.js` asocia targets de dependencias al `filePath` activo y descarta el target anterior al cambiar de recurso.
2. `VisualizationPanel` no dispara análisis al abrir la pestaña ni al enviar un símbolo vacío; el estado vacío queda inline y no genera notificación persistente.
3. El placeholder manual se adapta al contexto (`M_max` para notebook, `main` para `.py`) y la regresión focalizada fija que el callback de análisis no se invoque en cambios de pestaña.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/components/VisualizationPanel.test.js`, `docs/modules/12-dependency-graph-ui.md`, `docs/architecture/frontend-flow.md`, `docs/changelog/12-dependency-graph-ui.md`

---

## 2026-04-25 - UX de inspección para grafos complejos de la demo extrema

1. `MonacoEditorLSP` delega la selección en `dependencyTargetResolver.js`: selección explícita gana y un cursor sobre `def`/`class`/`async` resuelve el identificador semántico siguiente, evitando análisis de `def`.
2. `VisualizationPanel` compacta el estado vacío a `Sin grafo activo`, mueve la ayuda de clic derecho/`Ctrl+Shift+D` a tooltip y mantiene una entrada `Analizar simbolo` con botones para dependencias e impacto.
3. `App.js` acepta solicitudes manuales desde el panel tanto para archivos `.py` como notebooks, ignora strings/comentarios al localizar símbolos dotted, resuelve aliases de propiedades como `section_area = section.area` y arma contexto notebook conservador.
4. `DependencyGraph` agrega vista `Resumen` para grafos densos: agrupa por target, scope y archivo, y abre `capacity_ratio` como `9 / 51 nodos` y `11 / 67 aristas` antes de entrar al mapa completo.
5. `DependencyGraph` auto-selecciona el root en grafos densos, abre inicialmente `Resumen`, expone chips `Resumen` / `Todo` / `Camino` / `Vecinos`, colapsa secundarios por defecto en `Large graph ON`, limita el resaltado del root al vecindario inmediato en `Todo`, preserva ese vecindario cuando `Camino` se aplica al root y mantiene el camino cuando búsqueda + foco no intersectan.
6. `D3DependencyGraph` baja grosor/opacidad base en `Large graph ON` y atenúa fuertemente las aristas no enfocadas cuando existe selección, evitando que `capacity_ratio` pinte todas las rutas transitivas con la misma presencia visual.
7. El fullscreen del grafo pasa a modo exploración: bloquea el scroll del body, compacta header, mantiene el canvas como región dominante y limita scroll a rail/inspector internos.
8. `[!] Analisis parcial` ahora es un banner de calidad visible y accionable: explica parcialidad, lista warnings/unresolved/caps y permite aumentar profundidad hasta 20 sin abrir diagnóstico por defecto.
9. La búsqueda deja de filtrar estructuralmente por defecto: enfoca/resalta resultados preservando contexto y agrega `Filtrar resultados` / `Mostrar contexto` como control explícito.
10. El inspector inferior se reorganiza en `Resumen`, `Relaciones`, `Origen` y `Codigo`, añade acciones de investigación y oculta UUIDs de celda como etiqueta primaria.
11. Los cierres del grafo normal y de paneles auxiliares (`Trace`, `Sensibilidad`, `Optimizar`) reciben nombres accesibles; `OptimizationPanel` muestra un error local si `Optimizar` no tiene variables numéricas de diseño.
12. Se agregan/actualizan regresiones en `dependencyGraphOverview.test.js`, `dependencyTargetResolver.test.js`, `VisualizationPanel.test.js`, `App.dependency.test.js`, `nodeVisualProfile.test.js`, `DependencyGraph.test.js` y `OptimizationPanel.test.js`.

**Archivos:** `frontend/src/components/dependencyTargetResolver.js`, `frontend/src/components/dependencyTargetResolver.test.js`, `frontend/src/components/MonacoEditorLSP.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/components/VisualizationPanel.test.js`, `frontend/src/components/DependencyGraph.js`, `frontend/src/components/DependencyGraph.css`, `frontend/src/components/DependencyGraph.test.js`, `frontend/src/components/dependencyGraphOverview.js`, `frontend/src/components/dependencyGraphOverview.test.js`, `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/dependency-graph/Panels.js`, `frontend/src/components/dependency-graph/SensitivityPanel.js`, `frontend/src/components/dependency-graph/OptimizationPanel.js`, `frontend/src/components/dependency-graph/OptimizationPanel.test.js`, `frontend/src/components/dependency-graph/nodeVisualProfile.js`, `frontend/src/components/dependency-graph/nodeVisualProfile.test.js`, `frontend/src/App.js`, `frontend/src/App.css`, `frontend/src/App.dependency.test.js`, `docs/modules/12-dependency-graph-ui.md`, `docs/architecture/frontend-flow.md`, `docs/changelog/12-dependency-graph-ui.md`, `docs/llm-index.yaml`

## 2026-04-25 - Modo denso por complejidad para grafos extremos

1. Se agrega `graphComplexity.js` para compartir la decisión de `Large graph` entre `DependencyGraph`, `D3DependencyGraph` y tests.
2. `Large graph auto` deja de depender solo de 120 nodos: ahora activa por 48+ nodos, 64+ aristas o densidad alta, cubriendo casos como `capacity_ratio` de `demo_dependency_analyzer_extreme.ipynb`.
3. `d3Layout.js` amplía spacing, sweeps y demanda de carriles para grafos densos, evitando que cadenas multiarchivo y métodos/clases complejos queden comprimidos en una columna estrecha.
4. `D3DependencyGraph.js` baja el mínimo de fit/zoom a `0.05` para que `Reset view` pueda encuadrar grafos muy altos antes del zoom manual.
5. `D3DependencyGraph.js` reduce grosor y opacidad base de aristas en modo denso, manteniendo highlights interactivos para inspección.
6. Se agregan/actualizan regresiones en `graphComplexity.test.js`, `d3Layout.test.js` y `DependencyGraph.test.js`; también se ejecuta el grupo unitario `dependency-graph`.

**Archivos:** `frontend/src/components/DependencyGraph.js`, `frontend/src/components/DependencyGraph.test.js`, `frontend/src/components/dependency-graph/graphComplexity.js`, `frontend/src/components/dependency-graph/graphComplexity.test.js`, `frontend/src/components/dependency-graph/d3Layout.js`, `frontend/src/components/dependency-graph/d3Layout.test.js`, `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/dependency-graph/index.js`, `docs/modules/12-dependency-graph-ui.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`, `docs/changelog/12-dependency-graph-ui.md`

## 2026-04-25 - Panel visible en notebook angosto y clic derecho robusto

1. `VisualizationPanel` pasa a ser el flex item real en `App.js`: el ancho del split se aplica al componente y se elimina el wrapper externo duplicado con clase `.visualization-panel`.
2. `App.css` agrega reglas responsive para `.notebook-container`; en viewports angostos el notebook y la visualización se apilan, el resizer se oculta y las tabs `DOCUMENTO` / `DEPENDENCIAS` / `VARIABLES` permanecen dentro del viewport.
3. `VisualizationPanel` detecta nuevos análisis por `requestToken` o por una identidad completa del target (`symbol`, `mode`, `cellId`, `line`, `column`, `filePath`), de modo que repetir la misma variable reabre la vista de dependencias.
4. `MonacoEditorLSP` captura el token bajo el clic derecho con `editor.onContextMenu`; las acciones de dependencias e impacto usan esa posición contextual y conservan fallback al cursor actual para shortcuts.
5. `App.js` y `NotebookEditor.js` adjuntan `requestToken` monotónico a cada `dependencyTarget`, sin cambiar los contratos ni mover `analyze_dependencies` / `analyze_impact` fuera del `/ws` global.
6. Se agregan regresiones en `VisualizationPanel.test.js`, `App.dependency.test.js` y `frontend/tests/dependency-panel-responsive.spec.ts`.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.css`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/components/NotebookEditor.js`, `frontend/src/components/MonacoEditorLSP.js`, `frontend/src/components/VisualizationPanel.test.js`, `frontend/src/App.dependency.test.js`, `frontend/tests/dependency-panel-responsive.spec.ts`, `docs/modules/12-dependency-graph-ui.md`, `docs/architecture/frontend-flow.md`, `docs/changelog/12-dependency-graph-ui.md`

## 2026-04-19 - Apertura directa del grafo sin activar el documento en primer paint

1. `VisualizationPanel.js` ya no necesita montar primero la vista `docx` para después saltar a `dependencies` cuando el análisis entra con `dependencyTarget` activo.
2. Esto evita un lifecycle incidental del visor documental justo al abrir el grafo y reduce la probabilidad de carreras con `pdf.js` en shells donde el documento estaba cargado.
3. Se agrega una regresión dedicada en `VisualizationPanel.test.js` que verifica que `DocxViewer` nunca reciba `isVisible=true` en ese escenario.

## 2026-04-10 - Ruteo ortogonal local y sin autopistas globales

1. `edgeRouter.js` deja de usar curvas en el pipeline activo y pasa a generar paths estrictamente rectilíneos (`M/L`) con codos de 90°.
2. El planner global por `laneY` desaparece: `edgeRouter.js` pasa a resolver edges forward por corredores locales entre ranks, con desvíos externos solo para same-rank, retrocesos, ciclos o fallo del routing local.
3. `edgePorts.js` endurece el orden estable de puertos: en flujo `LR`, los lados laterales se ordenan por la posición vertical del vecino y desempatan por rank para reducir inversiones antes del routing.
4. `d3Layout.js` sigue fuera del bundling curvo, mantiene fallback ortogonal y expone `routing_scope` junto a `route_type`, `lane_id` y `shared_trunk_id`.
5. `D3DependencyGraph.js` expone metadata de ruteo en atributos `data-*` para inspección y pruebas E2E.
6. Cobertura ampliada:
   - `edgeRouter.test.js`: paths sin curvas, localidad del recorrido, avance monótono multi-rank y detours externos acotados.
   - `edgePorts.test.js`: orden vertical estable en puertos laterales LR.
   - `d3Layout.test.js`: routing local rectilíneo y spacing dependiente de demanda entre ranks.
   - `frontend/tests/dependency-graph-layout.spec.ts`: verificación E2E de ausencia de comandos curvos y de `routing_scope=external` en la fixture seeded principal.

**Archivos:** `frontend/src/components/dependency-graph/edgeRouter.js`, `frontend/src/components/dependency-graph/edgePorts.js`, `frontend/src/components/dependency-graph/d3Layout.js`, `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/dependency-graph/edgeRouter.test.js`, `frontend/src/components/dependency-graph/edgePorts.test.js`, `frontend/src/components/dependency-graph/d3Layout.test.js`, `frontend/tests/dependency-graph-layout.spec.ts`, `docs/modules/12-dependency-graph-ui.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

## 2026-04-10 - Layout horizontal semántico y nodos content-aware

1. `d3Layout.js` cambia el flujo principal a `LR`: el rank pasa al eje X, los nodos del mismo nivel se alinean verticalmente y el layout deja de wrapear por ancho máximo.
2. `edgePorts.js` prioriza conexiones laterales (`right -> left` / `left -> right`) para el flujo principal y reserva `top/bottom` para same-rank, retrocesos y desvíos.
3. Se introduce `nodeVisualProfile.js` y `nodeSizing.js` deja de usar una cuenta lineal simple: el tamaño de cada nodo se deriva de badges, valor runtime, expresión, checks, procedencia y ubicación.
4. `D3DependencyGraph.js` consume la geometría real del layout, suma badges de procedencia (`EXT`/archivo) y deja de recalcular una altura simplificada distinta a la del motor de layout.
5. Cobertura ampliada:
   - `d3Layout.test.js`: orientación horizontal, columnas por rank y puertos LR.
   - `edgePorts.test.js`: fallback vertical en same-rank dentro del flujo LR.
   - `nodeVisualProfile.test.js`: perfiles semánticos y modo compacto.
   - `frontend/tests/dependency-graph-layout.spec.ts`: crecimiento horizontal y root a la derecha en modo dependencias.

**Archivos:** `frontend/src/components/dependency-graph/d3Layout.js`, `frontend/src/components/dependency-graph/edgePorts.js`, `frontend/src/components/dependency-graph/nodeSizing.js`, `frontend/src/components/dependency-graph/nodeVisualProfile.js`, `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/dependency-graph/d3Layout.test.js`, `frontend/src/components/dependency-graph/edgePorts.test.js`, `frontend/src/components/dependency-graph/nodeVisualProfile.test.js`, `frontend/tests/dependency-graph-layout.spec.ts`, `docs/modules/12-dependency-graph-ui.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

## 2026-04-10 - Cableado del grafo en modo `.py` y navegación a archivos externos

1. `App.js` conecta `MonacoEditor` con `VisualizationPanel` también en modo código: las acciones de dependencias/impacto del editor ya generan `dependencyTarget` sin pasar por notebooks.
2. La navegación grafo→código ahora acepta `location.file`; si el nodo pertenece a otro `.py` del workspace, `App` abre/enfoca el tab correspondiente y reinyecta `highlightLine/highlightColumn` en Monaco.
3. Se agregan regresiones frontend para el flujo completo en `.py`, incluyendo apertura de archivo externo y fallback cuando el nodo no tiene destino navegable.
4. `DependencyGraph.test.js` valida además que `location.file` se propague al callback de navegación cuando el nodo proviene de otro archivo.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.dependency.test.js`, `frontend/src/components/DependencyGraph.js`, `frontend/src/components/DependencyGraph.test.js`, `docs/modules/12-dependency-graph-ui.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

## 2026-04-10 - Contrato de ubicación opcional restaurado en frontend

1. `DependencyGraph` deja de sintetizar `line: 1` / `column: 0` cuando el usuario no seleccionó una ubicación real; el request WS vuelve a respetar el contrato opcional ya endurecido en backend.
2. Se agrega una regresión frontend dedicada para validar ambos casos: ubicación explícita preservada y request sin `line`/`column` cuando la ubicación no existe.
3. `edgePorts.test.js` se realinea con la geometría vigente del grafo: los endpoints deben quedar pegados al borde real del nodo, no desplazados hacia afuera.

**Archivos:** `frontend/src/components/DependencyGraph.js`, `frontend/src/components/DependencyGraph.test.js`, `frontend/src/components/dependency-graph/edgePorts.test.js`, `docs/modules/12-dependency-graph-ui.md`

## 2026-04-10 - Estabilización D3 de viewport y corrección de causa raíz en flechas

1. `D3DependencyGraph` separa render estructural de gestión de viewport: resize, fullscreen, filtros y minimap ya no reconstruyen el SVG completo ni preservan transforms inválidos.
2. El fit usa bounds reales del `content-group` (`getBBox()` + fallback a `layout.bounds`) y deja de asumir un origen fijo; si un transform preservado queda fuera del viewport, el componente hace refit automático.
3. El zoom programático (`fit`, `focus`, `reset`) se marca explícitamente y deja de contaminar `hasUserTransform`, eliminando el comportamiento errático al cambiar el tamaño útil del panel.
4. `edgePorts.js` mantiene `EDGE_ENDPOINT_OFFSET = 0` para que la ruta matemática llegue al borde real del nodo.
5. La causa raíz del clipping residual se corrige eliminando el modelo `mask + marker-end`: los cuerpos pasan a `edge-bodies-layer`, los nodos quedan encima y las puntas se dibujan en `edge-heads-layer` con geometría explícita.
6. Se introduce `edgeVisibility.js` para medir la parte visible del path, calcular la punta como polígono y escalar grosor, dash y head size según el zoom real.
7. Se elimina la animación de opacidad de entrada para cuerpos y puntas de aristas; el estado anterior podía dejar `opacity: 0` inline tras interacción y hacer desaparecer todas las flechas aunque la geometría siguiera presente.
8. `DependencyGraph` mantiene `--dependency-graph-shell-offset` para que el modo fullscreen quede por debajo de `DesktopTitleBar` web y mantenga el header clickeable.
9. Se amplían pruebas:
   - `edgeVisibility.test.js`: rectángulo redondeado, boundary search, punta y escala por zoom.
   - `fitView.test.js`: persistencia/refit de viewport y bounds con origen real.
   - `d3Layout.test.js`: endpoints de aristas pegados al borde del nodo.
   - `frontend/tests/dependency-graph-layout.spec.ts`: integridad cuerpo+puntas, opacidad efectiva no nula, fullscreen y acciones del header.

**Archivos:** `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/dependency-graph/edgeVisibility.js`, `frontend/src/components/dependency-graph/fitView.js`, `frontend/src/components/dependency-graph/edgePorts.js`, `frontend/src/components/DependencyGraph.css`, `frontend/src/components/dependency-graph/edgeVisibility.test.js`, `frontend/src/components/dependency-graph/fitView.test.js`, `frontend/src/components/dependency-graph/d3Layout.test.js`, `frontend/tests/dependency-graph-layout.spec.ts`, `docs/modules/12-dependency-graph-ui.md`, `docs/architecture/frontend-flow.md`

## 2026-04-09 - Re-layout desktop-first, rail adaptativo y fit real

1. `DependencyGraph` se recompone en toolbar compacta + canvas principal + inspector docked, eliminando la superposición permanente del `InfoPanel` sobre el grafo.
2. `Legend`, `Minimap`, `Diagnostics` y `Comparison` pasan a rail derecho cuando el panel tiene ancho suficiente; en layout compacto quedan como secundarios activables desde `More`.
3. `More` deja de depender del stacking context del header y se renderiza vía portal, evitando que `Filtros` o overlays del canvas bloqueen su interacción.
4. `D3DependencyGraph` incorpora auto-fit con escala > 1, padding adaptativo (`fitView.js`) y spacing compacto para grafos de baja densidad.
5. Se retira `scroll-surface` de overlays livianos (`Legend`, `InfoPanel`) y se agregan pruebas nuevas: `fitView.test.js`, `d3Layout.test.js` y `frontend/tests/dependency-graph-layout.spec.ts`.

**Archivos:** `frontend/src/components/DependencyGraph.js`, `frontend/src/components/DependencyGraph.css`, `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/dependency-graph/d3Layout.js`, `frontend/src/components/dependency-graph/fitView.js`, `frontend/src/components/dependency-graph/Panels.js`, `frontend/tests/dependency-graph-layout.spec.ts`, `docs/modules/12-dependency-graph-ui.md`, `docs/architecture/frontend-flow.md`

---

## 2026-02-24 - Pulido visual y corrección de 16 defectos gráficos

### Correcciones
1. Gradientes en nodos categorizados: reemplaza color plano por gradiente real con helper `lightenColor`.
2. Texto legible: helper `contrastTextColor` selecciona blanco/oscuro automáticamente.
3. Header overlay: `clipPath` para esquinas redondeadas solo arriba (nodos y contenedores).
4. Fuentes unificadas: `FONT_LABEL` module-level entre contenedores y nodos.
5. Check nodes: colores corregidos a verde (`#55efc4/#00b894`).
6. Root badge: fill, font-weight y font-family para "R".
7. Badge overflow: guard para no renderizar badges que excedan el ancho del nodo.
8. Truncado: 18 → 24 caracteres.
9. Ubicación: opacidad 0.4 → 0.55.
10. Encoding: `semÃ¡ntica` → `semántica`.
11. Sombra: `stdDeviation` 6 → 4, bounds ajustados.
12. `backdrop-filter` eliminado de SVG (sin efecto).
13. ~470 líneas de CSS legacy eliminadas (React Flow, nodos HTML, contenedores HTML).

### Mejoras visuales
1. Grid de puntos SVG en canvas para profundidad.
2. Halo dorado en nodo raíz (filtro dual `feDropShadow`).
3. Glow cyan en contenedores expandidos.
4. Inner glass stroke (glassmorphism SVG).
5. Separador header/contenido.
6. Animación de entrada escalonada (fade-in + draw-in).
7. Legend expandida: 7 tipos + 5 categorías de ingeniería.
8. InfoPanel: slide-in animado, borde lateral por categoría.
9. Botones: active state, hover lift.
10. Minimap: breathing glow.

**Archivos:** `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/DependencyGraph.css`, `frontend/src/components/dependency-graph/Panels.js`, `docs/modules/12-dependency-graph-ui.md`

---

## 2026-02-23 - Corrección integral de coherencia visual y colapsado controlado

1. El estado de colapsado se mueve a `DependencyGraph` y `D3DependencyGraph` pasa a modo controlado (`collapsedNodeIds`, `onToggleCollapse`).
2. Se incorpora helper compartido `collapsedGraph.js` para derivar vista colapsada efectiva (nodos/aristas/input/output/root) y reutilizarla en grafo principal, minimap y highlight.
3. `selectedPathHighlight` ahora se calcula sobre el grafo colapsado visible para evitar rutas fantasma tras colapsar contenedores.
4. El estado de colapsado se resetea al disparar nuevo análisis para impedir arrastre entre símbolos/consultas.
5. Badges de agregación y labels de evidencia reciben `data-edge-key` y quedan sincronizados con el estado de su arista (`normal/dim/highlight`).
6. Se ajustan markers SVG para escala estable (`markerUnits=userSpaceOnUse`) y se corrige offset de puertos para reducir recorte visual de flechas.
7. `edgePorts` agrega distribución por round-robin + jitter cuando hay sobresaturación (`edgeCount > portCount`).
8. `edgeRouter` completa desvíos orthogonales para casos laterales con obstáculos reales.
9. `d3Layout` minimiza cruces y construye capas usando el set visible para evitar contaminación por nodos ocultos.
10. Se agregan pruebas unitarias para helper de colapsado, puertos saturados, routing orthogonal lateral y estado visual de foco.

**Archivos:** `frontend/src/components/DependencyGraph.js`, `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/dependency-graph/collapsedGraph.js`, `frontend/src/components/dependency-graph/d3Layout.js`, `frontend/src/components/dependency-graph/edgePorts.js`, `frontend/src/components/dependency-graph/edgeRouter.js`, `frontend/src/components/dependency-graph/highlightUtils.js`, `frontend/src/components/dependency-graph/highlightUtils.test.js`, `frontend/src/components/dependency-graph/collapsedGraph.test.js`, `frontend/src/components/dependency-graph/edgePorts.test.js`, `frontend/src/components/dependency-graph/edgeRouter.test.js`, `docs/modules/12-dependency-graph-ui.md`

---

## 2026-02-22 - Hardening anti-crash en `applyInteractiveStyles`

1. Se corrige crash de runtime en D3 (`Cannot read properties of undefined (reading 'id')`) durante efectos pasivos y doble invocación de StrictMode.
2. Cada nodo SVG ahora se crea con binding explícito (`.datum(node)`) para garantizar `layoutNode.id` en callbacks de `each`.
3. `updateNodeStyles` agrega fallback a `data-id` y retorno temprano si falta `nodeId` o `nodeBody`, evitando lecturas inseguras con DOM parcialmente sincronizado.
4. No hay cambios de contrato WS ni de payloads backend; el ajuste es 100% frontend/render.

**Archivos:** `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `docs/modules/12-dependency-graph-ui.md`

---

## 2026-02-22 - Corrección de flechas en focus de precedencia (upstream transitive)

1. `DependencyGraph` calcula `selectedPathHighlight` upstream transitivo sobre el grafo visible (post filtros/modos) y lo envía explícitamente al renderer D3.
2. `D3DependencyGraph` cambia el foco principal a selección persistente por click: el camino upstream permanece resaltado hasta nueva selección o click en fondo.
3. Se desacopla render estructural vs estado interactivo: cambios de selección ya no disparan reconstrucción completa del SVG, reduciendo flicker en cambios rápidos.
4. Se rehace el sistema de `marker` SVG con IDs únicos por instancia y caché por color/opacidad, sincronizando flecha y arista en estados normal/dim/highlight.
5. Hover queda como preview liviano y no invalida el estado persistente de selección; en grafos densos evita dimming masivo.
6. Se agregan pruebas unitarias para helper puro de upstream (`cadena`, `rama`, `ciclo`, `sin upstream`).
7. Se documenta checklist de QA visual por escenarios para validar flechas/markers en foco upstream (cadena, ramas, ciclo, SCC, A/B, selección rápida).

**Archivos:** `frontend/src/components/DependencyGraph.js`, `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/dependency-graph/highlightUtils.js`, `frontend/src/components/dependency-graph/highlightUtils.test.js`, `frontend/src/components/DependencyGraph.css`, `docs/modules/12-dependency-graph-ui.md`

---

## 2026-02-22 - Legibilidad multiescenario (fase UX + semántica + escalabilidad base)

1. `D3DependencyGraph` conserva cámara (`zoom/pan`) entre selecciones y re-renderes; se introduce control explícito `resetViewSignal` para re-fit intencional.
2. `d3Layout` preserva metadata de aristas durante colapsado/layout (`relation`, `relations`, `aggregated_count`, `original_pairs`, `is_cycle`, `route_type`) y habilita pipeline real de puertos/routing/bundling para grafos densos.
3. Se incorpora detección de ciclos (SCC) en layout con marcado visual de nodos y aristas cíclicas.
4. `DependencyGraph` agrega panel de filtros con búsqueda instantánea, filtros por tipo/categoría/celda, modo de foco (`all`, `neighbors`, `path`) y selector de profundidad (`max_depth` 3/5/10/20).
5. Toolbar se vuelve responsive: acciones secundarias se mueven a menú `More` y se reducen sobreposiciones en resoluciones pequeñas.
6. Se activa `Evidence mode` para mostrar relación de aristas y badges de multiplicidad (`aggregated_count`) en edges agregados.
7. Panel de diagnóstico ahora expone calidad de análisis (`parse_errors`, `runtime_enriched`, ciclos, sugerencias de corrección).
8. Limpieza de deuda legacy: `dependency-graph/index.js` deja de re-exportar utilidades/componentes React Flow en la API principal D3.
9. Se agrega `SCC mode` colapsable con supernodos de ciclo y controles de expansión global/individual.
10. Se incorpora minimapa navegable para salto rápido a nodos y recentrado dirigido.
11. Se incorpora comparador A/B con captura de baseline, conteo de deltas y marcado visual `added/mixed` en nodos/aristas.
12. Hover en grafos de alta densidad degrada a estrategia liviana para evitar costos O(E+V) agresivos por evento.

**Archivos:** `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/dependency-graph/d3Layout.js`, `frontend/src/components/DependencyGraph.js`, `frontend/src/components/DependencyGraph.css`, `frontend/src/components/dependency-graph/index.js`, `docs/modules/12-dependency-graph-ui.md`

---

## 2026-02-21 - Hardening de navegación + panel de optimización de ingeniería

1. Se endurecen las condiciones de navegación para nodos con ubicación: se reemplazan checks frágiles por validaciones robustas (`Number.isInteger(cell_index)` y `cell_id` string no vacío).
2. Se evita mostrar hints falsos de navegación y se previenen coordenadas inválidas (`CNaN`/`Lundefined`) en etiquetas del grafo.
3. Se incorpora `OptimizationPanel` en `DependencyGraph` para flujos de optimización paramétrica, envolventes de carga, checks de código y comparación de escenarios.
4. El frontend empieza a tolerar de forma explícita nuevos mensajes WS de análisis/optimización (`optimization_*`, `load_envelope_*`, `code_checks_*`, `scenario_comparison_*`) sin ruido en el dispatcher global.

**Archivos:** `frontend/src/components/DependencyGraph.js`, `frontend/src/components/DependencyGraph.css`, `frontend/src/components/dependency-graph/OptimizationPanel.js`, `frontend/src/components/dependency-graph/Panels.js`, `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/dependency-graph/index.js`, `frontend/src/components/NotebookEditor.js`, `frontend/src/hooks/useAppWebSocket.js`

---

## 2026-02-21 - Discoverability de navegación a código

1. Se añade tip visible en el panel de grafo indicando navegación por doble clic.
2. `InfoPanel` incorpora botón `Ir al código` para navegación explícita sin depender de descubrir el doble clic.
3. `DependencyGraph` centraliza la lógica de navegación para reutilizar doble clic y botón, manteniendo consistencia.

**Archivos:** `frontend/src/components/DependencyGraph.js`, `frontend/src/components/dependency-graph/Panels.js`, `frontend/src/components/DependencyGraph.css`

---

## 2026-02-21 - Panel de diagnóstico y correlación estricta de requests

1. `DependencyGraph` incorpora panel de diagnóstico (`showDiagnostics`) con métricas de ejecución: duración, nodos/aristas, estado, warnings y mensajes descartados.
2. Se endurece el filtrado de respuestas WS por `request_id` para evitar mezclar resultados stale en análisis consecutivos.
3. La navegación al código usa `cell_id` como prioridad para resolver celda destino con mayor precisión.

**Archivos:** `frontend/src/components/DependencyGraph.js`, `frontend/src/components/DependencyGraph.css`, `frontend/src/components/dependency-graph/D3DependencyGraph.js`

---

## 2026-02-21 - Trace Table Topológico (Kahn's Sort)

1. **Orden Algorítmico:** El array `traceNodes` del componente principal `DependencyGraph.js` ahora aplica algoritmo Kahn de sort topológico sobre las aristas antes de pasarlo al sub-panel `TraceTable`. Esto subsana el render asíncrono aleatorio del backend y asegura que las hojas de entradas siempre anteceden ordenadamente a sus dependientes durante tracking paso a paso.

**Archivos:** `frontend/src/components/DependencyGraph.js`

---

## 2026-02-21 - Contenedores Plegables (Collapse/Expand) en Grafo

1. **Renderizado de Contenedores:** Recuperado código visual para mostrar cajas de componentes en `D3DependencyGraph.js` agrupando sub-nodos con botones interactivos de contracción (+/-).
2. **Ajustes de Layout Relativo:** `computeHierarchicalLayout` modificado en `d3Layout.js` para ocultar jerarquías enteras filtrando ancestros colapsados y empalmando las aristas (edges) hacia el contorno delimitante exterior.

**Archivos:** `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/dependency-graph/d3Layout.js`

---



## 2026-02-07 - Cleanup de warnings en utilidades de grafo

1. Se removió código no usado en `D3DependencyGraph.js`, `edgeRouter.js` y `graphUtils.js`.
2. Se estandarizaron exports default nombrados en `edgeBundler.js`, `edgePorts.js` y `edgeRouter.js`.
3. No hubo cambios funcionales de layout/render; el ajuste fue de mantenibilidad/lint.

**Archivos:** `frontend/src/components/dependency-graph/D3DependencyGraph.js`, `frontend/src/components/dependency-graph/edgeBundler.js`, `frontend/src/components/dependency-graph/edgePorts.js`, `frontend/src/components/dependency-graph/edgeRouter.js`, `frontend/src/components/dependency-graph/graphUtils.js`, `docs/modules/12-dependency-graph-ui.md`

## 2026-02-06 - Inicialización del changelog

1. Se crea el changelog dedicado del módulo dentro de docs/changelog/.
2. El histórico detallado se moverá gradualmente desde la documentación de módulo.
