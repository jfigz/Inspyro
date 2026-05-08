# Changelog 17 - template-editor

> **Última actualización:** 2026-05-08

---

## 2026-05-08 - Banco `template-binding-bank` para binding JSON por notebook

1. `backend/tests/test_template_binding.py` se amplía como subset rápido de PR: contratos de bind, paquetes corruptos/schema inválidos/base64 inválido, rutas inseguras, symlink traversal, workspace default, Home canónico frente a legacy y autoexport aislado por kernel.
2. Se agrega `frontend/tests/template-binding-bank.spec.ts`, banco live Playwright que valida upload+bind, persistencia `.ipynb`/JSON, estado `Vinculada`, warning por JSON perdido, no dirty falso por hidratación, Home summary y MCP stateful.
3. `agent_debug.ps1` suma `template-binding-bank`, que ejecuta subset backend/frontend y luego el banco live; además `verify-fast` incluye `test_template_binding.py` para que el contrato notebook-first quede en el gate rápido.
4. El banco live genera evidencia en `output/template-binding-bank/<run-id>/summary.json` y `summary.md`, con matriz requisito→escenario→resultado→artefactos.

**Archivos:** `backend/tests/test_template_binding.py`, `frontend/tests/template-binding-bank.spec.ts`, `frontend/src/hooks/useTemplateMessageHandler.test.js`, `agent_debug.ps1`, `.gitignore`, `docs/modules/17-template-editor.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`, `docs/changelog/17-template-editor.md`

---

## 2026-05-08 - Plantilla JSON anidada al notebook

1. `POST /api/templates/bind` exporta el template activo en formato portable, escribe `<notebook_stem>.inspyro-template.json` junto al notebook y parchea `metadata.inspyro.template_binding`.
2. Las mutaciones autoritativas del editor (`template_uploaded`, estilos, defaults, slots, creación y formato de tabla) refrescan automáticamente el JSON vinculado cuando el kernel tiene binding activo.
3. El formato persistido conserva `schema_version=1.1`, `template`, `docx_base64` y `semantic_style_slots` top-level; el DOCX mirror legacy queda solo como compatibilidad/migración.
4. La UI del editor agrega la acción `Anidar plantilla` y estados explícitos de vínculo para distinguir plantilla activa runtime de plantilla persistida por notebook.

**Archivos:** `backend/app/services/template_binding.py`, `backend/app/routers/templates.py`, `backend/app/routers/notebook_template.py`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/TemplateEditor.css`, `backend/tests/test_template_binding.py`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `docs/modules/17-template-editor.md`, `docs/changelog/17-template-editor.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/system-context.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-05-08 - Banco exhaustivo de pruebas del Template Editor

1. Se agrega `backend/tests/template_editor_bank_utils.py` para generar fixtures DOCX sintéticas y auditarlas desde OOXML: mínima, completa, localizada, Word-complete y corrupta, con estilos ocultos/latentes, tablas, headers/footers, SDTs/placeholders, `docDefaults` y propiedades avanzadas de Word.
2. Se agrega `backend/tests/test_template_editor_bank.py` para validar extracción, mutación, `word_style`, `word_defaults`, `style_visibility`, slots semánticos, tablas directas vs `tblStyle`, cuarentena/regeneración de DOCX corrupto y coherencia JSON↔DOCX.
3. Se agrega `frontend/tests/template-editor-bank.spec.ts` como E2E exhaustivo: upload+attach sin doble `template_attach`, navegación `Slots/Estilos/Diagnóstico`, edición rápida y `Word completo`, export/import JSON portable, cierre/reapertura, generación DOCX desde notebook, inspección OOXML y Workbench `audit`/`render_all_pages`.
4. El banco escribe reportes `summary.json` y `summary.md` en `output/template-editor-bank/<run-id>/` y se ignora ese directorio como artefacto generado.
5. La cobertura encontró y fijó una regresión real en mutaciones OOXML: helpers de `template_service.py` ya no usan truthiness de `ElementTree` para reutilizar nodos vacíos, por lo que propiedades como `w:kern` y `w:spacing` se sobrescriben correctamente.

**Archivos:** `backend/tests/template_editor_bank_utils.py`, `backend/tests/test_template_editor_bank.py`, `frontend/tests/template-editor-bank.spec.ts`, `.gitignore`, `backend/app/services/template_service.py`, `frontend/src/App.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `docs/modules/17-template-editor.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`, `docs/changelog/17-template-editor.md`

---

## 2026-05-08 - Carga determinística y edición Word completa práctica

1. El WebSocket global de plantillas agrega cola acotada de mensajes críticos, flush ordenado tras reconnect, deduplicación por `request_id`/attach key y retorno booleano de `sendMessage()` para que `template_attach` no se pierda cuando el socket aún está cerrando o reabriendo.
2. `App.js` centraliza el attach por token: upload/import REST solo producen `template_token`, el latch `lastTemplateAttach` queda `pending` hasta ACK `template_uploaded`/`template_info`, y los errores limpian el estado pendiente sin disparar doble attach.
3. `useTemplateMessageHandler` rehidrata payloads autoritativos también desde `template_style_created` y `template_format_applied`, evitando `template_get` redundante y drift después de mutaciones de tabla/estilo.
4. `_sanitize_persisted_template_if_needed()` ya no devuelve JSON stale tras cuarentenar un DOCX corrupto: regenera el DOCX, reextrae metadata compatible, preserva slots válidos y persiste DOCX/JSON coherentes.
5. `_write_docx_parts()` adopta escritura ZIP temporal con validación y `os.replace()` con retry, alineada con el hardening de `save_template`.
6. `template_update_style` y `template_update_document_defaults` aceptan campos aditivos `word_style`, `word_defaults` y `style_visibility`; la extracción publica estilos ocultos/latentes con metadata OOXML y la UI los filtra por defecto con toggle `Mostrar ocultos`.
7. `StyleEditPanel` incorpora modo `Word completo` con secciones estructuradas de identidad, galería, fuente, párrafo, listas, tablas y OOXML/raw, manteniendo el modo rápido existente.

**Archivos:** `frontend/src/hooks/useWebSocket.js`, `frontend/src/hooks/useTemplateMessageHandler.js`, `frontend/src/App.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/TemplateEditor.css`, `backend/app/services/template_service.py`, `backend/tests/test_template_storage_hardening.py`, `frontend/src/hooks/useWebSocket.test.js`, `frontend/src/hooks/useTemplateMessageHandler.test.js`, `frontend/src/components/template-editor/StyleEditPanel.test.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `docs/modules/17-template-editor.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`, `docs/changelog/17-template-editor.md`

---

## 2026-05-06 - Tablas estilo-derivadas sin borrado de bordes

