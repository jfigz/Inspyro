# Changelog 06 - dependency-analyzer

> **Última actualización:** 2026-04-25

---

## 2026-04-25 - Impacto workspace y dataflow mínimo de clases

1. `analyze_impact` ahora puede indexar consumidores `.py` del workspace cuando la raíz viene de un archivo Python real, permitiendo ver impacto hacia archivos posteriores que importan el símbolo origen.
2. Se cablea `max_depth` en el contrato de impacto desde WS, servicio backend, MCP y frontend.
3. La resolución de clases importadas respeta `module_prefix`, registra `self.attr` bajo la clase real y enlaza constructores/métodos locales con la cadena `argumento -> __init__.param -> self.attr -> método -> resultado`.
4. Se elimina el fallback peligroso por sufijo para referencias dotted no resueltas; `alias.attr` sólo cruza archivos cuando hay import o instancia local inequívoca.
5. Nuevas regresiones cubren impacto cross-file global, star imports, reexports por `__init__.py`, `max_depth` y homónimos de clase/global.
6. Los warnings `Dependencias no resueltas (top)` filtran builtins de Python antes de actualizar `unresolved_symbol_count`, para que grafos como `BeamModel.capacity_ratio` no muestren `float`, `int`, `max` o `property` como fallas accionables.

**Archivos:** `backend/app/services/dependency_analyzer.py`, `backend/app/services/dependency_service.py`, `backend/app/routers/analysis.py`, `backend/app/contracts/ws_models.py`, `backend/mcp_server/tools/analysis.py`, `backend/tests/test_dependency_cross_file_resolution.py`, `backend/tests/test_dependency_fixes.py`, `frontend/src/components/DependencyGraph.test.js`, `docs/modules/06-dependency-analyzer.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-04-18 - Puentes interprocedurales conservadores callsite -> parametro

1. `dependency_analyzer.py` registra callsites AST resolubles y construye puentes internos `argumento real -> parametro formal` solo para funciones/metodos locales con resolucion estatica no ambigua.
2. `analyze_symbol` y `analyze_impact` incorporan esos puentes sin cambiar contratos WS ni tipos publicos de nodo/arista, habilitando la cadena completa `arg -> param -> locals -> callee -> callsite`.
3. La inyeccion interprocedural es conservadora: si un mismo callee tiene multiples callsites resolubles en el contexto analizado, el backend omite el puente para evitar contaminacion entre callers.
4. El visitor deja de promover `self` desnudo como dependencia util cuando ya existe `self.attr` o `self.method`, eliminando warnings espurios sin perder rastreo de atributos/metodos.
5. Nuevas regresiones backend cubren funcion libre, metodo de clase, keyword args, fallback conservador con multiples callsites y continuidad de cadenas via retorno de estructuras simples.

**Archivos:** `backend/app/services/dependency_analyzer.py`, `backend/tests/test_dependency_impact_resolution.py`, `docs/modules/06-dependency-analyzer.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-10 - Resolución multiarchivo local para imports del workspace

1. `dependency_analyzer.py` reemplaza la metadata mínima de imports por bindings estructurados y resuelve imports Python locales del workspace usando `file_path` como contexto y el workspace activo backend como root canónico.
2. Se añade soporte explícito para `from module import symbol`, `from module import symbol as alias`, `import module`, `import module as alias` e imports relativos dentro de paquetes locales (`from .helpers import B`).
3. El analizador ahora expande módulos `.py` locales de forma lazy y cacheada por ruta absoluta + hash de contenido, preservando imports externos/no resolubles como nodos terminales `IMPORT`.
4. La resolución de dependencias/impacto entiende `alias.attr` y puede atravesar bindings locales hacia definiciones reales del archivo importado, poblando `location.file`, `line` y `column` del archivo externo.
5. Se agregan regresiones backend para expansión cross-file, imports relativos, impacto cross-file y aislamiento de homónimos entre módulos.

**Archivos:** `backend/app/services/dependency_analyzer.py`, `backend/tests/test_dependency_cross_file_resolution.py`, `docs/modules/06-dependency-analyzer.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-07 - `analyze_dependencies` deja de forzar ubicación sintética

1. `analysis.py` ya no rellena `line=1` / `column=0` cuando el cliente omite ambos campos en `analyze_dependencies`.
2. `dependency_service.py` y `dependency_analyzer.py` propagan `Optional[int]` para que la resolución de raíz preserve la ausencia de posición y no sesgue el análisis al primer símbolo de la celda.
3. Se agrega regresión en `backend/tests/test_analysis_runtime_enrichment.py` para asegurar que el router entregue `None` al servicio cuando el caller no envía ubicación.

**Archivos:** `backend/app/routers/analysis.py`, `backend/app/services/dependency_service.py`, `backend/app/services/dependency_analyzer.py`, `backend/tests/test_analysis_runtime_enrichment.py`, `docs/modules/06-dependency-analyzer.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-02-23 - Endurecimiento de fiabilidad para `analyze_dependencies` / `analyze_impact`

