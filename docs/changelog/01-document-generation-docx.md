# Changelog 01 - document-generation-docx

> **Última actualización:** 2026-05-02

---

## 2026-05-02 - Fences LaTeX robustos para OMML

1. `latex_math.py` corrige el emparejamiento de cierres en `\left...\right` para respetar paréntesis anidados dentro de funciones como `\min(...)` y agrupaciones internas.
2. La promoción MathML a `mfenced` envuelve el contenido como un único `mrow`, de modo que el XSL produce un solo operando `m:e` en OMML y Word no introduce separadores visuales espurios.
3. Se agregan regresiones para fórmulas de corte y flexión pretensada, paréntesis anidados, matrices, `cases`, delimitadores angulares y n-arios dentro de fences.

**Archivos:** `backend/librerias_propias/docx_builder/latex_math.py`, `backend/tests/test_docx_math_latex.py`, `docs/modules/01-document-generation-docx.md`, `docs/changelog/01-document-generation-docx.md`, `LLM_GUIDE_DOCX.md`, `docs/llm-index.yaml`

---

## 2026-04-28 - Celdas DOCX nativas en notebooks

1. Se formaliza `cell_type="docx"` como tipo Inspyro para celdas que producen informe, separándolo del tipo Jupyter `code` sin cambiar la API pública del builder DOCX.
2. La ejecución documental conserva `emit_docx` como modo de corrida/export y no como sinónimo exclusivo de celda DOCX, manteniendo compatibilidad con notebooks legacy que todavía usan celdas `code` con `build_doc`, `doc_finalize` o helpers DOCX detectables.
3. Apagar DOCX/PDF o ejecutar por MCP con `include_docx=false` omite celdas DOCX sin limpiar `mdoc` ni invalidar el último DOCX/PDF visible, permitiendo iteraciones de cálculo sin regenerar informes.

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/mcp_server/tools/notebook.py`, `frontend/src/components/NotebookEditor.js`, `frontend/src/components/notebook/NotebookCell.js`, `docs/modules/01-document-generation-docx.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-25 - Workbench DOCX nativo, núcleo `docx_core` y cache visual

1. Se agrega `backend/app/services/docx_core/` como núcleo compartido OOXML para ZIP/XML, namespaces, story parts, relaciones, content types, texto visible, findings normalizados y mutaciones transaccionales.
2. `docx_quality` evoluciona a Workbench con auditoría v2 por perfiles, operaciones de render, limpieza/preparación de entrega, comentarios, redlines, fields, SDTs, redacción, protección y diff.
3. `docx_artifacts.py` persiste resultados Workbench con summaries/resources/variantes sin mutar el artefacto original; `backend/app/routers/docx.py` agrega `/api/docx/workbench/run`, `/result`, `/resource` y `/api/docx/diff`.
4. `docx_builder` suma helpers de entrega (`alt_text`, header row repetible, anchos/padding/alineación) y `doc_finalize(profile="delivery")` para revisión local compacta.
5. El MCP y la UI consumen Workbench de forma compacta/link-first, manteniendo render visual y auditorías pesadas bajo demanda.
6. Se agrega `docx_render_cache.py` como cache persistente de derivados visuales: PDF canónico por `binary_hash + renderer_signature + profile`, PNGs por página/zoom con PyMuPDF, manifests con timings/hashes y endpoint `/api/docx/render/resource`.
7. Los resources Workbench/render quedan endurecidos contra traversal: `workbench_id`/`render_id` y nombres se validan como segmentos seguros y el path final debe permanecer bajo el store/cache controlado.
8. La auditoría de hyperlinks vuelve a cubrir texto genérico acentuado como `aquí`, con regresión dedicada.