1. `template_apply_table_format` deja de borrar propiedades del estilo destino cuando la tabla fuente no trae formato directo equivalente.
2. Si la tabla fuente referencia un `tblStyle`, backend resuelve ese estilo Word y copia su formato efectivo antes de aplicar overrides directos de la tabla.
3. `TableDirectFormatPanel` muestra cuándo una tabla proviene de un estilo Word y permite asignar ese estilo al slot `table_default` sin usar la ruta de formato directo.
4. Se agregan regresiones backend para preservar bordes destino y copiar bordes desde el estilo fuente, más cobertura frontend para asignar `table_default` desde la tabla de muestra.

**Archivos:** `backend/app/services/template_service.py`, `backend/tests/test_template_table_hardening.py`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/TableDirectFormatPanel.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/components/TemplateEditor.css`, `docs/modules/17-template-editor.md`, `docs/modules/01-document-generation-docx.md`, `docs/changelog/17-template-editor.md`

---

## 2026-05-06 - Persistencia atomica y quarantine de templates DOCX

1. `_write_template_files()` usa locks por `kernel_id`, temporales únicos, `fsync` y `os.replace()` con retry/backoff para escribir `template.docx` y `template.json`.
2. `_sanitize_persisted_template_if_needed()` detecta DOCX corruptos/no-ZIP, los mueve a `template.quarantine_*.docx` y regenera un DOCX limpio mínimo si `python-docx` está disponible.
3. Se agregan regresiones para escritura completa sin temporales colgando y quarantine/regeneración de templates corruptos.

**Archivos:** `backend/app/services/template_service.py`, `backend/tests/test_template_storage_hardening.py`, `docs/modules/17-template-editor.md`, `docs/changelog/17-template-editor.md`, `docs/llm-index.yaml`

---

## 2026-05-05 - Fuentes legacy con fallback Word visible

1. `StyleEditPanel` preserva borradores sucios de fuente, párrafo y tabla frente a props equivalentes reconstruidas, evitando que un cambio manual como `Arial` vuelva a `CG Times (W1)` antes de guardar.
2. `TemplateEditorContainer` sincroniza la selección de `Slots` por identidad estable (`selection_key`, `style_id`, `category`, `style_type`, `status`) en vez de comparar referencias del objeto `style`.
3. `fontUtils` conserva el nombre exacto del template para fuentes no instaladas y muestra el fallback Word detectado desde `font_table.fonts[].alt_name` cuando está disponible en `system_font_catalog`.
4. La cobertura backend prueba un DOCX con `Body Text`/`Textoindependiente` en `CG Times (W1)` y `altName="Times New Roman"`, y verifica que guardar `Arial` escribe `w:rFonts` en `ascii`, `hAnsi`, `cs` y `eastAsia` sin atributos theme conflictivos.
5. El reattach persistido desde Home y las mutaciones del editor usan el WebSocket global de plantillas para evitar que el socket dedicado del notebook deje un `template_attach` stale pisando un `template_update_style` reciente.

**Archivos:** `frontend/src/App.js`, `frontend/src/components/VisualizationPanel.js`, `frontend/src/components/DocxViewer.js`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/template-editor/StyleEditPanel.test.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/components/template-editor/fontUtils.js`, `frontend/src/components/template-editor/fontUtils.test.js`, `frontend/src/components/TemplateEditor.css`, `backend/tests/test_template_style_fallback.py`, `docs/modules/17-template-editor.md`, `docs/changelog/17-template-editor.md`

---

## 2026-05-05 - Preview interno automatico y Word nativo serializado

1. `TemplateEditorContainer` muestra un preview interno automatico en el rail al cargar o cambiar una plantilla, sin disparar Word ni dejar el estado pegado en generacion.
2. `StyleEditPanel` y `useStylePreviewPipeline` envian `preview_engine="word_native"` y `native_word_preview=true` solo cuando el usuario presiona `Preview Word nativo`.
3. `notebook_template.py` serializa previews Word nativos de estilos y tablas con un lock compartido y timeout de cola; `generate_style_preview()` usa Word nativo solo para esa ruta explicita y cae al preview interno si no hay imagen.
4. Se agregan regresiones frontend/backend y el E2E del editor verifica que la carga DOCX usa `template-internal-preview` y el boton `template-native-word-preview` sin render Word automatico.

**Archivos:** `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/template-editor/hooks/useStylePreviewPipeline.js`, `frontend/src/components/TemplateEditor.css`, `backend/app/routers/notebook_common.py`, `backend/app/routers/notebook_template.py`, `backend/app/services/template_service.py`, `backend/tests/test_template_table_hardening.py`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/components/template-editor/previewHooks.test.js`, `frontend/tests/template-editor.spec.ts`, `docs/modules/17-template-editor.md`, `docs/changelog/17-template-editor.md`, `docs/architecture/system-context.md`

---

## 2026-05-05 - Runtime defaults de tablas en preview

1. `_apply_table_runtime_defaults_to_preview_table()` cambia de `xml.etree.ElementTree` a OOXML nativo de `python-docx` para tablas de preview, eliminando el warning `CT_TblPr`.
2. Los previews de estilos de tabla vuelven a aplicar `tblLook`, `tblLayout` y `tblW` desde `table_style_runtime_defaults` sin introducir nodos inválidos en `styles.xml`.
3. Se agregan regresiones backend con `Document().add_table()` y frontend para ACK de slots semánticos, retry de preview de tablas y estabilidad al aplicar formato directo.

**Archivos:** `backend/app/services/template_service.py`, `backend/tests/test_template_table_hardening.py`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `docs/modules/17-template-editor.md`, `docs/changelog/17-template-editor.md`

---

## 2026-05-04 - Rehidratación de estilos y slots custom

1. `TemplateEditorContainer` consume los payloads `template_*_updated` como fuente autoritativa, refresca `templateInfo`, selección por `style_id`/slot y dirty state después del ACK real.
2. `StyleEditPanel` guarda cambios de fuente escritos manualmente o elegidos desde el picker sin bloquear por fuentes no instaladas en el host.
3. `App.js` separa notebook origen y mirror `.docx` al abrir plantillas desde Home, evitando que `Abrir plantilla` intente leer un DOCX como archivo binario editable.
4. `template_service.py` preserva `semantic_style_slots` al reextraer tras cambios de estilo o `docDefaults`, manteniendo IDs Word localizados como `Textoindependiente` y `Ttulo1`.

**Archivos:** `frontend/src/App.js`, `frontend/src/App.test.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/template-editor/StyleEditPanel.test.js`, `backend/app/services/template_service.py`, `backend/tests/test_template_style_fallback.py`, `docs/modules/17-template-editor.md`, `docs/changelog/17-template-editor.md`, `docs/modules/14-main-app.md`, `docs/changelog/14-main-app.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-05-01 - Slots con contexto central explícito

