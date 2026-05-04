# 17 - Template Editor

> **Estado:** ✅ Producción
> **Ubicación:** `frontend/src/components/TemplateEditor.js` + `frontend/src/components/template-editor/*` + `backend/app/services/template/` + `backend/app/services/template_service.py`
> **Última actualización:** 2026-05-01
> **Changelog:** `docs/changelog/17-template-editor.md`

---

## Propósito sistémico

Permitir edición visual de estilos DOCX de plantilla, generación de previews y aplicación de formato directo de tablas, manteniendo sincronía con el kernel y sin bloquear ejecución de celdas.

## Workbench visual slots-first (2026-05-01)

- `TemplateEditorContainer` organiza la experiencia como workbench de tres zonas: navegación izquierda, edición central y rail derecho de preview Word. El header concentra estado, reemplazo DOCX, menú secundario (`Importar JSON`, `Exportar JSON`, `Eliminar plantilla`) y cierre; el footer persistente fue retirado para evitar acciones duplicadas y contenido tapado.
- La navegación izquierda prioriza uso real: `Slots` es la vista inicial para `body`, `heading_1..6`, listas, `caption`, `code` y `table_default`; `Estilos` aloja búsqueda, categorías detectadas y `Documento (Global)`; `Diagnóstico` agrupa página, campos SDT/placeholders, headers/footers y salud.
- En `Slots`, la tarjeta activa gobierna el panel central: se muestra el contexto `Slot -> Estilo Word asignado` y debajo se edita el estilo asociado. La edición directa de tablas queda reservada a `Estilos`, para que el slot sea una experiencia de mapeo semántico + edición del estilo asignado, no un navegador paralelo ambiguo.
- `StyleEditPanel` mantiene el guardado en header sticky, agrupa controles en bloques compactos (`Fuente`, `Párrafo`, `Sangría`, avanzado/table style) y mueve valores efectivos + OOXML a paneles `Inspección` colapsados.
- La preview Word sale del flujo obligatorio de edición y queda en un rail sticky en desktop; en anchos medianos/chicos baja como panel de apoyo dentro del flujo responsivo. `TableDirectFormatPanel` separa selección/preview de tabla de la acción explícita `Aplicar`.
- No se agregan contratos WS/REST. Siguen vigentes `template_update_style`, `template_update_document_defaults`, `template_update_semantic_slots`, previews, upload/import/export y apply de tabla.

## Apertura desde Home sin loops de render (2026-05-01)

- `TemplateEditorContainer` distingue la carga de una plantilla persistida desde Home con el estado `Cargando plantilla...`, evitando mostrar transitoriamente `No hay plantilla activa`.
- El editor deduplica mensajes WS de template ya procesados y resetea previews con una huella estable del metadata de plantilla, para que un remount o cambio de callback no vuelva a disparar `Maximum update depth exceeded`.
- `useTablePreviewQueue` preserva referencias vacías al resetear, evitando renders extra cuando no hay previews en memoria.
- La regresión frontend cubre rerenders con metadata estable, mensajes `template_uploaded` repetidos y el estado de carga persistida.

## Estado vacío simplificado (2026-04-26)

- Cuando no existe `templateInfo`, `TemplateEditorContainer` muestra una única zona de arranque: acción primaria para seleccionar `.docx` y acción secundaria para importar JSON portable.
- Los CTAs de header y footer quedan ocultos hasta que haya una plantilla activa, evitando tres lugares distintos que aparentan hacer lo mismo.
- La vista vacía mantiene `Cerrar` como única acción de footer y conserva el panel principal sin estilos/controles que no puedan operar todavía.

## Campos Word-first accionables y Workbench (2026-04-25)

- El panel `Campos` deja de ser solo observabilidad: ahora ofrece acciones discretas para guiar el envoltorio de placeholders `{{TAG}}`, generar valores de prueba y validar la plantilla contra el Workbench DOCX antes de usarla como base de entrega.
- La extracción sigue viniendo de OOXML real (`content_controls`, placeholders y campos detectados), manteniendo la plantilla como fuente de verdad y evitando una ruta paralela de generación.
- La validación recomendada para plantillas complejas es: detectar placeholders no envueltos, envolverlos como SDTs cuando corresponda, probar relleno y revisar fields/styles/protection desde Workbench en el DOCX generado.
- La validación previa a entrega debe seguir siendo explícita: el editor puede guiar campos/SDTs y advertencias de plantilla, pero el render visual cacheado y la auditoría delivery se ejecutan desde Workbench sobre el artefacto DOCX real.

