# Plantilla de Módulo (LLM-First)

> **Estado:** ✅/🟡/🔧
> **Ubicación:** `ruta/principal`
> **Última actualización:** 2026-02-06
> **Changelog:** `docs/changelog/<id>-<slug>.md`

---

## Propósito sistémico

Describir qué resuelve el módulo en el flujo global, no solo su implementación local.

## Entradas y salidas contractuales

### Entradas
- Mensajes WS/REST que consume.

### Salidas
- Mensajes WS/REST/eventos que produce.

## Dependencias y sinergias

- Upstream.
- Downstream.
- Módulos acoplados por estado compartido.

## Estado compartido y concurrencia

- Estado que posee.
- Locks/colas/semaforos/timeouts relevantes.

## Fallos frecuentes y observabilidad

- Fallos esperables.
- Señales de logs/métricas para diagnóstico.

## Archivos fuente y puntos de entrada

- Lista de archivos y funciones de entrada.

## Resumen de cambios recientes

- Resumen corto (3-10 bullets).
- Enlace al changelog detallado del módulo.