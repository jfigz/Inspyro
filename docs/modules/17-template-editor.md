# 17 - Template Editor

> **Estado:** ✅ Producción
> **Ubicación:** `frontend/src/components/TemplateEditor.js` + `frontend/src/components/template-editor/*` + `backend/app/services/template/` + `backend/app/services/template_service.py`
> **Última actualización:** 2026-05-09
> **Changelog:** `docs/changelog/17-template-editor.md`

---

## Propósito sistémico

Permitir edición visual de estilos DOCX de plantilla, generación de previews y aplicación de formato directo de tablas, manteniendo sincronía con el kernel y sin bloquear ejecución de celdas.

## Preview DOCX de ejemplo único (2026-05-09)

- El rail principal se renombra a `Preview DOCX de ejemplo` y deja de depender de previews aislados por estilo. El frontend toma el DOCX activo desde `GET /api/templates/export`, abre el paquete con `JSZip` y reemplaza solo `word/document.xml` por un body de muestra con titulos, cuerpo, captions, codigo, listas, tabla con estilo y tabla directa.
- El preview default renderiza ese mismo Blob DOCX con `docx-preview@0.3.7`, conservando `styles.xml`, `theme`, `numbering.xml`, `sectPr`, relaciones, media, encabezados y pies reales del template. Al cambiar estilo, slot, categoria, tabla directa, defaults o template, se vuelve a exportar el DOCX activo, se regenera el Blob y se enfoca verticalmente la seccion asociada sin ejecutar Word automaticamente ni desplazar horizontalmente la pagina.
- Cuando el template contiene tablas reales en el body, el bloque de `tabla directa` copia el OOXML de la tabla seleccionada en vez de recrearla; asi se preservan formato directo, shading, bordes, anchos, celdas y cualquier `tblStyle`/override que Word ya mostraba.
- Si el export del DOCX activo no esta disponible, el editor cae a un sample generado con `docx@9.6.1` y estilos `TplPreview_*`; esa ruta queda como fallback de disponibilidad, no como autoridad visual normal.
- El rail tiene ancho ajustable en desktop y el marco del documento conserva scroll horizontal visible (`scrollWidth > clientWidth` en la cobertura E2E) para revisar la pagina completa cuando el ancho del preview es menor que la hoja.
- `Preview Word nativo` queda como accion explicita sobre el mismo DOCX base64 mediante `POST /api/templates/sample-preview/render-word`. Backend devuelve paginas PNG completas (`preview_pages[]`) y warnings no bloqueantes si Word no esta disponible o falla.
- `Abrir DOCX` llama `POST /api/templates/sample-preview/open-default`: valida que el base64 sea un DOCX ZIP valido, lo guarda en un directorio temporal seguro del estado de la app y lo abre con la aplicacion por defecto del host.
- Upload/import siguen entregando solo `template_token` al shell: `App.js` conserva el ownership de `template_attach`, pero lo emite por el socket dedicado `/ws/notebook` de la libreta activa para que el ACK vuelva por la misma cola que consume el editor.
- `template_preview_style` y `template_table_preview` se mantienen para compatibilidad legacy, pero el Template Editor ya no los usa como preview principal del rail.

## Compatibilidad legacy de previews y recuperación de carga (2026-05-09)

- La correccion previa de previews por estilo queda preservada para clientes legacy que aun consumen `template_preview_style`/`template_table_preview`: cada imagen Word nativa se asocia estrictamente al `preview_key` activo y las respuestas stale se descartan.
- Los errores de Word nativo quedan como warning operativo no bloqueante. En el rail principal actual, la UI conserva el preview DOCX JS usable; en clientes legacy conserva el preview interno.
- `TemplateInternalPreview` sigue disponible como fallback/compatibilidad y refleja propiedades efectivas reales: fuente, color, tamaño, alineación, espaciados, sangrías, listas, captions, bloques de código, sombreado/bordes de párrafo y formato de tabla/celda (`tblLook`, layout, width, márgenes, sombreado de celda y alineación vertical).
- Los previews legacy generados desde PDF ya no deben estirarse ni descentrarse; el nuevo render Word del DOCX de ejemplo devuelve páginas PNG completas.
- El attach/upload de un DOCX corrupto o no-ZIP se convierte en `invalid_docx` recuperable. Si una plantilla vinculada queda en `missing` o `error`, el editor sale de `Cargando plantilla...` y muestra `Seleccionar DOCX` / `Importar JSON` junto al mensaje visible.
- La cobertura de banco ahora prueba fixtures mínima, completa, localizada y Word-complete sobre previews internos; cuando Word nativo está disponible valida el PNG bajo demanda por botón, sin ejecución automática al seleccionar estilos.

