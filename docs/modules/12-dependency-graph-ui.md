# Visualización del Grafo de Dependencias

> **Última actualización:** 2026-04-26
> **Changelog:** `docs/changelog/12-dependency-graph-ui.md`

Este módulo describe la interfaz de usuario para la visualización del grafo de dependencias, implementada con **D3.js** para control total sobre la renderización SVG.

## Mejoras 2026-04-26 (estado contextual y prompts inline)

1. `App.js` asocia cada `dependencyTarget` con `filePath` y lo descarta al cambiar de archivo/notebook, evitando que un análisis anterior se filtre en otra vista.
2. `VisualizationPanel` ya no dispara análisis al abrir la pestaña `Dependencias` ni al enviar el formulario vacío; el estado `Sin grafo activo` queda inline y no genera notificaciones persistentes.
3. El placeholder manual se deriva del contexto activo (`M_max` en notebook, `main` en `.py`, fallback genérico), por lo que el usuario no hereda símbolos de otra superficie.
4. La cobertura focalizada fija que cambiar de tab a `Dependencias` no llama a `onRequestDependencyAnalysis()` y que el flujo `.py` conserva placeholder contextual sin tocar contratos WS.

## Mejoras 2026-04-25 (QA Browser Use sobre grafos complejos)

1. **Selección semántica de símbolo:** `MonacoEditorLSP` usa `dependencyTargetResolver.js` para priorizar una selección explícita y, cuando el cursor cae sobre keywords Python (`def`, `class`, `async`), resolver el identificador siguiente de la línea antes de disparar dependencias o impacto.
2. **Estado vacío accionable y compacto:** `VisualizationPanel` reduce instrucciones visibles a `Sin grafo activo`, mueve ayuda contextual a tooltips y mantiene `Analizar simbolo` para ejecutar dependencias o impacto sin depender del cursor exacto.
3. **Resumen agregado para grafos grandes:** `DependencyGraph` construye una vista `Resumen` con grupos lógicos por target, scope y archivo; `capacity_ratio` pasa de `51 nodos / 67 aristas` a una lectura inicial agregada de `9 / 51 nodos` y `11 / 67 aristas`, manteniendo el grafo completo disponible en `Todo`.
4. **Grafo grande con foco inmediato:** `DependencyGraph` auto-selecciona el nodo raíz en grafos densos, abre inicialmente `Resumen`, mantiene el inspector colapsado y expone chips visibles `Resumen`, `Todo`, `Camino` y `Vecinos` para alternar entre mapa agregado, mapa completo y detalle local; en `Todo`, el root de un grafo grande resalta solo su vecindario inmediato, y si `Camino` se aplica sobre el root conserva ese vecindario para no dejar una vista trivial sin aristas.
5. **Canvas priorizado en modo denso y fullscreen:** en `Large graph ON`, la leyenda deja de ocupar rail por defecto; el rail aparece solo cuando el usuario abre leyenda, minimap, diagnóstico o comparación, y `D3DependencyGraph` atenúa con fuerza aristas no enfocadas para que el grafo completo no compita visualmente con el foco activo. En pantalla completa, el body queda bloqueado, el header se compacta y el scroll se concentra en paneles internos.
6. **Diagnóstico parcial visible:** `[!] Analisis parcial` pasa a banner de calidad accionable dentro del flujo principal, explica por qué la lectura es parcial, lista warnings/unresolved/caps y ofrece `Aumentar profundidad` sin abrir por defecto un rail que reduzca el canvas.
7. **Búsqueda separada de filtro:** escribir en `Buscar nodo` enfoca/resalta el primer resultado y conserva el contexto del grafo; `Filtrar resultados` es una acción explícita para recortar nodos, con `Mostrar contexto` como vuelta rápida.
8. **Inspector orientado a tareas:** `InfoPanel` organiza el detalle en `Resumen`, `Relaciones`, `Origen` y `Codigo`, suma acciones `Ir al codigo`, `Ver vecinos`, `Ver camino` y `Expandir grupo`, y evita usar UUIDs crudos de celda como etiqueta primaria.
9. **Cierres y paneles auxiliares accesibles:** el grafo normal, estados vacíos, `Trace`, `Sensibilidad` y `Optimizar` exponen nombres accesibles para cerrar; `OptimizationPanel` devuelve un error local trazable si `Optimizar` no tiene variables numéricas.
10. **Cobertura nueva:** `dependencyGraphOverview.test.js`, `dependencyTargetResolver.test.js`, `VisualizationPanel.test.js`, `App.dependency.test.js`, `DependencyGraph.test.js` y `OptimizationPanel.test.js` cubren resumen agregado, keywords `def/class`, entrada manual, target notebook/code, chips, búsqueda como foco, bloqueo fullscreen, diagnóstico parcial y optimización sin variables.

## Mejoras 2026-04-25 (modo denso por complejidad y demo extrema)

1. **Detección por complejidad real:** `graphComplexity.js` centraliza umbrales de modo denso por nodos, aristas y densidad; un grafo tipo `capacity_ratio` de la demo extrema ya no espera a 120 nodos para activar `Large graph`.
2. **Layout con spacing de estrés:** `d3Layout.js` abre márgenes, gaps entre ranks, sweeps y demanda de carriles cuando el grafo supera umbrales de complejidad, manteniendo orientación `LR` y ruteo ortogonal.
3. **Fit completo para grafos muy altos:** `D3DependencyGraph.js` permite auto-fit hasta escala `0.05`, de modo que `Reset view` pueda mostrar completo un grafo alto antes de que el usuario haga zoom de inspección.
4. **Aristas menos dominantes en grafos densos:** `D3DependencyGraph.js` reduce grosor/opacidad base en modo denso, preservando highlight interactivo para inspección de caminos sin saturar el lienzo inicial.
5. **Cobertura nueva:** `graphComplexity.test.js`, `d3Layout.test.js`, `DependencyGraph.test.js` y el grupo `dependency-graph` fijan activación automática, spacing adaptativo y compatibilidad con routing/puertos/fit.

