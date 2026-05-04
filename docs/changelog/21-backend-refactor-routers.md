# 21 - Extracción de Estado Global y Desacoplamiento de Routers

> **Última actualización:** 2026-02-20

**Fecha:** 2026-02-20
**Complejidad Módulo:** Alta (Arquitectura Base)
**Status:** Mantenimiento completado (Propuesta de Refactorización Técnica)

## Resumen de Cambios

Se ha ejecutado la **Propuesta 1 de Mejora Arquitectónica** para reducir la complejidad técnica del backend y separar correctamente las responsabilidades (routers obesos vs. estado global), mejorando la mantenibilidad a largo plazo sin alterar los flujos lógicos existentes.

## Puntos Clave:

### 1. Centralización del Estado Global (`core.state`)
- **Problema Anterior:** `notebook_common.py` almacenaba variables en memoria como diccionarios de conexiones WS a kernels, bloqueos para previsualización (`_preview_latest_lock`) o ejecución (`_execution_state_lock`).
- **Solución:** Se creó `app/core/state.py` como un verdadero singleton para estado en tiempo de compilación. Las variables globales ahora importadas directamente limitan el desbordamiento lógico de un archivo rutero como lo era `notebook_common.py`.

### 2. Desacoplamiento de Reglas de Negocio (`template_logic.py`)
- **Problema Anterior:** Los handlers en `notebook_template.py` como `handle_template_upload` y `handle_template_attach` contenían validaciones muy profundas (decodificación Base64 exhaustiva, estimación de bytes, limitadores max).
- **Solución:** Se extrajeron los manejadores puros de negocio a un nuevo servicio de aplicación: `app/services/template_logic.py`. Ahora el router solo inyecta el ID del kernel y un payload de mensaje; limitándose a atrapar su `TemplateValidationError` personalizado y despacharlo por WebSocket.
- Se ha desacoplado el método `_apply_template_bytes_to_kernel` de la capa de routing compartida al archivo de la lógica que le corresponde (`template_logic.py`).

## Impacto
- Disminución del tamaño de `notebook_template.py` en aproximadamente un 6% y un código más declarativo.
- Reestablecimiento de todos las pruebas unitarias usando inyección de dependencias `AsyncMock` sobre los nuevos puntos de contacto (e.g., test de payload exagerado).
- Ejecución de limpieza de procesos y cierre de sesiones más robusta al centralizar la desconexión dentro del `state.py` que detiene kernels y limpia previsualizaciones atómicas.
