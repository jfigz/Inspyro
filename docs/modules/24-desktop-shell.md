# 24 - Desktop Shell

> **Estado:** Implementado
> **Ubicación:** `desktop/`
> **Última actualización:** 2026-05-03
> **Changelog:** `docs/changelog/24-desktop-shell.md`

---

## Propósito sistémico

Convertir Inspyro en una aplicación de escritorio Windows sin depender de un navegador externo. El shell Electron encapsula la UI React, arranca el backend FastAPI como sidecar en producción, fuerza same-origin para REST/WS/LSP y expone una API preload mínima hacia la ventana.

## 2026-05-03 - Identidad Inspyro PNG reproducible

- `assets/brand/` pasa a ser la fuente canónica del logo desde el PNG aprobado: `inspyro-logo-source.png`, `inspyro-mark.png`, `inspyro-mark-light.png`, `inspyro-logo.png`, `inspyro-logo-light.png`, `inspyro-app-icon.png` y derivados por tamaño.
- `tools/brand/generate_assets.py` recorta el símbolo y el logo completo desde el PNG maestro, genera variantes claras para superficies oscuras, mantiene favicon/Word con el mark original y genera `desktop/assets/icon.ico` desde el tile oscuro de app.
- `desktop/package.json` declara `desktop/assets/icon.ico` como icono Windows y empaqueta `desktop/assets/**`; `desktop/main.js` pasa ese icono al `BrowserWindow` y la splash usa el mark claro contextual.
- `desktop/scripts/stage-resources.mjs` mantiene el empaquetado reproducible omitiendo el `filter` de `fs.cp` cuando no se requiere filtro, compatible con Node actual.

## 2026-05-03 - Cierre desktop nativo instalable

- `desktop/scripts/stage-resources.mjs` deja de copiar estado local del backend (`.templates`, `.template_tokens`, descargas DOCX/PDF, `tmp*`, `dev`, `tests`, caches y archivos de diagnóstico) al paquete distribuible.
- El staging copia primero el runtime Python portable y luego sincroniza/verifica dentro de `.stage/python` las dependencias críticas de backend, notebook, LSP y Agents (`pylsp`, `fastmcp`, `mcp`, `jupyter_client`, `ipykernel`, `PyMuPDF`, `watchdog`, etc.) con `PYTHONNOUSERSITE=1`; si faltan imports tras `pip install -r backend/requirements.txt -r backend/mcp_server/requirements-mcp.txt`, el empaquetado falla antes de generar artefactos.
- `desktop/package.json` define metadata de release Windows (`artifactName`, `publisherName`, `requestedExecutionLevel`, iconos NSIS, uninstall display name), asociaciones `.ipynb`/`.py`/`.inspyro` y protocolo `inspyro://`.
- `desktop/main.js` registra el protocolo en builds empaquetados, captura archivos/URLs recibidos por single-instance, file associations o deep links, y los encola hasta `renderer_app_ready`; `App.js` abre archivos nativos dentro del workspace activo o toma su carpeta padre como workspace inicial.
- `desktop/scripts/smoke-packaged.cjs` valida el build `dist/win-unpacked`: recursos staged, imports Python críticos, renderer visible, `/health`, socket LSP, lifecycle MCP y bridge `window.inspyroDesktop`.

## 2026-04-18 - Branding shell y superficie Agents orientados al lanzamiento open source

- `desktop/splash.html`, `frontend/public/favicon.png` y `DesktopTitleBar` dejan de depender del identificador visual `🐍` como branding principal: ahora comparten un brand mark raster y un wordmark alineado al posicionamiento público del producto.
- La splash y los estados de boot visibles pasan a priorizar copy English-first (`Initializing shell`, `Starting local backend`, `Loading interface`, etc.), reforzando la narrativa de "AI-native engineering workspace" en la primera impresión.
- `desktop/main.js` renombra la capa visible `MCP` a `Agents` en menú/acciones/About cuando la interacción es de producto; MCP queda solo como detalle técnico del transporte o del endpoint.

## Entradas y salidas contractuales

### Entradas
- Runtime Electron (`desktop/main.js`, `desktop/preload.js`).
- Frontend compilado en `frontend/build`.
- Backend Python arrancado en desarrollo sobre `:8000`, o sidecar local en producción.
- Variables de entorno de runtime:
  - `INSPYRO_DESKTOP`
  - `INSPYRO_SERVE_FRONTEND`
  - `INSPYRO_BACKEND_PORT`
  - `INSPYRO_FRONTEND_BUILD_DIR`
  - `INSPYRO_DESKTOP_PYTHON_HOME` (staging/packaging)

