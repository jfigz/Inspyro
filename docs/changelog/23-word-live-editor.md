# Changelog - 23 Word Live Editor

> **Modulo:** `backend/app/routers/word_live.py` + `backend/app/services/word_live.py` + `word-addin/` + `frontend/src/components/DocxViewer.js`
> **Doc principal:** `docs/modules/20-word-live-editor.md`
> **Última actualización:** 2026-03-31

---

## 2026-03-31 - Launcher local desde Inspyro hacia Word Live

### Contexto
La primera entrega del módulo 20 ya permitía editar en vivo dentro de Word, pero seguía dependiendo de que el usuario entendiera y operara el sideload manualmente. Se necesitaba una v2 pragmática: disparar el flujo desde Inspyro con un solo botón, manteniendo el add-in operativo sobre el `.docx` real dentro de la misma instancia de Word.

### Cambios técnicos
1. `backend/app/services/word_live.py` incorpora funciones de launcher local para Windows: selector nativo de `.docx`, registro del manifest vía `office-addin-dev-settings`, sideload del host temporal y automatización COM (`pywin32`) para abrir/activar el documento real en la misma instancia de Word.
2. `backend/app/routers/word_live.py` agrega `POST /api/word-live/launcher/install` y `POST /api/word-live/launcher/open`.
3. `frontend/src/components/DocxViewer.js` agrega el botón `Word Live` tanto en el toolbar vacío como en el toolbar normal del visor DOCX.
4. `frontend/src/components/DocxViewer.test.js` cubre el nuevo CTA y `backend/tests/test_word_live_api.py` cubre los contratos REST del launcher.
5. El launcher minimiza la ventana temporal `Word add-in ...docx` y deja al usuario en el documento objetivo con el task pane ya cargado.

### Riesgos/impacto
- La automatización del launcher sigue siendo Windows-only porque depende de Word Desktop + `pywin32`.
- El flujo continúa usando sideload de Office bajo el capó; se automatiza la fricción, pero no se convierte mágicamente en un despliegue corporativo persistente.
- Si faltan `npx`, `office-addin-dev-settings` o `pywin32`, la ruta nueva falla con error explícito.

### Validación
- `venv_inspyro\Scripts\python.exe -m pytest backend/tests/test_word_live_api.py -q`
- `npm test -- --runTestsByPath src/components/DocxViewer.test.js --watchAll=false`
- Smoke manual contra backend vivo: `POST /api/word-live/launcher/open` devolviendo `launched=true` y activación del `.docx` real en la misma instancia de Word.

### Archivos afectados
- `backend/app/services/word_live.py`
- `backend/app/routers/word_live.py`
- `backend/tests/test_word_live_api.py`
- `frontend/src/components/DocxViewer.js`
- `frontend/src/components/DocxViewer.test.js`
- `docs/modules/20-word-live-editor.md`
- `docs/modules/14-main-app.md`
- `docs/architecture/contracts-catalog.md`
- `docs/architecture/feature-threads.md`
- `docs/architecture/synergy-matrix.md`
- `docs/architecture/system-context.md`
- `docs/llm-index.yaml`