1. `TemplateEditorContainer` agrega slot semántico activo (`selectedSemanticSlotName`) y hace seleccionables las tarjetas de `Slots`.
2. La pestaña `Slots` muestra en el panel central el contexto `Slot -> Estilo Word asignado` antes del editor del estilo asociado, evitando que el usuario vea un editor genérico sin relación visible con el slot.
3. `Formato Directo` de tablas queda oculto dentro de `Slots` y se conserva disponible en `Estilos`, donde vive la edición completa de estilos Word.
4. Las regresiones frontend cubren slot activo inicial, cambio por tarjeta, persistencia al cambiar el selector de slot y disponibilidad de formato directo solo desde `Estilos`.

**Archivos:** `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/TemplateEditor.css`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `docs/modules/17-template-editor.md`, `docs/changelog/17-template-editor.md`

---

## 2026-05-01 - Workbench slots-first y rail de preview

1. `TemplateEditorContainer` pasa a un workbench de tres zonas: navegación `Slots/Estilos/Diagnóstico`, edición central y rail derecho de preview Word.
2. Se elimina el footer persistente y las acciones secundarias se agrupan en `Más acciones`, preservando import/export/delete sin duplicar CTAs.
3. `StyleEditPanel` mueve `Guardar Cambios` al header sticky, compacta grupos de controles y desplaza valores efectivos/OOXML a inspección colapsada.
4. `TableDirectFormatPanel` separa selección/preview de tabla de la acción explícita de aplicar formato al estilo.
5. Se actualizan pruebas unitarias y E2E para navegación slots-first, menú secundario, preview rail y guardas responsive.

**Archivos:** `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/template-editor/TableDirectFormatPanel.js`, `frontend/src/components/TemplateEditor.css`, `frontend/src/components/Icons.js`, `frontend/src/components/DropdownMenu.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/components/template-editor/StyleEditPanel.test.js`, `frontend/tests/template-editor.spec.ts`, `docs/modules/17-template-editor.md`, `docs/architecture/frontend-flow.md`, `docs/changelog/17-template-editor.md`

---

## 2026-05-01 - Apertura desde Home sin warning de profundidad

1. `TemplateEditorContainer` muestra `Cargando plantilla...` mientras Home reatacha una plantilla persistida, sin enseñar el estado vacío de forma transitoria.
2. El editor deduplica mensajes WS de template ya procesados y usa una huella estable del metadata para resetear previews solo cuando la plantilla realmente cambia.
3. `useTablePreviewQueue` evita crear objetos vacíos nuevos durante resets sin previews, reduciendo renders redundantes.
4. Las regresiones frontend cubren rerenders de metadata estable, mensajes `template_uploaded` repetidos y el estado de carga persistida.

**Archivos:** `frontend/src/components/DocxViewer.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/hooks/useTablePreviewQueue.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `docs/modules/17-template-editor.md`, `docs/changelog/17-template-editor.md`

---

## 2026-04-26 - Estado vacío con una sola zona de arranque

1. `TemplateEditorContainer` oculta CTAs de header/footer cuando no hay `templateInfo` y concentra el arranque en una acción primaria `.docx` y una secundaria JSON.
2. `TemplateEditor.css` ajusta la vista vacía para que el panel no muestre controles que aparentan funcionar antes de cargar plantilla.
3. La regresión frontend verifica que no existan acciones duplicadas en header/footer durante el estado vacío.

**Archivos:** `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/components/TemplateEditor.css`, `docs/modules/17-template-editor.md`, `docs/changelog/17-template-editor.md`

---

## 2026-04-25 - Panel Campos conectado al flujo Workbench

1. `TemplateEditorContainer` agrega acciones discretas en `Campos` para guiar envoltorio de placeholders `{{TAG}}`, prueba de relleno y validación previa de entrega.
2. El panel sigue leyendo OOXML real desde `content_controls` y placeholders detectados; no crea una ruta paralela de generación ni reemplaza el contrato Word-first de la plantilla.
3. La documentación alinea el flujo recomendado: detectar campos, envolver como SDT cuando corresponda, probar valores y validar el DOCX generado con Workbench.
4. La validación visual y delivery queda explícitamente fuera del montaje del editor: debe ejecutarse sobre el artefacto real desde Workbench, usando el cache visual bajo demanda.

**Archivos:** `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/TemplateEditor.css`, `docs/modules/17-template-editor.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-04-20 - Retiro de facades runtime ya sin callers

1. Se eliminan `backend/app/services/template_style_apply.py` y `backend/app/services/template_table_format.py` después de confirmar que el runtime consume directamente `app.services.template.mutation` y `app.services.template.table_format`.
2. No hay cambios de contrato WS/REST; el ajuste reduce superficie legacy muerta sin mover los caminos de compatibilidad que siguen activos en `template_service.py`, `template_upload` o import/export portable.
3. Las referencias históricas de entradas previas se conservan como contexto del refactor original.

**Archivos:** `backend/app/services/template/mutation.py`, `backend/app/services/template/table_format.py`, `backend/app/routers/notebook_common.py`, `backend/app/routers/notebook_template.py`, `docs/modules/17-template-editor.md`, `docs/llm-index.yaml`

---

## 2026-04-19 - Slots semánticos persistidos y export portable `1.1`

1. `template_extract.py` y `template_service.py` agregan `semantic_style_slots` como bloque top-level persistido, alineando template editor, runtime DOCX y Word alrededor de slots semánticos en vez de overrides locales por categoría.
2. `TemplateEditorContainer` suma una banda de slots Word-first persistidos, mantiene `style_browser` solo como fuente de opciones/navegación y emite el contrato nuevo `template_update_semantic_slots`.
3. `useTemplateMessageHandler` rehidrata `template_semantic_slots_updated`, y el export/import portable sube a `schema_version=1.1` con `semantic_style_slots`, aceptando `category_overrides` solo como compatibilidad legacy.
4. El kernel DOCX se recarga ahora también con `semantic_style_slots`, de modo que `doc.text()` y el resto de defaults del builder queden alineados con la selección persistida en el editor.

**Archivos:** `backend/app/services/template_extract.py`, `backend/app/services/template_service.py`, `backend/app/routers/notebook_template.py`, `backend/main.py`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/hooks/useTemplateMessageHandler.js`, `frontend/src/contracts/wsMessageTypes.generated.js`, `docs/modules/17-template-editor.md`, `docs/modules/14-main-app.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-03-27 - Preview de estilos vuelve a preservar header/footer del template