## Mejoras 2026-04-25 (panel visible en notebook angosto y target de clic derecho)

1. **Panel como flex item real:** `App.js` deja de envolver `VisualizationPanel` en un segundo `.visualization-panel`; el componente recibe el `style` de ancho directamente y es el elemento que participa en el split.
2. **Notebook responsive:** `.notebook-container` apila editor y visualización bajo viewports angostos, oculta el resizer horizontal y fuerza `width: 100%`, `min-width: 0` y una altura útil para que `DOCUMENTO` / `DEPENDENCIAS` / `VARIABLES` sigan visibles y clickeables.
3. **Identidad completa del análisis:** `VisualizationPanel` usa `requestToken` o la clave `symbol/mode/cellId/line/column/filePath` para detectar nuevos targets; repetir la misma variable vuelve a abrir el panel de dependencias.
4. **Clic derecho robusto en Monaco:** `MonacoEditorLSP` captura la posición del menú contextual y las acciones `Ver Árbol de Dependencias` / `Ver Impacto` usan el token bajo el clic derecho, con fallback al cursor para atajos.
5. **Transporte sin cambios:** `analyze_dependencies` y `analyze_impact` siguen saliendo por el `/ws` global que recibe `App.js`; el `/ws/notebook` no asume estos contratos.
6. **Cobertura nueva:** `VisualizationPanel.test.js`, `App.dependency.test.js` y `frontend/tests/dependency-panel-responsive.spec.ts` fijan repetición de símbolo, propagación notebook con WS global y visibilidad/click derecho en viewport angosto.

## Mejoras 2026-04-19 (apertura directa sin mount transitorio del documento)

1. **Primera pintura alineada al intent real:** `VisualizationPanel` deja de inicializar siempre en `docx`; cuando ya existe `dependencyTarget`, el panel abre directamente `dependencies`.
2. **Sin lifecycle PDF incidental:** este cambio evita montar y desmontar `DocxViewer`/`PdfViewer` en el mismo ciclo solo para llegar al grafo, reduciendo el riesgo de carreras con el worker de `pdf.js`.
3. **Cobertura nueva:** `VisualizationPanel.test.js` fija que un target de dependencias preexistente no haga visible el documento ni siquiera transitoriamente.

## Mejoras 2026-04-10 (ruteo ortogonal local y sin autopistas globales)

1. **Paths 100% rectilíneos:** el pipeline activo deja de usar Bezier y esquinas redondeadas; las aristas se materializan solo con segmentos `M/L` y codos de 90°.
2. **Routing local por tramo:** `edgeRouter.js` deja el planner de carriles globales y pasa a elegir recorridos por corredor local entre ranks; `lane_id` y `shared_trunk_id` siguen existiendo, pero ya no implican una autopista horizontal a escala de todo el grafo.
3. **Detours externos controlados:** same-rank, retrocesos y ciclos salen por carriles superiores/inferiores dedicados, evitando cruzar el corredor central cuando existe alternativa.
4. **Orden estable de puertos:** `edgePorts.js` ya no ordena solo por X; en flujo `LR` prioriza la coordenada vertical del nodo opuesto para que los puertos laterales acompañen mejor el orden visual de los vecinos.
5. **Layout edge-aware:** `d3Layout.js` infla el gap horizontal entre columnas según la demanda real de aristas entre ranks, de modo que el grafo reserve más espacio donde realmente hay más tráfico local.
6. **Bundling curvo fuera del pipeline activo:** `edgeBundler.js` queda como referencia/legacy, pero el render principal no vuelve a introducir curvas en grafos densos.
7. **Cobertura ampliada:** `edgeRouter.test.js`, `edgePorts.test.js`, `d3Layout.test.js` y `frontend/tests/dependency-graph-layout.spec.ts` fijan paths sin comandos curvos, localidad del recorrido, detours externos acotados y estabilidad visual tras zoom/fullscreen.

## Mejoras 2026-04-10 (layout horizontal semántico + nodos content-aware)

1. **Orientación LR por defecto:** `d3Layout.js` pasa a orientar el flujo principal de izquierda a derecha; el rank vive en el eje X y los nodos del mismo nivel se alinean verticalmente.
2. **Sin wrap por ancho del layout:** el grafo deja de cortar filas por `MAX_WIDTH`; ahora el viewport absorbe el crecimiento horizontal y el fit mantiene visible el conjunto.
3. **Packing orgánico controlado:** las capas usan relajación por barycenter en el eje secundario y spacing variable por grado/tamaño, evitando la grilla rígida sin caer en force-layout no determinista.
4. **Puertos y fallback orientados al flujo:** `edgePorts.js` prioriza `right -> left` / `left -> right` para el flujo LR y reserva `top/bottom` para same-rank, retrocesos o detours.
5. **Sizing compartido por contenido real:** `nodeSizing.js` deja la heurística simple por cantidad de líneas y pasa a usar `getNodeDimensions()` basado en badges, valor runtime, expresión, checks, procedencia y ubicación.
6. **Perfil visual semántico:** `nodeVisualProfile.js` clasifica nodos en `quantity-input`, `computed-result`, `check-constraint`, `import-external`, `container` y `generic`, reutilizando metadata ya existente del backend.
7. **Representación más trazable:** el nodo ahora puede mostrar procedencia externa (`full_name`, archivo), badges `EXT`/archivo y dimensiones acordes al contenido sin desalinearse del layout.
8. **Cobertura ampliada:** `d3Layout.test.js`, `edgePorts.test.js`, `nodeVisualProfile.test.js` y `frontend/tests/dependency-graph-layout.spec.ts` fijan la orientación horizontal, la alineación por columnas y los perfiles semánticos.

