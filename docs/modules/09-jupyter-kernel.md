# 09 - Jupyter Kernel Manager

> **Estado:** ✅ Modularizado
> **Ubicación:** `backend/app/services/jupyter_kernel.py`
> **Última actualización:** 2026-04-19
> **Changelog:** `docs/changelog/09-jupyter-kernel.md`

---

## Propósito sistémico

Gestionar sesiones Jupyter reales por `kernel_id`, ejecutar código Python, capturar outputs estructurados y exponer snapshots de variables para módulos de análisis.

## Entradas y salidas contractuales

### Entradas internas
- Llamadas desde `04-notebook-handlers` (`execute_cell`, restart/interrupt/shutdown).
- Llamadas desde `06-dependency-analyzer` para captura runtime (`capture_variables_now`).

### Salidas internas
- Tuplas de ejecución: `outputs`, `execution_count`, `variables_summary`, `extras`.
- Streams IOPub reenviados por callbacks a handlers WS con despacho desacoplado (`asyncio.create_task`) y backlog acotado.

## Dependencias y sinergias

### Upstream
- `jupyter_client`, `ipykernel`.

### Downstream
- `04-notebook-handlers` (núcleo de ejecución).
- `06-dependency-analyzer` / `07-sensitivity-analyzer` (enriquecimiento runtime).
- `17-template-editor` de forma indirecta por recargas de template.

## Estado compartido y concurrencia

1. `KernelSession` mantiene `manager`, `client` y `execute_lock` por sesión.
2. `execute_lock` serializa consumo de canales `shell/iopub` para evitar replies perdidos.
3. `capture_variables_now()` reutiliza el mismo lock para evitar carreras con `execute_cell()`.
4. Timeouts operativos configurables por entorno (`INSPYRO_KERNEL_TIMEOUT`, `INSPYRO_KERNEL_IDLE_TIMEOUT`).
5. `execute_cell()` puede sobrescribir aditivamente el timeout de ejecucion por llamada; `INSPYRO_KERNEL_TIMEOUT` ahora queda en `600s` como default low-level y no como limite rigido universal. En la ruta notebook-first, el caller llega alineado con ese mismo orden de magnitud desde UI/backend/MCP.
6. Backpressure de callbacks IOPub configurable con `INSPYRO_IOPUB_MAX_PENDING` para evitar acoplar ejecución del kernel a la latencia de envío WS/UI.
7. El callback IOPub desacoplado ya no compite llamando `send_text()` en paralelo sobre el socket compartido: `02-websocket-manager` serializa toda salida WS por conexión con cola FIFO + writer único.
8. Si el transporte saliente compartido se degrada y la cola se satura, la política vigente es reciclar la conexión (`1013/outgoing_queue_saturated`) antes que dejar el kernel wedgeado esperando flush indefinido.
9. Después de `execute_reply`, la espera por `status=idle` queda acotada por una gracia corta para no retener el cierre de la celda si el canal IOPub degrada.
10. La captura de variables puede degradar a snapshot previo del `KernelSession`; el cierre de ejecución no depende de que la captura silenciosa termine perfecta.
11. El serializador runtime evita `repr()` inseguro sobre contenedores pequeños y objetos arbitrarios; variables `ret_*` y proxies COM/interop se omiten o degradan a placeholders seguros para no colgar la celda.
12. `restart_kernel()` ya no reutiliza el mismo cliente ZMQ: recrea `client/channels` antes de volver a operar, evitando reintentos sobre threads cerrados o ya iniciados.
13. Si `execute_reply` vence o falla, el manager cancela los readers IOPub asociados a esa ejecución antes de propagar el error, evitando tareas zombi y contaminación del canal para la siguiente celda.
14. Lecturas benignas `Empty` en IOPub se degradan como timeout/ausencia temporal y ya no deben contaminar `execution_diagnostics` como error duro del canal.
15. El snapshot runtime de `execute_cell()` ya no transporta artefactos DOCX ni provenance por `user_expressions`; el kernel devuelve solo `outputs`, `execution_count`, variables y extras de runtime (`performance_data`, `execution_states`, `execution_diagnostics`).