**Archivos:** `backend/app/services/docx_core/*`, `backend/app/services/docx_quality/*`, `backend/app/services/docx_render_cache.py`, `backend/app/services/docx_artifacts.py`, `backend/app/routers/docx.py`, `backend/librerias_propias/docx_builder/builder.py`, `backend/librerias_propias/docx_builder/api.py`, `backend/tests/test_docx_quality.py`, `docs/modules/01-document-generation-docx.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-04-24 - Calidad DOCX nativa y UI accionable

1. Se agrega `backend/app/services/docx_quality/` con utilidades OOXML, auditoría, render DOCX→PDF→PNG vía PyMuPDF, limpieza de publicación, SDTs/content controls y diff textual/visual base.
2. `backend/app/routers/docx.py` expone `GET /api/docx/quality`, `POST /api/docx/quality/run`, `GET /api/docx/quality/render` y `POST /api/docx/quality/clean`; `docx_artifacts.py` persiste `quality_summary.json` junto al artefacto y enriquece `/api/docx/history`.
3. `DocxViewer`, `AgentWorkspaceHome` y `TemplateEditorContainer` incorporan badges, rail de calidad, acciones de auditoría/render/limpieza y panel `Campos` para SDTs/placeholders no envueltos.
4. La entrega no introduce dependencia runtime al plugin `Documents` ni usa `artifact-tool`: Inspyro absorbe las ideas útiles como código propio y mantiene auditoría pesada bajo demanda.

**Archivos:** `backend/app/services/docx_quality/*`, `backend/app/services/docx_artifacts.py`, `backend/app/routers/docx.py`, `backend/app/services/template_service.py`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/DocxViewer.css`, `frontend/src/components/AgentWorkspaceHome.js`, `frontend/src/components/AgentWorkspaceHome.css`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/TemplateEditor.css`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/components/Icons.js`, `frontend/src/utils/docxArtifacts.js`, `backend/tests/test_docx_quality.py`, `frontend/src/components/DocxViewer.test.js`, `frontend/src/components/AgentWorkspaceHome.test.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/components/VisualizationPanel.test.js`, `docs/modules/01-document-generation-docx.md`, `docs/modules/14-main-app.md`, `docs/modules/17-template-editor.md`, `docs/architecture/frontend-flow.md`, `docs/llm-index.yaml`, `docs/agents/quickstart.md`, `docs/agents/task-routing.yaml`, `docs/changelog/01-document-generation-docx.md`

---

## 2026-04-19 - Cola async del convertidor PDF para aislar notebooks paralelos

1. `pdf_converter.py` agrega `build_pdf_context_async()` con executors dedicados y una puerta async explícita para el camino Word-capable, evitando que varios notebooks queden bloqueando workers del pool compartido mientras esperan turno del convertidor.
2. El diagnóstico documental incorpora `pdf_queue_wait_ms` y el flujo notebook puede publicar espera visible del convertidor (`Esperando turno del convertidor PDF...`) sin romper contratos WS/REST.
3. Se añaden regresiones backend para proteger la serialización Word-capable, el paralelismo cuando Word no participa y la propagación del estado de espera al pipeline notebook-first.

**Archivos:** `backend/app/services/pdf_converter.py`, `backend/app/services/notebook_service.py`, `backend/app/routers/notebook_execution.py`, `backend/tests/test_pdf_converter_hardening.py`, `backend/tests/test_notebook_document_contracts.py`, `backend/tests/test_notebook_pdf_large_docs.py`, `backend/tests/test_force_reconvert_pdf_regression.py`, `docs/modules/01-document-generation-docx.md`, `docs/modules/04-notebook-handlers.md`, `docs/changelog/01-document-generation-docx.md`, `docs/changelog/04-notebook-handlers.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`

---

## 2026-04-19 - Slots semánticos Word-first para runtime DOCX

1. `template_extract.py`, `template_service.py` y `DocxSession` incorporan `semantic_style_slots` como contrato persistido del template, validado contra `style_browser` y reinyectado al kernel junto con `table_style_runtime_defaults` y `builder_required_style_defaults`.
2. `DocBuilder` cambia sus defaults para consumir slots semánticos (`body`, `heading_1..6`, `list_bullet`, `list_number`, `caption`, `code`, `table_default`) y deja `Normal` como fallback técnico, no como convención pública de autoría.
3. `DocBuilder.resolve_style_slot(slot_name)` agrega una salida mínima para `builder.document`, permitiendo resolver el estilo Word activo sin hardcodear nombres de estilo en notebooks avanzados.
4. `table()` y `dataframe()` pasan a `style=None` por default, de modo que la tabla Word efectiva la decida el template cargado.

**Archivos:** `backend/app/services/template_extract.py`, `backend/app/services/template_service.py`, `backend/app/services/template_logic.py`, `backend/app/routers/notebook_common.py`, `backend/librerias_propias/docx_builder/session.py`, `backend/librerias_propias/docx_builder/builder.py`, `backend/librerias_propias/docx_builder/api.py`, `docs/modules/01-document-generation-docx.md`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-04-18 - Handoff file-backed, dedupe workspace y telemetría enriquecida

1. `backend/app/services/notebook_service.py` cierra el handoff documental notebook-first con un archivo temporal por ejecución para el tramo pesado de DOCX/procedencia, manteniendo `stdout/base64` solo como fallback defensivo mientras se estabiliza la transición.
2. `backend/app/services/docx_artifacts.py` deja una única persistencia visible por ejecución/materialización en `Docx_Documents/`, deduplicando por `execution_id + binary_hash` y exponiendo `workspace_path`, `workspace_relpath` y `workspace_warning` para el shell/UI.
3. `backend/app/services/pdf_converter.py` y el pipeline documental publican timings adicionales (`kernel_export_ms`, `transport_read_ms`, `transport_cleanup_ms`, `workspace_write_ms`, `index_write_ms`, `cache_lookup_ms`, bytes transferidos) para investigar notebooks con DOCX poco complejos pero lentos.
4. `backend/app/routers/docx.py` propaga esos metadatos workspace-backed a `/api/docx/history`, de modo que el frontend ya no dependa de una descarga temporal para abrir el DOCX final del proyecto.
5. Se agregan regresiones para el handoff file-backed, latest-wins documental y persistencia deduplicada sin reintroducir rutas temporales como flujo principal del usuario.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/app/services/docx_artifacts.py`, `backend/app/services/pdf_converter.py`, `backend/app/routers/docx.py`, `backend/app/routers/notebook_execution.py`, `backend/tests/test_docx_artifacts.py`, `backend/tests/test_notebook_document_mutations.py`, `backend/tests/test_notebook_docx_file_handoff.py`, `backend/tests/test_pdf_converter_hardening.py`, `backend/tests/test_force_reconvert_pdf_regression.py`, `docs/modules/01-document-generation-docx.md`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-17 - Toda salida Word-visible queda libre de procedencia automática

1. `backend/app/services/docx_sanitizer.py` pasa a sanear el paquete OOXML completo de entrega y elimina tanto hyperlinks automáticos `/api/docx/provenance/open?...` como field codes `HYPERLINK` equivalentes, preservando links normales del usuario o de la plantilla.
2. `backend/librerias_propias/docx_builder/session.py` separa export raw (`serialize_docx_bytes()` / `export_docx_base64()`) de export delivery (`serialize_docx_bytes_for_delivery()` / `export_docx_base64_for_delivery()`), y `doc_export(format='docx'|'bytes'|'path')` publica siempre la variante saneada.
3. `notebook_service.py` mantiene el artifact interno link-first para PDF/reconversión, pero usa la copia saneada para `docx_file_b64`, token legacy y `docx_size_bytes` visibles, mientras el recovery/export interno notebook usa explícitamente la variante raw.
4. `backend/app/routers/docx.py` sirve descargas saneadas por `artifact_id`, `token`, lookup estable y fallback runtime por `kernel_id`, sin mutar el artifact persistido.
5. `tools/repair_docx_provenance.py` agrega una utilidad para reparar DOCX ya descargados mediante el mismo sanitizer productivo.
6. Se agregan regresiones para el sanitizer puro, `doc_export(...)`, la entrega visible saneada, la utilidad de reparación y `force_reconvert_pdf`, fijando que la reconversión siga consumiendo el DOCX original con procedencia.

**Archivos:** `backend/app/services/docx_sanitizer.py`, `backend/librerias_propias/docx_builder/session.py`, `backend/librerias_propias/docx_builder/api.py`, `backend/app/services/notebook_service.py`, `backend/app/routers/docx.py`, `tools/repair_docx_provenance.py`, `backend/tests/test_docx_sanitizer.py`, `backend/tests/test_docx_artifacts.py`, `backend/tests/test_docx_export_delivery.py`, `backend/tests/test_repair_docx_provenance.py`, `docs/modules/01-document-generation-docx.md`, `docs/modules/04-notebook-handlers.md`, `docs/changelog/01-document-generation-docx.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-04-15 - El conversor PDF base sube su default a 600s

1. `backend/app/services/pdf_converter.py` sube `INSPYRO_PDF_TIMEOUT` de `25s` a `600s`, evitando que conversiones DOCX/PDF fuera del flujo notebook puro sigan cortando demasiado pronto.
2. La documentación del módulo y `AGENTS.md` quedan alineadas con ese nuevo default, manteniendo separado el timeout específico notebook (`INSPYRO_NOTEBOOK_PDF_TIMEOUT=600`).

**Archivos:** `backend/app/services/pdf_converter.py`, `docs/modules/01-document-generation-docx.md`, `docs/changelog/01-document-generation-docx.md`, `AGENTS.md`

---

## 2026-04-15 - Hotfix de proxy DOCX y gate documental final-only para notebook grande

1. `backend/librerias_propias/docx_builder/proxies.py` reemplaza la selección `or` sobre nodos OOXML por fallback explícito `is not None`, eliminando el `FutureWarning` repetitivo de `lxml/python-docx` en `FontProxy` y `ParagraphFormatProxy` sin cambiar el target efectivo del tracking.
2. `backend/tests/test_docx_builder_tracking.py` agrega regresiones específicas para mutaciones `run.font.*` y `paragraph.paragraph_format.*`, fijando tanto la ruta primaria (`_element`) como el fallback (`_rPr` / `_pPr`) y la ausencia del warning.
3. El notebook externo `G135_Analisis_Estructural.ipynb` deja `GENERAR_DOCX` como única fuente de verdad, evita regenerar DOCX en la celda de validación cuando está en modo iteración y pasa a inicializar estilos DOCX una sola vez por documento.

**Archivos:** `backend/librerias_propias/docx_builder/proxies.py`, `backend/tests/test_docx_builder_tracking.py`, `docs/modules/01-document-generation-docx.md`, `docs/changelog/01-document-generation-docx.md`, `C:\Proyectos\G135\Calculos trinchera cerrada 2\Calculos trinchera cerrada 2\G135_Analisis_Estructural.ipynb`

---

## 2026-04-14 - Reconversión PDF usa solo el último DOCX no vacío

1. `backend/app/services/docx_artifacts.py` endurece la clasificación de DOCX vacío para que párrafos vacíos o solo con whitespace no cuenten como contenido visible, manteniendo válidos los documentos con contenido real en header/footer.
2. `backend/app/routers/notebook_execution.py` hace que `force_reconvert_pdf` restaure únicamente el último artefacto DOCX no vacío; si solo existen artefactos vacíos, responde `no_docx` y evita generar un PDF en blanco.
3. `backend/tests/test_docx_empty_handling.py` amplía cobertura sobre DOCX vacíos/whitespace y `backend/tests/test_force_reconvert_pdf_regression.py` fija las regresiones de reconversión latest non-empty.

**Archivos:** `backend/app/services/docx_artifacts.py`, `backend/app/routers/notebook_execution.py`, `backend/tests/test_docx_empty_handling.py`, `backend/tests/test_force_reconvert_pdf_regression.py`, `docs/modules/01-document-generation-docx.md`, `docs/changelog/01-document-generation-docx.md`

---

## 2026-04-08 - Descarga DOCX e historial quedan explícitamente no-cacheables

1. `backend/app/routers/docx.py` agrega headers anti-cache (`Cache-Control: no-store, no-cache, must-revalidate, max-age=0`, `Pragma: no-cache`, `Expires: 0`) a `GET /api/docx/download` y `GET /api/docx/history`.
2. La descarga runtime fallback por `kernel_id` y las descargas persistidas por `artifact_id`/`source_path`/`token` comparten ahora la misma política de frescura HTTP.
3. Se agregan regresiones backend para asegurar que tanto la descarga DOCX como el historial expongan esos headers y no vuelvan a quedar sujetos al cache del navegador o del shell Electron.

**Archivos:** `backend/app/routers/docx.py`, `backend/tests/test_docx_artifacts.py`, `backend/tests/test_docx_empty_handling.py`, `docs/modules/01-document-generation-docx.md`, `docs/changelog/01-document-generation-docx.md`

---

## 2026-03-29 - Ruta `math_latex()` con LaTeX matemático y compatibilidad legacy intacta

1. `backend/librerias_propias/docx_builder/latex_math.py` agrega una nueva tubería autosuficiente `LaTeX math -> MathML -> OMML` basada en `latex2mathml` vendorizado, con caché LRU y validación explícita de scope math-only.
2. `builder.py` suma `math_latex()` para ecuaciones de bloque y `create_math_latex_element()` para inline, reutilizando numbering/bookmarks/references del flujo histórico sin tocar `math()` ni `create_math_element()`.
3. `api.py`, `__init__.py`, `math_to_docx.py`, `notebook_service.py`, stubs LSP y la capa MCP (`resources`, `prompts`, hints notebook) exponen `EquationLatex` y pasan a recomendar LaTeX para ecuaciones nuevas, manteniendo `math()` como compatibilidad legacy.
4. Se vendoriza tanto `latex2mathml` como la transformación `MathML -> OMML` dentro del proyecto, eliminando dependencia runtime de Office/COM o de binarios externos para construir el DOCX final.
5. Se agregan regresiones backend para conversión LaTeX, inline, numbering/references, timeout, binario faltante, scope inválido, integración PDF condicional y estabilidad del parser legacy.
6. La normalización previa a `MathML -> OMML` corrige delimitadores extensibles para matrices y `cases`, de modo que DOCX/PDF ya no muestren corchetes o llaves planos en contenido alto.
7. Se amplía la misma normalización para fences `\left...\right` soportados, incluyendo `\left\langle ... \right\rangle`, y se reinyectan `begChr/endChr` Unicode correctos cuando el XSL legado degrada esos delimitadores a `?`.
8. La documentación del módulo, el índice LLM y la guía extendida actualizan el alcance real del motor LaTeX para reflejar soporte explícito de esos delimitadores extensibles.
9. `latex_math.py` repara además operadores n-arios (`\sum`, `\prod`, `\int`) cuyo `m:e` queda vacío tras `MathML -> OMML`, incluso cuando el operando real queda envuelto por fences altos (`\left[...\right]`, normas o matrices), evitando cuadros placeholder en Word.

**Archivos:** `backend/latex2mathml/*`, `backend/librerias_propias/docx_builder/latex_math.py`, `backend/librerias_propias/docx_builder/builder.py`, `backend/librerias_propias/docx_builder/api.py`, `backend/librerias_propias/docx_builder/session.py`, `backend/librerias_propias/docx_builder/resources/*`, `backend/librerias_propias/math_to_docx.py`, `backend/app/services/notebook_service.py`, `backend/mcp_server/resources/inspyro_resources.py`, `backend/mcp_server/prompts/inspyro_prompts.py`, `backend/mcp_server/tools/notebook.py`, `backend/stubs/docx_api.pyi`, `backend/tests/test_docx_math_latex.py`, `docs/modules/01-document-generation-docx.md`, `docs/changelog/01-document-generation-docx.md`, `LLM_GUIDE_DOCX.md`, `docs/llm-index.yaml`, `docs/modules/19-mcp-server.md`, `docs/changelog/19-mcp-server.md`, `docs/architecture/feature-threads.md`

---

## 2026-03-29 - Soporte de DOCX grandes en conversión PDF

1. `pdf_converter.py` reemplaza el cap fijo de `8 MB` por `INSPYRO_PDF_MAX_DOCX_BYTES`, donde `0` deshabilita el límite y permite convertir notebooks grandes por defecto.
2. Cuando un operador configura un cap manual y el DOCX lo excede, el diagnóstico `too_large` reporta tamaño recibido y límite efectivo en vez del mensaje opaco legacy.
3. Se agregan regresiones backend para validar que un DOCX válido `> 8 MB` sí alcanza la ruta de conversión con el cap deshabilitado y que el rechazo configurado sigue funcionando.

**Archivos:** `backend/app/services/pdf_converter.py`, `backend/tests/test_pdf_converter_hardening.py`, `docs/modules/01-document-generation-docx.md`

---

## 2026-03-27 - Export DOCX reinyecta referencias header/footer del template cuando un notebook pierde sus `sectPr`

1. `backend/librerias_propias/docx_builder/session.py` detecta el caso en que el DOCX final conserva `word/header*.xml` / `word/footer*.xml` pero ya no tiene ninguna referencia activa `w:headerReference` / `w:footerReference` en `document.xml`.
2. Antes de exportar, la sesión vuelve a insertar en el `sectPr` final las referencias originales del template cargado, usando OOXML del propio `template.docx`.
3. Esto cubre notebooks que llaman `builder.document.add_section(...)` directo y luego pierden los párrafos estructurales de cambio de sección durante el rebuild notebook.
4. Se agrega una regresión backend que reproduce un `add_section()` raw sobre una plantilla con header/footer y exige que el DOCX exportado mantenga referencias activas.

**Archivos:** `backend/librerias_propias/docx_builder/session.py`, `backend/librerias_propias/docx_builder/api.py`, `backend/tests/test_docx_empty_handling.py`, `docs/modules/01-document-generation-docx.md`, `docs/llm-index.yaml`

---

## 2026-03-27 - Header/footer dejan de clasificarse como DOCX vacío

1. `docx_artifacts.py` amplía `detect_docx_body_is_empty()` para considerar contenido útil en `word/header*.xml` y `word/footer*.xml`, incluyendo texto, tablas, campos e imágenes.
2. Como `notebook_service.py` reutiliza esa detección al capturar exportaciones DOCX, una ejecución con contenido visible solo en encabezado/pie ya no se marca con `docx_is_empty=true` ni queda oculta detrás del último artefacto previo.
3. Se agregan regresiones backend para la clasificación `header/footer only` y para el lookup `latest` por `source_path`.

**Archivos:** `backend/app/services/docx_artifacts.py`, `backend/tests/test_docx_empty_handling.py`, `docs/modules/01-document-generation-docx.md`

---

## 2026-03-27 - DOCX vacíos ya no reemplazan el último documento válido

1. `notebook_service.py` clasifica el DOCX exportado inmediatamente después de capturarlo; si el body queda vacío (`sectPr` only), la ejecución responde `docx_is_empty=true`, agrega warning humano y no persiste/publica un nuevo artefacto descargable.
2. `docx_artifacts.py` persiste metadata aditiva `docx_is_empty`/`docx_warning` para artefactos nuevos y clasifica entradas legacy en forma perezosa al leer historial o resolver descargas latest.
3. El lookup latest por `source_path`/`kernel_id` deja de elegir versiones vacías; estas siguen visibles en `/api/docx/history` solo como referencias descargables explícitas.
4. Se agregan regresiones backend para clasificación de artefactos vacíos, supresión de publicación en `notebook_cell_executed` y cleanup de bloques stale por reejecución de celda.

**Archivos:** `backend/app/services/notebook_service.py`, `backend/app/services/docx_artifacts.py`, `backend/app/routers/docx.py`, `backend/tests/test_docx_empty_handling.py`, `docs/modules/01-document-generation-docx.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-25 - Captions Word `SEQ` para figuras y tablas en el builder DOCX

1. `builder.image()`/`builder.figure()` aceptan captions nativos con `caption`, `label`, `caption_position` y `caption_label`, mientras `builder.table()`/`builder.dataframe()` hacen lo mismo con default `Tabla` arriba de la tabla.
2. `builder.caption(number=True)` genera `w:fldSimple` con `SEQ`, reutiliza contadores por secuencia (`Figura`/`Tabla`) y deja sembrado el valor visible actual para visores que no refresquen campos.
3. El bookmark de captions numerados pasa a envolver el resultado del `SEQ` y no el párrafo completo, permitiendo que `reference(label)` resuelva al número del objeto en Word/PDF.
4. Se agregan regresiones backend para XML del builder y un diagnóstico manual Windows COM para validar `SEQ/REF` a través del pipeline PDF.

**Archivos:** `backend/librerias_propias/docx_builder/builder.py`, `backend/librerias_propias/docx_builder/session.py`, `backend/librerias_propias/docx_builder/api.py`, `backend/tests/test_docx_builder_tracking.py`, `backend/tests/test_word_caption_fields.py`, `docs/modules/01-document-generation-docx.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-24 - `doc.text()` hereda `docDefaults` globales materializados desde Template Editor

1. `docx_builder` pasa a apoyarse en `docDefaults` reales de `styles.xml` cuando el usuario edita `Documento (Global)` en Template Editor, en lugar de depender de un hint inferido desde `document.xml`.
2. La metadata persistida del template incorpora `document_defaults`, permitiendo que runtime y editor compartan la misma resolución de texto base y párrafo global.
3. El comportamiento esperado queda fijado para que `doc.text()` cambie a `Century Gothic` cuando el default global del documento se materializa, mientras estilos explícitos como `Heading 1` siguen mandando.

**Archivos:** `backend/app/services/template_service.py`, `backend/librerias_propias/docx_builder/session.py`, `backend/tests/test_template_style_fallback.py`, `docs/modules/01-document-generation-docx.md`, `docs/modules/17-template-editor.md`

---

## 2026-03-24 - Runtime DOCX reutiliza la resolución tipográfica efectiva del template

1. `docx_builder.session` deja de depender de `Calibri/Consolas` hardcodeados para estilos requeridos faltantes y pasa a reutilizar `builder_required_style_defaults` persistidos desde `template.json`.
2. `template_service.py` distingue ahora `default_font_source` y `resolved_font_source`, incluyendo el caso `theme/docDefaults`, para que el fallback runtime respete la semántica real de Word cuando el template no trae el estilo explícito.
3. `builder.code()` ya no fuerza `Consolas` al degradar sin estilo `Code`; hereda la familia efectiva del template o la default del documento.

**Archivos:** `backend/app/services/template_service.py`, `backend/librerias_propias/docx_builder/session.py`, `backend/librerias_propias/docx_builder/builder.py`, `backend/tests/test_template_style_fallback.py`, `docs/modules/01-document-generation-docx.md`, `docs/modules/17-template-editor.md`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-24 - Fallback tipográfico de estilos requeridos alineado con la plantilla

1. `template_service.py` publica defaults tipográficos efectivos del template para que la sesión DOCX pueda reutilizar la familia de `Normal`/`docDefaults`/theme cuando necesita sintetizar estilos paragraph requeridos.
2. Esto reduce los casos en que un template con fuente efectiva distinta terminaba viendo `Heading/List/Caption` en Calibri por falta de estilo explícito compatible.
3. Se agregan regresiones backend para catálogo de fuentes y defaults efectivos del template.

**Archivos:** `backend/app/services/template_service.py`, `backend/librerias_propias/docx_builder/session.py`, `backend/tests/test_template_style_fallback.py`, `docs/modules/01-document-generation-docx.md`, `docs/modules/17-template-editor.md`

---

## 2026-03-24 - Precedencia de estilos template y fallback visible para listas/captions/code

1. `backend/librerias_propias/docx_builder/session.py` solo crea estilos fallback cuando el template no trae el nombre requerido; si el estilo ya existe en la plantilla, queda intacto.
2. Los estilos fallback ahora usan formato explícito visible y, para `List Bullet` / `List Number`, clonan numeración Word por defecto (`w:num` + `w:abstractNum`) en vez de limitarse a una sangría simple.
3. `backend/librerias_propias/docx_builder/builder.py` agrega fallback visible para listas con estilo roto o sin `numPr`, y deja de imponer `Consolas` cuando el template sí define un estilo `Code`.
4. Se reemplaza la regresión inicial por pruebas con templates `.docx` manipulados que validan precedencia real del template, recreación de listas con numeración y degradación visible cuando el estilo de lista está roto.

**Archivos:** `backend/librerias_propias/docx_builder/session.py`, `backend/librerias_propias/docx_builder/builder.py`, `backend/tests/test_template_style_fallback.py`, `docs/modules/01-document-generation-docx.md`, `docs/modules/17-template-editor.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-23 - Rebuild DOCX relationship-aware, validación OOXML de imágenes y batch final-only

1. `backend/librerias_propias/docx_builder/session.py` deja de depender de snapshots XML-only: ahora serializa metadata de relaciones OOXML por fragmento y rehidrata `rId`s/medios al reconstruir el documento.
2. `backend/librerias_propias/docx_builder/utils.py` centraliza `validate_docx_package_bytes()`, reutilizado por `session.py` y `pdf_converter.py`, para detectar `a:blip`/`r:id` colgantes y targets `word/media/*` faltantes antes de persistir o convertir.
3. `notebook_service.py` endurece la semántica de `Run All`: las celdas intermedias con `skip_pdf=True` ya no persisten DOCX ni agregan historial; solo la última celda exportable fija el artefacto final.
4. Se agregan regresiones backend para preservar imágenes de `Image(bytes)` y `Figure(matplotlib)` tras rebuild/export, y para fijar que el batch notebook no persista DOCX intermedios.

**Archivos:** `backend/librerias_propias/docx_builder/session.py`, `backend/librerias_propias/docx_builder/utils.py`, `backend/app/services/pdf_converter.py`, `backend/app/services/notebook_service.py`, `backend/tests/test_docx_builder_tracking.py`, `backend/tests/test_docx_artifacts.py`, `docs/modules/01-document-generation-docx.md`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-23 - Artefactos DOCX persistentes, descarga estable e historial de 30 dias

1. Se agrega `backend/app/services/docx_artifacts.py` como store persistente DOCX en app-state, con deduplicación de blobs por hash binario pero una entrada histórica por cada generación.
2. `GET /api/docx/download` acepta `artifact_id` estable, `token` legacy y lookup del último DOCX por `source_path`/`kernel_id`; si no hay artifact store pero el runtime del kernel aún conserva el DOCX actual, la descarga por `kernel_id` sigue funcionando.
3. Se agrega `GET /api/docx/history` para listar historial newest-first por `source_path` o `kernel_id`, con retención por defecto de 30 días y cleanup periódico.
4. `notebook_service.py` deja de depender del cambio de hash para reemitir `docx_ref` y endurece el fallback para no quedar nunca sin una vía descargable cuando existe DOCX generado.
5. Se agregan pruebas backend para historia con mismo hash, fallback de descarga cuando falla storage, reload restart-safe por `artifact_id` y pruning por retención.

**Archivos:** `backend/app/services/docx_artifacts.py`, `backend/app/routers/docx.py`, `backend/app/services/notebook_service.py`, `backend/tests/test_docx_artifacts.py`, `docs/modules/01-document-generation-docx.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-11 - Storage temporal DOCX/PDF fuera del árbol instalado

1. `docx_downloads.py` y `pdf_downloads.py` pasan a resolver sus caches temporales por defecto bajo `INSPYRO_APP_STATE_DIR`, evitando escrituras en `backend/.docx_downloads` y `backend/.pdf_downloads`.
2. Se mantienen los overrides `INSPYRO_DOCX_CACHE_DIR` y `INSPYRO_PDF_CACHE_DIR` para despliegues o tests que requieran una ubicación distinta.
3. Se añaden pruebas unitarias para fijar estos defaults a `state/docx_downloads` y `state/pdf_downloads`.

**Archivos:** `backend/app/services/workspace_service.py`, `backend/app/services/docx_downloads.py`, `backend/app/services/pdf_downloads.py`, `backend/tests/test_system_workspace_api.py`, `docs/modules/01-document-generation-docx.md`, `docs/architecture/system-context.md`

---

## 2026-02-20 — Hardening crítico DOCX/PDF y template preview/upload

1. Se hizo thread-safe la caché de previews en `backend/app/services/template/preview.py` con `threading.RLock`, cubriendo `get/set/clear` concurrentes y evitando iteración no protegida al limpiar por `kernel_id`.
2. `template_upload` WS (`backend/app/routers/notebook_template.py`) ahora valida tamaño de payload con `INSPYRO_TEMPLATE_UPLOAD_MAX_BYTES` antes y después del decode base64, manteniendo `type="template_error"` y agregando `details` de tamaño.
3. `backend/app/services/docx_downloads.py` y `backend/app/services/pdf_downloads.py` agregan limpieza de residuos al arranque del módulo + barridos periódicos guardados por intervalo (`INSPYRO_DOCX_CACHE_SCAN_INTERVAL` / `INSPYRO_PDF_CACHE_SCAN_INTERVAL`).
4. Se eliminó la definición duplicada de `_ensure_rebuilt` en `backend/librerias_propias/docx_builder/session.py`.
5. Se consolidó estado global duplicado de procesos preview en `backend/app/services/template_service.py`.
6. `backend/librerias_propias/docx_builder/builder.py` elimina registro redundante de tabla en `table()` para dejar un único tracking.
7. Se añadieron pruebas `unittest`: `test_template_preview_cache_threadsafe.py`, `test_download_cache_cleanup.py`, `test_docx_builder_tracking.py`, y se extendió `test_template_table_hardening.py` para payload WS oversized.

**Archivos:** `backend/app/services/template/preview.py`, `backend/app/routers/notebook_template.py`, `backend/app/services/docx_downloads.py`, `backend/app/services/pdf_downloads.py`, `backend/librerias_propias/docx_builder/session.py`, `backend/app/services/template_service.py`, `backend/librerias_propias/docx_builder/builder.py`, `backend/tests/test_template_preview_cache_threadsafe.py`, `backend/tests/test_download_cache_cleanup.py`, `backend/tests/test_docx_builder_tracking.py`, `backend/tests/test_template_table_hardening.py`, `docs/modules/01-document-generation-docx.md`, `docs/modules/17-template-editor.md`

## 2026-02-19 — Hardening de PDF converter: lock, type hint y validación soffice

1. `get_latency_quantiles()` ahora protege la lectura de `_pdf_conversion_durations` con `_pdf_cache_lock` para evitar torn reads concurrentes.
2. El type hint del parámetro `executor` en `convert_docx_async` se corrigió de `ProcessPoolExecutor` a `Executor` (clase base), permitiendo cualquier executor compatible.
3. La detección de `soffice` ahora valida que el binario encontrado por `shutil.which` pertenezca a una instalación LibreOffice real, refactorizada como función `_find_soffice()`.
4. También se eliminaron imports muertos (`tempfile`, `subprocess`) en `notebook_service.py`.

**Archivos:** `backend/app/services/pdf_converter.py`, `backend/app/services/notebook_service.py`, `docs/modules/01-document-generation-docx.md`

## 2026-02-10 — Auditoría de calidad: 12 bug fixes en DOCX builder y PDF converter

1. **Críticos:** triple definición de `_mark_dirty` (session.py), doble registro de elementos en `_new_paragraph` (builder.py), variable `ns` shadowed en `validate_document` (session.py).
2. **Alta severidad:** tipo de retorno y yield incorrectos en `doc_block` (api.py), errores XML silenciados en `_fast_rebuild_document` (session.py), contadores globales sin protección de lock (pdf_converter.py).
3. **Calidad de código:** código muerto eliminado (session.py), `print()` migrados a `logging` (pdf_converter.py), `'python'` → `sys.executable` y literal `\\n` corregido (notebook_service.py).

**Archivos:** `backend/librerias_propias/docx_builder/session.py`, `builder.py`, `api.py`, `backend/app/services/pdf_converter.py`, `backend/app/services/notebook_service.py`, `docs/modules/01-document-generation-docx.md`

## 2026-02-10 - Thread-safety de caché PDF y corrección de excepciones

1. Se añade `threading.Lock` (`_pdf_cache_lock`) para proteger acceso concurrente a `_pdf_cache`, `_pdf_cache_hits` y `_pdf_conversions` en `pdf_converter.py`.
2. `threading.Lock` (no `asyncio.Lock`) es deliberado: las conversiones PDF corren en threads COM/STA separados del event loop.
3. Se corrigen `except:` desnudos a `except Exception:` con logging para no capturar `SystemExit`/`KeyboardInterrupt`.
4. Se documenta en docstring la razón del tipo de lock elegido.

**Archivos:** `backend/app/services/pdf_converter.py`, `docs/modules/01-document-generation-docx.md`

## 2026-02-06 - Hardening DOCX corrupto en conversión PDF

1. Se endureció la validación de estructura DOCX para revisar todas las partes XML del paquete, relaciones `.rels` y referencias en `[Content_Types].xml`.
2. Se agregó reparación automática vía LibreOffice (`DOCX -> DOCX`) cuando Word detecta archivo corrupto.
3. Se añadió reintento de conversión con Word tras reparación para evitar fallback innecesario y reducir alertas falsas en notebook.
4. Se incorporaron pruebas unitarias para XML malformado y relaciones rotas.

**Archivos:** `backend/app/services/pdf_converter.py`, `backend/tests/test_pdf_converter_hardening.py`, `docs/modules/01-document-generation-docx.md`

## 2026-02-06 - Estabilidad de conversión PDF

1. Se reforzó serialización de conversiones Word para minimizar fallos por concurrencia.
2. Se consolidó manejo de timeouts y trazas de diagnóstico en el pipeline DOCX→PDF.
3. Se alineó comportamiento con flujos de preview de template para evitar bloqueos cruzados.

**Archivos:** `backend/app/services/pdf_converter.py`, `backend/app/routers/notebook.py`

## 2026-02-06 - Integración con locks de kernel y previews

1. Se documentó la interacción entre export DOCX, cola de conversión y locks por kernel.
2. Se reforzó semántica de respuesta (`notebook_cell_executed` + `notebook_pdf_ready`) para rutas async.

**Archivos:** `docs/modules/01-document-generation-docx.md`, `docs/architecture/backend-flow.md`

## 2026-01-31 a 2026-02-05 - Endurecimiento incremental

1. Ajustes de robustez para compatibilidad Word/LibreOffice.
2. Mejoras de fallback y observabilidad de errores de conversión.
3. Ajustes de caché para evitar reconversiones innecesarias.

**Archivos:** `backend/app/services/pdf_converter.py`, `backend/app/routers/notebook.py`

## 2026-01-17 - Base de documentación del módulo

1. Se consolidó referencia de API DOCX + conversión PDF en un módulo único.
2. Se publicaron ejemplos end-to-end para notebooks.

**Archivos:** `docs/modules/01-document-generation-docx.md`
