# Contexto del Sistema Inspyro (LLM-First)

> **Última actualización:** 2026-05-03
> **Objetivo:** entregar a agentes IA una vista global mínima y precisa del sistema completo.

---

## Capas del sistema

1. **Desktop Shell (Electron)**
- Encapsula la UI web en una ventana nativa, fuerza single-instance, protege navegación externa, muestra splash/boot status, ofrece menú nativo, registra asociaciones/protocolo nativo en producción y arranca el backend local como sidecar.
- Fuentes principales: `desktop/main.js`, `desktop/preload.js`, `desktop/scripts/*.mjs`, `desktop/assets/`, `assets/brand/`.

2. **Frontend (React)**
- Orquesta UX, estado de edición, paneles de notebook/visualización y envío de mensajes WS.
- Fuentes principales: `frontend/src/App.js`, `frontend/src/components/NotebookEditor.js` (+ módulos extraídos en `notebook/`), `frontend/src/components/TemplateEditor.js`.

3. **Backend API (FastAPI)**
- Expone REST para archivos/sistema y WebSocket para operaciones en tiempo real.
- Router de entrada: `backend/main.py`.

4. **Servicios Backend**
- Kernel Jupyter, bridge LSP, conversión PDF, gestión de templates, análisis de dependencias.
- Fuentes principales: `backend/app/services/*.py`.

5. **Procesos externos**
- `ipykernel` para ejecución real de Python.
- `pylsp` para autocompletado.
- Microsoft Word / LibreOffice para DOCX→PDF.

---

## Componentes y límites

| Capa | Componente | Límite de responsabilidad | Estado dueño |
|------|------------|---------------------------|--------------|
| Desktop | `desktop/main.js` + `preload.js` | Ventana Electron, splash, menú nativo, single-instance, sidecar backend, preload seguro, persistencia de recents/bounds, máquina de estados del renderer y navegación externa | Lifecycle del shell + backend child process + shell-state local |
| Frontend | `App.js` | Layout principal, wiring WS/REST, estado global de paneles, bridge desktop-aware, branding visible del header desde los PNG canónicos y variantes contextuales de `assets/brand/`, arbitraje de notificaciones nativas y gobierno del espejo MCP | Estado UI global + sesiones notebook/code por path + template/document state notebook-scoped + integración del shell desktop |
| Frontend | `NotebookEditor.js` + `notebook/` | Superficie visible del notebook activo, ejecución de celdas, outputs y parseo de mensajes notebook | Estado notebook visible + runtime por celda; lifecycle persistente del kernel delegado al shell |
| Frontend | `TemplateEditor.js` | Edición de estilos de plantilla y previews | Estado template del notebook activo; ownership persistente en `App.js` por `path` |
| Backend | `main.py` | Dispatcher WS con priorización de control, colas inbound acotadas por conexión y workers por tipo de carga, endpoints REST de salud/sistema y serving same-origin del frontend compilado en modo desktop | Mapa de contratos de entrada + lifecycle de colas/tareas inbound WS por conexión (`/ws` shell global, `/ws/notebook` por notebook) + serving SPA |
| Backend | `services/websocket_manager.py` | Registro/desregistro de conexiones, sanitización JSON-safe, cola saliente FIFO por conexión, writer task único y política `Protect notebooks` ante saturación del transporte compartido | Conexiones activas + `_ConnectionState` por socket (`queue`, `writer_task`, `closing`) + managers separados para shell global y sockets notebook dedicados |
| Backend | `routers/notebook.py` + `routers/notebook_*.py` | Fachada + handlers separados de ejecución/control/template | Orquestación de mensajes notebook/template |
| Backend | `services/jupyter_kernel.py` | Sesiones kernel, serialización de ejecución por lock y callbacks IOPub desacoplados que drenan sobre el transporte WS serializado de `02-websocket-manager` | Estado kernel por `kernel_id` + backlog acotado de callbacks |
| Backend | `services/lsp_bridge.py` | Proceso `pylsp`, bridge WS<->stdio y forwarding JSON-RPC | Estado efímero por conexión LSP + lifecycle del subprocess |
| Backend | `services/workspace_service.py` | Workspace activo y raíz de estado interno escribible de la app | Workspace activo + app-state dir |
| Backend | `services/template/` + `services/template_service.py` | Dominio template modular + fachada de compatibilidad legacy | Estado de plantilla en disco por kernel |
| Backend | `services/pdf_converter.py` | Conversión y caché PDF; caché protegido con `threading.Lock`, cola async explícita del camino Word-capable y executors dedicados para no bloquear el pool compartido mientras un notebook espera convertidor | Estado de conversión/caché + cola async del convertidor |
| Backend | `services/runtime_metrics.py` | Métricas de saturación/latencia WS, cola saliente compartida por conexión y contención de locks | Estado agregado de observabilidad runtime |
| Backend | `backend/mcp_server/*` | Adaptador MCP local, discoverability AI-first, bridge REST/WS, resources/prompts y relay de actividad/espejo | Estado MCP session-scoped por `session_id` (bridge, notebooks, artefactos, ejecuciones, roots/perfil) |

