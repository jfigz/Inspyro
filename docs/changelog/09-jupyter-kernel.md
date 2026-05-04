# Changelog 09 - jupyter-kernel

> **Última actualización:** 2026-04-19

---

## 2026-04-19 - Documentado el aislamiento del transporte WS compartido para callbacks IOPub

1. La documentación del módulo deja explícito que los callbacks IOPub desacoplados ya no compiten directamente por `websocket.send_text()`; el transporte compartido se serializa en `02-websocket-manager` mediante cola FIFO por conexión y writer único.
2. También queda fijado contractualmente que, si el `/ws` compartido se satura, se prefiere reciclar la conexión antes de dejar el kernel wedgeado por flushs salientes interminables.

**Archivos:** `docs/modules/09-jupyter-kernel.md`, `docs/architecture/system-context.md`, `docs/llm-index.yaml`, `docs/changelog/09-jupyter-kernel.md`

---

## 2026-04-15 - El default low-level del kernel sube a 600s

1. `backend/app/services/jupyter_kernel.py` sube `INSPYRO_KERNEL_TIMEOUT` de `30s` a `600s`, alineando también las ejecuciones directas y callers legacy con el presupuesto notebook-first.
2. El timeout de `idle` y la gracia post-reply siguen cortos; el cambio apunta solo al runtime total permitido de `execute_cell()` cuando no llega override explícito del caller.

**Archivos:** `backend/app/services/jupyter_kernel.py`, `docs/modules/09-jupyter-kernel.md`, `docs/changelog/09-jupyter-kernel.md`, `AGENTS.md`

---

## 2026-04-15 - El kernel queda explícitamente detrás del presupuesto notebook de 600s

1. La documentación del módulo aclara que `INSPYRO_KERNEL_TIMEOUT` sigue siendo un default low-level, mientras la ruta notebook-first ahora llega con `execution_timeout_s=600` desde UI/backend/MCP.
2. Esto fija la responsabilidad correcta del módulo: ejecutar con el timeout que le propaga el caller, sin volver a introducir un límite universal más corto en notebooks grandes.

**Archivos:** `docs/modules/09-jupyter-kernel.md`, `docs/changelog/09-jupyter-kernel.md`, `docs/llm-index.yaml`

---

## 2026-04-13 - El kernel deja de transportar DOCX en el snapshot runtime

1. `execute_cell()` mantiene compatibilidad de firma, pero el camino genérico ya no usa `capture_docx` para poblar extras DOCX ni provenance desde `user_expressions`.
2. `_capture_variables_summary()` vuelve a enfocarse solo en variables, `performance_data` y `execution_states`, dejando la materialización documental al coordinador post-terminal de `04-notebook-handlers`.
3. Se agregan regresiones backend para fijar que la ejecución notebook produce un `DocumentJobRequest` interno en lugar de depender de `_document_pipeline_pending` / `_docx_recovery_pending`.

**Archivos:** `backend/app/services/jupyter_kernel.py`, `backend/app/services/notebook_service.py`, `backend/tests/test_mcp_server_remediation.py`, `backend/tests/test_docx_empty_handling.py`, `docs/modules/09-jupyter-kernel.md`, `docs/modules/04-notebook-handlers.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-04-13 - La ultima celda diferida deja de pedir captura DOCX al kernel

1. La integracion con `04-notebook-handlers` desactiva `capture_docx` cuando la exportacion DOCX final queda diferida a background, evitando que la ultima celda exportable espere `__INSP_NOTEBOOK_DOCX` en el reply terminal.
2. El kernel mantiene intacto el contrato de `outputs + variables + extras`, pero ahora el cierre terminal de la celda puede ocurrir sin payload DOCX inline cuando el documento se materializa despues.

**Archivos:** `backend/app/services/notebook_service.py`, `docs/modules/09-jupyter-kernel.md`, `docs/changelog/09-jupyter-kernel.md`, `docs/architecture/synergy-matrix.md`

---

## 2026-04-13 - `Empty` benigno en IOPub y degradación más precisa

1. El loop IOPub deja de clasificar lecturas benignas `Empty` como `iopub_error`; ahora las trata como espera temporal del canal y reserva diagnósticos de error para fallos reales.
2. Se añade regresión dedicada para proteger que `Empty` no contamine `execution_diagnostics`, manteniendo intacta la cobertura de errores reales del canal.

**Archivos:** `backend/app/services/jupyter_kernel.py`, `backend/tests/test_jupyter_kernel_resilience.py`, `docs/modules/09-jupyter-kernel.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-03-15 - Timeout por llamada y cleanup de readers IOPub

