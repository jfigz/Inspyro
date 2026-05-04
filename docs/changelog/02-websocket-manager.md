# Changelog 02 - websocket-manager

> **Última actualización:** 2026-04-19

---

## 2026-04-19 - Cola saliente FIFO por conexión y writer único para aislar notebooks paralelos

1. `ConnectionManager` deja de llamar `websocket.send_text()` directamente desde múltiples productores; cada conexión ahora mantiene una cola saliente FIFO propia y un único writer task autorizado a drenar el socket.
2. Se adopta política `Protect notebooks`: si la cola saliente se satura, la conexión se recicla con `1013/outgoing_queue_saturated` en lugar de bloquear indefinidamente pipelines notebook/DOCX/PDF sobre el `/ws` compartido.
3. `runtime_metrics` agrega métricas públicas para profundidad, backlog, saturación y wait p95 de la cola saliente; además se añaden regresiones para serialización estricta de `send_text()`, FIFO por conexión, drenaje paralelo entre conexiones distintas y cierre por saturación.

**Archivos:** `backend/app/services/websocket_manager.py`, `backend/app/services/runtime_metrics.py`, `backend/tests/test_websocket_manager.py`, `docs/modules/02-websocket-manager.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`

## 2026-03-13 - Sanitización JSON estricta para payloads notebook con valores no finitos

1. `ConnectionManager` ahora normaliza payloads salientes antes de `json.dumps`, reemplazando `NaN`, `Infinity` y `-Infinity` por `null`.
2. El hardening se aplica a `send_personal_message()` y `broadcast()`, preservando compatibilidad con `JSON.parse` del frontend.
3. Se agregan regresiones backend para mensajes `notebook_cell_executed` y `notebook_progress_update` con números no finitos anidados.

**Archivos:** `backend/app/services/websocket_manager.py`, `backend/tests/test_websocket_manager.py`, `docs/modules/02-websocket-manager.md`

## 2026-02-10 - Concurrencia async-safe y optimización de broadcast

1. `ConnectionManager.connect()` y `disconnect()` protegidos con `asyncio.Lock` para evitar races en la lista de conexiones activas.
2. `broadcast()` serializa JSON una sola vez y envía texto crudo a cada conexión, eliminando re-serialización O(n).
3. `disconnect()` pasa a ser método `async` para compartir el lock.

**Archivos:** `backend/app/services/websocket_manager.py`, `docs/modules/02-websocket-manager.md`

## 2026-02-10 - Alineación documental de control plane y contratos aditivos

1. Se sincroniza documentación de dispatcher WS con priorización de control, cleanup por desconexión y contratos aditivos vigentes.
2. No hay cambios funcionales nuevos de runtime en esta entrada; se consolida trazabilidad documental.

**Archivos:** `docs/modules/02-websocket-manager.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

## 2026-02-09 - Dispatcher con control-plane prioritario y cleanup por desconexión

1. El dispatcher `/ws` separa control plane (`interrupt/reset/shutdown/cancel`) de trabajo pesado con semáforos por conexión para reducir head-of-line blocking.
2. Se incorporan contratos `notebook_cancel_execution` y `template_preview_cancel`.
3. Al desconectar socket se limpian kernels y recursos asociados a la conexión.

**Archivos:** `backend/main.py`, `backend/app/routers/notebook.py`, `docs/modules/02-websocket-manager.md`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`

## 2026-02-09 - Validación tipada de payload WS y gate de sincronía documental

1. Se incorpora validación aditiva de payload para mensajes WS críticos en `main.py` usando `backend/app/contracts/ws_models.py`.
2. Cuando falla validación, el dispatcher responde `type="error"` con `error_code="invalid_message_payload"` y `details.validation_errors`.
3. Se agrega gate `docs/tools/check_contract_sync.py` para comparar runtime (`main.py`) contra `contracts-catalog.md` y `llm-index.yaml`.

**Archivos:** `backend/main.py`, `backend/app/contracts/ws_models.py`, `docs/tools/check_contract_sync.py`, `docs/tools/validate_docs.ps1`, `docs/modules/02-websocket-manager.md`

## 2026-02-07 - Hardening de registro de conexiones y métricas WS

1. El endpoint `/ws` en `main.py` ahora usa `manager.connect()` en apertura y mantiene `manager.disconnect()` en cierre.
2. Se corrige consistencia de métricas de conexiones activas/total consumidas por `/health` y `/metrics`.
3. Se mantiene compatibilidad de contratos WS, agregando únicamente metadatos de error en payload global `type="error"`.

**Archivos:** `backend/main.py`, `backend/app/services/websocket_manager.py`, `docs/modules/02-websocket-manager.md`

## 2026-02-06 - Inicialización del changelog

1. Se crea el changelog dedicado del módulo dentro de docs/changelog/.
2. El histórico detallado se moverá gradualmente desde la documentación de módulo.