## Preview Word nativo con Word aislado (2026-05-09)

- `Preview Word nativo` y los previews de tabla que pasan por Word consumen el conversor común de `pdf_converter.py`, que crea una instancia Word aislada con `DispatchEx` y valida un PID propio antes de abrir el DOCX temporal.
- Si Word no puede aislarse porque COM devuelve una instancia existente o no verificable, el backend no cierra Word del usuario; la UI conserva el preview interno/fallback existente.
- `Word Live` no cambia: sigue usando el Word visible porque es un flujo explícito de edición humana.

## Editor Word/OOXML estructurado (2026-05-09)

- `backend/app/services/template/word_complete.py` define la matriz canónica de capacidades Word/OOXML por familia: identidad, visibilidad, fuente, párrafo, listas, tablas, globales y raw. El payload extraído incluye `word_capabilities` para que UI/tests conozcan qué es `supported`, `readonly`, `raw_only` o `unsupported`.
- El backend amplía `word_style.metadata` con `aliases`, `locked`, `autoRedefine`, flags personales y `rsid` readonly; `word_style.paragraph` ahora extrae y aplica `pBdr`/`shd` estructurados, además de tabs y flags avanzados ya existentes.
- `template_update_style` conserva el contrato actual y valida `advanced_props` raw antes de escribir nodos OOXML. Errores de forma se rechazan como `invalid_advanced_props.*` en vez de mutar parcialmente el DOCX.
- `template_update_document_defaults` acepta `word_defaults` con propiedades avanzadas de fuente/párrafo compartidas con estilos, materializándolas en `docDefaults` reales cuando son seguras.
- `StyleEditPanel` reemplaza la experiencia principal de JSON por pestañas tipadas: `Rápido`, `Fuente`, `Párrafo`, `Listas`, `Tabla`, `Identidad` y `Raw OOXML`; el JSON experto sigue disponible solo como escape hatch.
- La cobertura focalizada valida extracción → mutación → reextracción → OOXML real para metadata, fuente CS/East Asia, tabs, sombreado y bordes de párrafo, además de rechazo tipado del raw mal formado.

## Carga determinística y Word completo práctico (2026-05-08)

- El attach de plantillas queda centralizado en `App.js`: upload/import REST entregan `template_token`, un único helper emite `template_attach`, `lastTemplateAttach` pasa a `pending` solo si `sendMessage()` aceptó el mensaje y cambia a `attached` recién con ACK `template_uploaded` o `template_info`.
- `useWebSocket` mantiene una cola acotada para mensajes críticos de template cuando el WS global no está abierto, deduplica `template_attach` por kernel/token/path o `request_id`, flushea en orden tras reconectar y permite que la UI limpie pending/error cuando el envío no fue aceptado.
- `useTemplateMessageHandler` trata `template_style_created` y `template_format_applied` con `template` completo como ACK autoritativos, igual que `template_style_updated`, para rehidratar `templateInfo` sin hacer un `template_get` extra ni pisar drafts locales antes del ACK real.
- `StyleEditPanel` suma modo `Word completo` además del modo rápido: identidad OOXML, visibilidad/galería, fuente avanzada, párrafo avanzado, listas, tablas y bloque raw/unsupported quedan serializados en `updates.word_style`, `updates.style_visibility` y `updates.word_defaults` como campos opcionales.
- La extracción incluye estilos ocultos/latentes con metadata (`hidden`, `semiHidden`, `qFormat`, `uiPriority`, `unhideWhenUsed`); el navegador los oculta por defecto y el usuario puede activarlos con `Mostrar ocultos`.

## Tablas de muestra y estilos Word fuente (2026-05-06)

- Las tablas detectadas en el cuerpo del template distinguen ahora si su visual viene de un estilo Word (`tblStyle`) o de formato directo real. El panel de tablas muestra el estilo fuente y permite asignarlo al slot `table_default` sin pasar por una copia destructiva.
- `template_apply_table_format` mezcla primero el formato efectivo del `tblStyle` fuente y luego los overrides directos de la tabla concreta; si la fuente no trae bordes, sombreado o márgenes directos equivalentes, conserva las propiedades existentes del estilo destino en vez de vaciarlas.
- Esta corrección evita que plantillas con una tabla basada en `Grid Table 1 Light` borren los bordes de `Table Grid` al usar el editor, y mantiene `doc.table(..., style=None)` / `doc.dataframe(..., style=None)` gobernados por `table_default`.

