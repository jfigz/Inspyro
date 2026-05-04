# Changelog 03 - file-system-api

> **Última actualización:** 2026-05-03

---

## 2026-05-03 - Apertura con aplicación por defecto

1. Se agrega `POST /api/files/open-default` para abrir archivos seguros y existentes con la aplicación por defecto del sistema operativo donde corre el backend.
2. El endpoint reutiliza la validación del filesystem, rechaza directorios/rutas inexistentes y mantiene la apertura como acción explícita del usuario.

**Archivos:** `backend/app/routers/files.py`, `backend/tests/test_files_api.py`, `docs/modules/03-file-system-api.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-04-13 - Límite configurable de lectura

1. Se introduce `INSPYRO_FILES_READ_MAX_BYTES` para controlar el tamaño máximo permitido en `GET /api/files/read` (default 100 MB) sin cambiar el contrato REST.

**Archivos:** `backend/app/routers/files.py`, `docs/modules/03-file-system-api.md`, `docs/changelog/03-file-system-api.md`, `AGENTS.md`

---
## 2026-03-29 - Explorer lazy, search y watcher del workspace

1. `files.py` deja de asumir árbol completo y pasa a responder carpetas en modo lazy con metadata por nodo (`hasChildren`, `writable`, `hidden`, `symlink`, `modified`, `relativePath`).
2. Se agregan `GET /api/files/search`, `POST /api/files/move`, `POST /api/files/copy` y `POST /api/files/duplicate`.
3. `file_watcher.py` introduce batches `workspace_fs_event` para refresco externo del shell con degradación segura cuando `watchdog` no está disponible.

**Archivos:** `backend/app/routers/files.py`, `backend/app/services/file_watcher.py`, `backend/main.py`, `backend/tests/test_files_api.py`, `backend/tests/test_file_watcher.py`, `docs/modules/03-file-system-api.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

---

## 2026-02-10 - Alineación documental de métricas referenciales

1. Se retiran/etiquetan métricas estáticas de líneas como referenciales para evitar deuda documental.
2. Se mantiene sin cambios el contrato REST y el comportamiento runtime del módulo.

**Archivos:** `docs/modules/03-file-system-api.md`

## 2026-02-09 - Desbloqueo de event loop en endpoints de archivos

1. Operaciones pesadas de árbol/lectura/escritura/creación/rename/delete pasan a `run_in_executor` para evitar bloqueo del loop async.
2. Se mantiene compatibilidad de payloads REST; el cambio es interno de orquestación/concurrencia.

**Archivos:** `backend/app/routers/files.py`, `docs/modules/03-file-system-api.md`

## 2026-02-06 - Inicialización del changelog

1. Se crea el changelog dedicado del módulo dentro de docs/changelog/.
2. El histórico detallado se moverá gradualmente desde la documentación de módulo.