### Salidas
- Ventana única Electron con `contextIsolation=true`, `nodeIntegration=false`, `sandbox=true`.
- Splash local previa a la ventana principal, con etapas explícitas de boot y error English-first (`Initializing shell`, `Starting local backend`, `Waiting for backend health`, `Loading interface`, `Starting renderer`, `Mounting interface`, `Ready`, `Renderer did not start`, `Renderer failed to start`).
- Title bar híbrida desktop-aware con overlay nativo de Windows, header React personalizado y branding visible sincronizado con el shell (`DesktopTitleBar` + splash).
- Menú nativo con shortcuts, `Open Recent`, acciones notebook/Agents y routing IPC hacia el renderer.
- Backend sidecar oculto y gestionado por lifecycle del shell.
- Frontend servido por el backend en `/` y assets en `/static`.
- Instalador Windows NSIS con metadata estable, iconos nativos, asociaciones `.ipynb`/`.py`/`.inspyro` y protocolo `inspyro://`.
- Preload `window.inspyroDesktop`:
  - `isDesktop`
  - `version`
  - `openExternal(url)`
  - `openPath(path)`
  - `openDevTools()`
  - `reloadRenderer()`
  - `reportWorkspace(path)`
  - `reportRendererPhase(phase, payload)`
  - `emitDesktopNotification(payload)`
  - `onMenuAction(handler)`
  - `notifyRendererReady()` como alias legacy hacia `renderer_app_ready`

## Dependencias y sinergias

### Upstream
- `14-main-app` para la UI principal.
- `08-lsp-bridge` para el socket LSP same-origin.
- `19-mcp-server` porque el shell desktop debe convivir con el backend que arranca/gestiona MCP.

### Downstream
- `03-file-system-api`, `04-notebook-handlers`, `08-lsp-bridge`, `14-main-app`, `19-mcp-server`.
- Backend `main.py`, que pasa a servir el build del frontend en modo desktop.

## Estado compartido y concurrencia

1. El shell es dueño del lock de instancia única, la splash, la ventana principal, el menú nativo y el lifecycle del sidecar Python.
2. En desarrollo, Electron no arranca servicios: espera `http://127.0.0.1:3000` y `http://127.0.0.1:8000/health`.
3. En producción, Electron resuelve un puerto backend disponible, exporta `INSPYRO_BACKEND_PORT` y levanta `backend/main.py` con serving same-origin.
4. `desktop/main.js` persiste `windowBounds`, `isMaximized`, `recentWorkspaces` y `lastWorkspace` en `app.getPath('userData')/desktop-shell-state.json`, saneando bounds fuera de pantalla antes de restaurarlos.
5. El shell mantiene una cola acotada de acciones renderer-side (`desktop:menu-action`) hasta recibir `renderer_app_ready`; el preload expone `desktop:renderer-phase` y el main process solo revela la ventana principal cuando el renderer montó la app o ya dejó una pantalla fatal visible.
6. El preload sigue siendo estrecho: toda lógica de negocio permanece en frontend/backend; Electron solo expone bridge seguro para shell/workspace/notificaciones, incluyendo `openPath(path)` para abrir artefactos DOCX persistidos del proyecto sin pasar por descargas del navegador.
7. La navegación a URLs externas se saca del shell y se delega a `shell.openExternal()`.
8. Las notificaciones nativas se emiten desde Electron y se suprimen cuando la ventana principal está enfocada; el `NotificationCenter` interno sigue siendo la fuente visible siempre.
9. El branding visible del shell se reparte entre `assets/brand/`, `frontend/public/favicon.png`, `frontend/public/brand/inspyro-mark-light-128.png`, `desktop/assets/icon.ico` y el markup local de `desktop/splash.html`; la app usa el mark claro sobre superficies oscuras, mientras favicon/Word conservan el mark original y Electron/Windows usa un tile oscuro.
10. El staging de empaquetado copia backend, build del frontend y runtime Python portable a `desktop/.stage/`, excluyendo estado mutable de desarrollo y sincronizando/verificando dependencias Python críticas dentro de la copia staged con `PYTHONNOUSERSITE=1` para evitar depender del perfil Python del usuario.
11. El build empaquetado puede recibir rutas nativas (`.ipynb`, `.py`, `.inspyro`) o deep links `inspyro://`; Electron conserva esos targets hasta que React está listo y `App.js` decide si abre el archivo en el workspace actual o inicializa la carpeta padre como workspace.

## Fallos frecuentes y observabilidad

### Fallos frecuentes
- Runtime Python portable ausente al empaquetar.
- Runtime Python portable sin dependencias de LSP/Agents (`pylsp`, `fastmcp`, `mcp`) o sin dependencias notebook/documentales críticas.
- Staging contaminado por estado de desarrollo (`.templates`, descargas temporales, caches o probes) que termina dentro del instalador.
- `frontend/build` inexistente cuando el backend intenta servir la SPA.
- Fallback incorrecto de `API_BASE` hacia `localhost:8000` en runtime same-origin.
- Sidecar Python huérfano si el cierre del shell no propaga cleanup.
- Navegación externa no interceptada desde la ventana Electron.
- Apertura de rutas locales inválidas o fuera de sincronía con el workspace, dejando al botón `DOCX` sin archivo de proyecto abrible aun cuando exista artifact store interno.
- Shortcut duplicado entre menú nativo y listeners web si el renderer no desacopla aceleradores desktop.
- Drift entre `recentWorkspaces` del shell y el workspace canónico del backend si el renderer no reporta cambios reales.
- Pantalla negra si el renderer carga JS pero React falla antes de montar contenido visible.
- Splash colgada si no llega `renderer_bootstrap_ready`, si el renderer falla antes de reportar fase útil o si el boot state no progresa.

