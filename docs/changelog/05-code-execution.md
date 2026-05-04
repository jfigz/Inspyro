# Changelog 05 - code-execution

> **Última actualización:** 2026-04-19

---

## 2026-04-19 - Corridas `.py` aisladas por archivo con cancelación explícita

1. `execute_code` pasa a correlacionarse por `run_id + file_path`; corridas de archivos distintos ya no se cancelan entre sí.
2. `_code_run_by_path` fija la política "una corrida activa por archivo", mientras `active_tasks` se indexa por `run_id` para soportar concurrencia real entre tabs.
3. Se agrega `cancel_code_execution`, usado por cierre de tab o cancelación explícita, y Home empieza a reflejar esos jobs vivos bajo `code_runtime_items` / `runtime_items`.

**Archivos:** `backend/app/routers/notebook_execution.py`, `backend/app/services/notebook_service.py`, `backend/app/services/home_compact.py`, `backend/main.py`, `backend/app/contracts/ws_models.py`, `backend/tests/test_ws_payload_validation.py`, `backend/tests/test_home_summary_backend.py`, `docs/modules/05-code-execution.md`, `docs/architecture/contracts-catalog.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`

---

## 2026-02-19 - Fix imports faltantes y tracking de tareas async PDF

1. Se añadieron `import subprocess` e `import tempfile` que faltaban y eran requeridos por `execute_code_isolated` (runtime `NameError` al invocar ejecución aislada).
2. Se añadió `add_done_callback` a `asyncio.create_task(_convert_pdf_background(...))` en la función `_convert_pdf_background` para prevenir warnings de excepciones no capturadas.

**Archivos:** `backend/app/services/notebook_service.py`, `docs/modules/05-code-execution.md`

## 2026-02-10 - Split estructural del router notebook

1. `handle_code_execution` se mueve a `backend/app/routers/notebook_execution.py`.
2. `backend/app/routers/notebook.py` queda como fachada de compatibilidad para imports existentes desde `main.py`.
3. Se preserva contrato WS `execute_code` sin cambios breaking.

**Archivos:** `backend/app/routers/notebook.py`, `backend/app/routers/notebook_execution.py`, `docs/modules/05-code-execution.md`

## 2026-02-06 - Inicialización del changelog

1. Se crea el changelog dedicado del módulo dentro de docs/changelog/.
2. El histórico detallado se moverá gradualmente desde la documentación de módulo.