1. `template_service.py` extrae la preparación del DOCX temporal de preview a un helper con flags explícitos (`clear_body`, `clear_header_footer`, `compact_page_setup`).
2. `generate_style_preview()` deja de vaciar `header/footer` por defecto; ahora limpia solo el body y conserva `headerReference` / `footerReference` junto con las partes `word/header*.xml` y `word/footer*.xml`.
3. La extracción del template pasa a leer `word/header*.xml` y `word/footer*.xml` directamente, recuperando texto visible aunque venga dentro de tablas o runs fragmentados del header/footer.
4. `TemplateEditorContainer` muestra en el sidebar un resumen read-only de encabezados/pies detectados y avisa que el DOCX/PDF visible se actualiza al reejecutar.
5. Se añaden regresiones backend/frontend para fijar tanto la preservación del preview como la detección/render de encabezados y pies.

**Archivos:** `backend/app/services/template_service.py`, `backend/tests/test_template_table_hardening.py`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `docs/modules/17-template-editor.md`

---

## 2026-03-25 - `Caption` visible en coverage y captions detectados desde el template

## 2026-03-25 - Modernización del editor, navegador por categorías y round-trip JSON portable

1. `template_extract.py` añade `style_browser` como vista navegable de todos los estilos detectados, separada de `style_coverage`, con categorías normalizadas (`titles`, `headings`, `body`, `lists`, `tables`, `code`, `captions`, `other`), `counts`, `category_order` y `auto_selected`.
2. Cada estilo visible en el editor recibe `selection_key` estable compuesto (`category|style_id|display_name[#N]`), permitiendo convivir con estilos duplicados y mantener updates seguros por `style_id`.
3. `TemplateEditorContainer` agranda y reorganiza el modal, reemplaza el sidebar lineal por navegador por categoría, auto-selecciona el primer formato válido y preserva `category_overrides` tras `template_uploaded`/refresh.
4. Se agrega `GET /api/templates/export?kernel_id=...`, que devuelve un envelope portable con `schema_version`, `exported_at`, `kernel_id`, `template`, `docx_base64` y `file_name`.
5. El editor incorpora importación JSON: valida envelope/version, decodifica el DOCX embebido, reutiliza `POST /api/templates/upload` + `template_attach` y restaura `category_overrides` sin crear mensajes WS nuevos.
6. Se agregan regresiones backend para clasificación `style_browser` y export portable, además de regresiones frontend para auto-selección, selección manual por categoría, import JSON y export con overrides.

**Archivos:** `backend/app/services/template_extract.py`, `backend/app/services/template_service.py`, `backend/app/routers/templates.py`, `backend/tests/test_template_style_fallback.py`, `backend/tests/test_template_export_api.py`, `frontend/src/components/TemplateEditor.css`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `docs/modules/17-template-editor.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-25 - `Caption` visible en coverage y captions detectados desde el template

1. `template_service.py` incorpora la categoría `captions` en `style_coverage` y añade `document_captions[]` al payload extraído desde `document.xml`.
2. La detección asocia captions a `table`/`figure`, expone posición (`before`/`after`), `style_id/style_name`, `uses_caption_style`, `has_seq_field` y `sequence_name`.
3. `StyleEditPanel` muestra un bloque read-only de captions detectados cuando el estilo seleccionado es `Caption`, y el preview fallback usa `Figura 1. Texto de ejemplo` en vez del pangrama genérico.
4. Se añaden regresiones frontend/backend para coverage, extracción estructural y render del panel.

**Archivos:** `backend/app/services/template_service.py`, `backend/tests/test_template_style_fallback.py`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/components/template-editor/StyleEditPanel.test.js`, `docs/modules/17-template-editor.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-24 - `Documento (Global)` editable materializa `docDefaults` reales

1. Se agrega el contrato dedicado `template_update_document_defaults` / `template_document_defaults_updated`, con `updates.font` y `updates.paragraph`, para editar texto/párrafo global del documento sin inventar un pseudo-style.
2. `StyleEditPanel` convierte `Documento (Global)` en un panel editable con controles de fuente y párrafo, mensaje fijo de alcance y sin preview Word dedicada en esta primera versión.
3. `template_service.py` escribe `w:docDefaults/w:rPrDefault/w:rPr` y `w:pPrDefault/w:pPr` en `styles.xml`, limpia `*Theme` al fijar una familia explícita, remueve nodos vacíos para reactivar herencia y recompone `template.json` con `document_defaults`.
4. `notebook_template.py` recarga inmediatamente la plantilla materializada en el kernel, por lo que `doc.text()` y párrafos sin estilo explícito ya heredan la fuente global real del documento mientras estilos explícitos como `Heading 1` se preservan.
5. Se agregan regresiones backend/frontend para contrato WS, persistencia OOXML de `docDefaults` y herencia runtime del texto base.

**Archivos:** `backend/app/services/template_service.py`, `backend/app/services/template/mutation.py`, `backend/app/routers/notebook_template.py`, `backend/app/contracts/ws_models.py`, `backend/main.py`, `backend/tests/test_template_style_fallback.py`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/hooks/useTemplateMessageHandler.js`, `frontend/src/hooks/useTemplateMessageHandler.test.js`, `frontend/src/components/template-editor/StyleEditPanel.test.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/contracts/wsMessageTypes.generated.js`, `docs/modules/17-template-editor.md`, `docs/modules/01-document-generation-docx.md`, `docs/modules/04-notebook-handlers.md`, `docs/modules/14-main-app.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-24 - Catálogo base compartido y persistencia OOXML estricta de fuentes

1. `fontUtils.js` pasa a ser la fuente única del catálogo de sugerencias de `Familia`: mezcla una base Office/Windows segura con `default_font`, `font_catalog`, `fontTable`, fuentes de theme, `system_font_catalog` y la selección local/resuelta sin duplicados case-insensitive.
2. `StyleEditPanel` deja de depender del `datalist` nativo y usa un picker propio, por lo que al abrir la lista ya no queda filtrada por el valor actual (`Calibri`) y vuelven a aparecer familias como `Century Gothic`, `Book Antiqua` o `Franklin Gothic Book`.
3. `template_service.py` endurece la persistencia de `font_name` explícito en `styles.xml`: `w:rFonts` ahora se escribe en `ascii`, `hAnsi`, `cs` y `eastAsia`, y se limpian atributos `*Theme` conflictivos para que Word/LibreOffice respeten la familia elegida en preview y DOCX/PDF final.
4. La extracción de template promueve ahora la fuente explícita dominante del cuerpo del documento cuando `Normal/docDefaults` solo resuelven una familia de theme genérica y el contenido real usa otra de forma consistente; esto corrige casos donde el template visualmente usa `Century Gothic` pero Word mantiene `Calibri` en `minorHAnsi`.
5. Se agregan regresiones frontend/backend para picker amplio, serialización `rFonts`, promoción de fuente dominante del cuerpo y preservación de herencia theme/docDefaults cuando el cambio no toca la familia.

**Archivos:** `frontend/src/components/template-editor/fontUtils.js`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/StyleEditPanel.test.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/components/template-editor/fontUtils.test.js`, `backend/app/services/template_service.py`, `backend/tests/test_template_style_fallback.py`, `docs/modules/17-template-editor.md`, `docs/modules/01-document-generation-docx.md`

