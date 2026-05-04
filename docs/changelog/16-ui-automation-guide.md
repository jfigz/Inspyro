# Changelog 16 - ui-automation-guide

> **Última actualización:** 2026-03-15

---

## 2026-03-15 - Harness Playwright aislado y suite E2E por superficies

1. La guía documenta el harness real de `frontend/tests/`, con sandbox temporal por corrida, fixtures sembradas y puertos aislados.
2. Se agrega el modo de reutilización de harness externo con `INSPYRO_E2E_MANIFEST` + `INSPYRO_E2E_SKIP_WEBSERVER=1`.
3. Quedan registrados los helpers canónicos, los `data-testid` estables y el comando de una sola orden `.\agent_debug.ps1 playwright-e2e`.

**Archivos:** `frontend/playwright.config.ts`, `frontend/package.json`, `frontend/tests/helpers/*`, `frontend/tests/*.spec.ts`, `agent_debug.ps1`, `docs/modules/16-ui-automation-guide.md`, `docs/agents/quickstart.md`, `docs/agents/task-routing.yaml`

---

## 2026-02-06 - Inicialización del changelog

1. Se crea el changelog dedicado del módulo dentro de docs/changelog/.
2. El histórico detallado se moverá gradualmente desde la documentación de módulo.