## Campos Word-first y SDTs (2026-04-24)

- `template_service.py` reutiliza `docx_quality.content_controls.inspect_content_controls()` para exponer `content_controls` dentro del payload de plantilla.
- `TemplateEditorContainer` agrega un panel discreto `Campos` en el sidebar: lista SDTs detectados, cuenta tags y advierte placeholders `{{TAG}}` que todavía no están envueltos en content controls Word.
- El panel es observabilidad operativa, no una ruta paralela de generación: la autoridad del documento sigue estando en el DOCX/OOXML de la plantilla y en los slots semánticos Word-first.

## Contrato Word-first por slots semánticos (2026-04-19)

- El editor ya no persiste solo overrides locales por categoría: el template guarda `semantic_style_slots` como contrato Word-first entre UI, runtime DOCX y Word.
- Los slots canónicos son `body`, `heading_1..6`, `list_bullet`, `list_number`, `caption`, `code` y `table_default`; cada uno persiste `selection_key`, `style_id`, `style_name` y `style_type`.
- El sidebar separa dos responsabilidades: una banda de slots semánticos persistidos para el runtime y, por debajo, el navegador `style_browser` para inspeccionar/editar estilos Word reales.
- El import/export portable sube a `schema_version=1.1` con `semantic_style_slots`; `category_overrides` queda solo como compatibilidad legacy de import.

## Preview de estilo preserva header/footer del template (2026-03-27)

- `generate_style_preview()` prepara ahora el DOCX temporal mediante un helper explícito de preview, separando `clear_body`, `clear_header_footer` y `compact_page_setup`.
- El preview de estilos normales limpia solo el body del documento y conserva los `header/footer` originales de la plantilla, para que el render Word/PDF refleje el contexto real del formato cargado.
- La limpieza de `header/footer` deja de ser el default global del editor; queda reservada a previews aislados donde se solicite explícitamente por performance o estabilidad.

## Encabezados y pies detectados desde OOXML real (2026-03-27)

- La extracción del template ya no depende solo de `section.header/footer.paragraphs`; ahora recorre `word/header*.xml` y `word/footer*.xml` para recuperar texto visible también cuando el contenido vive dentro de tablas, celdas o runs fragmentados.
- El sidebar del editor muestra un bloque read-only con los encabezados y pies detectados, lo que permite verificar rápidamente que el formato cargado sí contiene la cabecera/pie esperados.
- Tras cargar una plantilla, la UI avisa explícitamente que hay que reejecutar la celda para regenerar el DOCX/PDF con el formato actualizado del kernel.

## Navegación detectada + paquete portable (2026-03-25)

- `style_coverage` se conserva como resumen de salud de estilos requeridos del builder DOCX, para no romper compatibilidad con el runtime existente.
- La extracción añade `style_browser`, que clasifica todos los estilos detectados en `titles`, `headings`, `body`, `lists`, `tables`, `code`, `captions` y `other`, e incluye `category_order`, `counts` y `auto_selected`.
- Cada estilo navegable expone `selection_key` estable (`category|style_id|display_name[#N]`) para tolerar nombres duplicados y mantener selección/manual override sin colisiones por `name`.
- El editor frontend reemplaza el listado lineal de “estilos requeridos” por un navegador por categoría con selector por bucket y `selection_key` estable, pero la autoridad runtime vive en `semantic_style_slots`.
- `GET /api/templates/export?kernel_id=...` devuelve un paquete portable con `schema_version=1.1`, `exported_at`, `kernel_id`, `template`, `docx_base64` y `file_name`; la importación JSON valida ese envelope, reusa `POST /api/templates/upload` + `template_attach` y rehidrata `semantic_style_slots`, aceptando `category_overrides` solo como compatibilidad legacy.

## Captions detectados y estilo `Caption` (2026-03-25)