## Persistencia robusta de plantillas (2026-05-08)

- `template_service.py` escribe `template.docx` y `template.json` con temporales únicos en el mismo directorio, `os.replace()` con retry/backoff y lock por `kernel_id`, evitando lecturas parciales o locks intermitentes de Windows.
- `_write_docx_parts()` usa ahora el mismo patrón de ZIP temporal validado + replace atómico, de modo que mutaciones de `styles.xml` y otros parts no dejen un DOCX parcialmente reescrito si Word/antivirus retiene el archivo en Windows.
- Si un DOCX persistido deja de ser un ZIP válido, el servicio lo mueve a `template.quarantine_*.docx`, regenera un DOCX limpio mínimo cuando `python-docx` está disponible, reextrae metadata desde ese DOCX regenerado y solo preserva `semantic_style_slots` que sigan resolviendo contra estilos vigentes.
- El JSON persistido después de la recuperación coincide con el DOCX regenerado y marca `metadata.recovered_from_corrupt_docx=true`; ya no se devuelve un `template.json` stale que describa un binario cuarentenado.
- La validación y regeneración ocurren en la capa de storage de templates, antes de reinyectar plantilla al kernel o construir previews, para que fallos de plantilla no obliguen a rutas manuales fuera de Inspyro.

## Plantilla JSON anidada al notebook (2026-05-08)

- El editor agrega la acción secundaria `Anidar plantilla`, que llama `POST /api/templates/bind` y convierte el template activo del kernel en un paquete JSON portable junto al notebook (`<notebook_stem>.inspyro-template.json` por defecto).
- El `.ipynb` queda parcheado con `metadata.inspyro.template_binding` y la UI conserva `templateBinding` dentro de la sesión notebook, mostrando `Vinculada`, `Perdida` o `Sin plantilla vinculada` en el header del Template Editor.
- Si `template_binding.status` llega como `missing` o `error`, el editor muestra un warning explícito; la ejecución sin plantilla sigue siendo válida y no fuerza dirty por hidratación runtime.
- Los ACKs autoritativos de edición (`template_style_updated`, `template_document_defaults_updated`, `template_semantic_slots_updated`, `template_style_created`, `template_format_applied` y reemplazo de template) reexportan automáticamente el JSON vinculado desde backend.
- Home trata el binding dentro del `.ipynb` como fuente canónica. El índice legacy `<workspace>/.inspyro/templates/index.json` y sus mirrors DOCX siguen como fallback, con acción visible de migración hacia JSON.
- El banco dedicado `template-binding-bank` valida el contrato completo de esta persistencia: fixtures válidas/missing/corruptas/inseguras, autoapply, Home, warning UI, mutaciones latest-wins y MCP live.

## Banco exhaustivo de pruebas (2026-05-08)

- `backend/tests/template_editor_bank_utils.py` genera en runtime un corpus DOCX sintético para pruebas de plantilla mínima, completa, localizada, Word-complete y corrupta, incluyendo estilos ocultos/latentes, listas, tablas, headers/footers, SDTs/placeholders, `docDefaults`, duplicados/localizados y propiedades OOXML avanzadas.
- `backend/tests/test_template_editor_bank.py` valida extracción, mutación y roundtrip de backend sobre ese corpus: `word_style`, `word_defaults`, `style_visibility`, slots semánticos, tablas directas vs `tblStyle`, variantes, cuarentena/regeneración de DOCX corrupto y coherencia JSON↔DOCX.
- `backend/tests/test_template_binding.py` es el subset rápido del binding JSON notebook-first: `POST /api/templates/bind`, rutas inseguras, JSON faltante/corrupto/schema inválido/base64 inválido, herencia workspace default, prioridad Home sobre legacy, aislamiento por kernel y autoexport latest-wins.
- `frontend/tests/template-editor-bank.spec.ts` ejecuta el tier E2E amplio: abre notebook, carga plantilla por upload+attach, confirma un solo `template_attach`, navega `Slots/Estilos/Diagnóstico`, edita modo rápido y `Word completo`, exporta/importa JSON portable, cierra/reabre, genera DOCX desde notebook, inspecciona OOXML y ejecuta Workbench `audit` + `render_all_pages` cuando el conversor PDF está disponible.
- `frontend/tests/template-binding-bank.spec.ts` ejecuta el banco live del binding: usa navegador real para upload/bind/warning/no-dirty, consulta Home, arranca MCP stateful, llama `bind_template_to_notebook`, recarga binding válido/missing, muta estilo por MCP y ejecuta un notebook sin bloquear aunque el JSON falte.
- Cada corrida del banco escribe `summary.json` y `summary.md` bajo `output/template-editor-bank/<run-id>/`, con escenarios, fixtures, artefactos DOCX/JSON, auditoría y razón estructural/visual de cualquier fallo. Ese directorio es artefacto generado y no forma parte del código fuente versionado.
- Las corridas de `template-binding-bank` escriben `summary.json` y `summary.md` bajo `output/template-binding-bank/<run-id>/`, con matriz requisito→escenario→resultado→artefactos.
- Gates focalizados recomendados: `pytest backend/tests/test_template_editor_bank.py -q`, `pytest backend/tests/test_template_binding.py -q`, `cd frontend; npm run test:e2e -- tests/template-editor-bank.spec.ts` y `.\agent_debug.ps1 template-binding-bank`. El tier rápido diario sigue cerrando con `.\agent_debug.ps1 verify-fast`; los bancos live quedan como cobertura exhaustiva para cambios del Template Editor y pre-release/nightly.

