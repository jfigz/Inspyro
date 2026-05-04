# 06 - Dependency Analyzer

> **Estado:** ✅ Modularizado
> **Ubicación:** `backend/app/services/dependency_analyzer.py`
> **Última actualización:** 2026-04-25
> **Changelog:** `docs/changelog/06-dependency-analyzer.md`

---

## Propósito sistémico

Analizar dependencias estáticas entre símbolos Python para habilitar el grafo de dependencias y el análisis de impacto en notebook/editor.

## Entradas y salidas contractuales

### Entradas
- WS `analyze_dependencies`
- WS `analyze_impact` (con `line`/`column` opcionales para desambiguación de scope)
- WS `optimize_design`
- WS `analyze_load_envelope`
- WS `run_code_checks`
- WS `compare_scenarios`
- Contexto de celdas y/o archivo fuente

### Salidas
- WS `dependency_analysis_result` (correlacionable por `request_id`)
- WS `impact_analysis_result` (correlacionable por `request_id`)
- WS `dependency_analysis_error` / `impact_analysis_error` (correlacionables por `request_id`)
- WS `optimization_progress` / `optimization_result` / `optimization_error`
- WS `load_envelope_result` / `load_envelope_error`
- WS `code_checks_result` / `code_checks_error`
- WS `scenario_comparison_result` / `scenario_comparison_error`

## Dependencias y sinergias

### Upstream
- `11-notebook-editor-ui`, `12-dependency-graph-ui`, `13-monaco-editor` y `14-main-app` (solicitudes de análisis y navegación)
- `04-notebook-handlers` y `analysis.py` (orquestación)

### Downstream
- `12-dependency-graph-ui` (render de nodos/aristas)
- `07-sensitivity-analyzer` (complementa análisis cuantitativo)

## Estado compartido y concurrencia

1. El análisis AST es stateless por request.
2. Puede enriquecerse con estado runtime del kernel (`capture_variables_now`) bajo timeout.
3. Respuestas de análisis incluyen metadatos aditivos (`analysis_mode`, `parse_errors`, `runtime_enriched`) para diagnóstico en UI.
4. No debe bloquear rutas críticas de ejecución de celdas.
5. Cuando `file_path` pertenece al workspace activo, el analizador puede abrir módulos Python locales de forma lazy y cacheada (`ruta absoluta + hash de contenido`) para expandir imports sin tocar módulos externos.
6. En `analyze_impact` con origen `.py` real del workspace, el backend construye además un índice conservador de consumidores `.py` del workspace para encontrar impacto hacia archivos que importan al símbolo origen.
7. El seguimiento interprocedural agrega puentes conservadores `argumento real -> parámetro formal` solo cuando el callsite y el callee se resuelven de forma estática y existe un único callsite resoluble por callee en el contexto analizado; las llamadas a constructores/métodos locales enlazan `instancia -> clase -> __init__/self.attr -> método` cuando no hay ambigüedad.

## Fallos frecuentes y observabilidad

### Fallos frecuentes
- Contexto incompleto de notebook produce grafos parciales.
- Diferencias entre análisis estático y estado runtime real.
- `file_path` ausente o fuera del workspace degrada el análisis a intra-file/cross-cell y evita expansión multiarchivo por seguridad.
- Imports externos/no resolubles deben permanecer como nodos terminales `IMPORT`; expandirlos rompe la frontera del workspace.
- Múltiples callsites resolubles hacia el mismo helper/método fuerzan degradación conservadora: el grafo preserva la relación callsite→callee, pero omite el puente `argumento -> parámetro` para no mezclar flujos.
- Imports dinámicos, reflexión (`getattr`, monkeypatching) o alias de instancia ambiguos se reportan como no resueltos en metadata/warnings antes de inferir una ruta falsa.

### Observabilidad
- Errores enviados por WS (`dependency_analysis_error`, `impact_analysis_error`).
- Trazas de `analysis.py` al fallar parsing o resolución de símbolos.

## Archivos fuente y puntos de entrada

- `backend/app/services/dependency_analyzer.py`
- `backend/app/services/dependency_service.py`
- `backend/app/routers/analysis.py`

## Resumen de cambios recientes

