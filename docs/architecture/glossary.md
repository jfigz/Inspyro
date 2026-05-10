# Glosario Técnico Canónico

> **Última actualización:** 2026-05-09

---

## Términos clave

| Término | Definición operativa |
|---------|-----------------------|
| `kernel_id` | Identificador lógico de sesión Jupyter usada por notebook/template. |
| Lock por kernel | `asyncio.Lock` que serializa operaciones críticas sobre un mismo kernel. |
| `execute_lock` | Lock interno por sesión (`KernelSession`) para proteger canales ZMQ shell/iopub. |
| Dispatcher WS | Bucle principal en `backend/main.py` que enruta `message.type` a handlers. |
| Handler direct | Handler atendido en la ruta principal del dispatcher (sin tarea de fondo). |
| Handler background | Handler ejecutado con `create_task`, sin bloquear lectura del socket. |
| DOCX hash | Hash del DOCX exportado para deduplicar y cachear conversiones PDF. |
| Preview DOCX de ejemplo | Documento de muestra único generado por frontend para mostrar header/footer, títulos, cuerpo, captions, código, listas y tablas del Template Editor. |
| Preview de estilo | Ruta legacy de vista previa de un estilo Word generada por `template_service` para clientes no migrados al DOCX de ejemplo. |
| Preview de tabla | Ruta legacy de miniatura de tabla detectada en template DOCX. |
| `templateInfo` | Estructura frontend con metadatos/estilos de la plantilla activa. |
| `lastMessage` | Último mensaje recibido por WebSocket en hooks frontend. |
| Source of truth | Documento canónico que prevalece en caso de conflicto documental. |

---

## Prioridad de fuentes para IA

1. `docs/llm-index.yaml`.
2. `docs/architecture/contracts-catalog.md`.
3. `docs/architecture/feature-threads.md`.
4. Módulos detallados en `docs/modules/*.md`.

---

## Términos de estado compartido

| Estado | Owner canónico | Nota |
|--------|-----------------|------|
| Estado UI global | `frontend/src/App.js` | Tabs, paneles, notificaciones, template persistente. |
| Estado notebook en edición | `frontend/src/components/NotebookEditor.js` | Celdas, cola de ejecución, celda activa. |
| Estado kernel/backend | `backend/app/services/jupyter_kernel.py` | sesiones activas y locks por sesión. |
| Estado template backend | `backend/app/services/template_service.py` | estilos extraídos, cache de previews, archivos template. |