## Preview interno y Word nativo bajo demanda (2026-05-05)

- El rail del editor ya no dispara Word automáticamente al cargar o cambiar un `.docx`: `TemplateEditorContainer` muestra un preview interno automático construido en React/CSS desde las propiedades efectivas de fuente, párrafo y tabla.
- El render de Microsoft Word queda como acción explícita `Preview Word nativo`; esa ruta envía `template_preview_style` con `preview_engine="word_native"` y `native_word_preview=true`, por lo que no cambia contratos ni obliga a clientes legacy a adoptar campos nuevos.
- `handle_template_preview_style()` y `handle_template_table_preview()` comparten una cola/lock global de preview Word nativo con timeout (`INSPYRO_TEMPLATE_NATIVE_WORD_PREVIEW_QUEUE_TIMEOUT`) para impedir conversiones Word simultáneas que se pisen entre sí o dejen el editor en bucle de generación.
- `generate_style_preview()` conserva el motor genérico existente para clientes legacy, pero cuando se pide `word_native` usa solo Word nativo serializado; si Word no está disponible o no produce imagen, la UI vuelve al preview interno sin quedar pegada en estado loading.

## Fuentes legacy y fallback Word (2026-05-05)

- El editor preserva el nombre exacto de fuente declarado por el DOCX, incluso si el host no la tiene instalada. Por ejemplo, `CG Times (W1)` sigue visible como fuente del estilo y no se sustituye automáticamente.
- `font_table.fonts[].alt_name` se usa solo como diagnóstico visual: si el DOCX declara `altName="Times New Roman"` y esa familia existe en `system_font_catalog`, la UI muestra `Fallback Word detectado: Times New Roman` dentro del aviso de disponibilidad.
- `StyleEditPanel` no rehidrata `localFont`, `localParagraph` ni `localTable` desde props reconstruidas mientras existan cambios sin guardar. La rehidratación ocurre al cambiar la identidad estable del estilo/slot o cuando llega un ACK autoritativo que ya coincide con el borrador.
- `TemplateEditorContainer` compara la selección activa de `Slots` por `selection_key`, `style_id`, `category`, `style_type` y `status`, evitando que referencias nuevas del mismo objeto de estilo pisen un cambio local de fuente.
- `App.js`, `VisualizationPanel` y `DocxViewer` enrutan `template_attach` y mutaciones del editor por el WebSocket global de plantillas, no por el WebSocket dedicado del notebook. Esto evita que un reattach persistido stale o una ejecución de celdas solape/posponga `template_update_style` y vuelva a aplicar el DOCX legacy sobre un guardado reciente.
- Al guardar una fuente explícita como `Arial`, `template_update_style` sigue materializando `w:rFonts` en `ascii`, `hAnsi`, `cs` y `eastAsia` y limpia atributos theme conflictivos; no hay cambio de contrato ni migración de schema.

## Preview de tablas con defaults runtime OOXML (2026-05-05)