1. **Semántica de `edge.relation` preservada (2026-02-23):** el analizador ya no degrada sistemáticamente a `uses`; ahora conserva `calls`, `imports`, `attribute_of`, `assigns`, `uses` según contexto AST.
2. **Inversión de impacto con relación estable (2026-02-23):** `analyze_impact` mantiene tipo de relación al invertir dependencias, incluyendo consolidación por prioridad cuando se repite un par source→target.
3. **Runtime enrichment scope-aware (2026-02-23):** el router de análisis prioriza match exacto por `scope_path` y usa `name` solo como fallback no ambiguo para evitar contaminación entre símbolos homónimos de scopes distintos.
4. **Hardening + Optimización inicial (2026-02-21):** Se corrige jerarquía de atributos `self.*`, clasificación IO por modo (dependencias vs impacto), parse errors homogéneos y enriquecimiento runtime también en `analyze_impact`. Se agrega servicio de optimización/escenarios con contratos `optimize_design`, `analyze_load_envelope`, `run_code_checks`, `compare_scenarios`.
5. **Fixes exhaustivos de AST y Grafo (2026-02-21):** Corregida contaminación de caché AST vía deepcopy, reparación visual de `analyze_impact` para mantener el polimorfismo de tipos (Variable/Function/Import), y resolución estricta del `self.attr` vía helper.
6. **Integración de Anotaciones y Top-Sort:** El parsing de comentarios de ingeniería ahora transfiere metadata (`@unit`, `@desc`) directamente al `DependencyNode`, y los grafos se pintan con orden topológico exacto en el cliente.
7. **Mejoras dinámicas de Infraestructura:** El checker de módulos ahora usa `importlib` en lugar de enmascarado estático. Lookups acelerados a O(1) y hashes ensanchados para grafos grandes.
8. **Scope-aware en impacto por ubicación:** cuando `analyze_impact` recibe `line`, el backend fija raíz estricta para evitar mezclar dependientes de símbolos homónimos en otros scopes.
9. **Hardening fiabilidad (2026-02-23):** resolución de raíz token-aware por `line/column` (prioriza token clickeado), fallback sólo por candidato único, impacto estricto por QN sin mezcla amplia por nombre, cobertura interprocedural (`return`/`yield`/defaults), merge acumulativo en reasignaciones y dependencias de control (`if/while/try`) codificadas como `uses`.
10. **Meta diagnóstica aditiva:** `graph.meta` incorpora `resolution_strategy`, `ambiguous_symbol_candidates` y `unresolved_symbol_count` para observabilidad de resolución sin romper contratos WS.
11. **Dependencias sin posición forzada (2026-03-07):** `analyze_dependencies` deja de inventar `line=1,column=0` cuando el cliente no los envía; el backend ahora preserva `None` y evita resolver por error el primer símbolo de la celda.
12. **Resolución multiarchivo local (2026-04-10):** el analizador expande imports Python del workspace (`import module`, `import module as alias`, `from module import symbol`, `from .module import symbol`) con parseo lazy/caché por archivo, soporte para `alias.attr`, `location.file` real en nodos externos y degradación segura para stdlib/módulos no resolubles.
13. **Puentes interprocedurales conservadores (2026-04-18):** el backend registra callsites estáticos y enlaza `argumento real -> parámetro formal` en funciones/métodos locales solo cuando la resolución es inequívoca; `analyze_dependencies` y `analyze_impact` ahora pueden mostrar la cadena `arg -> param -> locals -> callee -> callsite` sin contaminar helpers con múltiples callsites.
14. **Impacto workspace + clases locales (2026-04-25):** `analyze_impact` acepta `max_depth`, escanea consumidores `.py` del workspace para impacto hacia adelante desde archivos origen, preserva metadata `workspace_scanned_files`/`workspace_reverse_index_used`, resuelve star imports/reexports por `__init__.py` y enlaza constructores, `self.attr` y métodos de instancias locales sin usar fallback por sufijo dotted.
15. **Warnings accionables (2026-04-25):** los resúmenes `Dependencias no resueltas (top)` filtran builtins de Python (`float`, `int`, `max`, `property`, etc.) antes de incrementar `unresolved_symbol_count` o mostrar advertencias, dejando visibles sólo nombres que requieren revisión real.

Detalle histórico: `docs/changelog/06-dependency-analyzer.md`.