---

## 2026-03-24 - Metadata de fuentes canónica y aviso de fuentes no instaladas

1. `template_service.py` pasa a persistir `default_font_source`, `resolved_font_source`, `font_source`, `system_font_catalog` y `builder_required_style_defaults`, además del `font_catalog`, para que editor y runtime usen la misma resolución efectiva de Word.
2. `TemplateEditorContainer` y `StyleEditPanel` comparten una utilidad de fuentes (`fontUtils.js`), alineando cards, panel, preview CSS y parser avanzado sobre `resolved_font` en vez de mezclar `font.name`, `font.font_name` o parsers divergentes.
3. La UI mantiene la familia libre del template y añade un aviso no bloqueante cuando la fuente no aparece en el host, sin reemplazarla por `Calibri`.

**Archivos:** `backend/app/services/template_service.py`, `backend/app/services/template_extract.py`, `backend/app/services/template_logic.py`, `backend/app/routers/notebook_common.py`, `backend/app/routers/notebook_kernel_control.py`, `backend/librerias_propias/docx_builder/session.py`, `frontend/src/components/template-editor/fontUtils.js`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/StyleEditPanel.test.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `docs/modules/17-template-editor.md`, `docs/modules/04-notebook-handlers.md`, `docs/modules/14-main-app.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`

---

## 2026-03-24 - Catálogo real de fuentes del template y picker editable

1. `template_service.py` extrae también `fontTable.xml`, resuelve `default_font` efectivo con `docDefaults`/`theme`/`Normal` y expone un `font_catalog` con fuentes reales del template.
2. `StyleEditPanel` deja de usar un `<select>` cerrado para `Familia`; ahora usa una entrada editable con sugerencias provenientes del propio template, por lo que fuentes como `Century Gothic` ya no quedan invisibles por no estar en un preset frontend.
3. `TemplateEditorContainer` pasa ese catálogo enriquecido al panel de edición y se añade una regresión frontend para fijar el caso “fuente efectiva fuera de la lista común”.

**Archivos:** `backend/app/services/template_service.py`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/StyleEditPanel.test.js`, `docs/modules/17-template-editor.md`

---

## 2026-03-24 - Recarga kernel con fallback seguro para estilos paragraph ausentes

1. La recarga de template hacia el kernel preserva cualquier estilo paragraph existente de la plantilla; `docx_builder` solo sintetiza estilos requeridos cuando el template no los define.
2. `List Bullet` y `List Number` ausentes ahora recuperan numeración Word por defecto en runtime, manteniendo la precedencia de la plantilla sin mutar `template.docx`.
3. Si una plantilla trae un estilo de lista roto o sin `numPr`, `builder.list()` degrada a marcadores visibles explícitos para evitar listas planas o contenido aparentemente desaparecido.
4. Se agregan regresiones backend con templates `.docx` manipulados para validar precedencia de estilo, recreación de listas y fallback visible.

**Archivos:** `backend/librerias_propias/docx_builder/session.py`, `backend/librerias_propias/docx_builder/builder.py`, `backend/tests/test_template_style_fallback.py`, `docs/modules/17-template-editor.md`, `docs/modules/01-document-generation-docx.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-15 - Ack-driven save, upload fallback estricto y cleanup real de previews

1. `StyleEditPanel` deja de limpiar baseline/dirty flags de forma optimista; el borrador local permanece hasta recibir `template_style_updated` y sobrevive a `template_error`.
2. `TemplateEditorContainer` separa errores HTTP funcionales del upload REST (`400`/`413`/`422`) de fallos de transporte: solo estos últimos pueden usar fallback a `template_upload` WS, y ese fallback se bloquea por encima de `6.5MB`.
3. `useStylePreviewPipeline` y `useTablePreviewQueue` ahora cancelan previews activas en timeout, unmount, reset y cambio de pestaña usando `template_preview_cancel`.
4. Las previews de tabla limpian su flag interno de “ya solicitada” en error/timeout y exponen reintento explícito desde la UI sin recargar la plantilla.
5. `app.core.state` poda el registro latest-wins de previews por kernel y elimina entradas completadas/canceladas para evitar crecimiento no acotado en sesiones largas.
6. Se agregan regresiones backend/frontend para save ack-driven, política de fallback REST→WS, cancelación de previews y pruning del registro de previews.

**Archivos:** `backend/app/core/state.py`, `backend/app/routers/notebook_common.py`, `backend/app/routers/notebook_template.py`, `backend/tests/test_template_preview_state.py`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/template-editor/TableDirectFormatPanel.js`, `frontend/src/components/template-editor/hooks/useStylePreviewPipeline.js`, `frontend/src/components/template-editor/hooks/useTablePreviewQueue.js`, `frontend/src/components/template-editor/StyleEditPanel.test.js`, `frontend/src/components/template-editor/TemplateEditorContainer.test.js`, `frontend/src/components/template-editor/previewHooks.test.js`, `docs/modules/17-template-editor.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-12 - Sanitización OOXML-safe para estilos de tabla y defaults runtime

1. `template_service.py` deja de serializar `tblW`, `tblLayout` y `tblLook` dentro de `w:style/w:tblPr`; ahora solo persiste propiedades válidas para estilos de tabla en `styles.xml`.
2. Se introduce `table_style_runtime_defaults` en `template.json` para conservar `look/layout/width` por `style_id`, mezclar esos valores sobre `resolved_table_format` y reutilizarlos en preview/generación notebook.
3. Se añade saneamiento automático de plantillas legacy: si `styles.xml` contiene `tblW/tblLayout/tblLook` inválidos bajo un estilo de tabla, el backend los extrae al sidecar runtime, reescribe la plantilla y conserva backup timestamped.
4. La recarga de template hacia kernel ahora propaga `table_style_runtime_defaults`; `docx_builder.session` los preserva y `builder.table()/dataframe()` reaplican `tblLook/tblLayout/tblW` sobre la tabla concreta en vez del estilo.
5. `NotebookEditor` incorpora `word_error` en la notificación de fallo de PDF para exponer la causa real cuando Word rechaza el DOCX.
6. Además del saneamiento de `styles.xml`, el backend ahora repara declaraciones `xmlns:*` faltantes en cualquier parte OOXML del paquete cuando `mc:Ignorable` referencia prefixes no declarados, corrigiendo plantillas persistidas que Word seguía rechazando como “archivo corrupto”.
7. Se agregan regresiones backend/frontend para update/apply/sanitizer legacy, reparación de namespaces OOXML y para la reaplicación runtime en `docx_builder`.

