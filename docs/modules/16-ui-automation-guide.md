# 16 - UI Automation Guide

> **Última actualización:** 2026-03-15
> **Propósito:** guía operativa para automatización real de Inspyro desde navegador, con sandbox aislado y anclas estables de UI.
> **Changelog:** `docs/changelog/16-ui-automation-guide.md`

---

## Objetivo del harness

La automatización E2E canónica vive en `frontend/tests/` y levanta Inspyro en un sandbox temporal por corrida:

- `INSPYRO_APP_STATE_DIR` apunta a `%TEMP%\inspyro-e2e\<run-id>\app-state`
- `INSPYRO_DEFAULT_PROJECTS_ROOT` apunta a `%TEMP%\inspyro-e2e\<run-id>\projects`
- Los puertos aislados por defecto son `3010` (frontend), `8010` (backend) y `8110` (MCP)

Esto evita tocar el workspace humano y permite validar launcher, shell, notebook, template editor y MCP con datos reproducibles.

### Comando recomendado para agentes

```powershell
.\agent_debug.ps1 playwright-e2e
```

Opcional:
- `.\agent_debug.ps1 playwright-e2e responsive-smoke.spec.ts`
- `cd frontend; npm run test:e2e`
- `cd frontend; npm run test:e2e:keep -- responsive-smoke.spec.ts`

---

## Helpers principales

| Helper | Rol |
|--------|-----|
| `frontend/tests/helpers/inspyroHarness.js` | crea el manifest, prepara sandbox, siembra fixtures y restaura estado entre specs |
| `frontend/tests/helpers/seedWorkspace.js` | genera `main.py`, `notes.md`, `report.ipynb`, `quickstart.ipynb` y `sample-template.docx` |
| `frontend/tests/helpers/startInspyroSandbox.cjs` | levanta backend + frontend aislados |
| `frontend/tests/helpers/mcpClient.ts` | cliente MCP HTTP para `initialize`, `tools/list`, `resources/read` y `tools/call` |
| `frontend/tests/helpers/ui.ts` | navegación reusable de launcher, shell, selector de carpetas, árbol y Monaco |
| `frontend/tests/helpers/globalTeardown.cjs` | limpia sandbox solo cuando Playwright es dueño del lifecycle |

---

## Modos de arranque

### Modo autocontenido

`frontend/playwright.config.ts` crea un sandbox nuevo y arranca backend/frontend automáticamente.

### Modo harness externo

Para depurar o rerun múltiple sobre el mismo entorno:

1. Levantar `startInspyroSandbox.cjs` con un manifest ya generado.
2. Ejecutar Playwright con:
   - `INSPYRO_E2E_MANIFEST=<manifest>`
   - `INSPYRO_E2E_SKIP_WEBSERVER=1`

En este modo el teardown no destruye el sandbox, de forma que varios specs pueden reutilizar el mismo estado controlado.

---

## Fixtures semilla

### Workspace `inspyro-e2e`
- `main.py`
- `notes.md`
- `loads.csv`
- `report.ipynb`
- `sample-template.docx`

### Workspace `inspyro-recent`
- `quickstart.ipynb`

### Workspace `inspyro-alt`
- `alt-notes.md`

`restoreSeedFixtures()` limpia el árbol completo `projects/` antes de resembrar, así los workspaces creados por la UI durante una corrida no contaminan reruns posteriores.

---

## Selectores estables recomendados

### Launcher y workspace
- `launcher-create-project`
- `launcher-open-project`
- `launcher-recent-workspace`
- `explorer-workspace-button`
- `folder-selector-dialog`
- `folder-selector-up`
- `folder-selector-current-path`
- `folder-selector-workspace-name`
- `folder-selector-create-workspace`
- `folder-selector-item`
- `folder-selector-open-workspace`

### Explorador
- `explorer-new-file`
- `explorer-new-folder`
- `explorer-rename`
- `explorer-delete`
- `explorer-refresh`
- `explorer-search`
- `explorer-selection-bar`
- `file-tree-folder`
- `file-tree-file`
- `file-action-dialog`

### Notebook y visualización
- `notebook-toolbar`
- `notebook-toolbar-add-code`
- `notebook-toolbar-add-markdown`
- `notebook-toolbar-run-all`
- `notebook-toolbar-interrupt`
- `notebook-toolbar-reset-kernel`
- `notebook-toolbar-save`
- `notebook-toolbar-more-actions`
- `visualization-view-docx`
- `visualization-view-dependencies`
- `visualization-view-variables`
- `quantity-variable-card`
- `quantity-variable-target-unit`
- `quantity-variable-convert`

### Template editor
- `docx-template-button`
- `template-editor`
- `template-tab-direct`
- `template-apply-table-format`
- `template-close-button`

### MCP
- `mcp-status-button`
- `mcp-panel`
- `mcp-start`
- `mcp-stop`
- `mcp-restart`
- `mcp-tab-activity`
- `mcp-tab-info`
- `mcp-tab-logs`
- `mcp-panel-mirror-toggle`

---

## Suite E2E canónica

| Spec | Cobertura |
|------|-----------|
| `workspace-files.spec.ts` | launcher, cambio de workspace, create/edit/save/rename/delete |
| `notebook-docx.spec.ts` | run all, add cell, save/reload, clear outputs, interrupt/reset/shutdown, DOCX/PDF |
| `analysis-units.spec.ts` | variables, conversión de unidades, dependencias, sensibilidad, optimización |
| `template-editor.spec.ts` | upload template, preview y apply de tabla |
| `mcp-ui.spec.ts` | start/stop MCP, actividad, mirror en targets limpios y bloqueo sobre dirty |
| `responsive-smoke.spec.ts` | launcher, selector de workspace y notebook en viewport móvil |

---

## Reglas de sincronización UI

1. No asumir que la app arranca siempre en shell; puede caer en launcher si no hay `active_workspace`.
2. Para cambiar de workspace desde el picker, esperar que cambie `folder-selector-current-path` después de `Subir nivel`.
3. Crear/renombrar/eliminar archivos se hace por diálogo controlado; no usar `prompt()` ni asumir APIs nativas del navegador.
4. En notebook, validar progreso por estado visible y mensajes terminales, no solo por tiempo fijo.
5. En MCP, arrancar el servidor desde la UI antes de usar el cliente HTTP externo.
6. Si el recurso objetivo está dirty, validar conflicto visible y ausencia de replay local.

---

## Tiempos sugeridos

| Acción | Ventana sugerida |
|--------|-------------------|
| Carga inicial shell/launcher | 15-30 s |
| Cambio de workspace | 10-20 s |
| Ejecución notebook semilla | 30-120 s |
| Preview/apply template | 30-60 s |
| Start/stop MCP | 15-30 s |

---

## Cierre de validación recomendado

1. `.\agent_debug.ps1 playwright-e2e`
2. `.\agent_debug.ps1 verify-fast`
3. `.\agent_debug.ps1 mcp-smoke`
4. `.\agent_debug.ps1 docs-check`
