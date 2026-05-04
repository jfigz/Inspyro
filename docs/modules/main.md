# Inspyro - Documentación de Módulos

> **Versión:** 2.0
> **Última actualización:** 2026-04-04
> **Punto de entrada:** `AGENTS.md` + `docs/llm-index.yaml`

---

## Ruta de lectura LLM-first

1. `docs/llm-index.yaml`
2. `docs/architecture/system-context.md`
3. `docs/architecture/contracts-catalog.md`
4. `docs/architecture/feature-threads.md`
5. Módulo específico en esta carpeta.

---

## Índice de módulos

### Backend

| # | Módulo | Archivo | Changelog |
|---|--------|---------|-----------|
| 01 | Document Generation DOCX/PDF | [01-document-generation-docx.md](./01-document-generation-docx.md) | [01](../changelog/01-document-generation-docx.md) |
| 02 | WebSocket Manager | [02-websocket-manager.md](./02-websocket-manager.md) | [02](../changelog/02-websocket-manager.md) |
| 03 | File System API | [03-file-system-api.md](./03-file-system-api.md) | [03](../changelog/03-file-system-api.md) |
| 04 | Notebook Handlers | [04-notebook-handlers.md](./04-notebook-handlers.md) | [04](../changelog/04-notebook-handlers.md) |
| 05 | Code Execution | [05-code-execution.md](./05-code-execution.md) | [05](../changelog/05-code-execution.md) |
| 06 | Dependency Analyzer | [06-dependency-analyzer.md](./06-dependency-analyzer.md) | [06](../changelog/06-dependency-analyzer.md) |
| 07 | Sensitivity Analyzer | [07-sensitivity-analyzer.md](./07-sensitivity-analyzer.md) | [07](../changelog/07-sensitivity-analyzer.md) |
| 08 | LSP Bridge | [08-lsp-bridge.md](./08-lsp-bridge.md) | [08](../changelog/08-lsp-bridge.md) |
| 09 | Jupyter Kernel | [09-jupyter-kernel.md](./09-jupyter-kernel.md) | [09](../changelog/09-jupyter-kernel.md) |

### Frontend

| # | Módulo | Archivo | Changelog |
|---|--------|---------|-----------|
| 11 | Notebook Editor UI | [11-notebook-editor-ui.md](./11-notebook-editor-ui.md) | [11](../changelog/11-notebook-editor-ui.md) |
| 12 | Dependency Graph UI | [12-dependency-graph-ui.md](./12-dependency-graph-ui.md) | [12](../changelog/12-dependency-graph-ui.md) |
| 13 | Monaco Editor | [13-monaco-editor.md](./13-monaco-editor.md) | [13](../changelog/13-monaco-editor.md) |
| 14 | Main App | [14-main-app.md](./14-main-app.md) | [14](../changelog/14-main-app.md) |
| 15 | Notification Center | [15-notification-center.md](./15-notification-center.md) | [15](../changelog/15-notification-center.md) |
| 16 | UI Automation Guide | [16-ui-automation-guide.md](./16-ui-automation-guide.md) | [16](../changelog/16-ui-automation-guide.md) |
| 17 | Template Editor | [17-template-editor.md](./17-template-editor.md) | [17](../changelog/17-template-editor.md) |
| 18 | Engineering Units | [18-engineering-units.md](./18-engineering-units.md) | [18](../changelog/18-engineering-units.md) |
| 24 | Desktop Shell | [24-desktop-shell.md](./24-desktop-shell.md) | [24](../changelog/24-desktop-shell.md) |

---

## Convención canónica de módulos

Plantilla oficial para nuevos módulos: [_module-template.md](./_module-template.md)

Secciones obligatorias:
1. Propósito sistémico
2. Entradas y salidas contractuales
3. Dependencias y sinergias
4. Estado compartido y concurrencia
5. Fallos frecuentes y observabilidad
6. Archivos fuente y puntos de entrada
7. Resumen de cambios + enlace a changelog

---

## Documentación global relacionada

- [system-context.md](../architecture/system-context.md)
- [contracts-catalog.md](../architecture/contracts-catalog.md)
- [feature-threads.md](../architecture/feature-threads.md)
- [synergy-matrix.md](../architecture/synergy-matrix.md)
- [glossary.md](../architecture/glossary.md)