1. Resolución de símbolo raíz ahora token-aware por `line/column`: prioriza token clickeado y evita sesgo por definición en la misma línea.
2. Estrategia de scope matching endurecida a QN estricto: contexto léxico primero, fallback sólo si existe candidato único, y reporte de ambigüedad cuando no es resoluble de forma segura.
3. `analyze_impact` elimina mezcla amplia por nombre no resuelto; traversal parte de raíz QN estricta para evitar contaminación entre homónimos.
4. Se agregan metadatos diagnósticos aditivos en `graph.meta`: `resolution_strategy`, `ambiguous_symbol_candidates`, `unresolved_symbol_count`.
5. Cobertura interprocedural ampliada: funciones acumulan dependencias de `return`, `yield`, `yield from`, defaults y anotaciones relevantes.
6. Reasignaciones cambian de overwrite a merge acumulativo (incluye ramas `if/else`), preservando cobertura alta de upstream.
7. Se añaden dependencias de control (`if.test`, `while.test`, guardas de `except`) como `relation=uses` para no romper contrato de tipos de relación.
8. Nuevas regresiones backend validan: token click RHS, impacto interprocedural (retornos/defaults), merge en ramas, homónimos por scope y control-flow en impacto.

**Archivos:** `backend/app/services/dependency_analyzer.py`, `backend/tests/test_dependency_impact_resolution.py`, `docs/modules/06-dependency-analyzer.md`

---

## 2026-02-23 - Preservación semántica de relaciones + enrichment runtime scope-aware

1. `DependencyVisitor` ahora registra hints de relación por dependencia y el grafo conserva `calls`, `imports`, `attribute_of`, `assigns`, `uses` según contexto AST.
2. `analyze_symbol` deja de forzar `uses` al crear aristas y aplica fallback semántico por prioridad cuando hay múltiples señales.
3. `analyze_impact` mantiene la relación al invertir dependencias (sin degradar a `uses`) y preserva prioridad al fusionar aristas duplicadas.
4. `DependencyGraph.add_edge` consolida relaciones repetidas por par `source->target` con prioridad semántica (más específica gana).
5. En `analysis.py`, el enrichment runtime prioriza `scope_path` exacto y usa `name` sólo como fallback no ambiguo; se evita contaminar nodos homónimos de scopes distintos.
6. Se añaden pruebas de regresión para inferencia de relación (assign/call/import/attribute), preservación en impacto y contaminación runtime por homónimos.

**Archivos:** `backend/app/services/dependency_analyzer.py`, `backend/app/routers/analysis.py`, `backend/tests/test_dependency_fixes.py`, `backend/tests/test_analysis_runtime_enrichment.py`, `docs/modules/06-dependency-analyzer.md`

---

## 2026-02-21 - Hardening R1 + contratos de optimización de diseño

1. Se corrige parentado de nodos `self.*` para enlazarlos al contenedor real (clase/scope válido) manteniendo `scope_path` legacy.
2. La clasificación IO del grafo pasa a ser mode-aware: en `impact` la raíz ya no se marca como output.
3. `analyze_impact` ahora reporta errores de sintaxis por celda en `warnings` y `parse_errors`.
4. Se habilita enriquecimiento runtime en `analyze_impact` (paridad con `analyze_dependencies`).
5. Se agrega metadata aditiva en payload (`analysis_mode`, `parse_errors`, `runtime_enriched`) y alias de tipo (`node_type`) sin romper compatibilidad.
6. Nuevos contratos WS de ingeniería/optimización en `analysis.py`: `optimize_design`, `analyze_load_envelope`, `run_code_checks`, `compare_scenarios`.

**Archivos:** `backend/app/services/dependency_analyzer.py`, `backend/app/routers/analysis.py`, `backend/app/services/engineering_optimization_service.py`, `backend/app/contracts/ws_models.py`, `backend/main.py`, `backend/tests/test_dependency_fixes.py`, `backend/tests/test_analysis_runtime_enrichment.py`, `backend/tests/test_engineering_optimization_service.py`