---

## Fuentes de estado y ownership

1. **Estado UI (frontend)**
- Owner: React state/hooks (`App.js`, `NotebookEditor.js`, `TemplateEditor.js`).
- `App.js` mantiene `workspaceSurface`, `homeSummary`, las tabs visibles y las sesiones runtime por recurso (`notebookSessionsByPath`, estado `.py` por `file_path`), de modo que la navegación ya no dependa del mount del editor. Home combina el snapshot backend con esas sesiones locales activas para reflejar `Run All`/pipeline documental en vivo cuando el backend todavía no consolidó `home-summary`.
- Persistencia: memoria del navegador.

2. **Estado runtime desktop**
- Owner: `desktop/main.js`.
- Persistencia: proceso Electron vivo + `desktop-shell-state.json`; incluye lock de instancia, URL de runtime, PID del sidecar backend, buffer corto de logs, etapa de boot, cola IPC temprana, targets nativos pendientes (`.ipynb`, `.py`, `.inspyro`, `inspyro://`) hasta `renderer_app_ready`, máquina de estados del renderer (`renderer_bootstrap_ready`, `renderer_app_ready`, `renderer_app_failed`, `renderer_unhandled_error`), diagnóstico de arranque, bounds/maximized y `recentWorkspaces`.

3. **Estado notebook/code frontend por archivo**
- Owner: `App.js` + `useFileSystem.js` + `NotebookEditor.js` + `useAppWebSocket.js`.
- Modelo: `useFileSystem` cachea drafts persistibles por `path`; `App.js` conserva sesiones notebook por tab (`kernel_id`, `runtimeNotebook`, `runtimeVersion`, `editorHydrationToken`, estado kernel, batch `Run All`, estado documental, `templateInfo`, `templateBlob`, `templateOpenRequest`, `lastTemplateAttach`) y estado de ejecución `.py` por archivo (`run_id`, output, documento). `NotebookEditor` monta solo la vista activa, trata `initialKernelId` como runtime vivo y consume mensajes notebook visibles ya ruteados por el shell en vez de re-resolverlos por su cuenta.
- Al volver desde `home` o al reabrir una tab notebook dentro de la misma sesión renderer/WS, el shell reutiliza la sesión local sin mandar attach automático y sigue aplicando mensajes `notebook_*` aunque el editor esté desmontado, de modo que `Run All` y los outputs continúan en background.
- `documentPipelineStatus` es notebook-scoped: permanece asociado a la sesión aunque la libreta quede oculta o el usuario vuelva a `home`, y solo se limpia en terminales documentales reales (`notebook_pdf_ready`, fallo final, cancelación o interrupción).
- La adopción de `notebookData` hacia una sesión visible ya no es ciega: `App.js` valida que `notebookSyncState.path` coincida con la sesión activa antes de hidratar, evitando contaminación cruzada cuando el usuario cambia rápido entre notebooks y el draft visible todavía pertenece al path anterior.
- Ir a `home`, cambiar de tab o abrir otro archivo ya no cancela runtimes; cerrar una tab es la acción explícita que dispara `notebook_shutdown_kernel` o `cancel_code_execution`.
- `useFileSystem` etiqueta el origen de `notebookData` (`runtime` vs `persistable`) y `NotebookEditor` solo promueve `onNotebookChange` cuando el cambio nace de edición humana persistible, no de cargas iniciales, recargas same-path ni snapshots MCP.
- Si un `.ipynb` llega sin `cell.id`, el frontend preserva ids estables usando `metadata.inspyro_id` y un fallback determinista para evitar remounts espurios del editor.