**Archivos:** `backend/app/services/template_service.py`, `backend/app/services/template_logic.py`, `backend/app/routers/notebook_common.py`, `backend/app/routers/notebook_template.py`, `backend/app/routers/notebook_kernel_control.py`, `backend/librerias_propias/docx_builder/session.py`, `backend/librerias_propias/docx_builder/builder.py`, `backend/tests/test_template_table_hardening.py`, `backend/tests/test_docx_builder_tracking.py`, `frontend/src/components/NotebookEditor.js`, `frontend/src/components/NotebookEditor.test.js`, `docs/modules/17-template-editor.md`, `docs/modules/01-document-generation-docx.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-11 - Storage de templates y tokens fuera del árbol instalado

1. `template_service.py` resuelve por defecto el directorio de templates en `INSPYRO_APP_STATE_DIR/templates` y agrega override explícito `INSPYRO_TEMPLATE_DIR`.
2. En despliegues que ya tenían plantillas en `backend/.templates`, el servicio intenta migrarlas al nuevo destino por defecto en el primer uso cuando el directorio nuevo está vacío.
3. `template_tokens.py` mueve sus blobs temporales al app-state dir (`INSPYRO_APP_STATE_DIR/template_tokens`) salvo override `INSPYRO_TEMPLATE_TOKEN_DIR`.

**Archivos:** `backend/app/services/workspace_service.py`, `backend/app/services/template_service.py`, `backend/app/services/template_tokens.py`, `backend/tests/test_system_workspace_api.py`, `docs/modules/17-template-editor.md`, `docs/architecture/system-context.md`

---

## 2026-03-08 - Reflejo MCP de template hacia el shell

1. Las tools MCP de template emiten `template_snapshot` y el shell puede actualizar `templateInfo`/`templateBlob` directamente sin esperar un `template_*` del websocket humano.
2. El flujo reflejado fuerza foco `docx` cuando el cambio afecta template o artefactos asociados, manteniendo la preview alineada con la acción remota.
3. No se introduce un nuevo contrato público `template_*`; el cambio es aditivo sobre `mcp_mirror_event`.

**Archivos:** `backend/mcp_server/tools/templates.py`, `frontend/src/App.js`, `frontend/src/hooks/useMcpMirror.js`, `frontend/src/components/VisualizationPanel.js`, `docs/modules/17-template-editor.md`, `docs/modules/14-main-app.md`, `docs/modules/19-mcp-server.md`

---

## 2026-02-12 - Fix de error tipado en `template_upload` para base64 inválido

1. Se corrige import faltante de `binascii` en `handle_template_upload`, que provocaba fallback genérico `template_upload_failed` en lugar del error tipado esperado.
2. `template_upload` vuelve a responder `template_error` con `error_code=invalid_docx_base64` cuando `docx_base64` es inválido.
3. Se valida con test router: `test_template_upload_invalid_base64_returns_typed_error`.

**Archivos:** `backend/app/routers/notebook_template.py`, `backend/tests/test_template_table_hardening.py`

## 2026-02-11 - Protección de tablas en headers/footers ante cambios de estilo

1. Se añade `_freeze_header_footer_table_styles()` en `template_service.py`: antes de modificar un estilo de tabla, escanea `word/header*.xml` y `word/footer*.xml`, copia las propiedades actuales del estilo como formato directo inline en las tablas que lo referencian, y remueve la referencia `<w:tblStyle>` para desacoplarlas del estilo.
2. Se integra la función en `_apply_table_style_updates()` (edición de estilo desde panel) y `apply_table_format_to_style()` (aplicación de formato directo detectado).
3. Se agregan 3 pruebas unitarias: desacople correcto, manejo de DOCX sin headers, y preservación de overrides inline existentes.
4. No hay cambios de contrato WS; el fix es transparente para el frontend.

**Archivos:** `backend/app/services/template_service.py`, `backend/tests/test_template_table_hardening.py`, `docs/modules/17-template-editor.md`

## 2026-02-10 - Paquete template backend y facades legacy

1. Se crea paquete `backend/app/services/template/` con módulos cohesivos:
- `storage.py`
- `preview.py`
- `mutation.py`
- `table_format.py`
- `xml_ops.py`
2. `template_storage.py`, `template_preview.py`, `template_style_apply.py` y `template_table_format.py` quedan como facades de compatibilidad hacia el paquete nuevo.
3. `notebook_common.py` consume el paquete `app.services.template.*` como punto primario de integración.
4. No se introducen cambios breaking en contratos WS de template.

**Archivos:** `backend/app/services/template/__init__.py`, `backend/app/services/template/storage.py`, `backend/app/services/template/preview.py`, `backend/app/services/template/mutation.py`, `backend/app/services/template/table_format.py`, `backend/app/services/template/xml_ops.py`, `backend/app/services/template_storage.py`, `backend/app/services/template_preview.py`, `backend/app/services/template_style_apply.py`, `backend/app/services/template_table_format.py`, `backend/app/routers/notebook_common.py`, `docs/modules/17-template-editor.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`

## 2026-02-10 - Flujo template por token y ejecución pesada fuera del event loop

1. Se añade upload REST `POST /api/templates/upload` con token efímero para plantillas grandes.
2. Se incorpora contrato WS aditivo `template_attach` para adjuntar `template_token` al `kernel_id` activo sin base64 obligatorio.
3. `TemplateEditorContainer` usa ruta REST + attach como flujo preferido y conserva fallback legacy `template_upload`.
4. Operaciones de template de mayor costo se delegan a ejecutor dedicado para reducir bloqueo del event loop bajo carga.

**Archivos:** `backend/app/routers/templates.py`, `backend/app/services/template_tokens.py`, `backend/app/routers/notebook.py`, `backend/app/services/template_service.py`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `docs/modules/17-template-editor.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

## 2026-02-10 - Consolidación real de submódulos template_extract/template_preview

1. `template_extract` incorpora lógica efectiva de `style_coverage` (deja de delegar de forma trivial).
2. `template_preview` pasa a ser owner de la caché LRU de previews por `kernel_id + preview_key`.
3. `template_service` mantiene API legacy y delega a ambos submódulos para compatibilidad backward.
4. No hay cambios breaking de contratos WS para frontend.

**Archivos:** `backend/app/services/template_extract.py`, `backend/app/services/template_preview.py`, `backend/app/services/template_service.py`, `docs/modules/17-template-editor.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`

## 2026-02-09 - Migración de tipos WS template a constantes compartidas

1. `TemplateEditorContainer` reemplaza tipos WS hardcodeados (`template_*`) por constantes generadas (`WS_MESSAGE_TYPES`).
2. Se conserva comportamiento de correlación por `request_id` y estado pending de mutaciones sin cambios funcionales.
3. El archivo generado se mantiene sincronizable vía `npm run generate:ws-types`.

