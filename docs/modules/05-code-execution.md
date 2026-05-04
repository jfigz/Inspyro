# 05 - Code Execution

> **Estado:** OK Integrado en el shell multi-tab
> **Ubicacion:** `backend/app/routers/notebook_execution.py` (`handle_code_execution`, `handle_cancel_code_execution`) + `backend/app/services/notebook_service.py` (`_execute_python_code_simple`) + `backend/app/services/home_compact.py`
> **Última actualización:** 2026-04-19
> **Changelog:** `docs/changelog/05-code-execution.md`

---

## Proposito

Ejecutar archivos `.py` desde el shell con jobs aislados por archivo:

- correlacionados por `run_id + file_path`
- concurrentes entre tabs/archivos distintos
- reemplazables solo dentro del mismo `file_path`
- visibles en Home aunque el editor ya no este montado
- cancelables de forma explicita al cerrar la tab o por accion del usuario

El modelo elegido no mantiene un interprete persistente entre corridas `.py`; cada run sigue siendo un job aislado.

---

## Archivos

| Archivo | Descripcion |
|---------|-------------|
| `backend/app/routers/notebook_execution.py` | `handle_code_execution`, `handle_cancel_code_execution`, registro `_code_run_by_path` |
| `backend/app/services/notebook_service.py` | `_execute_python_code_simple`, emision `execution_started/result/error`, captura DOCX/PDF |
| `backend/app/services/home_compact.py` | Runtime registry por `.py` (`code_runtime_items`, `runtime_items`) |
| `backend/main.py` | Dispatcher WS y cleanup de runs por conexion |

---

## Contratos WS

### Request `execute_code`

```json
{
  "type": "execute_code",
  "code": "print('hello')",
  "file_path": "C:\\workspace\\calc.py",
  "run_id": "code_run_123"
}
```

### Request `cancel_code_execution`

```json
{
  "type": "cancel_code_execution",
  "file_path": "C:\\workspace\\calc.py",
  "run_id": "code_run_123"
}
```

`cancel_code_execution` acepta `run_id` o `file_path`; con cualquiera de los dos el backend intenta resolver la corrida activa correcta.

### Responses

- `execution_started`: eco de `run_id` + `file_path`
- `execution_result`: resultado final + artefactos DOCX/PDF + `run_id` + `file_path`
- `execution_error`: error o cancelacion (`error_code="execution_cancelled"` cuando aplica) + `run_id` + `file_path`

---

## Flujo

1. `App.js` genera un `run_id` por archivo y envia `execute_code` con `file_path`.
2. Backend normaliza `file_path`, consulta `_code_run_by_path` y cancela solo la corrida previa de ese mismo archivo.
3. Corridas de archivos distintos se mantienen en paralelo en el mismo websocket.
4. `_execute_python_code_simple()` registra el runtime en `home_compact_store`, emite `execution_started` y ejecuta el codigo.
5. El resultado final actualiza `execution_result` o `execution_error`, y Home se refresca via `code_runtime_items` / `runtime_items`.
6. Cerrar la tab o cancelar explicitamente dispara `cancel_code_execution`; ir a Home, cambiar de tab o abrir otro archivo no corta el job.

---

## Estado compartido y concurrencia

1. `active_tasks` pasa a indexarse por `run_id`, no por websocket.
2. `_code_run_by_path[file_path]` fija la politica "una corrida activa por archivo".
3. Varias corridas `.py` de archivos distintos pueden convivir en paralelo.
4. El cleanup del websocket cancela solo las corridas asociadas a esa conexion.
5. `home_compact_store` conserva el runtime visible (`running/idle/error`) mientras la tab siga viva; al cerrar la tab o cancelar el job, ese runtime debe salir del resumen de Home.

---

## Testing

- `backend/tests/test_ws_payload_validation.py` valida `cancel_code_execution`.
- `backend/tests/test_home_summary_backend.py` fija que `/api/system/home-summary` exponga `code_runtime_items`.
- Smoke sugerido: correr dos `.py` de archivos distintos, volver a Home, cerrar una sola tab y verificar que solo esa corrida se corte y desaparezca del resumen.

---

## Observabilidad

Mensajes y campos relevantes:

- `execution_started.file_path`
- `execution_started.run_id`
- `execution_result.file_path`
- `execution_result.run_id`
- `execution_error.error_code`
- `overview.runtime_code_count` en `/api/system/home-summary`