1. `execute_cell()` y `_execute_cell_locked()` aceptan override de timeout por llamada para no depender de un único `INSPYRO_KERNEL_TIMEOUT` global.
2. Cuando vence `execute_reply`, el manager cancela los readers IOPub pendientes antes de propagar el error, evitando tareas zombi y contaminación del canal para la siguiente celda.
3. Se agregan regresiones para propagación de timeout y cleanup en timeout de `execute_reply`.

**Archivos:** `backend/app/services/jupyter_kernel.py`, `backend/tests/test_jupyter_kernel_resilience.py`, `docs/modules/09-jupyter-kernel.md`, `docs/architecture/feature-threads.md`

---

## 2026-03-15 - Reinicio de kernel con cliente nuevo

1. `restart_kernel()` recrea el cliente y sus canales antes de devolver la sesión.
2. Se evita la regresión `threads can only be started once` tras reset.
3. Se añade cobertura específica para proteger el restart contra reutilización de threads ZMQ.

**Archivos:** `backend/app/services/jupyter_kernel.py`, `backend/tests/test_jupyter_kernel_resilience.py`, `docs/modules/09-jupyter-kernel.md`

---

## 2026-03-13 - Serialización segura de variables frente a COM/interop

1. La captura runtime deja de llamar `repr()` directo sobre contenedores pequeños, callables y objetos arbitrarios; ahora usa placeholders/metadatos seguros.
2. Variables temporales `ret_*` y proxies COM/interop (`comtypes`, `ctypes`, `win32com`, etc.) se omiten o degradan agresivamente para evitar cuelgues post-celda en notebooks como los de SAP2000.
3. Cuando la captura runtime cae en fallback, el kernel marca degradación explícita (`variables_capture_degraded`, `variables_snapshot_degraded`) sin impedir que el handler superior cierre la celda.

**Archivos:** `backend/app/services/jupyter_kernel.py`, `backend/tests/test_jupyter_kernel_resilience.py`, `backend/tests/test_units_kernel.py`, `docs/modules/09-jupyter-kernel.md`, `docs/architecture/feature-threads.md`, `docs/llm-index.yaml`

---

## 2026-02-19 - Refactor de extracción JSON, corrección Unicode y hardening IOPub

1. Se extrajo helper `_extract_ue_text()` a nivel de módulo para consolidar la lógica duplicada de parsing JSON desde `user_expressions` (~107 líneas reducidas a ~22).
2. Se eliminó `codecs.decode(s, 'unicode_escape')` que corrompía cadenas UTF-8 con caracteres acentuados.
3. Se acotó `except Exception` en el loop IOPub a `except (asyncio.TimeoutError, TimeoutError)` con `logger.warning` para errores inesperados.
4. Se añadió `logger.warning` cuando `_wait_for_idle` alcanza timeout, en lugar de retornar silenciosamente.
5. Se amplió el allowlist de módulos reconocidos como variables de usuario (`math`, `scipy`, `re`, `datetime`, `pathlib`, etc.).

**Archivos:** `backend/app/services/jupyter_kernel.py`, `docs/modules/09-jupyter-kernel.md`

## 2026-02-10 - Backpressure en callbacks IOPub

1. El envío de callbacks IOPub se desacopla con tareas async para evitar que un consumidor WS/UI lento bloquee el flujo de ejecución.
2. Se agrega backlog acotado de callbacks en vuelo (`INSPYRO_IOPUB_MAX_PENDING`) para limitar presión y memoria.
3. Se mantiene contrato runtime de mensajes (`notebook_stream`, `notebook_clear_output`, `notebook_update_display_data`, `notebook_comm_*`) sin cambios breaking.

**Archivos:** `backend/app/services/jupyter_kernel.py`, `docs/modules/09-jupyter-kernel.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`

## 2026-02-06 - Normalización documental LLM-first

1. Se reorganizó la documentación del módulo bajo plantilla canónica.
2. Se explicitó `execute_lock` como control central de concurrencia en sesiones de kernel.
3. Se enlazó el módulo con flujos E2E y matriz de sinergias.

**Archivos:** `docs/modules/09-jupyter-kernel.md`, `docs/architecture/feature-threads.md`