**Archivos:** `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/contracts/wsMessageTypes.generated.js`, `frontend/scripts/generate_ws_types.mjs`, `docs/modules/17-template-editor.md`

## 2026-02-07 - Compatibilidad con errores globales de dispatcher WS

1. El flujo de template mantiene compatibilidad ante `type="error"` global emitido por dispatcher (ej: `invalid_json`, `unknown_message_type`, payload oversized).
2. Se conserva contrato específico `template_error` para fallos de dominio sin cambios de tipo.

**Archivos:** `backend/main.py`, `frontend/src/App.js`, `frontend/src/hooks/useTemplateMessageHandler.js`, `docs/modules/17-template-editor.md`

## 2026-02-07 - Refactor amplio frontend/backend del Template Editor

1. Frontend: `TemplateEditor.js` pasa a ser fachada y se introduce `TemplateEditorContainer` como orquestador principal.
2. Frontend: se extrae `StyleEditPanel` (edición de estilo) y `TableDirectFormatPanel` (tab de formato directo) para reducir acoplamiento del contenedor.
3. Frontend: se incorporan hooks especializados:
- `useStylePreviewPipeline` para cola/debounce/cache de preview de estilo.
- `useTablePreviewQueue` para cola serial de previews de tabla.
4. Frontend: se mantiene persistencia de tabla (`table_*` + bloque `updates.table`) y correlación por `request_id` en mutaciones template.
5. Backend: se modularizan entrypoints del dominio template en servicios especializados sin romper contrato:
- `template_storage`
- `template_extract`
- `template_style_apply`
- `template_preview`
- `template_table_format`
6. Backend: `notebook.py` migra consumo a módulos especializados, manteniendo compatibilidad de `template_service.py`.
7. Se actualizaron pruebas router/backend para nuevos imports modulares.

**Archivos:** `frontend/src/components/TemplateEditor.js`, `frontend/src/components/template-editor/TemplateEditorContainer.js`, `frontend/src/components/template-editor/StyleEditPanel.js`, `frontend/src/components/template-editor/TableDirectFormatPanel.js`, `frontend/src/components/template-editor/hooks/useStylePreviewPipeline.js`, `frontend/src/components/template-editor/hooks/useTablePreviewQueue.js`, `backend/app/routers/notebook.py`, `backend/app/services/template_storage.py`, `backend/app/services/template_extract.py`, `backend/app/services/template_style_apply.py`, `backend/app/services/template_preview.py`, `backend/app/services/template_table_format.py`, `backend/tests/test_template_table_hardening.py`

## 2026-02-07 - Seguridad de borrado, persistencia real de tabla y correlación de mutaciones

1. Se cerró path traversal en borrado de plantilla: `delete_template` ahora sanitiza `kernel_id` antes de resolver rutas.
2. `template_upload` valida `docx_base64` con decode estricto (`validate=True`) y emite `template_error` con `error_code=invalid_docx_base64`.
3. Mutaciones WS de template (`upload/update/delete/create/apply`) aceptan `request_id` aditivo y lo reflejan en respuestas de éxito/error.
4. `template_error` se estandariza con `error_code`, `message`, `error` (compat) y `request_id` opcional.
5. Frontend reduce límite de subida de plantilla a 6.5MB para no exceder límite WS tras base64/JSON.
6. `App.js` ahora procesa `type="error"` global para mostrar errores WS no tipados de template.
7. `Ctrl+S` se conecta al guardado real del `StyleEditPanel`; se elimina ruta de guardado duplicada no funcional en contenedor.
8. El panel de tabla persiste cambios reales (`table_*`) en `template_update_style`, incluyendo `updates.table` (aditivo) y mapeo a payload plano.
9. Backend soporta updates anidados (`font`, `paragraph`, `table`) con normalización a claves flat para compatibilidad retroactiva.
10. `update_template_style` invalida caché de preview backend y `_apply_table_style_updates` amplía cobertura (`layout`, `width`, `tblLook`, `cell shading`, `vertical align`).
11. Se añadió mapper dedicado `templateEditorMappers` y pruebas unitarias frontend.
12. Se ampliaron pruebas backend para `request_id` en éxito de `template_update_style`, invalidación de caché en update y validación base64 tipada.

**Archivos:** `backend/app/services/template_service.py`, `backend/app/routers/notebook.py`, `backend/tests/test_template_table_hardening.py`, `frontend/src/components/TemplateEditor.js`, `frontend/src/components/template-editor/templateEditorMappers.js`, `frontend/src/components/template-editor/templateEditorMappers.test.js`, `frontend/src/App.js`

## 2026-02-07 - Render manual determinístico y firma de tabla en preview key

1. `handleManualPreview` ahora solicita preview con `force=true`, evitando retorno inmediato desde caché.
2. `template_preview_style` se envía con `force_refresh` cuando corresponde y backend omite caché para ese request.
3. El `preview_key` ahora incluye `table_signature` para estilos de tabla (estructura `table/cell/variants`), de modo que cambios en formato de tabla invaliden la vista aunque font/párrafo no cambien.
4. Se limpian estados pending/in-flight por clave cuando el usuario fuerza render para evitar no-op al presionar `⟳ Renderizar`.
5. UX de preview endurecida: debounce centralizado, estado de carga visible desde fase encolada y mensajes explícitos “Renderizando/Actualizando” para evitar confusión cuando se muestra fallback CSS temporal.

**Archivos:** `frontend/src/components/TemplateEditor.js`, `frontend/src/components/TemplateEditor.css`, `backend/app/routers/notebook.py`

## 2026-02-07 - Coherencia de caché ante respuestas stale de preview

1. `template_preview_ready` en frontend ahora solo cachea imagen cuando la respuesta pertenece al request activo y al estilo esperado.
2. Respuestas tardías fuera de vuelo ya no rehidratan caché local ni reemplazan la primera preview post-apply.
3. Se elimina la contaminación de caché que provocaba render inicial genérico tras aplicar formato directo en tabla.

**Archivos:** `frontend/src/components/TemplateEditor.js`

## 2026-02-07 - Orquestación de preview sin carreras post-apply

1. Se rediseñó el pipeline de preview en `TemplateEditor` para tener un punto único de invalidación (`resetStylePreviewPipeline`) que cancela debounce, timeout e in-flight request antes de aceptar nuevos renders.
2. `request_id` de preview ahora es secuencial y único por sesión de edición (`tpl_prev_<timestamp>_<seq>`), mejorando correlación ante ráfagas de cambios.
3. `template_preview_ready/error` ahora solo actualiza UI cuando la respuesta corresponde al request activo (`preview_key`/`request_id` en vuelo), evitando que respuestas tardías sobrescriban la preview actual.
4. Se eliminó el `template_get` redundante después de `template_format_applied`; se usa el payload `template` ya devuelto por backend como única fuente de verdad para refrescar selección/estado.
5. Se eliminó el disparo manual adicional de preview post-apply y se dejó el refresco en la ruta normal del panel de estilo, reduciendo parpadeo y doble render no determinista.