## Mejoras 2026-04-10 (estabilización D3: viewport y flechas geométricas)

1. **Render y viewport desacoplados:** `D3DependencyGraph` deja de reconstruir el SVG al solo cambiar el tamaño útil del panel; el render estructural y la gestión de zoom/fit pasan a efectos separados.
2. **Jerarquía SVG estable:** el grafo usa `background-layer + viewport-group + content-group`, de modo que el fondo interactivo ya no contamina el cálculo de fit.
3. **Fit con bounds reales:** el auto-fit usa `contentGroup.getBBox()` con fallback a `layout.bounds`, incluyendo padding expandido para labels/badges, y deja de asumir origen `(0,0)`.
4. **Persistencia de cámara endurecida:** el transform manual solo se preserva cuando no cambia el viewport ni la estructura del grafo; resize, fullscreen, filtros y minimap invalidan el transform previo y fuerzan un fit visible.
5. **Zoom programático explícito:** `zoom.transform` usado por fit/focus/reset ya no marca el estado como interacción del usuario, eliminando arrastre errático de transforms viejos.
6. **Se elimina `marker-end`:** la punta deja de depender de markers SVG nativos y pasa a geometría explícita (`edgeVisibility.js`), calculada a partir del path routed y del `zoomK` actual.
7. **Se elimina la máscara de nodos:** ya no se recorta un `edges-layer` superior con `mask`; el render pasa a tres capas (`edge-bodies-layer`, `nodes-layer`, `edge-heads-layer`) para evitar clipping dependiente del zoom.
8. **Cuerpo y punta desacoplados:** el cuerpo visible de la arista se re-muestrea como subpath geométrico, mientras la punta se dibuja como polígono explícito cuyo tip toca el borde real del nodo destino.
9. **Escala visual estable:** grosor de cuerpo, patrón dash de ciclos y dimensiones de la punta se recalculan en unidades del mundo según el zoom, sin depender de la combinación `vector-effect + markerUnits`.
10. **Animación no invasiva:** la animación de entrada queda limitada a nodos y contenedores; las aristas ya no animan opacidad de entrada para evitar estados inline `opacity: 0` tras hover/selección o zoom.
11. **Fullscreen bajo el shell:** el panel fullscreen usa `--dependency-graph-shell-offset` para quedar por debajo de `DesktopTitleBar` web y mantener el header clickeable.
12. **Cobertura ampliada:** `edgeVisibility.test.js`, `fitView.test.js`, `d3Layout.test.js` y `frontend/tests/dependency-graph-layout.spec.ts` ahora cubren recorte geométrico, integridad cuerpo+puntas y transiciones zoom→fullscreen.
13. **Request de análisis endurecido:** `DependencyGraph` deja de enviar `line: 1` / `column: 0` por defecto cuando no existe ubicación real; ahora preserva la semántica de ubicación opcional del contrato WS y suma una regresión frontend específica para ese flujo.
14. **Flujo `.py` cableado end-to-end:** `App.js` ahora pasa `onShowDependencyTree` al `MonacoEditor`, alimenta `VisualizationPanel` también en modo código y navega desde el grafo a archivos `.py` del workspace usando `location.file` + highlight de `line`/`column`.

## Mejoras 2026-04-09 (re-layout desktop-first + rail adaptativo)

1. **Superficie reestructurada:** `DependencyGraph` deja de apilar overlays flotantes sobre el canvas y pasa a una composición con toolbar compacta, canvas central y `Inspector` docked en la base.
2. **Secundarios degradables:** `Legend`, `Minimap`, `Diagnostics` y `Comparison` se renderizan en rail derecho cuando el ancho real del panel lo soporta; en layout compacto quedan como secundarios inline activables desde `More`.
3. **Menú superior desacoplado:** `More` se renderiza en capa portal (`createPortal`) para que `Filtros` o cualquier overlay del canvas no intercepten clicks destinados al header.
4. **Filtros no invasivos:** el panel de filtros deja de vivir como overlay absoluto sobre el grafo y pasa a flujo normal, preservando interactividad del header y del canvas.
5. **Inspector persistente:** el detalle del nodo ya no tapa la visualización; el panel inferior puede colapsarse/expandirse y mantiene el CTA `Ir al código`.
6. **Auto-fit real en grafos chicos:** `D3DependencyGraph` habilita `maxAutoScale > 1`, padding adaptativo (`fitView.js`) y spacing más compacto para grafos de baja densidad.
7. **Tema alineado con el shell:** tipografías y superficies migran a la paleta/tokens del frontend principal (`Source Sans 3`, `Source Code Pro`, fondos del shell) en vez de gradientes y fuentes ad hoc.
8. **Scrollbars artificiales reducidas:** `Legend` e `InfoPanel` salen de `scroll-surface` para evitar barras superpuestas sobre overlays secundarios.
9. **Cobertura nueva:** se agregan tests unitarios para `fitView` y spacing adaptativo del layout, más una E2E dedicada (`frontend/tests/dependency-graph-layout.spec.ts`) para desktop y `1280x800`.

