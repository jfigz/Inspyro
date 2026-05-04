# 07 - Sensitivity Analyzer

> **Estado:** ✅ Modularizado  
> **Servicio:** `backend/app/services/sensitivity_service.py`  
> **Handler:** `backend/app/routers/analysis.py` (`handle_sensitivity_analyze`)  
> **Última actualización:** 2026-02-21
> **Changelog:** `docs/changelog/07-sensitivity-analyzer.md`

---

## Propósito

Evaluar el impacto de cambios en variables de entrada sobre variables de salida **sin ejecutar el kernel principal**:
- Aplica `modified_variables`
- Evalúa fórmulas con `eval` en un namespace seguro
- Retorna los valores calculados para `output_variables`

---

## Archivos

| Archivo | Descripción |
|---------|-------------|
| `backend/app/services/sensitivity_service.py` | Servicio de cálculo |
| `backend/app/routers/analysis.py` | Handler `handle_sensitivity_analyze` |

---

## API WebSocket

### Request

```json
{
  "type": "sensitivity_analyze",
  "modified_variables": {"E": 210000, "bf": 250},
  "output_variables": ["sigma_total", "FS"],
  "formulas": {
    "sigma_total": "M / S",
    "FS": "phi * sigma_total"
  },
  "current_values": {"M": 100, "S": 500, "phi": 0.9}
}
```

### Response

```json
{
  "type": "sensitivity_result",
  "success": true,
  "results": {
    "sigma_total": 0.2,
    "FS": 0.18
  },
  "error": null
}
```

---

## Flujo de Cálculo

```mermaid
graph LR
    A[Inputs + formulas] --> B[Namespace seguro]
    B --> C[Aplicar modified_variables]
    C --> D[Resolver dependencias]
    D --> E[Evaluar output_variables]
    E --> F[sensitivity_result]
```

---

## Evaluación Segura

El analizador usa un namespace restringido con builtins básicos y `math`. Si hay `numpy` o `pandas`, se inyectan como `np`/`pd`.

---

## Integración con Frontend

`SensitivityPanel.js` construye:
- `modified_variables` desde sliders
- `formulas` desde `value_preview`
- `current_values` desde runtime

---

## Cambios Recientes

| Fecha | Cambio |
|-------|--------|
| 2026-02 | Revisión documental de seguridad para vector eval() |
| 2026-01 | API documentada con `modified_variables` y `output_variables` |