- `style_coverage` incorpora la categoría `captions`, exponiendo `Caption` como estilo editable de primer nivel en el panel izquierdo.
- La extracción estructural del template añade `document_captions[]`, con asociación aditiva a `table`/`figure`, posición (`before`/`after`), texto visible, `style_id/style_name`, `uses_caption_style`, `has_seq_field` y `sequence_name`.
- `StyleEditPanel` trata `Caption` como preview especial: cuando no hay render Word todavía, el fallback CSS usa un ejemplo real (`Figura 1. Texto de ejemplo`) en lugar del pangrama genérico.
- La detección es observabilidad: el usuario edita un único estilo compartido `Caption`, mientras la lista de captions detectados se muestra como lectura estructural del `document.xml`.

## Entradas y salidas contractuales

### Entradas (`C→S`)
- `template_upload`
- `template_attach`
- `template_get`
- `template_delete`
- `template_update_style`
- `template_update_document_defaults`
- `template_update_semantic_slots`
- `template_preview_style`
- `template_table_preview`
- `template_create_style_from_table`
- `template_apply_table_format`

### Salidas (`S→C`)
- `template_uploaded`
- `template_info`
- `template_deleted`
- `template_style_updated`
- `template_document_defaults_updated`
- `template_semantic_slots_updated`
- `template_preview_ready` / `template_preview_error`
- `template_table_preview_ready` / `template_table_preview_error`
- `template_style_created`
- `template_format_applied`
- `template_error`

### REST auxiliares
- `POST /api/templates/upload`
- `POST /api/templates/tokenize`
- `GET /api/templates/export`

Contrato canónico: `docs/architecture/contracts-catalog.md`.

## Dependencias y sinergias

### Upstream
- `04-notebook-handlers` para enrutamiento y sincronización con kernel.
- `09-jupyter-kernel` para recarga de template en sesión activa.
- `01-document-generation-docx` para render/previews y formato Word.

### Downstream
- `14-main-app` almacena y propaga estado de template, incluyendo snapshots reflejados por MCP.
- `11-notebook-editor-ui` se beneficia de plantilla aplicada en ejecuciones DOCX posteriores.

## Estado compartido y concurrencia

