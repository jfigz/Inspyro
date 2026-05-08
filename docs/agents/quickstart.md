# Quickstart de Agentes IA

> **Última actualización:** 2026-05-08
> **Objetivo:** dejar a un agente operativo en menos de 10 minutos con checks reproducibles.

---

## Flujo recomendado (10 minutos)

1. Verificar entorno y dependencias:
```powershell
.\agent_debug.ps1 bootstrap-agent
```

2. Ejecutar gate rápido antes de cambiar código:
```powershell
.\agent_debug.ps1 verify-fast
```

3. Leer contexto mínimo según tipo de cambio:
- cambio backend: `docs/llm-index.yaml`, `docs/architecture/contracts-catalog.md`, módulo backend afectado.
- cambio frontend: `docs/llm-index.yaml`, `docs/architecture/frontend-flow.md`, módulo frontend afectado.
- cambio WS/REST: `backend/main.py`, `docs/architecture/contracts-catalog.md`, `docs/llm-index.yaml`.

4. Si el objetivo es crear o refactorizar notebooks de Inspyro orientados al usuario, con flujo MCP notebook-first o con salida DOCX de reporte, usar la skill repo-local `.codex/skills/inspyro-notebook-authoring`.

5. Si el objetivo toca DOCX Workbench/calidad/entrega, leer también `docs/modules/01-document-generation-docx.md`, `docs/modules/14-main-app.md`, `docs/modules/17-template-editor.md` y `docs/modules/19-mcp-server.md`; validar `backend/tests/test_docx_quality.py`, tests MCP de documents y los tests frontend del visor/Home/Template.

6. Si tocaste `backend/mcp_server/` o la conectividad MCP, ejecutar smoke reproducible:
```powershell
.\agent_debug.ps1 mcp-smoke
```

7. Si tocaste binding JSON de plantilla por notebook, Template Editor, Home legacy de templates o herramientas MCP de template, ejecutar el banco dedicado:
```powershell
.\agent_debug.ps1 template-binding-bank
```

8. Si el objetivo es validar la app completa desde navegador real:
```powershell
.\agent_debug.ps1 playwright-e2e
```
Opcional:
- `.\agent_debug.ps1 playwright-e2e responsive-smoke.spec.ts`
- `cd frontend; npm run test:e2e`
- `cd frontend; npm run test:e2e:keep -- responsive-smoke.spec.ts`

9. Cerrar sesión con validación documental:
```powershell
.\agent_debug.ps1 docs-check
```

---

## Gates disponibles

1. `./agent_debug.ps1 contracts-check`:
- valida sincronía exacta entre `backend/main.py`, `docs/architecture/contracts-catalog.md` y `docs/llm-index.yaml`.

2. `./agent_debug.ps1 verify-fast`:
- `docs-check`
- `contracts-check`
- tests críticos backend (`test_websocket_dispatcher_hardening.py`, `test_contract_sync_guard.py`, `test_stress_ws_mix.py`, `test_template_binding.py`)
- tests frontend en modo CI.

3. `./agent_debug.ps1 verify`:
- `docs-check`
- `contracts-check`
- suite backend completa
- tests frontend en modo CI
- build frontend.

4. `./agent_debug.ps1 mcp-smoke`:
- valida `initialize`, `tools/list`, `resources/list`, `prompts/list` y `tools/call get_health` contra el servidor MCP real.

5. `./agent_debug.ps1 playwright-e2e`:
- levanta backend + frontend aislados en un sandbox temporal.
- siembra workspaces/notebooks/templates reproducibles.
- ejecuta la suite Playwright usando el harness recomendado para agentes.
- apaga el harness al terminar salvo que se use el modo `test:e2e:keep`.

6. `./agent_debug.ps1 template-binding-bank`:
- ejecuta el subset backend/frontend del binding JSON por notebook.
- levanta un harness Playwright real, arranca MCP stateful desde la UI y valida bind/reload/mutación/missing/ejecución.
- deja evidencia en `output/template-binding-bank/<run-id>/summary.json` y `summary.md`.

---

## Reglas de operación

1. No modificar contratos WS/REST sin actualizar documentación canónica en la misma sesión.
2. Si el dispatcher cambia, correr `contracts-check` antes de cualquier commit.
3. Usar `verify-fast` durante iteración y `verify` antes de merge.
4. Si cambias `backend/mcp_server/`, configuración MCP o docs del módulo 19, correr `mcp-smoke` con backend+MCP levantados.
5. Si cambias binding JSON de templates, correr `template-binding-bank`; para pre-release combinarlo con `mcp-smoke`, `mcp-torture` y el banco del Template Editor.
6. Para validación UI real, preferir `.\agent_debug.ps1 playwright-e2e` o `npm run test:e2e`; no rearmar el harness manualmente.
7. Si vas a crear o reescribir notebooks de Inspyro para lectura humana o salida DOCX, cargar primero la skill repo-local `.codex/skills/inspyro-notebook-authoring`.
8. No vincular capacidades DOCX al plugin `Documents` en runtime: las mejoras deben importarse como servicios propios de Inspyro (`docx_core`/Workbench) y verificarse con render nativo DOCX→PDF→PNG cuando aplique.
9. En modo agente MCP, el flujo documental recomendado es generar DOCX, ejecutar `check_document_quality(run=true, profile="agent")`, corregir notebook/template y llamar `prepare_document_delivery` solo al cierre.
10. Para QA visual MCP, pedir primero `run_document_workbench(operation="render_manifest")`; `render_page` y `render_all_pages` son acciones explícitas y devuelven handles `resource_uri`, no PNG/base64 inline.
