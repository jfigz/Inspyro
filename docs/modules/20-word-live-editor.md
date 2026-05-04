# 20 - Word Live Editor

> **Estado:** Prototipo funcional + launcher local desde Inspyro
> **Ubicación:** `backend/app/routers/word_live.py` + `backend/app/services/word_live.py` + `word-addin/` + `frontend/src/components/DocxViewer.js`
> **Última actualización:** 2026-03-31
> **Changelog:** `docs/changelog/23-word-live-editor.md`

---

## Propósito sistémico

Exponer una ruta controlada para edición live de documentos Word dentro del host Word Desktop, usando `ContentControl` como anclas estructuradas y un bridge local REST hacia Inspyro para sincronizar regiones, validar alcance y reutilizar el hardening OOXML existente solo como capa offline de validación/export. Desde 2026-03-31, el módulo también incluye un launcher desde la UI de Inspyro que registra el add-in, lanza el host temporal de Office y abre el `.docx` elegido en la misma instancia de Word.

## Entradas y salidas contractuales

### Entradas (REST)
- `POST /api/word-live/session/open`
- `GET /api/word-live/session/state`
- `GET /api/word-live/regions`
- `POST /api/word-live/region/update-text`
- `POST /api/word-live/region/replace-fragment`
- `POST /api/word-live/session/resync`
- `POST /api/word-live/launcher/install`
- `POST /api/word-live/launcher/open`

### Salidas
- Estado serializado de `WordLiveSession` con `session_id`, `document_path`, `document_version`, `validation_status`, `warnings`, `unsupported_features`, `document_hash` y `regions`.
- Regiones tipadas `EditableRegion` con `region_id`, `kind`, `content_control_tag`, `allowed_ops`, `supports_ooxml_replace`, `locked`, `word_control_id?` y `text_preview`.
- Respuesta de launcher con `installed`, `registered`, `document_path`, `target_document_name`, `host_document_name`, `already_open`, `cancelled` y `message`.
- Assets del companion add-in servidos por FastAPI bajo `/word-addin/*` (`manifest.xml`, `taskpane.html`, `taskpane.js`, `assets/*.png`).

## Dependencias y sinergias

### Upstream
- `14-main-app` para exponer el CTA `Word Live` desde `DocxViewer`.
- `03-file-system-api` para resolver `document_path` seguro en disco.
- `01-document-generation-docx` para validación OOXML y reutilización del hardening de relaciones/paquete.
- Microsoft Word Desktop + Office.js como host real de edición.
- `npx` + `office-addin-dev-settings` y `pywin32` en Windows para el launcher local.

### Downstream
- Usuarios Word Desktop que necesiten abrir un `.docx` cualquiera con `Word Live` operativo sin navegar manualmente por la UI de Office.
- Flujos DOCX/PDF y templates que luego consuman el documento ya editado/guardado desde Word.

## Estado compartido y concurrencia

1. `word_live.py` persiste sesiones bajo `INSPYRO_APP_STATE_DIR/word_live/sessions`.
2. Cada sesión mantiene `document_version` y exige coincidencia opcional para evitar overwrite silencioso por clientes stale.
3. El bridge solo admite edición estructurada por región; si una región no soporta `update_text` o `replace_fragment`, devuelve error explícito.
4. `replace_fragment` valida el fragmento OOXML contra el tipo de región (`table`, `math`, `image`, `section-block`) antes de aceptar la mutación.
5. La validación de paquete completo se hace solo cuando llega un snapshot nuevo del documento (`docx_base64`) o cuando el caller pide refresco desde `document_path`; no se reescribe el `.docx` abierto por Word desde backend.
6. El launcher no persiste un “estado de instalación” propio adicional: registra el manifest vía `office-addin-dev-settings`, dispara el sideload del host temporal y automatiza Word para abrir/activar el documento real en la misma instancia.
7. Cuando el launcher abre el documento destino, minimiza la ventana host temporal de `Word add-in ...docx` para dejar al usuario en el `.docx` real con el task pane ya vivo.

## Fallos frecuentes y observabilidad

### Fallos frecuentes
- `document_path` ausente o no seguro.
- Documento sin `ContentControl`: la sesión abre, pero no aparecen regiones editables hasta que el add-in envuelve selección o hace resync con metadata live.
- `track_changes`, `comments` o `footnotes`: quedan marcados como `unsupported_features`.
- Reemplazo OOXML incompatible con el tipo de región (`table` sin `w:tbl`, `math` sin OMML, etc.).
- `document_version` stale en un cliente/add-in atrasado.
- `npx` o `office-addin-dev-settings` no disponibles en el host local.
- `pywin32` ausente en Windows, impidiendo automatizar la misma instancia de Word.
- Cancelación del selector nativo de `.docx`.

### Observabilidad
- `validation_status` (`ok`, `error`, `skipped`) y `validation_errors`.
- `warnings` para límites de alcance v1 (`headers_present_outside_v1_scope`, `footers_present_outside_v1_scope`).
- `last_action` para distinguir apertura, update de texto, replace OOXML y resync.
- Respuesta del launcher con `message`, `cancelled`, `already_open`, nombre del host temporal y documento real objetivo.

## Archivos fuente y puntos de entrada

- `backend/app/routers/word_live.py`
- `backend/app/services/word_live.py`
- `backend/tests/test_word_live_api.py`
- `word-addin/manifest.xml`
- `word-addin/taskpane.html`
- `word-addin/taskpane.js`
- `word-addin/taskpane.css`
- `frontend/src/components/DocxViewer.js`
- `frontend/src/components/DocxViewer.test.js`

Puntos de entrada principales:
- `POST /api/word-live/session/open`
- `POST /api/word-live/region/update-text`
- `POST /api/word-live/region/replace-fragment`
- `POST /api/word-live/session/resync`
- `POST /api/word-live/launcher/install`
- `POST /api/word-live/launcher/open`
- `word-addin/taskpane.html`

## Resumen de cambios recientes

1. Nuevo bridge REST `word-live` para sesiones/regiones estructuradas de Word Desktop.
2. Nuevo companion add-in servido desde FastAPI bajo `/word-addin/*`.
3. Extracción inicial de regiones `ContentControl` desde `word/document.xml` y resync live con metadata de Office.js.
4. Validación OOXML de fragmentos por tipo de región y reaprovechamiento del hardening existente para snapshots DOCX completos.
5. Cobertura inicial en `backend/tests/test_word_live_api.py` para extracción de regiones, rechazo de mutaciones inválidas, merge de metadata live y entrega de assets del add-in.
6. Launcher desde `DocxViewer` que registra el add-in, abre el selector nativo de `.docx`, dispara el sideload del host Word Live y activa el documento real dentro de la misma instancia de Word.