1. Estado frontend: estilo seleccionado, cache de previews, cola de miniaturas, request IDs.
2. Estado backend: template por kernel (`template/storage.py`), modelos `style_coverage` + `style_browser` (`template_extract.py`), sidecar `table_style_runtime_defaults` en `template.json` para defaults runtime de estilos de tabla (`tblLook/tblLayout/tblW`), envelope portable de export (`templates.py`) y caché de preview por `kernel_id + preview_key` (`template/preview.py`), con compatibilidad mantenida en `template_service.py`. Persistencia por defecto: `INSPYRO_APP_STATE_DIR/templates` para templates por kernel y `INSPYRO_APP_STATE_DIR/template_tokens` para uploads por token; `INSPYRO_TEMPLATE_DIR` e `INSPYRO_TEMPLATE_TOKEN_DIR` permiten override explícito fuera del árbol instalado. En paralelo, la home compacta persiste la asociación notebook-template por workspace en `<workspace>/.inspyro/templates/index.json` con un espejo `.docx` seguro reutilizable.
3. `App.js` mantiene `templateInfo` y `templateBlob` como source of truth frontend; si el cambio proviene de MCP, el shell puede actualizarlos directamente desde `template_snapshot` sin esperar un `template_*` del websocket humano.
4. Adjuntos por token: upload recomendado por REST (`/api/templates/upload`) + attach WS (`template_attach`); `template_upload` permanece como fallback legacy. El import portable JSON reutiliza exactamente esa ruta y el export portable sale por `GET /api/templates/export`. Cuando la home necesita reabrir un template persistido por espejo de workspace, usa `POST /api/templates/tokenize` para convertir ese `.docx` local en `template_token` efímero antes de hacer `template_attach`.
5. Concurrencia:
- Semáforo de previews de estilo.
- Semáforo de previews de tabla.
- Dispatch background para previews en `/ws`.
6. El estado latest-wins de previews en backend se poda por kernel y elimina entradas completadas/canceladas para evitar crecimiento no acotado en sesiones largas.
7. Frontend mantiene borradores locales de edición de estilo hasta recibir `template_style_updated` o `template_document_defaults_updated` correlados; el guardado deja de limpiar dirty flags de forma optimista.
8. El fallback a `template_upload` WS queda reservado a fallos de transporte/no disponibilidad del upload REST; errores HTTP funcionales (`400`/`413`/`422`) se muestran en UI sin reenviar el archivo por WS.
9. Locks de kernel para operaciones que ejecutan código de recarga/template.
10. Operaciones pesadas de plantilla se ejecutan en pool dedicado (`ThreadPoolExecutor`) para proteger el event loop.
11. El shell puede forzar la vista `docx` cuando un cambio template reflejado por MCP actualiza preview o artefactos asociados.
12. Al recargar template en kernel, `docx_builder` preserva cualquier estilo paragraph existente de la plantilla; solo crea fallbacks runtime para estilos requeridos ausentes (`Heading 1-6`, `List Bullet`, `List Number`, `Code`, `Caption`) y nunca sobrescribe estilos ya definidos por el template.
13. La extracción de template resuelve ahora fuentes efectivas desde `styles.xml`, `docDefaults`, `theme1.xml` y `fontTable.xml`; además persiste `default_font_source`, `resolved_font_source`, `font_source`, `font_catalog`, `system_font_catalog` y `builder_required_style_defaults` en `template.json` para que UI y runtime lean la misma semántica.
14. `TemplateEditorContainer` y `StyleEditPanel` consumen una utilidad compartida de fuentes (`fontUtils.js`) para que cards, panel, preview CSS, serialización `rFonts` y parser avanzado usen la misma `resolved_font` efectiva, sin drift entre `font.name`, `font.font_name`, theme o docDefaults.
15. `fontUtils.js` mezcla una base Office/Windows segura con `default_font`, `font_catalog`, `fontTable`, fuentes de theme y `system_font_catalog`; el picker de `Familia` ya no depende del `datalist` nativo ni de un preset local estrecho, y al abrirse muestra sugerencias amplias aunque el valor actual sea `Calibri`.
16. El campo `Familia` sigue siendo editable libremente, pero la UI ahora puede advertir de forma no bloqueante cuando la fuente elegida no aparece en el `system_font_catalog` del host; aun así conserva el nombre real del template y no lo sustituye por `Calibri`.
17. Si el template no define explícitamente la familia en `Normal/docDefaults` pero el cuerpo del documento usa otra fuente de forma consistente mediante formato directo, la extracción promueve esa familia como hint efectivo del documento; esto evita que el editor marque `Calibri/minorHAnsi` como valor efectivo cuando el contenido real viene en `Century Gothic`.
18. Cuando el usuario fija `font_name` explícito, el backend persiste `w:rFonts` en `ascii`, `hAnsi`, `cs` y `eastAsia`, limpiando atributos `*Theme` conflictivos; si la mutación no toca la familia, la herencia por `basedOn`/`docDefaults`/theme permanece intacta.
19. Cuando el kernel necesita sintetizar estilos requeridos ausentes, usa `builder_required_style_defaults` persistidos desde el template y deja de depender de `Calibri/Consolas` hardcodeados salvo que la propia plantilla resuelva a eso.
20. `Documento (Global)` deja de ser un panel solo lectura: expone controles editables de `Texto global` y `Párrafo global` para materializar `docDefaults` reales de Word sin reescribir estilos explícitos (`Heading 1`, `Caption`, `Code`, etc.).
21. El contrato dedicado `template_update_document_defaults` escribe `w:docDefaults/w:rPrDefault/w:rPr` y `w:docDefaults/w:pPrDefault/w:pPr` en `styles.xml`, reextrae el template y responde `template_document_defaults_updated` con el `template` completo ya recompuesto.
22. `template.json` persiste un bloque top-level canónico `document_defaults` con `font`, `paragraph`, `font_source` y `paragraph_source`, alineando editor, runtime DOCX y payloads WS sin depender de hints inferidos desde `document.xml`.
23. La sección `Documento (Global)` no solicita preview Word dedicada en esta versión: la validación visual esperada es el DOCX/PDF generado con la plantilla materializada, porque ahí es donde Word realmente consume `docDefaults`.
24. Las superficies scrollables del editor se reducen a zonas de ownership claro (`template-sidebar-panel`, `editor-main`, `template-preview-rail`) y adoptan `scroll-surface`, evitando scrolls anidados entre sidebar, listas internas y footer.

## Garantías técnicas de hardening (2026-02-07)

