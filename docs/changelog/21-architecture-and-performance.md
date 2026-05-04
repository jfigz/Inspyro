# 2026-02-20 - Architecture & Performance Refactor (E2E)

> **Estado:** Implementado
> **Impacto:** Alto (Backend decoupling, Frontend bundle size, Integración continua)
> **Última actualización:** 2026-02-20

### Contexto
Se abordó un esfuerzo masivo para reducir la Deuda Técnica arquitectónica y de rendimiento (P1), enfocado en abstraer el estado global backend, optimizar el tamaño de entrega del UI, y garantizar calidad a través de Tests End-to-End.

### Cambios Técnicos

#### Backend
- **Estado Global Aislado:** Migración de notebook_common.py hacia un manejador singleton en app/core/state.py.
- **Desacoplamiento de Routers:** Despiece del archivo masivo notebook_template.py, moviendo toda validación Base64, estimaciones y custom exceptions a una nueva capa de negocio: app/services/template_logic.py.

#### Frontend
- **React.lazy & Code Splitting:** Separación de librerías costosas (MonacoEditorLSP, marked, dompurify, katex). Envoltura de componentes dentro del UI con <Suspense> para diferir la carga reduciendo drásticamente el First Paint.
- **Micro-optimizaciones Memo:** Refactor de NotebookEditor.js para usar hooks referenciales estables (useCallback) en eventos y se recubrió a NotebookCell.js con React.memo(). Esto previene el clásico anti-patrón donde tipear en una celda re-renderizaba todo el Notebook inútilmente.

#### E2E (Playwright)
- Configuración de Playwright (playwright.config.ts) reutilizando el servidor de desarrollo Vite (localhost:3000).
- Desarrollo de un test vitalicio (tests/notebook.spec.ts) que simula la sesión completa: interceptar prompt nativo para new file, navegar el explorador asíncrono, crear celda, instanciar Worker de Monaco y evaluar la ejecución a través de inyección pura de eventos sobre el framework React-Monaco contra Pyodide/Backend.

### Riesgos & Mitigaciones
- **Verificación Completa:** Pasó la validación estricta de 130 procesos en pytest y validación GUI E2E exitosa en < 6s en Chromium. Se ejecutó script contracts-check para sincronía.
- **Riesgo E2E Mitigado:** Modificación drástica del flujo asíncrono de tests aumentando los timeouts predeterminados tras confirmarse que el Lazy Init del Kernel a demanda tomaba > 15s en cold starts.

### Archivos Afectados
- backend/app/routers/notebook_common.py
- backend/app/routers/notebook_template.py
- backend/app/core/state.py
- backend/app/services/template_logic.py
- frontend/src/App.js
- frontend/src/components/NotebookEditor.js
- frontend/src/components/notebook/NotebookCell.js
- frontend/tests/notebook.spec.ts