- `_apply_table_runtime_defaults_to_preview_table()` usa OOXML nativo de `python-docx` para aplicar `tblLook`, `tblLayout` y `tblW` sobre la tabla temporal de preview, evitando el warning `CT_TblPr` y reflejando `table_style_runtime_defaults` en la vista Word.
- La cobertura backend prueba una tabla real creada con `Document().add_table()`, remueve nodos runtime stale de la instancia de preview y verifica que los defaults frescos no se escriban mediante `xml.etree`.
- La cobertura frontend fija la rehidratación autoritativa de `template_semantic_slots_updated`, preservación de slots en export/import portable, retry de previews de tabla y estabilidad de selección al aplicar formato directo de tabla.

## Rehidratación autoritativa y estilos Word locales (2026-05-04)

- `TemplateEditorContainer` trata `template_uploaded`, `template_style_updated`, `template_document_defaults_updated` y `template_semantic_slots_updated` como payloads autoritativos: rehidrata `templateInfo`, resetea previews stale, conserva la selección por `style_id`/slot y limpia dirty state solo después del ACK efectivo.
- `StyleEditPanel` usa sets explícitos de claves editables para fuente y párrafo. El campo `Familia` acepta escritura libre y selección desde picker, y la advertencia de fuente no instalada sigue siendo no bloqueante para que Word resuelva la familia disponible al abrir/generar.
- La apertura desde Home separa el notebook origen del espejo `.docx`: `App.js` ya no envía el mirror de plantilla al lector binario de archivos, primero resuelve una `.ipynb` dueña y tokeniza el `.docx` solo para `template_attach`.
- `template_service.py` preserva `semantic_style_slots` al reextraer la plantilla después de `template_update_style` o `template_update_document_defaults`, manteniendo IDs reales de Word/idioma como `Textoindependiente`, `Ttulo1`, `Descripcin` o `Tablaconcuadrcula`.

## Workbench visual slots-first (2026-05-01)

- `TemplateEditorContainer` organiza la experiencia como workbench de tres zonas: navegación izquierda, edición central y rail derecho de preview interno con opción de `Preview Word nativo`. El header concentra estado, reemplazo DOCX, menú secundario (`Importar JSON`, `Exportar JSON`, `Eliminar plantilla`) y cierre; el footer persistente fue retirado para evitar acciones duplicadas y contenido tapado.
- La navegación izquierda prioriza uso real: `Slots` es la vista inicial para `body`, `heading_1..6`, listas, `caption`, `code` y `table_default`; `Estilos` aloja búsqueda, categorías detectadas y `Documento (Global)`; `Diagnóstico` agrupa página, campos SDT/placeholders, headers/footers y salud.
- En `Slots`, la tarjeta activa gobierna el panel central: se muestra el contexto `Slot -> Estilo Word asignado` y debajo se edita el estilo asociado. La edición directa de tablas queda reservada a `Estilos`, para que el slot sea una experiencia de mapeo semántico + edición del estilo asignado, no un navegador paralelo ambiguo.
- `StyleEditPanel` mantiene el guardado en header sticky, agrupa controles en bloques compactos (`Fuente`, `Párrafo`, `Sangría`, avanzado/table style) y mueve valores efectivos + OOXML a paneles `Inspección` colapsados.
- La preview interna sale del flujo obligatorio de edición y queda en un rail sticky en desktop; en anchos medianos/chicos baja como panel de apoyo dentro del flujo responsivo. El render Word nativo se solicita solo desde botón explícito y `TableDirectFormatPanel` separa selección/preview de tabla de la acción explícita `Aplicar`.
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
- `POST /api/templates/bind`
- `POST /api/templates/sample-preview/render-word`
- `POST /api/templates/sample-preview/open-default`

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