1. `table_index` inválido no debe gatillar apply/preview en otra tabla.
2. Parseo de bordes tolera `w:sz` no numérico sin romper extracción (`size_pt=None` y resto de campos intactos).
3. `tblStylePr[type=firstRow]` existente se preserva cuando no hay señal suficiente para reemplazar.
4. Preview “Estilo Word” no debe mutar el DOCX temporal por payload meta-only (`style_type`, `category`, `style_id`).
5. `tblLook` del preview de tabla respeta precedencia:
- props explícitas del request
- `tblLook` real del estilo objetivo
- defaults seguros
6. Resolución de estilo para apply/preview prioriza estilo existente por `style_name`/`style_id` antes de crear estilos nuevos.
7. Contrato WS permanece estable para frontend (`template_preview_ready/error`, `template_table_preview_ready/error`, `template_format_applied`, `template_error`).
8. Pipeline de preview en frontend opera con invalidación centralizada y aceptación estricta de respuestas activas (`request_id`/`preview_key` en vuelo), incluyendo cacheo únicamente de respuestas activas para evitar contaminación stale post-apply.
9. El `preview_key` de estilos de tabla incorpora firma estructural (`table_signature`) para invalidar preview cuando cambian `tblPr/tblStylePr` aunque font/párrafo no cambien.
10. Render manual (`⟳ Renderizar`) opera en modo `force_refresh`, bypass de caché frontend/backend y request nueva garantizada.
11. UX de preview comunica estado de pipeline (encolado/renderizando/actualizando) y mantiene fallback CSS explícito como temporal mientras llega el render real de Word.
12. `delete_template` sanitiza `kernel_id` antes de construir rutas en disco, cerrando path traversal en borrado de template.
13. `template_upload` valida `docx_base64` con decode estricto (`validate=True`) y responde error tipado (`invalid_docx_base64`) cuando el payload es inválido.
14. Mutaciones de template críticas (`upload/update/delete/create/apply`) usan lock por kernel con timeout y correlación por `request_id` en respuestas success/error.
15. `template_update_style` invalida caché de preview backend en cada actualización y acepta payload dual de updates (claves planas + bloques `font/paragraph/table/advanced_props`).
16. `template_update_document_defaults` opera por una ruta dedicada: recibe `updates.font` + `updates.paragraph`, materializa `docDefaults`, elimina nodos/atributos vacíos para restaurar herencia de Word y evita introducir un pseudo-style global.
17. El panel de tabla persiste cambios reales (`table_*`) y los integra en preview payload/key para evitar render stale tras editar bordes/look/layout/celda.
18. Errores globales WS (`type="error"`) ahora llegan al shell con `error_code`/`details` y se muestran sin romper flujo de `template_error`.
19. Modificaciones de estilos de tabla (`_apply_table_style_updates`, `apply_table_format_to_style`) desacoplan previamente las tablas de headers/footers del estilo objetivo mediante `_freeze_header_footer_table_styles`, evitando propagación no deseada de formato a contenido de encabezado/pie de página.
20. Caché backend de preview (`template/preview.py`) opera con `threading.RLock` para asegurar consistencia bajo ejecución concurrente en threadpool.
21. `template_upload` WS valida payload por tamaño aproximado (pre-decode) y tamaño real (post-decode) usando `INSPYRO_TEMPLATE_UPLOAD_MAX_BYTES`, manteniendo `template_error` con `details` aditivo.
22. Los estilos de tabla ya no persisten `tblW`, `tblLayout` ni `tblLook` dentro de `word/styles.xml`; esos defaults se capturan en `table_style_runtime_defaults` y se reaplican sobre la tabla concreta al generar DOCX.
23. Plantillas legacy con `tblW/tblLayout/tblLook` inválidos bajo `w:style/w:tblPr` se sanean automáticamente en primer uso, con backup timestamped antes de reescribir `template.docx`.
24. El preview y la generación notebook comparten la misma semántica runtime de tabla: `look/layout/width` se aplican como propiedades de instancia, no como OOXML inválido del estilo.
25. Antes de reutilizar o persistir una plantilla, el backend repara declaraciones `xmlns:*` faltantes en cualquier parte OOXML (`styles.xml`, headers, footers, etc.) cuando `mc:Ignorable` referencia prefixes no declarados; esto evita falsos “archivo corrupto” de Word tras mutaciones XML previas.
26. `StyleEditPanel` mantiene el borrador local hasta que llega el ack correlado (`template_style_updated` o `template_document_defaults_updated`); si llega `template_error`, la UI conserva el estado “Sin guardar”.
27. Los hooks de preview cancelan trabajo activo en timeout, unmount, reset y cambio de pestaña mediante `template_preview_cancel`, incluyendo previews de tabla correladas por `request_id`.
28. La cola de previews de tabla permite reintento explícito tras error/timeout sin recargar la plantilla; el flag interno de “ya solicitada” se limpia en ramas fallidas.
29. Si el template no define estilos paragraph requeridos por la API DOCX, la sesión del kernel inyecta fallbacks seguros y, para listas rotas o sin `numPr`, `builder.list()` degrada a marcadores visibles explícitos en vez de dejar contenido plano/invisible.
30. El panel de estilos ya no “pierde” fuentes fuera de una lista cerrada: el campo `Familia` acepta cualquier nombre de fuente y ofrece sugerencias provenientes del template, del host y de una base Office/Windows compartida.
31. Al abrir el picker de fuentes, la lista ya no queda reducida al prefijo de la familia actual; esto evita el falso “solo veo variantes de Calibri”.
32. Una edición explícita de `font_name` ya no compite con `asciiTheme`/`hAnsiTheme`/`csTheme`/`eastAsiaTheme`: `styles.xml` conserva una sola resolución tipográfica efectiva para Word, preview y export final.
33. Los defaults globales del documento se escriben/remueven a nivel `docDefaults`; limpiar un campo en `Documento (Global)` vuelve a activar la herencia nativa de Word/theme en lugar de dejar un override vacío persistido.

