# Changelog 13 - monaco-editor

> **Última actualización:** 2026-02-21

---

## 2026-02-21 - Precisión de offsets y coordenadas para análisis de dependencias

1. Se normaliza la serialización de `source` de celdas previas en `generateVirtualDocument` y `calculateLineOffset` para evitar desfases de diagnóstico cuando el notebook viene en formato `.ipynb` con saltos por línea.
2. Las acciones del menú contextual (`show-dependency-tree`, `show-impact-tree`) envían `column` en base 0 (`position.column - 1`) para alinear coordenadas con `ast.col_offset` del backend.
3. Se añade soporte de `highlightColumn` en navegación para colocar cursor en la columna objetivo al abrir la línea.

**Archivos:** `frontend/src/components/MonacoEditorLSP.js`, `frontend/src/components/notebook/NotebookCell.js`, `frontend/src/components/NotebookEditor.js`

---

## 2026-02-19 - Corrección de mapeo URI LSP y hardening de reconexión

1. Se añadió `_modelToDocUri` Map en `SharedLSPClient` para asociar cada modelo Monaco con su documento LSP correcto, eliminando el bug donde completado/hover usaba el último documento abierto en multi-celda.
2. `_modelToDocUri` se registra en `connectLSP`, se limpia en `didClose` y en el efecto de cleanup del componente.
3. `requestIdCounter` migrado de variable de módulo a propiedad de instancia (`_requestIdCounter`) para evitar colisiones de IDs entre reconexiones/hot reloads.
4. `disconnect()` ahora captura la referencia `oldWs` antes de nulificar `this.ws`, evitando cerrar un WebSocket nuevo creado durante el delay de 200ms.
5. Se elimina el contador global de request IDs no utilizado (`getNextRequestId`), manteniendo solo el contador por instancia activo.

**Archivos:** `frontend/src/components/MonacoEditorLSP.js`, `docs/modules/13-monaco-editor.md`

## 2026-02-07 - Cleanup de warnings LSP/snippets fallback

1. Se eliminó estado local no usado (`lspStatus`) manteniendo la señalización interna por setter.
2. Se acotó la regla `no-template-curly-in-string` al bloque de snippets fallback para preservar placeholders Monaco (`${1:...}`) sin warnings globales.
3. No hubo cambios de contrato WS LSP ni de comportamiento de completado/hover.

**Archivos:** `frontend/src/components/MonacoEditorLSP.js`, `docs/modules/13-monaco-editor.md`

## 2026-02-06 - Inicialización del changelog

1. Se crea el changelog dedicado del módulo dentro de docs/changelog/.
2. El histórico detallado se moverá gradualmente desde la documentación de módulo.