1. Estado frontend: estilo seleccionado, DOCX activo exportado en base64 para preservar el paquete Word real en el preview JS, Blob/base64/`preview_key` del DOCX de ejemplo, paginas Word nativas cacheadas solo para esa clave activa, estado de `Abrir DOCX`, request IDs, latch `lastTemplateAttach` (`pending/attached/error`) y attach one-shot emitido por `App.js` sobre el socket notebook activo para mantener ACK y editor en la misma cola.
2. Estado backend: template por kernel (`template/storage.py`), modelos `style_coverage` + `style_browser` (`template_extract.py`), sidecar `table_style_runtime_defaults` en `template.json` para defaults runtime de estilos de tabla (`tblLook/tblLayout/tblW`), envelope portable de export (`templates.py`), binding persistible por notebook (`template_binding.py`), cache del render Word del DOCX de ejemplo por `kernel_id + preview_key` y caché legacy de preview por `kernel_id + preview_key` (`template/preview.py`), con compatibilidad mantenida en `template_service.py`. Persistencia por defecto: `INSPYRO_APP_STATE_DIR/templates` para templates por kernel, `INSPYRO_APP_STATE_DIR/template_tokens` para uploads por token y subdirectorio seguro de estado para DOCX de muestra abiertos por defecto; `INSPYRO_TEMPLATE_DIR` e `INSPYRO_TEMPLATE_TOKEN_DIR` permiten override explícito fuera del árbol instalado. En paralelo, la home compacta mantiene el índice legacy `<workspace>/.inspyro/templates/index.json` como fallback/migración, pero el binding del `.ipynb` es la fuente canónica.
3. `App.js` mantiene `templateInfo` y `templateBlob` como source of truth frontend; si el cambio proviene de MCP, el shell puede actualizarlos directamente desde `template_snapshot` sin esperar un `template_*` del websocket humano.
4. Adjuntos por token: upload recomendado por REST (`/api/templates/upload`) + attach WS (`template_attach`) emitido por `App.js` hacia `/ws/notebook` de la libreta activa; `template_upload` permanece como fallback legacy. Upload/import solo generan `template_token`; el estado visible no se considera adjunto hasta ACK `template_uploaded`/`template_info`, y los intentos se deduplican por token/path/request para evitar doble attach después de reconnect. El import portable JSON reutiliza exactamente esa ruta y el export portable sale por `GET /api/templates/export`. Cuando la home necesita reabrir un template persistido por espejo de workspace, resuelve primero el notebook origen, usa `POST /api/templates/tokenize` para convertir ese `.docx` local en `template_token` efímero y nunca trata el mirror `.docx` como archivo editable/binario del shell.
5. Concurrencia:
- Semáforo de previews de estilo legacy.
- Semáforo de previews de tabla legacy.
- Lock global de Word/PDF para render nativo del DOCX de ejemplo y previews legacy, con timeout de cola para evitar solicitudes Word solapadas.
- Dispatch background para previews legacy en `/ws`; el preview principal usa endpoints REST auxiliares.
6. El estado latest-wins de previews legacy en backend se poda por kernel y elimina entradas completadas/canceladas para evitar crecimiento no acotado en sesiones largas; el cache del DOCX de ejemplo se invalida por `preview_key` y mutaciones de plantilla.
7. Frontend mantiene borradores locales de edición de estilo hasta recibir `template_style_updated`, `template_document_defaults_updated`, `template_semantic_slots_updated`, `template_style_created` o `template_format_applied` correlados; esos ACKs con `template` completo son autoritativos para rehidratar `templateInfo`, refrescar la selección por `style_id`/slot y limpiar dirty flags sin optimismo.
8. El fallback a `template_upload` WS queda reservado a fallos de transporte/no disponibilidad del upload REST; errores HTTP funcionales (`400`/`413`/`422`) se muestran en UI sin reenviar el archivo por WS.
9. Locks de kernel para operaciones que ejecutan código de recarga/template.
10. Operaciones pesadas de plantilla se ejecutan en pool dedicado (`ThreadPoolExecutor`) para proteger el event loop.
11. El shell puede forzar la vista `docx` cuando un cambio template reflejado por MCP actualiza preview o artefactos asociados.
12. Al recargar template en kernel, `docx_builder` preserva cualquier estilo paragraph existente de la plantilla; solo crea fallbacks runtime para estilos requeridos ausentes (`Heading 1-6`, `List Bullet`, `List Number`, `Code`, `Caption`) y nunca sobrescribe estilos ya definidos por el template.
13. La extracción de template resuelve ahora fuentes efectivas desde `styles.xml`, `docDefaults`, `theme1.xml` y `fontTable.xml`; además persiste `default_font_source`, `resolved_font_source`, `font_source`, `font_catalog`, `system_font_catalog` y `builder_required_style_defaults` en `template.json` para que UI y runtime lean la misma semántica.
14. `TemplateEditorContainer` y `StyleEditPanel` consumen una utilidad compartida de fuentes (`fontUtils.js`) para que cards, panel, preview CSS, serialización `rFonts` y parser avanzado usen la misma `resolved_font` efectiva, sin drift entre `font.name`, `font.font_name`, theme o docDefaults.
15. `fontUtils.js` mezcla una base Office/Windows segura con `default_font`, `font_catalog`, `fontTable`, fuentes de theme y `system_font_catalog`; el picker de `Familia` ya no depende del `datalist` nativo ni de un preset local estrecho, y al abrirse muestra sugerencias amplias aunque el valor actual sea `Calibri`.
16. El campo `Familia` sigue siendo editable libremente, usa claves editables explícitas para no perder `font_name` aunque no exista en el estado inicial y puede advertir de forma no bloqueante cuando la fuente elegida no aparece en el `system_font_catalog` del host; aun así conserva el nombre real del template y no lo sustituye por `Calibri`.
17. Si el template no define explícitamente la familia en `Normal/docDefaults` pero el cuerpo del documento usa otra fuente de forma consistente mediante formato directo, la extracción promueve esa familia como hint efectivo del documento; esto evita que el editor marque `Calibri/minorHAnsi` como valor efectivo cuando el contenido real viene en `Century Gothic`.
18. Cuando el usuario fija `font_name` explícito, el backend persiste `w:rFonts` en `ascii`, `hAnsi`, `cs` y `eastAsia`, limpiando atributos `*Theme` conflictivos; si la mutación no toca la familia, la herencia por `basedOn`/`docDefaults`/theme permanece intacta.
19. Cuando el kernel necesita sintetizar estilos requeridos ausentes, usa `builder_required_style_defaults` persistidos desde el template y deja de depender de `Calibri/Consolas` hardcodeados salvo que la propia plantilla resuelva a eso.
20. `Documento (Global)` deja de ser un panel solo lectura: expone controles editables de `Texto global` y `Párrafo global` para materializar `docDefaults` reales de Word sin reescribir estilos explícitos (`Heading 1`, `Caption`, `Code`, etc.).
21. El contrato dedicado `template_update_document_defaults` escribe `w:docDefaults/w:rPrDefault/w:rPr` y `w:docDefaults/w:pPrDefault/w:pPr` en `styles.xml`, reextrae el template y responde `template_document_defaults_updated` con el `template` completo ya recompuesto.
22. `template.json` persiste un bloque top-level canónico `document_defaults` con `font`, `paragraph`, `font_source` y `paragraph_source`, alineando editor, runtime DOCX y payloads WS sin depender de hints inferidos desde `document.xml`.
23. La sección `Documento (Global)` no solicita preview Word dedicada por estilo: la validación visual inmediata ocurre dentro del DOCX de ejemplo completo, y la validación final esperada sigue siendo el DOCX/PDF generado con la plantilla materializada, porque ahí es donde Word realmente consume `docDefaults`.
24. Las superficies scrollables del editor se reducen a zonas de ownership claro (`template-sidebar-panel`, `editor-main`, `template-preview-rail`) y adoptan `scroll-surface`, evitando scrolls anidados entre sidebar, listas internas y footer.
25. Después de cualquier reextracción por update de estilo o defaults globales, backend conserva `semantic_style_slots` por `style_id` para que plantillas Word localizadas no pierdan slots como `Textoindependiente` o `Ttulo1`.
26. El modo `Word completo` serializa propiedades avanzadas sin romper el modo rápido: `word_style.metadata`, `word_style.visibility`, `word_style.font/run`, `word_style.paragraph`, `word_style.list`, `word_style.table` y `word_style.raw/advanced_props` son opcionales y conviven con claves planas legacy.
27. La extracción publica `style_visibility` y `word_style` por estilo; los estilos ocultos o semiocultos se conservan en el modelo y se filtran solo en UI salvo que el usuario active `Mostrar ocultos`.

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
10. Preview Word nativo manual (`Preview Word nativo`) opera sobre el DOCX de ejemplo con `force_refresh`, bypass de caché frontend/backend y request nueva garantizada.
11. UX de preview comunica estado de pipeline (generando DOCX JS/renderizando Word/actualizando) y mantiene el preview DOCX JS como superficie estable mientras llega o falla el render Word nativo.
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
27. Los hooks de preview legacy cancelan trabajo activo en timeout, unmount, reset y cambio de pestaña mediante `template_preview_cancel`, incluyendo previews de tabla correladas por `request_id`.
28. La cola de previews de tabla permite reintento explícito tras error/timeout sin recargar la plantilla; el flag interno de “ya solicitada” se limpia en ramas fallidas.
29. Si el template no define estilos paragraph requeridos por la API DOCX, la sesión del kernel inyecta fallbacks seguros y, para listas rotas o sin `numPr`, `builder.list()` degrada a marcadores visibles explícitos en vez de dejar contenido plano/invisible.
30. El panel de estilos ya no “pierde” fuentes fuera de una lista cerrada: el campo `Familia` acepta cualquier nombre de fuente y ofrece sugerencias provenientes del template, del host y de una base Office/Windows compartida.
31. Al abrir el picker de fuentes, la lista ya no queda reducida al prefijo de la familia actual; esto evita el falso “solo veo variantes de Calibri”.
32. Una edición explícita de `font_name` ya no compite con `asciiTheme`/`hAnsiTheme`/`csTheme`/`eastAsiaTheme`: `styles.xml` conserva una sola resolución tipográfica efectiva para Word, preview y export final.
33. Los defaults globales del documento se escriben/remueven a nivel `docDefaults`; limpiar un campo en `Documento (Global)` vuelve a activar la herencia nativa de Word/theme en lugar de dejar un override vacío persistido.
34. El editor no inicia Word al cargar un `.docx`; el preview DOCX de ejemplo generado en frontend cubre la primera vista, y la ruta Word nativa queda detrás del botón `Preview Word nativo`.
35. `template_attach` no se marca como aplicado hasta recibir ACK; si el socket notebook activo no acepta el envío, la UI sale de `pending` con error explícito y evita quedarse en `Subiendo...` indefinido.
36. Después de upload/import REST no hay doble attach: `template_token` es un insumo de attach one-shot y el latch por token/path evita reenvíos equivalentes tras remount o reconnect.
37. `template_style_created` y `template_format_applied` pueden rehidratar `templateInfo` con el `template` autoritativo incluido en el ACK, manteniendo selección/drafts alineados sin polling extra.
38. Si un DOCX persistido se cuarentena por ZIP inválido, el backend reextrae metadata del DOCX regenerado antes de devolver/persistir JSON y preserva slots solo cuando siguen apuntando a estilos existentes.
39. Las mutaciones OOXML de parts DOCX se escriben por ZIP temporal validado y replace atómico con retry, reduciendo el riesgo de archivos parcialmente reempaquetados en Windows.
40. El preview DOCX JS normal preserva el paquete de la plantilla activa (`styles.xml`, headers/footers, media, numbering y `sectPr`) y solo sustituye el body de ejemplo; por eso los estilos que se ven en el editor corresponden al mismo DOCX que usara Word/notebook.