## Fallos frecuentes y observabilidad

### Fallos frecuentes
- Preview timeout por conversión pesada o entorno Word/LibreOffice degradado.
- Estado stale tras aplicar formato si no se invalida cache.
- Contención con ejecución notebook en kernels compartidos.
- `table_index` inválido (string/negativo/fuera de rango), ahora con rechazo explícito y mensaje trazable.
- Fallback a `template_upload` WS solo en entornos sin upload REST disponible; errores HTTP funcionales del upload REST se informan sin reintento por WS.

### Observabilidad
- Mensajes `template_*_error` con `request_id`/`table_index`.
- Logs de backend en handlers de template y `template_service`.
- `docs-check` para validar consistencia de contratos y documentación.

## Archivos fuente y puntos de entrada

- `frontend/src/components/TemplateEditor.js`
- `frontend/src/components/TemplateEditor.css`
- `frontend/src/components/template-editor/TemplateEditorContainer.js`
- `frontend/src/components/template-editor/StyleEditPanel.js`
- `frontend/src/components/template-editor/fontUtils.js`
- `frontend/src/components/template-editor/TableDirectFormatPanel.js`
- `frontend/src/components/template-editor/hooks/useStylePreviewPipeline.js`
- `frontend/src/components/template-editor/hooks/useTablePreviewQueue.js`
- `frontend/src/components/template-editor/templateEditorMappers.js`
- `frontend/src/contracts/wsMessageTypes.generated.js`
- `frontend/scripts/generate_ws_types.mjs`
- `backend/app/services/template_service.py`
- `backend/app/services/template/__init__.py`
- `backend/app/services/template/storage.py`
- `backend/app/services/template/mutation.py`
- `backend/app/services/template/preview.py`
- `backend/app/services/template/table_format.py`
- `backend/app/services/template/xml_ops.py`
- `backend/app/services/template_extract.py`
- `backend/app/routers/templates.py`
- `backend/app/routers/notebook_template.py`

Puntos de entrada principales:
- `handle_template_upload`
- `handle_template_preview_style`
- `handle_template_table_preview`
- `handle_template_apply_table_format`

## Resumen de cambios recientes