4. **Estado shell MCP en frontend**
- Owner: `App.js` + `useMcpActivity.js` + `useMcpShellControls.js` + `useMcpMirror.js`.
- Modelo: `mirrorEnabled` vive en `localStorage`, arranca en `false` si no hay preferencia previa, respeta el valor guardado cuando existe y puede forzarse a `true` tras `start/restart` MCP iniciados desde la UI; el replay granular sigue sujeto a dirty state local y activación desde caché.
- Los conflictos externos derivados de `workspace_fs_event` se deduplican por path mientras el archivo siga en conflicto, de modo que el shell mantiene la decoración visual pero evita inundar el `NotificationCenter`.

5. **Estado de notebook y kernel (backend)**
- Owner: `jupyter_kernel_manager` + `app/core/state.py` (locks, cache ejecuciones y preview) + registros en `notebook.py`/`notebook_service.py`/`home_compact.py`.
- Claves principales: `kernel_id`, `cell_id`, hashes DOCX/PDF, snapshot notebook por `kernel_id`, y runtimes activos notebook/code visibles en Home.
- `app/core/state.py` también es owner del mapping `kernel_id -> websocket` y del cleanup diferido por desconexión; cualquier request notebook/template/control válida sobre `/ws/notebook` vuelve a enlazar ese `kernel_id` a la conexión actual y evita que el cleanup del socket viejo apague un kernel todavía vivo tras reconnect.
- El pipeline DOCX/PDF notebook-first ya no deja la espera del convertidor Word-capable escondida dentro del executor compartido: esa contención vive explícitamente en `pdf_converter.py`, se publica por WS como `shared_resource={ kind: "pdf_converter", scope: "global", status: "waiting"|"running" }` y `home_compact.py` la refleja en `GET /api/system/home-summary` mientras el ciclo documental siga abierto.

6. **Estado del transporte WS saliente compartido**
- Owner: `services/websocket_manager.py` + `services/runtime_metrics.py`.
- Modelo: cada conexión mantiene una cola saliente FIFO propia y un único writer task autorizado a hacer `websocket.send_text()`. `send_personal_message()`/`broadcast()` significan "payload aceptado por la cola" y no "flush físico ya completado". Desde 2026-04-20 el shell humano separa `/ws` para eventos globales (`workspace_fs_event`, `mcp_*`, control general, `.py`) y `/ws/notebook` para notebook/template/documento con un socket por sesión notebook.
- Política de protección: si la cola se satura, la conexión se cierra con `1013/outgoing_queue_saturated` para evitar que un notebook o pipeline DOCX/PDF lento deje wedgeado al resto de los productores que comparten la misma sesión humana.
- En frontend, `useAppWebSocket` replica ese aislamiento también en la retención local: la cola notebook ya no se recorta como buffer plano global, sino por bucket `socket/path`, preservando el orden local y evitando que una ráfaga de notebook A evicte los terminales de notebook B.
- Implicancia arquitectónica: la independencia real entre notebooks paralelos depende no solo de `kernel_id`/`execution_id`, sino también de aislar correctamente este transporte WS y de rebindear el ownership del kernel al socket notebook vigente; el riesgo residual de contención se acota al recurso Word/PDF global, no al canal de mensajes entre notebooks.

