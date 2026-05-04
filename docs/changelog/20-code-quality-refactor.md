# 2026-02-19 - Code Quality & Reliability Refactor

> **Estado:** Implementado
> **Impacto:** Medio (Backend/Frontend reliability)
> **Última actualización:** 2026-02-20

### Contexto
Limpieza técnica profunda para eliminar deuda técnica acumulada: uso de `console.log` en frontend, `print()` en backend de producción, y manejo de errores genéricos (`bare except`).

### Cambios Técnicos

#### Backend
- **Logging estandarizado:** Migración de `print()` a `logger.warning/info/debug` en:
  - `app/routers/lsp.py`
  - `app/routers/notebook_kernel_control.py`
  - `app/routers/notebook_common.py`
  - `app/services/docker_executor.py`
- **Manejo de excepciones:** Reemplazo de `except:` por `except Exception:` en scripts de desarrollo (`dev/`).

#### Frontend
- **Limpieza de consola:** `console.log/warn` envueltos en `if (process.env.NODE_ENV !== 'production')` en:
  - `MonacoEditorLSP.js`
  - `NotebookCell.js`
  - `edgePorts.js`
  - `TemplateEditorContainer.js`
  - `App.js`
- **Limpieza ESLint:** Corregidos hooks en `PdfViewer.js` (URLs de Blob memory leaks listos) y `StatusBar.js`.

### Riesgos
- **Bajo:** Cambios puramente no funcionales (logging/error handling) y en scripts de desarrollo.
- **Verificación:** `ast.parse` y `node --check` pasaron exitosamente.