1. El sidebar agrega `Campos` para SDTs/content controls y placeholders `{{TAG}}` no envueltos, alimentado por la extracción OOXML nativa de calidad DOCX.
2. El preview de estilos vuelve a preservar `header/footer` del template en vez de vaciarlos siempre durante la preparación del DOCX temporal.
3. Se extrajo un helper de preparación de preview con flags explícitos (`clear_body`, `clear_header_footer`, `compact_page_setup`) para separar previews contextuales de previews aislados.
4. Dispatcher WS no bloqueante para previews y cancelación de tareas al desconectar.
4. Cola secuencial robusta de previews de tabla con correlación por `request_id`.
5. Apply por `style_id` y `style_name` para compatibilidad con plantillas heterogéneas.
6. Reforzamiento de timeouts, fallback y limpieza de estado stale en frontend/backend.
7. Integración segura con locks de kernel para evitar ejecuciones “pegadas”.
8. Hardening de `table_index` (normalización y rechazo temprano), parser de bordes tolerante a OOXML atípico y preservación no destructiva de `tblStylePr:firstRow`.
9. Fidelidad de preview de tablas en “Estilo Word”: ya no se reescribe el DOCX de preview con payload meta-only, `tblLook` se resuelve desde el estilo real y `_apply_style_to_docx` prioriza resolución por `style_id` antes de crear estilos nuevos.
10. Se añadieron pruebas unitarias específicas para asegurar invariantes de hardening en parser, apply y preview.
11. Se eliminó refresco WS redundante post-apply (`template_get`) y doble disparo manual de preview para consolidar una sola ruta de render post actualización de estilo.
12. Capa de caché de preview endurecida: respuestas fuera de vuelo ya no pueden reintroducir imagen genérica en la primera carga de “Estilo Word”.
13. Límite de upload frontend ajustado a 6.5MB para absorber overhead base64/JSON y reducir errores silenciosos por límite WS.
14. Manejo global de `type="error"` en `App` para visibilizar errores WS genéricos en UI (incluyendo payload oversized).
15. `Ctrl+S` quedó enlazado al guardado real en `StyleEditPanel` (antes invocaba ruta de guardado no conectada).
16. Se aisló mapeo de tabla a backend en `templateEditorMappers` con tests unitarios dedicados.
17. Refactor estructural frontend: `TemplateEditor` ahora es fachada y el flujo quedó dividido en `TemplateEditorContainer`, `StyleEditPanel`, `TableDirectFormatPanel`, `useStylePreviewPipeline` y `useTablePreviewQueue`.
18. Refactor estructural backend: router de notebook usa módulos especializados (`template.storage`, `template_extract`, `template_style_apply`, `template.preview`, `template_table_format`) manteniendo compatibilidad de `template_service.py`.
19. `TemplateEditorContainer` migra tipos WS de template a constantes generadas desde `docs/llm-index.yaml` para reducir errores de string literals en `sendMessage` y correlación de respuestas.
20. `template_extract` y `template_preview` dejan de ser facades triviales: ahora contienen lógica real de cobertura de estilos y cache LRU de previews.
21. Flujo recomendado de upload migra a REST (`/api/templates/upload`) + `template_attach`, manteniendo compatibilidad con `template_upload`.
22. Operaciones pesadas de preview/update/apply se delegan a ejecutor dedicado de template para evitar bloqueo del event loop bajo carga.
23. Dominio template backend se reagrupa bajo paquete `app/services/template/` (storage/preview/mutation/table_format/xml_ops), con `template_service.py` como fachada de compatibilidad de alto nivel.
24. Modificaciones de estilos de tabla protegen tablas en headers/footers: `_freeze_header_footer_table_styles` desacopla tablas de header/footer del estilo antes de modificarlo, copiando propiedades actuales como formato directo inline.
25. `template_upload` vuelve a emitir `error_code=invalid_docx_base64` para payload base64 inválido (se corrigió import faltante en el handler y se restableció el comportamiento tipado esperado por tests/cliente).
26. Se endureció `template_upload` WS con rechazo temprano de payloads grandes (`template_upload_too_large`) sin cambiar contrato de mensaje y con detalle de tamaño recibido/máximo.
27. Capa de caché de preview backend ahora sincroniza `get/set/clear` con `RLock` para evitar carreras al invalidar por kernel durante generación concurrente de previews.
28. El flujo MCP para templates emite `template_snapshot` y mantiene `templateInfo` del shell como source of truth, forzando foco `docx` sin introducir un nuevo contrato `template_*` público.
29. El storage default de templates/tokens deja de depender del repo instalado: `template_service.py` usa `INSPYRO_APP_STATE_DIR/templates` y migra en primer uso el legacy `backend/.templates` si el destino está vacío; `template_tokens.py` usa `INSPYRO_APP_STATE_DIR/template_tokens`.
30. El pipeline de estilos de tabla quedó dividido en dos capas: OOXML-safe en `styles.xml` (`tblBorders`, `shd`, `jc`, `tblCellSpacing`, `tblCellMar`, `tcPr`, `tblStylePr`) y defaults runtime (`table_style_runtime_defaults`) propagados a kernel/session/builder.
31. `template_update_style`, `template_create_style_from_table` y `template_apply_table_format` conservan fidelidad de `look/layout/width` sin volver a corromper el DOCX; la extracción recompone esos valores sobre `resolved_table_format`.
32. `NotebookEditor` ya muestra `word_error` junto a `pdf_conversion_error` cuando Word rechaza el DOCX y no hay conversor alternativo disponible, evitando ocultar la causa real detrás de `all_converters_unavailable`.
33. `StyleEditPanel` deja de confirmar guardado de forma optimista: mantiene dirty state hasta recibir el payload actualizado del backend.
34. `TemplateEditorContainer` separa errores REST funcionales de fallos de transporte en el upload de plantillas; solo estos últimos habilitan fallback a WS y ese fallback no se usa por encima de `6.5MB`.
35. El lifecycle de previews queda endurecido end-to-end: `useStylePreviewPipeline` y `useTablePreviewQueue` cancelan requests activas en cleanup/timeout, la cola de tablas admite retry explícito, y `app.core.state` poda/limpia el registro latest-wins por kernel.
36. El catálogo visible de `Familia` pasa a salir de `fontUtils.js` y deja de depender de listas duplicadas en `StyleEditPanel` o `TemplateEditorContainer`.
37. `StyleEditPanel` reemplaza el `datalist` nativo por un picker propio para mostrar más fuentes sin depender del texto ya cargado en el input.
38. La extracción tipográfica suma un hint desde `document.xml` para promover la fuente dominante del cuerpo cuando `Normal/docDefaults` no la definen explícitamente.
39. Las mutaciones de fuente explícita en `template_service.py` sincronizan `w:rFonts` en los cuatro slots (`ascii`, `hAnsi`, `cs`, `eastAsia`) y limpian `*Theme` para evitar sustituciones silenciosas de Word cuando el template venía heredando desde theme/docDefaults.
40. `Documento (Global)` pasa a editar `docDefaults` reales de Word mediante un contrato dedicado (`template_update_document_defaults`) y guarda defaults de texto/párrafo sin tocar estilos explícitos ya presentes en la plantilla.
41. El editor mantiene el bloque top-level `document_defaults` sincronizado con `template.json`, de modo que el valor que se ve en UI coincide con lo que Word usará en `doc.text()` y párrafos sin estilo explícito.
42. `template_extract.py` añade `style_browser` como vista navegable de todos los estilos detectados, manteniendo `style_coverage` como resumen de salud requerido.
43. El navegador lateral del editor pasa a operar por categorías detectadas, auto-selecciona el mejor candidato por score y permite override manual por categoría sin perderse al refrescar la plantilla.
44. Los estilos visibles en UI usan `selection_key` compuesto (`category|style_id|display_name[#N]`) para soportar nombres duplicados y mantener updates seguros por `style_id`.
45. Se agrega export portable por `GET /api/templates/export`, que embebe `docx_base64` junto con `template` y `semantic_style_slots` para un round-trip completo Word-first.
46. La importación JSON del editor valida `schema_version`, decodifica el DOCX embebido, reusa upload REST + `template_attach` y restaura `semantic_style_slots`; `category_overrides` queda solo como compatibilidad legacy.
47. `TemplateEditorContainer` deja de definir un skin propio de scrollbars y pasa a reutilizar el sistema compartido del shell, manteniendo consistencia con notebook, launcher, explorer y paneles MCP.
48. `TemplateEditorContainer` adopta un workbench slots-first con header único, navegación `Slots/Estilos/Diagnóstico`, rail de preview Word y sin footer duplicado; `StyleEditPanel` mueve guardar al header sticky y colapsa inspección efectiva/OOXML.

Detalle histórico completo: `docs/changelog/17-template-editor.md`.