## Mejoras 2026-02-24 (pulido visual y corrección de 16 defectos gráficos)

### Correcciones de defectos visuales
1. **Gradientes en nodos categorizados:** se reemplaza color placo por gradiente real (helper `lightenColor`).
2. **Texto legible en fondos claros:** helper `contrastTextColor` selecciona blanco/oscuro según luminancia.
3. **Header overlay sin artefacto:** `clipPath` para esquinas redondeadas solo arriba en nodos y contenedores.
4. **Consistencia de fuentes:** `FONT_LABEL` unificado entre contenedores y nodos regulares.
5. **Check nodes verdes:** colores corregidos a `#55efc4/#00b894` para consistir con docs y `CATEGORY_COLORS`.
6. **Root badge estilizado:** fill, font-weight y font-family definidos para el badge "R".
7. **Badge overflow guard:** badges que excederían el ancho del nodo no se renderizan.
8. **Truncado de nombre:** ampliado de 18 a 24 caracteres.
9. **Ubicación más visible:** opacidad de 0.4 → 0.55.
10. **Encoding corregido:** `semÃ¡ntica` → `semántica` en comentario.
11. **Sombra proporcional:** `stdDeviation` reducido a 4; bounds de filtro ajustados.
12. **backdrop-filter removido:** no tiene efecto en SVG; eliminado.
13. **~470 líneas de CSS legacy eliminadas:** estilos de React Flow, nodos HTML y contenedores HTML.

### Mejoras visuales nuevas
1. **Grid de puntos en canvas:** patrón SVG (`<pattern>`) con dots semitransparentes para profundidad espacial.
2. **Halo dorado en nodo raíz:** filtro SVG dual (`feDropShadow` gold + shadow) que destaca el root.
3. **Glow en contenedores expandidos:** filtro cyan sutil para diferenciar de nodos normales.
4. **Inner glass stroke:** rect inset con borde blanco 12% para glassmorphism en SVG.
5. **Separador header/contenido:** línea `<line>` sutil entre nombre y badges.
6. **Animación de entrada escalonada:** fade-in (350ms + 25ms delay) para nodos; draw-in (600ms) para edges.
7. **Legend expandida:** 7 tipos de nodos con gradientes + 5 categorías de ingeniería con iconos y dots de color.
8. **InfoPanel mejorado:** slide-in animado, borde lateral por categoría, estilos para código y valores.
9. **Botones con feedback:** active state, hover lift+sombra, transiciones más suaves.
10. **Minimap con glow:** animación breathing de box-shadow (3s).

## Mejoras 2026-02-23 (consistencia colapsado + foco + routing)

1. **Colapsado controlado por React:** `collapsedNodeIds` se eleva a `DependencyGraph` y `D3DependencyGraph` queda controlado vía props (`collapsedNodeIds`, `onToggleCollapse`).
2. **Vista colapsada compartida:** se introduce helper puro `collapsedGraph.js` para derivar nodos/aristas visibles y reutilizarlo en grafo principal, minimap y cálculo de highlight.
3. **Highlight sin rutas fantasma:** `selectedPathHighlight` se calcula sobre la vista colapsada efectiva, no sobre el grafo base.
4. **Reset de colapsado por análisis:** al cambiar request/símbolo/modo se limpia estado de colapsado para evitar arrastre entre consultas.
5. **Foco visual coherente en aristas:** badges (`edge-aggregate-badge*`) y etiquetas de evidencia (`edge-evidence-label`) heredan el mismo estado `normal/dim/highlight` que su arista.
6. **Semántica visual de aristas en overlays:** badges/labels reciben `data-edge-key` para sincronización robusta por arista.
7. **Flechas menos recortadas en destino:** puertos usan `EDGE_ENDPOINT_OFFSET` y markers SVG pasan a escala estable (`markerUnits=userSpaceOnUse`, `refX`/`size` ajustados).
8. **Densidad alta mejor distribuida:** cuando `edgeCount > portCount`, `edgePorts` aplica round-robin + jitter por carril para reducir superposición total.
9. **Routing orthogonal lateral completo:** `edgeRouter` incorpora desvíos reales para casos left/right con obstáculos.
10. **Layout aislado de nodos ocultos:** `d3Layout` construye capas y minimiza cruces con el set visible, evitando contaminación de barycenter por nodos no renderizados.

## Mejoras 2026-02-22 (legibilidad multiescenario)

1. **Persistencia de cámara (zoom/pan):** selección de nodos y cambios de detalle ya no fuerzan recentrado automático; se conserva `transform` hasta acción explícita de `Reset view`.
2. **Semántica de aristas preservada en layout:** `d3Layout.js` mantiene metadata enriquecida (`relation`, `relations`, `aggregated_count`, `original_pairs`, `is_cycle`, `route_type`) durante colapsado y routing.
3. **Pipeline real de routing/bundling activable:** se conecta flujo `assignPortsToEdges -> routeAllEdges -> bundleEdges` con auto-activación en grafos densos.
4. **Detección y marcado de ciclos:** SCC detectadas en layout con marcas visuales (nodos/edges) y metadata de ciclo para diagnósticos.
5. **LOD de texto en grafos grandes:** se reduce densidad de texto secundario en `Large Graph Mode` para mejorar rendimiento y lectura.
6. **Toolbar responsive con menú `More`:** acciones secundarias se mueven a menú contextual y se evita overflow en anchos móviles/laterales.
7. **Filtros y búsqueda instantánea:** panel con `search`, filtros por tipo/categoría/celda y modo de foco (`all`, `neighbors`, `path`).
8. **Calidad de análisis visible:** panel de diagnóstico muestra `parse_errors`, `runtime_enriched`, estado de ciclos y sugerencias de corrección.
9. **Control de profundidad de análisis:** selector de `max_depth` (3/5/10/20) conectado al request WS sin romper contrato.
10. **Limpieza de superficie legacy:** `index.js` deja de re-exportar utilidades/componentes de React Flow en el pipeline principal D3.
11. **SCC mode colapsable:** ciclos pueden verse como supernodos (`scc::*`) y expandirse/colapsarse individualmente o en bloque.
12. **Minimapa navegable:** overlay SVG con salto rápido a nodo y recentrado sin perder escala.
13. **Comparador A/B:** captura de baseline y delta visual de nodos/aristas (`added`/`mixed`) entre ejecuciones.
14. **Hover degradado para densidad alta:** se reduce atenuación global masiva cuando el grafo supera umbral de complejidad.
15. **Flechas robustas en foco de precedencia:** selección por click ahora fija resaltado upstream transitivo y sincroniza color/opacidad de marcador con cada arista para evitar rutas “cortadas”.