**Archivos:** `frontend/src/components/TemplateEditor.js`

## 2026-02-07 - Fidelidad de preview “Estilo Word” tras apply de formato directo

1. `generate_style_preview` dejó de aplicar `_apply_style_to_docx` cuando `style_props` contiene solo metadatos (`style_type`, `category`, `style_id`), evitando reescrituras innecesarias del DOCX de preview.
2. Se reemplazó el `tblLook` hardcodeado en previews de tabla por resolución en cascada: `style_props` explícito -> `tblLook` real del estilo -> defaults seguros.
3. `_apply_style_to_docx` ahora intenta resolver primero por `style_name` y luego por `style_id`, evitando creación accidental de estilos nuevos cuando el nombre visible no coincide con el identificador interno.
4. Se agregaron pruebas unitarias para `preview_updates` meta-only, resolución de `tblLook` y fallback por `style_id`.
5. No hay cambios de contrato WS; se mantienen tipos y payloads esperados por frontend.

**Archivos:** `backend/app/services/template_service.py`, `backend/tests/test_template_table_hardening.py`

## 2026-02-06 - Hardening seguro de detección/apply de tablas

1. Validación estricta de `table_index` en handlers WS de tabla (`preview`, `create_style`, `apply_format`), con rechazo de valores no enteros/negativos y payloads de error correlables.
2. Doble validación defensiva en service para `generate_document_table_preview`, `create_table_style_from_format` y `apply_table_format_to_style` (tipo, no-negativo y rango).
3. Parser de bordes endurecido: `w:sz` no numérico ya no rompe extracción; se conserva parseo de estilo/color y `size_pt=None`.
4. Aplicación de variantes `firstRow` no destructiva: solo reemplaza cuando hay señal válida de encabezado; si no, preserva la variante existente.
5. Se agregaron pruebas de hardening para service y router en `backend/tests/test_template_table_hardening.py`.

**Archivos:** `backend/app/routers/notebook.py`, `backend/app/services/template_service.py`, `backend/tests/test_template_table_hardening.py`

## 2026-02-06 - Dispatcher WS no bloqueante y concurrencia robusta

1. Se separaron previews (`template_preview_style`, `template_table_preview`) a tareas en background desde el dispatcher de `/ws`.
2. Se agregaron semáforos de concurrencia para previews de estilo y tabla.
3. Se reforzó serialización de conversión Word/PDF para evitar contención y errores COM intermitentes.
4. Se añadió estrategia de timeout defensiva e invalidación de tareas al cerrar WebSocket.

**Archivos:** `backend/main.py`, `backend/app/routers/notebook.py`, `backend/app/services/pdf_converter.py`

## 2026-02-06 - Estabilidad de previews y sincronización UI

1. Se implementó cola secuencial de previews de tabla en frontend para evitar ráfagas duplicadas.
2. Se añadió correlación por `request_id`, timeout por preview y limpieza de estado stale.
3. Se normalizó respuesta de errores para incluir `kernel_id`/`table_index` cuando aplica.
4. Se mejoró matching de previews por `style_id` para evitar parpadeos y reemplazos erróneos.

**Archivos:** `frontend/src/components/TemplateEditor.js`, `backend/app/routers/notebook.py`

## 2026-02-06 - Integridad de apply desde formato directo

1. `apply_table_format_to_style` pasó a soportar apply por `style_name` y `style_id`.
2. Se amplió transferencia de propiedades OOXML (`tblPr`, `tcPr`, `tblStylePr firstRow`).
3. Se forzó refresco de `templateInfo` tras aplicar para evitar estado stale en panel de edición.

**Archivos:** `backend/app/services/template_service.py`, `frontend/src/components/TemplateEditor.js`

## 2026-02-06 - Desbloqueo de ejecución de notebooks

1. Se introdujo ejecución segura de código kernel desde handlers auxiliares (`_execute_kernel_code_safely`).
2. Se serializó `execute_cell` y `capture_variables_now` por `execute_lock` en `KernelSession`.
3. Se mitigó competencia entre operaciones de template y `notebook_execute_cell`.

**Archivos:** `backend/app/services/jupyter_kernel.py`, `backend/app/routers/notebook.py`

## 2026-02-05 - Refinamientos de usabilidad y preview

1. Fix visual del modal de preview para tablas grandes.
2. Invalidación de caché + refresco automático tras aplicar formato.
3. Extracción de propiedades de texto (`rPr`) para tablas detectadas.

**Archivos:** `frontend/src/components/TemplateEditor.css`, `frontend/src/components/TemplateEditor.js`, `backend/app/services/template_service.py`

## 2026-02-04 - v2.2: detección de tablas con formato directo

1. Extracción de tablas del documento con propiedades de formato directo.
2. Preview de tabla y conversión a estilo reutilizable.
3. Nuevos mensajes WS: `template_table_preview`, `template_table_preview_ready`, `template_create_style_from_table`, `template_style_created`.

**Archivos:** `backend/app/services/template_service.py`, `backend/app/routers/notebook.py`, `frontend/src/components/TemplateEditor.js`

## 2026-02-01 - v2.1: edición visual de estilos de tabla

1. Se incorporó panel completo de estilo de tabla (bordes, sombreado, márgenes, layout, variantes).
2. Se expandió parseo backend para `tblPr`, `tcPr` y variantes de `tblStylePr`.
3. Se incorporó dependencia explícita de PyMuPDF para pipeline de preview.

**Archivos:** `frontend/src/components/TemplateEditor.js`, `frontend/src/components/TemplateEditor.css`, `backend/app/services/template_service.py`

## 2026-01-31 - v2.0: hardening general del módulo

1. Se cerraron fixes críticos de locking, validación de upload y cleanup de procesos de preview.
2. Se añadió `request_id` para abortar respuestas stale.
3. Se incorporaron shortcuts, búsqueda de estilos y export JSON.

**Archivos:** `backend/app/services/template_service.py`, `backend/app/routers/notebook.py`, `frontend/src/components/TemplateEditor.js`

## 2026-01-25 - Modelo de estilos efectivos y preview real

1. Se incorporó resolución efectiva de estilos (`docDefaults`, `basedOn`, `theme`).
2. Se mejoró la preview real con plantilla y numeración preservada.
3. Se añadió modelo explícito/efectivo en UI con indicadores por campo.

**Archivos:** `backend/app/services/template_service.py`, `frontend/src/components/TemplateEditor.js`, `frontend/src/components/TemplateEditor.css`
