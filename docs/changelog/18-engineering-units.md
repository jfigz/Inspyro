﻿# Changelog — 18 Engineering Units

> **Última actualización:** 2026-03-07

---

## 2026-03-07 — Compatibilidad dimensional canónica para fuerzas SI/imperiales

1. `normalization.py` deja de comparar compatibilidad con `str(quantity.dimensionality)`, porque Pint no garantiza un orden estable en esa representación.
2. Se introduce una firma dimensional canónica para agrupar y comparar unidades compatibles sin falsos negativos entre `N`, `kN`, `lbf`, `kgf` y `tonf`.
3. `/api/units/convert` ahora devuelve `dimension` desde la identidad normalizada de la unidad de salida, alineada con `/api/units/compatible`.
4. Se endurecen regresiones backend para validar que `/api/units/compatible` incluya `lbf` cuando el origen es una fuerza SI.

**Archivos:** `backend/librerias_propias/inspyro_units/normalization.py`, `backend/app/routers/units.py`, `backend/tests/test_units_normalization.py`, `backend/tests/test_units_convert_api.py`, `docs/modules/18-engineering-units.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-02-21 — Mejoras de rendimiento en Regex y limpieza UX de DimensionalityError

1. Modificación de `maskStringLiterals` en `unitTokens.js` para usar Regex en lugar de iteración por caracteres, evitando lags durante la validación continua de tokens en Mónaco.
2. Refactorización de patrones de detección (`tokenPattern` y `pattern`) para encontrar unidades sin necesidad de estar precedidas por operadores explícitos (`*`, `/`), y soporte a salidas literales compactas (ej. `14.5kN`).
3. Intercepción limpia en el entorno Jupyter (`jupyter_kernel.py`) para `DimensionalityError`, traduciéndolo al usuario final como "Error Físico" y removiendo stacktraces complejos de la librería Pint.

**Archivos:** `frontend/src/components/notebook/unitTokens.js`, `backend/app/services/jupyter_kernel.py`, `docs/modules/18-engineering-units.md`


## 2026-02-19 — Hardening runtime de `variables_summary` (kernel + filtrado de autoimport)

1. `jupyter_kernel.py` endurece `_extract_ue_text()` para decodificar literales quoted de `user_expressions` con `ast.literal_eval`, incluyendo fallback defensivo para escapes problemáticos.
2. `_capture_variables_summary` ahora usa parseo JSON robusto con fallback y logging `debug` mínimo cuando el payload llega con encoding irregular.
3. Se reforzó `_insp_is_user_var` para excluir internals de IPython (`_ih`, `_i*`, `In`, `Out`, etc.), helpers `_insp_*` y símbolos autoimportados de unidades por coincidencia de `id`.
4. `notebook_service.py` persiste `__INSP_UNITS_IMPORTED_IDS` en el preámbulo para filtrar de forma estable constantes inyectadas (`kN`, `MPa`, `__serialize_quantity`) sin bloquear overrides del usuario.
5. Se agregaron/ajustaron pruebas en `backend/tests/test_units_kernel.py` y `backend/tests/test_units_kernel_integration.py` para cubrir regresión de parseo y ausencia de contaminación en `variables_summary`.
6. Se añadió cobertura de integración para validar que un override explícito del usuario (`kN = 1*kg`) se conserva en `variables_summary` aunque el nombre colisione con símbolos autoimportados.
7. Se endureció el filtro para excluir ruido de runtime IPython/kernel (`_i`, `_ip`, `_np_to_native`, `exit`, `quit`, `__INSP_*`), dejando `variables_summary` con variables de usuario reales.

**Archivos:** `backend/app/services/jupyter_kernel.py`, `backend/app/services/notebook_service.py`, `backend/tests/test_units_kernel.py`, `backend/tests/test_units_kernel_integration.py`, `docs/modules/18-engineering-units.md`

## 2026-02-19 — Hardening no evidente: tokenización robusta + estabilización de `converted_uncertainty`

1. `unitTokens.js` agrega helper interno `maskStringLiterals()` que enmascara strings preservando columnas.
2. `findUnitTokens()` procesa cada línea en orden robusto: primero enmascara strings y después recorta comentarios (`#`) sobre la versión enmascarada, corrigiendo el falso negativo `a = "#"; F = 14.5*kN`.
3. Se mantiene el comportamiento esperado: no detectar unidades dentro de strings y omitir contenido posterior a comentarios reales.
4. `units.py` agrega normalización recursiva por cifras significativas para `converted_uncertainty` (escalar/vector/matriz).
5. Política aplicada: usa `options.significant_figures` cuando llega en request; si no, usa default interno de estabilidad (`12` cifras significativas).
6. La normalización se aplica solo a `converted_uncertainty`; `converted_magnitude` y el shape del payload permanecen intactos.
7. Se añaden pruebas backend para incertidumbre escalar (offset `degC -> K`), vector/matriz y respeto de `significant_figures`, además de pruebas frontend para tokenización con strings + `#`.