## Arquitectura

```
DependencyGraph.js (React wrapper)
  ├── dependencyGraphOverview.js (vista agregada para grafos densos)
  └── D3DependencyGraph.js (D3.js + SVG)
        ├── SVG Container con zoom/pan
        ├── Capa de contenedores (containers-layer)
        ├── Capa de cuerpos de aristas (edge-bodies-layer)
        ├── Capa de nodos (nodes-layer)
        └── Capa de puntas (edge-heads-layer)
```

### Archivos Principales

| Archivo | Propósito | Líneas (referencial) |
|---------|-----------|----------------------|
| `D3DependencyGraph.js` | Renderizado SVG con D3.js | ~700 |
| `d3Layout.js` | Layout jerárquico con minimización de cruces | ~480 |
| `edgePorts.js` | Sistema de puertos dinámicos | ~365 |
| `edgeRouter.js` | Routing inteligente de edges | ~420 |
| `edgeBundler.js` | Agrupación de edges paralelos | ~320 |
| `edgeVisibility.js` | Geometría visible de cuerpos y puntas | ~280 |
| `graphComplexity.js` | Umbrales compartidos de densidad/large graph | ~40 |
| `dependencyGraphOverview.js` | Agrupación `Resumen` por target/scope/archivo para grafos densos | referencial |
| `Panels.js` | InfoPanel, Legend (expandida), TraceTable, IOSidebar | ~290 |
| `constants.js` | Colores y iconos por tipo/categoría | ~50 |
| `utils.js` | Funciones de formato y validación | ~70 |
| `nodeSizing.js` | Dimensiones compartidas de nodos (D3 + layout) | ~80 |
| `nodeVisualProfile.js` | Perfil semántico y secciones visibles por nodo | ~120 |
| `DependencyGraph.js` | Wrapper React con estado y WebSocket | ~360 |
| `fitView.js` | Auto-fit/padding adaptativo para viewport | ~50 |

> Nota: los conteos de líneas son aproximados y solo referenciales.

---

## Sistema de Edges (v3.0)

### Puertos Dinámicos (`edgePorts.js`)

Cada nodo tiene múltiples puntos de conexión:

| Lado | Puertos | Uso |
|------|---------|-----|
| TOP | 5 | Same-rank, retrocesos o detours |
| BOTTOM | 5 | Same-rank, retrocesos o detours |
| LEFT | 3 | Entradas del flujo LR |
| RIGHT | 3 | Salidas del flujo LR |

Los edges se distribuyen automáticamente entre puertos para evitar superposición.

### Routing Ortogonal Local (`edgeRouter.js`)

El pipeline activo usa una sola familia de ruteo rectilíneo, pero con alcance local:

1. **Orthogonal bus** - rutas rectas que se mantienen cerca de sus columnas y solo comparten tramos cortos/locales cuando realmente coincide el corredor.
2. **Orthogonal detour** - desvíos externos para same-rank, retrocesos, ciclos o fallo del routing local.
3. **Orthogonal fallback** - ruta rectilínea segura cuando el planner local no logra resolver un edge limpio.

El score de carriles prioriza, en orden:

1. Cero colisiones con nodos.
2. Menos conflictos/cercanía entre carriles del mismo corredor.
3. Menor salida del envelope local fuente-destino.
4. Menor longitud Manhattan.

### Bundling Legacy (`edgeBundler.js`)

- Se mantiene como módulo legacy/referencial para compatibilidad histórica.
- El grafo D3 principal ya no lo activa: la agrupación visible se resuelve, cuando existe, dentro del router como **shared trunk local**, no como postproceso curvo.

---

## Layout Optimizado (`d3Layout.js`)

### Algoritmo de Minimización de Cruces

1. **Rankeo topológico** - BFS para asignar profundidad a cada nodo
2. **Barycenter heuristic** - Ordena nodos horizontalmente por baricentro de conexiones
3. **Iteración bidireccional** - Múltiples pasadas arriba↔abajo para optimizar
4. **Separación dinámica** - Nodos con más conexiones reciben más espacio y los gaps entre ranks crecen según la demanda de carriles

```javascript
// Configuración del layout
const LAYOUT_CONFIG = {
    NODE_WIDTH: 180,
    NODE_HEIGHT: 100, // Fallback si no hay sizing dinamico
    NODE_MARGIN_X: 40,
    NODE_MARGIN_Y: 50,
    LAYOUT_STYLE: 'flow',
    FLOW_SWEEPS: 6,
    FLOW_MIN_GAP: 24,
    FLOW_LAYER_GAP: 70,
    CROSSING_ITERATIONS: 12,  // Iteraciones de barycenter
    ENABLE_PORTS: true,
    ENABLE_ROUTING: true,
    ENABLE_BUNDLING: false,  // El pipeline activo usa bus routing, no bundling curvo
};
```

