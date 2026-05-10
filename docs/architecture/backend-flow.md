# Flujo del Backend

> **Archivo principal:** `backend/main.py`
> **Última actualización:** 2026-05-09
> **Contrato canónico:** `docs/architecture/contracts-catalog.md`

---

## Rol del backend

1. Exponer REST de sistema/archivos.
2. Recibir y enrutar mensajes WebSocket.
3. Coordinar servicios de kernel, template, análisis y conversión PDF.

---

## Dispatcher `/ws` (resumen)

- El dispatcher en `backend/main.py` enruta por `message.type`.
- Mensajes críticos de notebook se ejecutan en ruta directa.
- Previews legacy de template (`template_preview_style`, `template_table_preview`) se ejecutan en background; el preview principal del Template Editor usa REST (`/api/templates/sample-preview/*`) sobre el DOCX de ejemplo generado por frontend.
- El endpoint usa `manager.connect()` / `manager.disconnect()` para mantener métricas consistentes de conexiones.
- JSON inválido, payload no válido y tipos desconocidos retornan `type="error"` con `error_code` + `details` opcional.

### Mensajes entrantes canónicos

Ver lista completa en `docs/architecture/contracts-catalog.md` y `docs/llm-index.yaml`.

---

## Concurrencia y prioridades

1. Lock por `kernel_id` para operaciones notebook/template.
2. `execute_lock` por sesión kernel para proteger canales ZMQ.
3. Semáforos específicos para previews legacy de template y cola Word compartida para renders nativos.
4. Timeouts de lock/preview para evitar bloqueo indefinido.

---

## Servicios backend acoplados

| Servicio | Función |
|----------|---------|
| `jupyter_kernel.py` | ciclo de vida y ejecución del kernel |
| `template_service.py` | plantillas DOCX, extracción, previews legacy y render/apertura del DOCX de ejemplo |
| `pdf_converter.py` | DOCX→PDF + caché |
| `dependency_service.py` | análisis de dependencias/impacto |
| `websocket_manager.py` | envío de mensajes a clientes |

---

## Señales de health y observabilidad

- `GET /health`
- `GET /metrics`
- `GET /pdf-status`
- `/health` y `/metrics` incluyen contadores WS (`ws_connections_active`, `ws_connections_total`).
- logs condicionales con variables `INSPYRO_*_DEBUG`

---

## Lectura complementaria

1. `docs/architecture/system-context.md`
2. `docs/architecture/feature-threads.md`
3. `docs/modules/04-notebook-handlers.md`
4. `docs/modules/09-jupyter-kernel.md`
5. `docs/modules/17-template-editor.md`