**Archivos:** `frontend/src/components/notebook/unitTokens.js`, `frontend/src/components/notebook/unitTokens.test.js`, `backend/app/routers/units.py`, `backend/tests/test_units_convert_api.py`, `docs/modules/18-engineering-units.md`

## 2026-02-19 — Hardening de render SVG y cleanup de regex de unidades

1. `OutputRenderer` sanitiza payloads `image/svg+xml` con perfil SVG de `DOMPurify` antes de renderizar, cerrando vector de XSS en outputs embebidos.
2. Se limpiaron regex de `UnitTooltip`/`unitTokens` eliminando escapes innecesarios para mantener lint limpio sin alterar el parsing de unidades.

**Archivos:** `frontend/src/components/OutputRenderer.js`, `frontend/src/components/notebook/UnitTooltip.js`, `frontend/src/components/notebook/unitTokens.js`, `docs/modules/18-engineering-units.md`

## 2026-02-13 — Hardening físico del pie de tooltip (Dimensión + Fundamentales) — ✅ Completada

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `frontend/src/components/notebook/UnitTooltip.js` | Parseo robusto de notación dimensional (`^`, superíndices Unicode, middle-dot) y render estandarizado de `Dimensión` + `Fundamentales` |
| `frontend/src/components/notebook/UnitTooltip.js` | Inferencia local de dimensión para unidades compuestas cuando `metadata.dimension` llega vacío o no hay hidratación remota disponible |
| `frontend/src/components/notebook/UnitBadge.js` | Merge defensivo de metadata local/remota para evitar tooltips incompletos en payloads parciales |
| `frontend/src/components/notebook/UnitBadge.test.js` | Nuevas pruebas para consistencia física en `kN`, `MPa`, `kg/m` y fallback con fallo de `/api/units/compatible` |

### Resultado funcional

- La franja inferior del tooltip es físicamente consistente para unidades simples y compuestas:
  - `kN` → `M · L · T⁻²`
  - `MPa` → `M · L⁻¹ · T⁻²`
  - `kg/m` → `M · L⁻¹`
- La UI mantiene estilo propio, pero la semántica proviene de metadata/Pint y no de hardcode por variable.
- Cuando la metadata remota no llega, el tooltip sigue mostrando dimensión/fundamentales mediante inferencia local segura.

## 2026-02-13 — Corrección física de tooltips en unidades compuestas (UI) — ✅ Completada

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `frontend/src/components/notebook/unitTokens.js` | Se elimina fallback incorrecto de dimensión por primer factor; para unidades compuestas se resuelve metadata física vía backend (`POST /api/units/compatible`) con caché |
| `frontend/src/components/notebook/UnitBadge.js` | Hidratación asíncrona de metadata compuesta (dimension/categoría/descripcion) antes de tooltip, preservando fallback local |
| `frontend/src/components/notebook/UnitBadge.test.js` | Prueba nueva para `kg/m³` verificando dimensión real (`[mass] / [length] ** 3`) proveniente del backend |

### Resultado funcional

- Tooltips de `kg/m³`, `m/s²`, `kg/m`, etc. dejan de mostrar dimensiones parciales (`[mass]`, `[length]`) y pasan a mostrar dimensión física completa calculada por Pint.
- La UI mantiene estilo propio, pero la semántica de unidades se deriva del wrapper de Pint (sin hardcode por variable).

## 2026-02-13 — Plan Maestro: hardening canónico + ciencia avanzada (mecánica estructural) — ✅ Completada

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `backend/librerias_propias/inspyro_units/normalization.py` | Canonicalización/normalización bidireccional de unidades, catálogo canónico y compatibilidad dimensional |
| `backend/librerias_propias/inspyro_units/engineering.py` | Helpers científicos: aserciones dimensionales y soporte de incertidumbre de primer orden |
| `backend/tests/test_units_normalization.py` | Pruebas de aliases conflictivos, catálogo dimensional y helpers de ciencia avanzada |

### Archivos modificados (selección)