### Node sizing compartido

- Las dimensiones del nodo se calculan por contenido visible real: header, badges, valor/runtime, expresión, checks, procedencia y ubicación.
- `nodeSizing.js` reutiliza `nodeVisualProfile.js` para que layout y render compartan exactamente la misma noción de densidad/altura/ancho.
- `d3Layout.js` usa ese sizing para contenedores y nodos hoja, evitando drift entre el tamaño calculado en el layout y la tarjeta SVG realmente dibujada.

### Flow layout para grafos planos

- Cuando no hay contenedores, el layout usa columnas por rank en orientación `LR`.
- Se aplican sweeps de barycenter sobre el eje Y para acercar nodos a sus vecinos y compactar sin solapes.
- El grafo crece hacia la derecha y los nodos del mismo nivel quedan alineados verticalmente; el viewport absorbe el ancho, no el layout.
- El gap entre columnas deja de ser fijo: `d3Layout.js` lo infla según el número/span de aristas que deben cruzar cada corredor horizontal.
- En grafos densos, `graphComplexity.js` activa `largeGraphMode` por nodos, aristas o densidad y el layout usa spacing ampliado antes de degradar a un canvas ilegible.

---

## Características Visuales

### Nodos
- **Gradientes** por tipo de nodo (variable, function, class, import, etc.) con contraste de texto automático
- **Inner glass stroke** (borde interior cristalino para profundidad)
- **Sombras SVG** proporcionales con filtro ajustado
- **Halo dorado** en nodo raíz para destaque inmediato
- **Icono + nombre + unidad** `📐 variable [kN]`
- **Separador visual** entre header y contenido
- **Badges de metadata** (tipo, categoría, IN/OUT) con guard de overflow
- **Procedencia visible** para imports/nodos externos (`EXT`, archivo, `full_name`)
- **Descripción semántica** (si existe)
- **Valor runtime** resaltado en banda
- **Expresión** (línea `expr:` con preview de código)
- **Indicador de rango** 🟢🟡🔴 (ok/warning/error)
- **Resultado de verificación** PASS/FAIL/PENDING
- **Ubicación** `C1:L25` (celda:línea)
- **Animación de entrada** escalonada solo para nodos y contenedores

### Contenedores
- **Glassmorphism** (fondo translúcido)
- **Glow sutil** en contenedores expandidos (filtro cyan)
- **Headers coloreados** por tipo (class/function/method)
- **Headers con clipPath** (esquinas limpias sin artefactos)
- **Bordes punteados** para funciones
- **Jerarquía anidada** real (hijos dentro de padres)

### Canvas
- **Grid de puntos** para profundidad espacial (pattern SVG)
- **Fondo gradiente oscuro** (`#0f0f23` → `#1a1a2e` → `#16213e`)

### Interactividad
- **Zoom/pan** con d3-zoom
- **Selección** de nodos (click)
- **Navegación** al código (doble clic)
- **Navegación asistida**: tip visible en UI + botón `Ir al código` en `InfoPanel` para usuarios primerizos
- **Panel de optimización**: ejecución de `optimize_design`, `analyze_load_envelope`, `run_code_checks`, `compare_scenarios` desde el propio grafo
- **Diagnóstico técnico** en panel flotante (métricas, warnings y correlación de request)
- **InfoPanel** con detalles completos del nodo
- **Hover highlighting**: Al pasar el mouse sobre un nodo:
  - Resalta el nodo y sus conexiones directas
  - Atenúa el resto del grafo
  - Diferencia visualmente edges entrantes vs salientes
- **Correlación WS por `request_id`** para ignorar respuestas stale entre requests consecutivos

### Estilos de Edges
- **Color base**: `#81ecec` (cian brillante)
- **Opacidad**: base 0.7; en focus upstream se eleva en ruta seleccionada y atenúa fuera de ruta sin ocultar flechas
- **Ancho**: base dinámico por `aggregated_count`; el grosor visible se recalcula en unidades del mundo según `zoomK`
- **Flechas**: punta geométrica explícita (`edge-head`) calculada desde el path routed; no usa `marker-end`
- **Efectos**: Glow filter para edges destacados
- **Zoom**: cuerpo, dash de ciclos y punta se reescalan explícitamente para mantener lectura estable
- **Transiciones CSS**: 0.3s ease para animaciones suaves

## Checklist QA visual - Flechas en foco upstream

Usar este checklist para validar que el fix de flechas se mantiene estable en escenarios reales.

### Preparación

1. Ejecutar `.\agent_debug.ps1 start`.
2. Abrir un notebook con dependencias suficientes para ver rutas multi-salto.
3. Abrir panel de dependencias; en grafos grandes confirmar primero `Resumen` y luego cambiar a `Todo` para validar caminos upstream completos.

### Escenarios obligatorios

1. **Cadena lineal** (`a -> b -> c`, click en `c`)
   1. Esperado: se resaltan nodos `{a,b,c}` y aristas `{a->b,b->c}`.
   2. Esperado: las puntas de flecha del camino resaltado se ven completas y no “cortadas”.

2. **Ramas múltiples** (`a -> c`, `b -> c`, click en `c`)
   1. Esperado: ambas ramas upstream quedan resaltadas.
   2. Esperado: aristas fuera de ruta se atenúan pero conservan flecha visible.

