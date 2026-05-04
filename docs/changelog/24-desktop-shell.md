# 24 - Desktop Shell

> **Última actualización:** 2026-05-03

## 2026-05-03 - Logo Inspyro reproducible

- Se agrega `assets/brand/` como fuente canónica para `inspyro-logo-source.png`, marks/logos original y claro, `inspyro-app-icon.png` y PNGs derivados.
- `tools/brand/generate_assets.py` recorta el PNG aprobado, genera favicon y Word add-in desde el mark original, variantes claras para UI oscura e icono Windows `.ico` desde el tile oscuro.
- `DesktopTitleBar`, `desktop/splash.html`, `desktop/main.js`, `frontend/public/favicon.png` y `desktop/package.json` pasan al nuevo branding contextual serpiente/espiral verde con kernel dorado.
- `desktop/scripts/stage-resources.mjs` omite `filter` cuando no hay filtro de copia, evitando fallos de `fs.cp` durante `npm run pack` en Node actual.

## 2026-05-03 - Packaging desktop nativo autosuficiente

- `desktop/scripts/stage-resources.mjs` limpia el backend staged antes del instalador: excluye estado mutable (`.templates`, `.template_tokens`, descargas DOCX/PDF, caches, `tmp*`, `dev`, `tests`) y archivos de diagnóstico como `Dockerfile`, `pytest.ini` y probes locales.
- El staging ahora sincroniza/verifica dependencias Python críticas dentro de `.stage/python` con `PYTHONNOUSERSITE=1`; instala `backend/requirements.txt` + `backend/mcp_server/requirements-mcp.txt` cuando faltan imports como `jupyter_client`, `ipykernel`, `pylsp`, `fastmcp` o `mcp`, y falla si el runtime sigue incompleto sin depender del perfil Python del usuario.
- `desktop/package.json` agrega metadata NSIS/release (`artifactName`, `publisherName`, iconos instalador/desinstalador, uninstall display name), asociaciones `.ipynb`/`.py`/`.inspyro` y protocolo `inspyro://`.
- `desktop/main.js` captura rutas/deep links recibidos por el sistema operativo y los entrega a React después de `renderer_app_ready`; `App.js` abre el archivo nativo en el workspace activo o toma su carpeta padre como workspace.
- Se agrega `desktop/scripts/smoke-packaged.cjs` y `npm run smoke:packaged` para validar el build `win-unpacked`: recursos staged, imports Python, renderer visible, `/health`, LSP, MCP y bridge desktop.

## 2026-04-18 - Branding shell y superficie Agents

- `desktop/splash.html`, `frontend/public/favicon.png` y `DesktopTitleBar` pasan a compartir un brand mark raster + wordmark, desplazando al emoji `🐍` como identidad principal del shell.
- `desktop/main.js` traduce la narrativa visible del runtime desde "MCP/IDE" hacia `Agents` + "AI-native engineering workspace", manteniendo MCP solo como detalle técnico del transporte.
- La splash pasa a ser English-first y refuerza la secuencia de arranque como parte de un workspace agentic orientado a cálculos y reportes.

## 2026-04-18

- `desktop/preload.js` amplía `window.inspyroDesktop` con `openPath(path)`, permitiendo que la UI abra directamente el DOCX persistido del proyecto en desktop sin pasar por una descarga temporal del navegador.
- `desktop/main.js` agrega el handler IPC `desktop:openPath`, valida la ruta recibida y delega la apertura a `shell.openPath()`, devolviendo errores controlados al renderer cuando la materialización workspace-backed no existe o no es accesible.
- Esto cierra el nuevo contrato desktop-aware del botón `DOCX`: el shell ya puede abrir el archivo persistido en `Docx_Documents` y mantener el fallback web separado.

## 2026-04-07

- El arranque desktop deja de depender de un único `notifyRendererReady()`: `index.js` emite `renderer_bootstrap_ready`, `RendererRoot` informa `renderer_app_ready`/`renderer_app_failed` y `rendererDesktopBridge` reporta `renderer_unhandled_error`.
- `desktop/main.js` adopta una máquina de estados explícita para el renderer, con diagnóstico persistido en splash y reveal condicionado a app visible o fallback fatal del renderer, eliminando la ventana negra y la splash infinita.
- `desktop/preload.js` amplía `window.inspyroDesktop` con `reportRendererPhase()`, `reloadRenderer()` y `openDevTools()`, dejando `notifyRendererReady()` como alias legacy compatible.
- `desktop/scripts/smoke-renderer.cjs` agrega un smoke reproducible de Electron que falla si el shell termina con `#root` vacío, splash colgada o ventana negra sin contenido.

## 2026-04-05

- Se agrega splash local con etapas de boot (`Inicializando shell` -> `Listo`) y cierre diferido hasta que el renderer confirma `notifyRendererReady()`.
- El shell pasa a persistir `windowBounds`, estado maximizado y `recentWorkspaces` en `desktop-shell-state.json`, restaurando bounds saneados entre sesiones.
- Se incorpora menú nativo Windows-first con shortcuts, `Open Recent`, acciones notebook/MCP y routing IPC `desktop:menu-action` hacia React.
- `window.inspyroDesktop` se amplía con `reportWorkspace`, `emitDesktopNotification`, `onMenuAction` y `notifyRendererReady`.
- `App.js` adopta una title bar híbrida (`DesktopTitleBar`), reporta el workspace activo al shell, consume acciones del menú y arbitra notificaciones nativas para DOCX/PDF, `Run All` y fallos MCP.
- `NotebookEditor.js` expone `runActiveCell`, emite eventos de batch para `Run All` y deshabilita el listener web de `Ctrl+Enter` cuando el shell desktop ya provee ese acelerador desde el menú nativo.
- El branding visible del shell se concentra en `DesktopTitleBar`, `desktop/splash.html` y el favicon del frontend; en esa etapa el token visual seguía siendo `🐍`.

## 2026-04-04

- Se agrega shell Electron Windows-first en `desktop/` con preload mínimo y single-instance lock.
- El backend pasa a soportar serving same-origin del frontend compilado usando `INSPYRO_SERVE_FRONTEND` + `INSPYRO_FRONTEND_BUILD_DIR`.
- El runtime desktop de producción levanta `backend/main.py` como sidecar Python oculto y lo apaga al cerrar la app.
- El frontend endurece la resolución de `API_BASE`/WS/LSP para distinguir modo CRA (`:3000 -> :8000`) de modo desktop/prod same-origin.
- Se elimina la dependencia de Google Fonts remotas y se empaquetan fuentes locales para operación offline.
- `restart_inspyro.ps1` pasa a arrancar Inspyro Desktop por defecto y deja `-Mode Web` como compatibilidad legacy.