| Archivo | Cambio |
|---------|--------|
| `backend/app/routers/units.py` | `POST /api/units/convert` extendido (escalar/vector/matriz + `options` + `dimension` + `canonical`) y nuevos endpoints `GET /api/units/catalog` + `POST /api/units/compatible` |
| `backend/librerias_propias/inspyro_units/serialization.py` | Campos WS aditivos: `unit_canonical`, `unit_display`, `unit_pint`, `aliases` con compatibilidad legacy |
| `backend/librerias_propias/inspyro_units/metadata.py` | Metadata unificada desde catálogo canónico con índices por símbolo/alias y fallback para unidades compuestas |
| `backend/app/services/notebook_service.py` | Guard de preámbulo robusto con sentinel `__INSP_UNITS_READY__` e inyección de namespace seguro `u` |
| `backend/app/services/jupyter_kernel.py` | Captura de variables con timeout configurable, retry único y fallback al último snapshot válido |
| `backend/librerias_propias/docx_builder/builder.py` | Validación previa de token de unidad antes de aplicar parseo tipográfico agresivo |
| `backend/app/services/runtime_metrics.py` | Nuevas métricas: `unit_normalization_failures`, `unit_conversion_failures_by_code`, `quantity_serialization_fallbacks` |
| `frontend/src/components/notebook/unitTokens.js` | Catálogo dinámico con fallback local, normalización de aliases y compatibilidad por dimensión |
| `frontend/src/components/notebook/QuantityVariablesPanel.js` | Conversión guiada por `/api/units/compatible` y consumo de catálogo backend con fallback |
| `frontend/src/components/notebook/deriveEngineeringVars.js` | Preservación de campos canónicos de unidad en pipeline frontend |
| `backend/stubs/inspyro_units.pyi` | APIs nuevas para normalización/catálogo/incertidumbre expuestas a LSP |

### Validación

- `.\venv_inspyro\Scripts\python.exe -m pytest backend/tests/test_inspyro_units.py backend/tests/test_units_kernel_integration.py backend/tests/test_units_lsp_stubs.py backend/tests/test_units_serialization.py backend/tests/test_units_convert_api.py backend/tests/test_units_docx_rendering.py backend/tests/test_units_normalization.py -q`
- `npm test -- --watchAll=false --runInBand --testPathPattern="notebook/(UnitBadge|QuantityVariablesPanel)\.test\.js"`

## 2026-02-13 — Hotfix UX: tooltips de unidades flotantes sin clipping — ✅ Completada

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `frontend/src/components/notebook/UnitBadge.js` | Cálculo de anclaje (`getBoundingClientRect`) y actualización de posición en `scroll/resize` durante hover |
| `frontend/src/components/notebook/UnitTooltip.js` | Render vía `createPortal` en `document.body` con `position: fixed`, clamp horizontal y flip vertical |
| `frontend/src/components/notebook/UnitBadge.css` | Tooltip migrado a overlay flotante (`position: fixed`, `z-index` alto) para evitar recorte por `overflow` de contenedores |

### Validación

- `npm test -- --watchAll=false --runInBand --testPathPattern="UnitBadge\.test\.js"`
- `npm run build`

## 2026-02-13 — Fase 8: Testing integral + documentación transversal — ✅ Completada

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `backend/tests/test_units_serialization.py` | Tests dedicados de serialización `Quantity` |
| `backend/tests/test_units_kernel.py` | Flujo kernel adicional con caso `integration` |
| `frontend/src/components/notebook/UnitBadge.test.js` | Test de render y tooltip |
| `frontend/src/components/notebook/QuantityVariablesPanel.test.js` | Test de conversión rápida con `fetch` mock |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `docs/modules/18-engineering-units.md` | Estado final en ✅ y cierre de fases 6–8 |
| `docs/architecture/feature-threads.md` | Flujo E2E de unidades + conversión REST |
| `docs/architecture/synergy-matrix.md` | Sinergia explícita del módulo 18 |
| `docs/architecture/contracts-catalog.md` | Alta de `POST /api/units/convert` |
| `docs/llm-index.yaml` | REST nuevo + flujo `engineering_units_runtime_conversion` |
| `docs/modules/main.md` | Registro del módulo 18 en índice principal |

### Validación

- `.\venv_inspyro\Scripts\python.exe -m pytest backend/tests/test_inspyro_units.py backend/tests/test_units_kernel_integration.py backend/tests/test_units_lsp_stubs.py backend/tests/test_units_serialization.py backend/tests/test_units_convert_api.py backend/tests/test_units_docx_rendering.py -q`
- `.\venv_inspyro\Scripts\python.exe -m pytest backend/tests/test_units_kernel_integration.py backend/tests/test_units_kernel.py -m integration -q`
- `npm test -- --watchAll=false --runInBand --testPathPattern="notebook/(UnitBadge|QuantityVariablesPanel)\.test\.js"`
- `npm run build`