3. **Ciclo** (`a -> b -> a`, click en `b`)
   1. Esperado: no hay bloqueos ni loops visuales.
   2. Esperado: la ruta upstream mantiene flechas consistentes durante zoom/pan.

4. **Selección rápida** (20 clicks consecutivos en nodos distintos)
   1. Esperado: no hay flicker severo ni desaparición intermitente de cuerpos o puntas.
   2. Esperado: cada selección fija highlight persistente hasta nuevo click o fondo.

5. **Reset de selección** (click en fondo)
   1. Esperado: se limpia el highlight persistente.
   2. Esperado: todas las aristas vuelven a opacidad base y flechas válidas.

6. **A/B + SCC (si aplica)**
   1. Esperado: color de arista y color de flecha permanecen sincronizados (`normal/added/mixed`).
   2. Esperado: supernodos SCC no rompen el cálculo geométrico del subpath visible ni de la punta.

7. **Grafo grande agregado** (`capacity_ratio` en `demo_dependency_extreme/model.py`)
   1. Esperado: la vista inicial sea `Resumen`, con conteos `filtrados / total` y nodos agrupados por target/scope/archivo.
   2. Esperado: `Todo` conserve el grafo completo y `Vecinos` reduzca a contexto local sin perder `Large graph ON`.

### Criterios de aceptación visual

1. Ninguna arista del camino upstream seleccionado aparece sin punta de flecha.
2. Ninguna arista o punta queda con opacidad efectiva `0` tras hover, selección, zoom o fullscreen.
3. Opacidad de aristas fuera de ruta nunca llega a ocultar completamente la flecha.
4. Comportamiento consistente en zoom mínimo, intermedio y máximo.

---

## Propiedades del Componente

```javascript
<D3DependencyGraph
    graphData={graphData}          // Datos del backend
    rootId={graphData.root_id}     // ID del nodo raíz
    selectedNodeId={selectedNode?.id}
    collapsedNodeIds={collapsedNodeIds} // Colapsado controlado (Set<string>)
    onToggleCollapse={handleToggleCollapse}
    onNodeClick={handleNodeClick}
    onNodeDoubleClick={handleNodeDoubleClick}
    onBackgroundClick={handleBackgroundClick}
    resetViewSignal={resetViewSignal}     // Forzar recentrado explícito
    focusNodeRequest={focusNodeRequest}   // Centrar en nodo puntual (minimap/search)
    showEdgeEvidence={showEdgeEvidence}   // Etiquetas relation en aristas
    largeGraphMode={effectiveLargeGraphMode}
    fitPadding={{ x: 24, y: 24 }}         // Padding adaptativo para auto-fit
    maxAutoScale={2.8}                    // Permite ampliar grafos pequeños
    selectedPathHighlight={selectedPathHighlight} // { node_ids, edge_keys } sobre grafo visible
    selectionHighlightTrigger="click"             // highlight persistente
    selectionHighlightMode="upstream_transitive"  // precedencia completa
/>
```

## Metadata de Aristas/Layout (Frontend interno)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `relation` | string \| null | Relación principal (`uses`, `calls`, `imports`, `mixed`, etc.) |
| `relations` | string[] | Conjunto de relaciones agrupadas |
| `aggregated_count` | number | Multiplicidad real al colapsar/agrupar |
| `original_pairs` | array | Pares origen-destino originales para evidencia |
| `route_type` | string | Tipo de enrutado (`orthogonal-bus`, `orthogonal-detour`, `orthogonal-fallback`) |
| `lane_id` | string \| null | Carril ortogonal asignado por el planner local |
| `shared_trunk_id` | string \| null | Identificador de tramo compartido cuando varias aristas coinciden en el mismo corredor local |
| `routing_scope` | string \| null | Alcance del recorrido (`local` o `external`) |
| `is_cycle` | bool | Arista marcada como parte de ciclo |
| `ab_status` | string | Estado delta A/B (`added`, `mixed`, `unchanged`) |

## Metadata de Grafo (opcional / aditiva)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `meta.has_cycles` | bool | Flag de ciclos detectados en layout |
| `meta.scc_count` | number | Cantidad de componentes fuertemente conexas |
| `meta.parse_errors_count` | number | Conteo de `parse_errors` |
| `meta.runtime_enriched` | bool | Si el grafo incluyó enriquecimiento runtime |

## Contrato de ubicación opcional

- `DependencyGraph` solo envía `line` cuando recibe un entero positivo real y solo envía `column` cuando la ubicación existe y la columna es un entero no negativo.
- Si el usuario no seleccionó una posición concreta, el frontend omite ambos campos y deja que backend preserve la ausencia de ubicación sin sintetizar `1:0`.
- La navegación grafo→código sí puede seguir usando `column=0` como fallback visual local cuando el nodo no trae columna explícita; eso no altera el payload WS de análisis.

## Navegación notebook + archivo

- `DependencyGraph` trata `location.file` como source of truth para nodos multiarchivo; si apunta a otro `.py` del workspace, delega a `App` la apertura/activación del tab correcto antes de aplicar highlight visual.
- Cuando el nodo pertenece al notebook actual, la navegación existente por `cell_id` / `cell_index` sigue vigente y no cambia el contrato WS.
- Si el análisis no entrega un destino navegable (`file`, `cell_id`, `cell_index`, `line`), el frontend mantiene el grafo y degrada a warning local sin romper la sesión.

---