### Observabilidad
- Logs circulares del backend sidecar en el proceso principal Electron.
- Estado de boot visible en la splash con diagnóstico y acciones (`Retry`, `Quit`) cuando el arranque falla.
- Logs del proceso principal distinguen `did-start-loading`, `did-finish-load`, `dom-ready`, `ready-to-show`, `did-fail-load`, `render-process-gone`, `renderer_bootstrap_ready`, `renderer_app_ready`, `renderer_app_failed` y `renderer_unhandled_error`.
- Error modal claro si el backend no arranca o termina inesperadamente.
- Menú `About` y diálogos nativos para fallos de arranque y recents inválidos.
- Scripts explícitos para `dev`, `dev:full`, `smoke:renderer`, `smoke:packaged`, `pack` y `dist`.

## Archivos fuente y puntos de entrada

- `desktop/package.json`
- `desktop/main.js`
- `desktop/preload.js`
- `desktop/splash-preload.js`
- `desktop/splash.html`
- `desktop/scripts/dev-full.mjs`
- `desktop/scripts/smoke-renderer.cjs`
- `desktop/scripts/smoke-packaged.cjs`
- `desktop/scripts/stage-resources.mjs`
- `desktop/assets/`
- `assets/brand/`
- `tools/brand/generate_assets.py`
- `backend/main.py`
- `frontend/src/components/DesktopTitleBar.js`
- `frontend/src/components/DesktopTitleBar.css`
- `frontend/public/favicon.png`
- `frontend/src/config/endpoints.js`
- `frontend/public/index.html`
- `frontend/src/index.js`
- `frontend/src/boot/RendererRoot.js`
- `frontend/src/boot/rendererDesktopBridge.js`

Puntos de entrada:
- `.\restart_inspyro.ps1`
- `.\restart_inspyro.ps1 -Mode Web`
- `cd desktop && npm run dev`
- `cd desktop && npm run dev:full`
- `cd desktop && npm run smoke:packaged`
- `cd desktop && npm run pack`
- `cd desktop && npm run dist`

## Resumen de cambios recientes

1. El handshake renderer↔Electron deja de depender de un único `notifyRendererReady()`: `index.js` emite `renderer_bootstrap_ready`, `RendererRoot` informa `renderer_app_ready`/`renderer_app_failed` y `rendererDesktopBridge` propaga `renderer_unhandled_error`.
2. `desktop/main.js` modela el arranque como máquina de estados visible en splash y ya no revela la ventana principal por timeout ciego; el reveal solo ocurre con app real montada o con fallback fatal visible.
3. El shell mantiene diagnóstico del renderer (`phase`, `message`, `stack`, `status`) y lo expone tanto en logs como en la splash cuando el arranque falla.
4. `desktop/preload.js` amplía `window.inspyroDesktop` con `reportRendererPhase()`, `reloadRenderer()`, `openDevTools()` y `openPath(path)`, dejando `notifyRendererReady()` solo como alias legacy compatible.
5. `desktop/scripts/smoke-renderer.cjs` agrega una validación automatizable del shell: arranca Electron contra `:3000/:8000` y falla si encuentra splash infinita, `#root` vacío o ventana negra sin shell ni fallback fatal.
6. Electron sigue envolviendo la UI React y eliminando la dependencia del navegador externo.
7. `backend/main.py` ahora puede servir la SPA compilada y operar same-origin con REST/WS/LSP.
8. El shell añade splash de arranque, title bar híbrida, menú nativo, `Open Recent`, persistencia de bounds/maximize y bridge IPC seguro hacia React.
9. `frontend/src/config/endpoints.js` diferencia explícitamente `CRA :3000 -> backend :8000` de `desktop/prod -> window.location.origin`, y `App.js` reporta workspace/notificaciones al shell.
10. La identidad visual visible del shell queda desacoplada del ejecutable: el PNG maestro vive en `assets/brand/inspyro-logo-source.png`, y favicon, titlebar, splash, icono runtime/Windows y Word add-in se regeneran desde ese origen con variantes por contexto.
11. Las fuentes de UI pasan a empaquetarse localmente (`Source Sans 3`, `Source Code Pro`) y se elimina la carga remota de Google Fonts.
12. El empaquetado Windows usa `electron-builder` + NSIS y staging explícito de runtime Python portable.
13. El staging falla temprano si el Python portable no puede importar dependencias críticas de backend/LSP/Agents sin user-site, y el smoke empaquetado valida `win-unpacked` contra renderer, `/health`, LSP, MCP y bridge desktop.
