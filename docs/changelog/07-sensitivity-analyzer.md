# Changelog 07 - sensitivity-analyzer

> **Última actualización:** 2026-02-21

---

## 2026-02-21 - Vector de Seguridad Documentado

1. **Documentación Interna:** Se agregó un comentario explícito de seguridad destacando el riesgo del uso de `eval()` en `sensitivity_service.py` y detallando las mitigaciones actuales (ejecución solo local), como base de concientización para futuras integraciones de sandbox o parseadores restringidos como `ast.literal_eval`.

**Archivos:** `backend/app/services/sensitivity_service.py`

---

## 2026-02-06 - Inicialización del changelog

1. Se crea el changelog dedicado del módulo dentro de docs/changelog/.
2. El histórico detallado se moverá gradualmente desde la documentación de módulo.