## Datos del Nodo (Backend → Frontend)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | ID único del nodo |
| `name` | string | Nombre para visualización |
| `node_type` | string | variable, function, class, import, check... |
| `location` | object | `{ line, column, cell_index, cell_id }` |
| `value_preview` | string | Preview del código |
| `runtime_value` | object | Valor en runtime |
| `full_name` | string | Nombre cualificado o procedencia del import |
| `is_external` | bool | Marca imports/nodos externos al workspace |
| `description` | string | Descripción semántica |
| `unit` | string | Unidad física (kN, m, MPa) |
| `valid_range` | array | `[min, max]` |
| `category` | string | material, geometry, load, result, factor |
| `reference` | string | Referencia normativa |
| `is_check` | bool | Es verificación (assert) |
| `check_result` | bool/null | true/false/null |
| `check_message` | string | Mensaje del assert |
| `parent_id` | string | ID del contenedor padre |
| `children_ids` | array | IDs de nodos contenidos |
| `is_container` | bool | Es contenedor (clase/función) |
| `container_type` | string | class, function, method |
| `analysis_mode` | string | dependencies o impact |
| `parse_errors` | array | Errores de parseo por celda |
| `runtime_enriched` | bool | Si hubo enriquecimiento runtime |

---

## Colores por Categoría de Ingeniería

| Categoría | Color | Icono |
|-----------|-------|-------|
| material | 🟠 naranja | 🧱 |
| geometry | 🔵 azul | 📏 |
| load | 🔴 rojo | ⬇️ |
| result | 🟢 verde | 📊 |
| factor | 🟣 púrpura | ⚖️ |
| input | 🟡 amarillo | 📥 |
| output | 🩵 turquesa | 📤 |
| check | 🟢 verde | ✔️ |

---

## Historial de Cambios

> **2026-02-22:** Hardening anti-crash en selección interactiva de nodos
> - `D3DependencyGraph` ahora bindea `datum(node)` al crear cada `<g.node>` para que los handlers de estilo reciban datos consistentes.
> - `applyInteractiveStyles` agrega fallback por `data-id` y guard clause (`nodeBody.empty()` / `nodeId` vacío) para evitar `TypeError: Cannot read properties of undefined (reading 'id')`.
> - Se estabiliza el render en StrictMode y en ciclos de mount/unmount pasivo cuando hay nodos sin binding temporal.

> **2026-02-21:** Optimización integrada + navegación robusta
> - `DependencyGraph.js` incorpora `OptimizationPanel` para lanzar `optimize_design`, `analyze_load_envelope`, `run_code_checks`, `compare_scenarios`.
> - Se corrigen validaciones de navegación para usar `Number.isInteger(cell_index)` y evitar falsos positivos con payload legacy.
> - `D3DependencyGraph.js` endurece render de ubicación para evitar etiquetas `Lundefined`.

> **2026-02-21:** Diagnóstico y navegación robusta
> - `DependencyGraph.js` incorpora panel de diagnóstico (`showDiagnostics`) con duración, conteos de nodos/aristas, warnings y mensajes descartados por request stale.
> - Correlación estricta por `request_id` en resultados/errores de análisis de dependencias e impacto.
> - Navegación grafo→código ahora prioriza `location.cell_id` para enrutar a la celda correcta.
> - UX: se agrega tip persistente de navegación y acción explícita `Ir al código` en panel de detalle.

> **2026-02-21:** Trace Table Topológico
> - Implementación del algoritmo de Kahn para cálculo O(E+V) de top-sort en cliente.
> - Panel `TraceTable` ahora muestra hojas iterativamente en orden exacto descendente.

> **2026-02-07:** Cleanup de warnings sin cambios funcionales
> - Se eliminó código no usado en `D3DependencyGraph.js` (`CONTAINER_STYLES`, `containersGroup`).
> - Se normalizaron exports default no anónimos en `edgeBundler.js`, `edgePorts.js` y `edgeRouter.js`.
> - Se removieron variables locales no usadas en helpers legacy del layout previo.

> **2026-01-23:** Layout flow + contenido de nodos
> - **Flow layout:** capas con sweeps y compactacion horizontal por dependencias
> - **Nodos:** badges tipo/categoria/IN-OUT y linea expr
> - **Valor runtime:** banda destacada + check en pill

> **2026-01-23:** Alineacion de edges y sizing compartido
> - **nodeSizing.js**: altura real de nodo usada por layout y render D3
> - **Edges**: flechas incoming/outgoing + glow al resaltar
> - **Zoom**: trazo de edges constante al hacer zoom

> **2026-01-24:** Sistema de edges v2.0
> - **Implementación Robusta en `d3Layout.js`:**
>   - Distribución de puertos dinámicos inline (sin dependencias externas complejas)
>   - Ordenamiento automático de edges para minimizar cruces
>   - Curvas Bezier mejoradas con "carriles visuales"
> - **Módulos Base (disponibles para futuro):** `edgePorts.js`, `edgeRouter.js`, `edgeBundler.js`
> - **Mejoras Visuales:**
>   - Hover highlighting corregido (target `<rect>` en vez de grupo)
>   - Múltiples arrowheads (normal, incoming, outgoing)
>   - Efecto glow para edges destacados
> - **Layout:** Minimización de cruces con heurística de baricentro

> **2026-01-23:** Migración de React Flow + Dagre a D3.js puro
> - Control total sobre contenedores anidados
> - Mejor rendimiento con grafos grandes
> - Eliminación de dependencias pesadas

### Archivos Legacy (ya no se usan)
- `DependencyNode.js` - Reemplazado por D3
- Helpers legacy de React Flow/Dagre ya retirados del repo tras la migración a D3.