## Fallos frecuentes y observabilidad

### Fallos frecuentes
- Timeout de ejecución por celdas largas o kernel saturado.
- Timeout aparente por no propagar el timeout del caller hasta `execute_cell()`; el síntoma ya no debe confundirse con contención de lock de `04-notebook-handlers`.
- Contención de lock si varios handlers compiten por el mismo kernel.
- Sesiones huérfanas por cierre abrupto.
- Saturación de callbacks IOPub cuando el consumidor WS/UI no drena suficientemente rápido.
- Degradación del transporte WS compartido si otro notebook/document pipeline ocupa la misma conexión; desde 2026-04-19 ese caso debe reciclar la conexión lenta antes de bloquear indefinidamente el kernel.
- Reinicio aparente de kernel con cliente inválido reutilizado, que dispara errores como `threads can only be started once` al primer comando posterior.
- Falso `iopub_error` si lecturas vacías benignas se clasifican como excepción inesperada y empujan a handlers superiores a rutas de recuperación innecesarias.

### Observabilidad
- `INSPYRO_NOTEBOOK_DEBUG=1` para trazas detalladas.
- Verificar cleanup en `shutdown_all_kernels()` durante cierre de app.

## Archivos fuente y puntos de entrada

- `backend/app/services/jupyter_kernel.py`

Puntos de entrada principales:
- `start_kernel()`
- `execute_cell()`
- `capture_variables_now()`
- `restart_kernel()` / `shutdown_kernel()` / `shutdown_all_kernels()`

## Resumen de cambios recientes

1. Se agregó `execute_lock` por sesión para serializar acceso a canales ZMQ.
2. `capture_variables_now()` y `execute_cell()` comparten lock para evitar carreras.
3. Se reforzó la integración con handlers de template para prevenir bloqueos cruzados.
4. Se desacopló el callback por mensaje IOPub con backlog acotado para reducir bloqueos de control plane cuando hay stream intenso.
5. Se consolidó la extracción de datos de `user_expressions` en un único helper (`_extract_ue_text`), reduciendo duplicación y eliminando corrupción UTF-8.
6. Se acotó `except Exception` en el loop IOPub a timeout específico con logging para errores inesperados.
7. Se amplió el allowlist de módulos reconocidos como variables de usuario.
8. El loop IOPub registra diagnósticos internos (`iopub_error`, `idle_missing`) y deja de seguir esperando indefinidamente tras `execute_reply`.
9. La captura de variables usa fallback al último snapshot válido y marca degradación interna (`variables_capture_timeout`) sin impedir que `04-notebook-handlers` emita `notebook_cell_executed`.
10. La serialización runtime ya no invoca `repr()` directo sobre objetos/contendedores no triviales; `ret_*` y objetos COM/interop se filtran o resumen con placeholders seguros para evitar bloqueos post-celda.
11. `restart_kernel()` recrea el cliente del kernel y reinicia canales limpios antes de devolver la sesión, evitando reusar threads ZMQ ya iniciados tras un reset.
12. `execute_cell()` acepta timeout por llamada y cancela readers IOPub pendientes cuando la espera de `execute_reply` vence, para que una celda larga fallida no deje el kernel en estado ambiguo.
13. El loop IOPub trata `Empty` como espera benigna y reserva `iopub_error` para fallos reales del canal, manteniendo la ruta de degradación graceful hacia `04-notebook-handlers`.
14. La integración notebook-first deja la materialización DOCX/PDF completamente fuera de `execute_cell()`: el runtime del kernel solo muta el estado documental y el coordinador de `04-notebook-handlers` exporta después del terminal.
15. El desacople IOPub ahora descansa sobre transporte WS serializado por conexión en `02-websocket-manager`; el kernel ya no depende de múltiples productores compitiendo directamente por `websocket.send_text()` cuando dos notebooks comparten la misma sesión UI.

Detalle histórico: `docs/changelog/09-jupyter-kernel.md`.