7. **Estado interno de aplicación y workspace**
- Owner: `workspace_service.py`.
- Persistencia: `workspace_state.json` y subdirectorios auxiliares bajo `INSPYRO_APP_STATE_DIR` (`%LOCALAPPDATA%\Inspyro` en Windows si no hay override), separados del árbol instalado.

8. **Estado de template DOCX**
- Owner: `template/storage.py` (persistencia), `template_extract.py` (modelo extraído + `style_browser` + `semantic_style_slots`), `template/preview.py` (cache LRU de previews), `template/mutation.py` y `template/table_format.py`, con fachada de compatibilidad en `template_service.py`.
- Persistencia: archivos por kernel y estructuras extraídas/cacheadas por sesión, por defecto bajo `INSPYRO_APP_STATE_DIR/templates` salvo override `INSPYRO_TEMPLATE_DIR`.
- En frontend, el ownership visible del template ya no vive en un shell-global `templateInfo/templateBlob`: queda particionado por notebook dentro de `notebookSessionsByPath`, y solo la sesión dueña puede reatachar o abrir su plantilla persistida.

9. **Estado de artefactos descargables**
- Owner: `docx_downloads.py`, `pdf_downloads.py`, `template_tokens.py`.
- Modelo: tokens efímeros para `docx_ref`, `pdf_ref` y `template_token`, evitando base64 masivo por WS.
- Persistencia: blobs temporales en `INSPYRO_APP_STATE_DIR/docx_downloads`, `INSPYRO_APP_STATE_DIR/pdf_downloads` e `INSPYRO_APP_STATE_DIR/template_tokens`, salvo override explícito por variable de entorno.

10. **Estado de contratos de comunicación**
- Owner canónico: `backend/main.py` (entrada WS) + `backend/app/contracts/ws_models.py` (validación tipada aditiva) + `docs/architecture/contracts-catalog.md` + `docs/llm-index.yaml`.

11. **Estado MCP por sesión**
- Owner: `backend/mcp_server/bridge.py`, `backend/mcp_server/session_state.py`, `backend/mcp_server/runtime.py`.
- Modelo: cada `session_id` MCP mantiene su propio bridge REST/WS, mapa `kernel_id <-> notebook_path`, artefactos DOCX/PDF, ejecuciones batch, perfil visible y roots efectivos; además conserva evidencia compacta de recovery por `execution_id` (payload terminal observado o artefacto exacto) para reconciliar disconnects WS sin agregar contratos backend nuevos. Desde 2026-04-20 las tools notebook capturan `session_id` una sola vez al inicio y lo propagan explícitamente a bridge, locks, background tasks, late relays y `session_state`, evitando fugas por resolución tardía o fallback implícito entre sesiones.

12. **Estado LSP por conexión**
- Owner: `services/lsp_bridge.py`.
- Modelo: cada conexión `/ws/lsp` levanta su propio proceso `pylsp`; en Windows el arranque usa `subprocess.Popen` y la E/S bloqueante se envuelve con `asyncio.to_thread` para evitar la limitación del event loop selector de uvicorn.

---

## Ruta de lectura recomendada para IA

1. `docs/llm-index.yaml`
2. `docs/architecture/contracts-catalog.md`
3. `docs/architecture/feature-threads.md`
4. Módulo específico en `docs/modules/`.

---

## Regla de mantenimiento cruzado

Si cambia la arquitectura global o la interacción entre capas, actualizar en la misma sesión:

1. `docs/architecture/system-context.md`
2. `docs/architecture/feature-threads.md`
3. `docs/architecture/synergy-matrix.md`
4. `docs/llm-index.yaml`