---

## 2026-02-21 - Scope-aware en `analyze_impact` por línea/columna

1. `analyze_impact` aplica raíz estricta cuando llega `line` para evitar mezclar dependientes de símbolos homónimos en otros scopes.
2. Se mantuvo modo amplio por compatibilidad cuando la request no envía ubicación explícita.
3. Se añadió regresión en `backend/tests/test_dependency_impact_resolution.py` para validar desambiguación (`b` global vs `Beam.self.b`).

**Archivos:** `backend/app/services/dependency_analyzer.py`, `backend/tests/test_dependency_impact_resolution.py`

---

## 2026-02-21 - Corrección Exhaustiva del Sistema de Dependencias (16 Fixes)

1. **AST Cache profunda:** Se corrigió la contaminación del caché AST aplicando `copy.deepcopy`.
2. **Impacto tipado:** `analyze_impact` ahora preserva los verdaderos tipos de nodos (funciones, imports) en lugar de hardcodear todo como variable.
3. **Resolución de scopes de clase:** El helper `_find_class_scope()` arregla 3 incidencias donde variables `self.x` caían en un indexing erróneo, rompiendo la jerarquía.
4. **Integración de Anotaciones:** El nodo ahora consume exitosamente data de `annotation_parser` (description, unit, range, etc).
5. **Módulos Externos:** `_is_external_module` ahora utiliza `importlib` dinámico en vez de una lista estática, con soporte para built-ins, frozen os y aliases.
6. **Seguridad & API:** Se documentaron vectores eval en `sensitivity_service.py` y se reemplazó la API deprecada de asincronía (`get_event_loop()`).
7. **Rendimiento:** Nodos y aristas ahora manejan lookups O(1) vía sets internos. Hashes MD5 extendidos a 16 chars para mitigar colisiones.
8. **TraceTable Topológico:** El frontend calcula khan top-sort en O(E+V) localmente para ordenar correctamente el log en UI.
9. **Location Tracking:** List comprehensions ya no devuelven ubicaciones vacías.

**Archivos:** `backend/app/services/dependency_analyzer.py`, `backend/app/routers/analysis.py`, `backend/app/services/sensitivity_service.py`, `frontend/src/components/DependencyGraph.js`

---

## 2026-02-21 - Análisis de Impacto Recursivo y Caché AST

1. **Impacto Recursivo:** Se refactorizó `analyze_impact` para recorrer dependencias inversas recursivamente (cascada extendida).
2. **Caché AST:** Se implementó `_ast_cache` indexado por hash MD5 del código fuente para eludir la repetición de parseos en celdas de notebook no editadas.
3. **Resolución Cross-Cell:** Se arregló la creación del `root_node` en el impacto inverso para recuperar correctamente metadatos de ubicación desde `all_symbols_metadata`.

**Archivos:** `backend/app/services/dependency_analyzer.py`

---

## 2026-02-21 - Corrección de Bugs AST y Router (LLM-First)

1. **Resolución de Scopes:** Corrección del AST visitor (`DependencyVisitor`) para unificar correctamente las variables de instancia de clase (`self.x`) bajo el namespace léxico de la clase padre en lugar de fragmentarlos por métodos individuales.
2. **Inclusión de Decoradores y Herencias:** Añadida compatibilidad al `AST` para leer listas de decoradores y bases de clases automáticamente.
3. **Limpieza en Runtime:** Eliminado el anti-patrón de monkey-patching en la clase `DependencyGraph`. El método de búsqueda es ahora estático a la clase.
4. **Mejora de Resolución Root:** Cambiado el logaritmo de validación de fallback de coincidencia cruda por strings a compensación por offset estructural (columnas/lines) durante clicks/selecciones complejas.
5. **Limpieza SYS Router:** Removida la inyección `sys.path` del Websocket Handler de `analysis.py`, restaurándola con un entorno puro de importaciones de backend Python.

**Archivos:** `backend/app/services/dependency_analyzer.py`, `backend/app/routers/analysis.py`

---

## 2026-02-06 - Normalización documental LLM-first

1. Se migró el módulo a formato canónico con contratos, sinergias y observabilidad.
2. Se agregó enlace de integración con `llm-index.yaml` y catálogo de contratos.
3. Se simplificó el acceso para agentes manteniendo el alcance técnico del analizador.

**Archivos:** `docs/modules/06-dependency-analyzer.md`, `docs/llm-index.yaml`