## 2026-02-13 — Fase 7: Panel de Variables + conversión REST + grafo runtime — ✅ Completada

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `frontend/src/components/notebook/QuantityVariablesPanel.js` | Vista de variables `Quantity` con icono/categoría/dimensión + conversión rápida |
| `frontend/src/components/notebook/QuantityVariablesPanel.css` | Estilos para tarjetas y feedback por fila |
| `backend/app/routers/units.py` | Endpoint REST `POST /api/units/convert` con conversión Pint y errores tipados |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `backend/main.py` | Inclusión del router de unidades (`/api/units`) |
| `backend/app/routers/analysis.py` | Enriquecimiento de nodos con `unit/category/description` desde runtime `Quantity` |
| `frontend/src/components/VisualizationPanel.js` | Nueva pestaña `Variables` + iconografía en modo expandido/colapsado |
| `frontend/src/App.js` | Paso de `variables` hacia `VisualizationPanel` |
| `frontend/src/components/dependency-graph/utils.js` | `Quantity` runtime sin truncar `repr` |
| `frontend/src/components/dependency-graph/Panels.js` | Prioridad a unidad/metadata runtime |
| `frontend/src/components/dependency-graph/D3DependencyGraph.js` | Prioridad a unidad y descripción runtime en nodos |
| `frontend/src/components/Icons.js` | Nuevo `IconVariables` |
| `frontend/src/App.css` | Estilo de contenedor `variables-view-container` |

### Validación

- `.\venv_inspyro\Scripts\python.exe -m pytest backend/tests/test_units_convert_api.py -q`
- `npm test -- --watchAll=false --runInBand --testPathPattern="QuantityVariablesPanel\.test\.js"`
- `npm run build`

## 2026-02-13 — Fase 6: Integración DOCX de unidades — ✅ Completada

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `backend/librerias_propias/inspyro_units/formatting.py` | Parsing robusto de exponentes y helper público `build_docx_unit_runs()` |
| `backend/librerias_propias/docx_builder/builder.py` | Render agresivo de `número + unidad` con runs tipográficos (thin-space, italic, superscript) y fallback seguro |

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `backend/tests/test_units_docx_rendering.py` | Pruebas de runs/XML y fallback para `m/s²`, `kg/m³`, `kN`, `MPa` |

### Validación

- `.\venv_inspyro\Scripts\python.exe -m pytest backend/tests/test_units_docx_rendering.py -q`

## 2026-02-12 — Fase 5: Decoración Monaco de unidades (Frontend) — ✅ Completada

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `frontend/src/components/notebook/unitTokens.js` | Catálogo de tokens de unidades + helpers (`findUnitTokens`, metadata/description, split de cantidades en texto) |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `frontend/src/components/MonacoEditorLSP.js` | Decoraciones dinámicas para tokens de unidad en Monaco con hover contextual; limpieza de decoraciones al desmontar |
| `frontend/src/components/NotebookEditor.css` | Estilo `.monaco-unit-token` (cursiva + azul claro) |

### Validación

- `npm run build` (frontend) compiló correctamente.

### Notas técnicas

- La detección prioriza patrones de ingeniería en código (`*`/`/` y `Q_(..., unidad)`), evitando decorar identificadores arbitrarios.
- El hover de Monaco reutiliza metadata textual para mantener coherencia visual con el tooltip de outputs.

## 2026-02-12 — Fase 4: UnitBadge + renderizado de unidades en output (Frontend) — ✅ Completada

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `frontend/src/components/notebook/UnitBadge.js` | Componente para renderizar magnitud+unidad con estilo visual |
| `frontend/src/components/notebook/UnitBadge.css` | Estilos de badge/tooltip para unidades |
| `frontend/src/components/notebook/UnitTooltip.js` | Tooltip compacto con metadata de unidad |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `frontend/src/components/OutputRenderer.js` | Detección/render de cantidades en `stream` y `text/plain` con `UnitBadge` |
| `frontend/src/components/notebook/deriveEngineeringVars.js` | Normalización de variables `Quantity` provenientes de `variables_summary` |
| `frontend/src/components/NotebookEditor.js` | Integración del `variables_summary` base en la derivación para no perder metadata de `Quantity` |

### Validación

- `npm run build` (frontend) compiló correctamente.

