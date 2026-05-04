# Changelog 08 - lsp-bridge

> **Última actualización:** 2026-03-29

---

## 2026-03-29 - Stubs DOCX exponen `math_latex()` y helpers inline LaTeX

1. `backend/stubs/docx_api.pyi` agrega `DocBuilder.math_latex(...)`, `DocBuilder.create_math_latex_element(...)` y el alias funcional `EquationLatex(...)`.
2. La documentación del módulo LSP se alinea con la nueva superficie pública para que Monaco/pylsp reflejen el camino recomendado basado en LaTeX sin borrar la sintaxis legacy.

## 2026-02-06 - Inicialización del changelog

1. Se crea el changelog dedicado del módulo dentro de docs/changelog/.
2. El histórico detallado se moverá gradualmente desde la documentación de módulo.

## 2026-03-15 - Fallback de subprocess en Windows

1. `LSPBridge` deja de depender de `asyncio.create_subprocess_exec` para arrancar `pylsp` en runtime.
2. El bridge pasa a usar `subprocess.Popen` con forwarding async sobre `asyncio.to_thread`, evitando `NotImplementedError` bajo event loop selector de uvicorn en Windows.
3. Se agrega cobertura en `backend/tests/test_units_lsp_stubs.py` para fijar el arranque del bridge con lanzamiento bloqueante.