## Fallos frecuentes y observabilidad

### Fallos frecuentes
- Preview Word nativo timeout por conversión pesada, cola ocupada o entorno Word degradado; la UI debe conservar el preview DOCX JS automático.
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
- `frontend/src/components/template-editor/sampleDocxPreview.js`
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
- `backend/app/services/template/word_complete.py`
- `backend/app/services/template/xml_ops.py`
- `backend/app/services/template_extract.py`
- `backend/app/services/template_binding.py`
- `backend/app/routers/templates.py`
- `backend/app/routers/notebook_template.py`
- `backend/tests/template_editor_bank_utils.py`
- `backend/tests/test_template_editor_bank.py`
- `backend/tests/test_template_sample_preview_api.py`
- `backend/tests/test_template_binding.py`
- `frontend/tests/template-editor-bank.spec.ts`
- `frontend/tests/template-binding-bank.spec.ts`

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
48. `TemplateEditorContainer` adopta un workbench slots-first con header único, navegación `Slots/Estilos/Diagnóstico`, rail de preview interno/Word nativo y sin footer duplicado; `StyleEditPanel` mueve guardar al header sticky y colapsa inspección efectiva/OOXML.
49. El preview automático del rail pasa a motor interno React/CSS; Word nativo queda bajo demanda con cola backend serializada para evitar solapamientos.
50. El attach de plantillas queda determinístico: WS global con cola/dedupe, `sendMessage()` booleano, latch pendiente hasta ACK y upload REST sin doble `template_attach`.
51. El editor expone modo `Word completo` con payloads aditivos `word_style`, `word_defaults` y `style_visibility`, además de filtro por defecto para estilos ocultos/latentes extraídos desde OOXML.
52. La recuperación de DOCX corruptos ya no conserva JSON stale: cuarentena, regeneración, reextracción, slots válidos y escritura ZIP/JSON atómica mantienen binario y metadata sincronizados.
53. Se incorpora un banco exhaustivo reproducible del Template Editor con fixtures DOCX sintéticas, reportes `summary.json`/`summary.md`, cobertura backend de roundtrip/sanitización y E2E Playwright que valida upload+attach, edición Word-complete, import/export portable, generación DOCX y Workbench.

Detalle histórico completo: `docs/changelog/17-template-editor.md`.