### Notas técnicas

- Se mantiene fallback de texto plano cuando no hay patrón de unidad reconocido.
- Las variables `Quantity` ahora quedan marcadas como `is_engineering_data` para consumo uniforme en paneles/derivaciones.

## 2026-02-11 — Fase 3: Stubs LSP para autocompletado (Backend) — ✅ Completada

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `backend/stubs/inspyro_units.pyi` | Stub tipado de `inspyro_units` con constantes de unidades, `Q_`, serialización y formateadores para hover/autocompletado en Monaco/pylsp |
| `backend/tests/test_units_lsp_stubs.py` | Tests de validación de sintaxis del stub y normalización de rutas de stubs en `LSPBridge` |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `backend/app/services/lsp_bridge.py` | Nueva utilidad `build_extra_paths()` para incluir `backend/stubs` siempre, normalizar rutas relativas y deduplicar `extra_paths` |

### Validación

- `backend/tests/test_units_lsp_stubs.py` → 3 tests pasando.
- `backend/tests/test_inspyro_units.py backend/tests/test_units_kernel_integration.py` → regresión de Fases 1 y 2 sin fallas.

### Notas técnicas

- El stub expone todas las constantes públicas de ingeniería (`kN`, `MPa`, `kg`, etc.) y helpers (`Q_`, `serialize_quantity`, formateadores).
- La normalización de rutas en `LSPBridge` evita dependencia del directorio de trabajo del proceso `pylsp`.

## 2026-02-11 — Fase 2: Integración con kernel Jupyter (Backend) — ✅ Completada

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `backend/tests/test_units_kernel_integration.py` | Tests para preámbulo de unidades e integración kernel (`Quantity` serializada + filtro de constantes autoimportadas) |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `backend/app/services/notebook_service.py` | Preámbulo de unidades inyectado antes de DOCX; captura de variables activada en ejecución de celda |
| `backend/app/services/jupyter_kernel.py` | Serialización de `pint.Quantity` en `_capture_variables_summary` con fallback y filtro de constantes de unidad autoimportadas |

### Validación

- `backend/tests/test_inspyro_units.py` → 36 tests pasando.
- `backend/tests/test_units_kernel_integration.py` → tests unitarios del preámbulo pasando.
- Test de integración marcado `integration` para serialización real en kernel (`pytest -m integration`).

### Notas técnicas

- El preámbulo de unidades registra `__INSP_UNITS_IMPORTED_IDS` para diferenciar constantes de unidad vs variables reales del usuario.
- El serializador de variables usa `__serialize_quantity` si está disponible en `globals()`; si no, cae al import directo de `inspyro_units.serialization`.
- Se mantiene fallback para kernels sin paquete disponible, devolviendo payload mínimo de `Quantity` cuando aplica.

## 2026-02-11 — Fase 1: Librería `inspyro_units` (Backend) — ✅ Completada

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `backend/librerias_propias/inspyro_units/__init__.py` | API pública: re-exporta constantes, Q_, serialización, formateo, metadata, compat |
| `backend/librerias_propias/inspyro_units/registry.py` | Singleton `UnitRegistry` de Pint con formato `~P` por defecto |
| `backend/librerias_propias/inspyro_units/constants.py` | ~50 constantes de unidades de ingeniería (longitud, masa, fuerza, presión, etc.) |
| `backend/librerias_propias/inspyro_units/metadata.py` | Catálogo `UNIT_METADATA` con symbol, category, dimension, description por unidad |
| `backend/librerias_propias/inspyro_units/serialization.py` | `serialize_quantity()` → dict JSON para transporte WS |
| `backend/librerias_propias/inspyro_units/formatting.py` | Formateadores LaTeX, Unicode, HTML, DOCX con superíndices |
| `backend/librerias_propias/inspyro_units/compat.py` | Helpers de compatibilidad NumPy/Pandas |
| `backend/tests/test_inspyro_units.py` | 36 tests unitarios: aritmética, conversiones, errores, serialización, metadata, formateo, temperaturas, compat |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `backend/requirements.txt` | Agregado `pint>=0.23` |

### Notas técnicas

- Pint 0.25.2 instalado; versión mínima requerida: 0.23
- Registry usa `formatter.default_format` (API nueva de Pint ≥ 0.24) con fallback a `default_format` para compatibilidad
- Todas las unidades compuestas (velocidad, densidad, inercia) se forman naturalmente con operadores aritméticos
- Temperaturas con offset (°C, °F) requieren `Q_(valor, degC)` en lugar de `valor*degC`
