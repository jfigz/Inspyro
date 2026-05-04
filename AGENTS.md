# AGENTS.md - Hub LLM-First de Inspyro

> **Propósito:** punto de entrada único para agentes IA/LLMs, con prioridad de fuentes, rutas de lectura y reglas de mantenimiento cruzado.
> **Codificación:** toda la documentación (`AGENTS.md`, `docs/**/*.md`, `docs/**/*.yaml`) debe estar en UTF-8 con BOM.
> **Última actualización:** 2026-04-20

> [!IMPORTANT]
> **Prioridad de fuentes (source of truth):**
> 1. `docs/llm-index.yaml`
> 2. `docs/architecture/contracts-catalog.md`
> 3. `docs/architecture/feature-threads.md`
> 4. `docs/modules/*.md`
> 5. Referencias extendidas (ej: `LLM_GUIDE_DOCX.md`)

> [!IMPORTANT]
> **Flujo obligatorio para agentes:** usa `./agent_debug.ps1` (`bootstrap-agent`, `verify-fast`, `verify`, `contracts-check`, `docs-check`, `mcp-smoke` cuando toques MCP y `mcp-torture` cuando necesites cobertura live exhaustiva notebook-first).
> **Primer paso obligatorio:** leer `docs/llm-index.yaml` completo antes de cualquier cambio.
> **Cierre de sesión obligatorio:** ejecutar `./agent_debug.ps1 docs-check` después de cambios documentales.

---

## 1) Ruta obligatoria de lectura para IA

### Si el objetivo es entender el sistema global
1. `docs/llm-index.yaml`
2. `docs/architecture/system-context.md`
3. `docs/architecture/feature-threads.md`
4. `docs/architecture/contracts-catalog.md`

### Si el objetivo es cambiar backend
1. `docs/llm-index.yaml`
2. `docs/architecture/contracts-catalog.md`
3. módulo backend correspondiente en `docs/modules/`
4. `docs/architecture/synergy-matrix.md`

### Si el objetivo es cambiar frontend
1. `docs/llm-index.yaml`
2. `docs/architecture/frontend-flow.md`
3. módulo frontend correspondiente en `docs/modules/`
4. `docs/architecture/synergy-matrix.md`

### Si el objetivo es cambiar contratos WS/REST
1. `backend/main.py` (dispatcher real)
2. `docs/architecture/contracts-catalog.md`
3. `docs/llm-index.yaml`
4. módulos backend/frontend impactados

---

## 2) Mapa rápido de sinergias

| Área | Módulo núcleo | Módulos acoplados |
|------|----------------|-------------------|
| Ejecución notebook | `04-notebook-handlers` | `09-jupyter-kernel`, `01-document-generation-docx`, `11-notebook-editor-ui`, `14-main-app` |
| Template DOCX | `17-template-editor` | `04-notebook-handlers`, `09-jupyter-kernel`, `01-document-generation-docx`, `14-main-app` |
| Dependencias/sensibilidad | `06` + `07` | `11-notebook-editor-ui`, `12-dependency-graph-ui`, `09-jupyter-kernel` |
| Edición archivos | `03-file-system-api` | `14-main-app`, `11-notebook-editor-ui` |
| LSP | `08-lsp-bridge` | `13-monaco-editor`, `14-main-app` |
| Servidor MCP | `19-mcp-server` | `04`, `03`, `01`, `06`, `07`, `17`, `18` (consume todos via REST/WS como cliente local) |
| Shell desktop | `24-desktop-shell` | `14-main-app`, `08-lsp-bridge`, `19-mcp-server` |

Ver matriz completa: `docs/architecture/synergy-matrix.md`.

---

## 3) Reglas generales de mantenimiento cruzado

> [!IMPORTANT]
> Después de cambios significativos en código o documentación, la IA **DEBE** actualizar docs afectadas en la misma sesión.
> Si se crea una nueva caracteristica, se debe crear la documentacion en todos los lugares que deba ir, y actualizar la documentacion que haga referencia a esta.

### Reglas obligatorias

1. Si cambia un mensaje WS en `backend/main.py`:
- actualizar `docs/architecture/contracts-catalog.md`
- actualizar `docs/llm-index.yaml`
- actualizar módulos backend/frontend impactados

2. Si cambia un flujo E2E:
- actualizar `docs/architecture/feature-threads.md`
- actualizar `docs/architecture/synergy-matrix.md`
- actualizar `docs/llm-index.yaml` (`flows`)

3. Si cambia ownership de estado o concurrencia:
- actualizar `docs/architecture/system-context.md`
- actualizar módulo(s) con lock/semaphore/queue impactados

4. Si se agrega o elimina funcionalidad:
- crear/retirar módulo documental en `docs/modules/` según corresponda
- crear/actualizar `docs/changelog/<id>-<slug>.md`

5. Siempre actualizar la fecha **Última actualización** en archivos modificados.

6. Evitar métricas estáticas no canónicas (por ejemplo conteo de líneas) o marcarlas explícitamente como referenciales.

---

## 4) Inventario completo de documentación

## Arquitectura global (`docs/architecture/`)

| Archivo | Propósito |
|---------|-----------|
| `overview.md` | Índice de arquitectura y fuentes canónicas |
| `system-context.md` | Capas, límites y ownership de estado |
| `feature-threads.md` | Flujos E2E y sinergias entre módulos |
| `contracts-catalog.md` | Catálogo canónico WS/REST |
| `synergy-matrix.md` | Matriz módulo↔módulo e impacto |
| `glossary.md` | Glosario técnico estable para IA |
| `backend-flow.md` | Resumen operativo del backend |
| `frontend-flow.md` | Resumen operativo del frontend |

## Índices LLM

| Archivo | Propósito |
|---------|-----------|
| `docs/llm-index.yaml` | Enrutamiento canónico para IA (módulos, contratos, flujos, mantenimiento) |
| `docs/agents/quickstart.md` | Onboarding operativo de agentes y gates |
| `docs/agents/task-routing.yaml` | Mapa intención→rutas→checks para ejecución IA |

## Módulos (`docs/modules/`)

| # | Archivo |
|---|---------|
| 01 | `01-document-generation-docx.md` |
| 02 | `02-websocket-manager.md` |
| 03 | `03-file-system-api.md` |
| 04 | `04-notebook-handlers.md` |
| 05 | `05-code-execution.md` |
| 06 | `06-dependency-analyzer.md` |
| 07 | `07-sensitivity-analyzer.md` |
| 08 | `08-lsp-bridge.md` |
| 09 | `09-jupyter-kernel.md` |
| 11 | `11-notebook-editor-ui.md` |
| 12 | `12-dependency-graph-ui.md` |
| 13 | `13-monaco-editor.md` |
| 14 | `14-main-app.md` |
| 15 | `15-notification-center.md` |
| 16 | `16-ui-automation-guide.md` |
| 17 | `17-template-editor.md` |
| 18 | `18-engineering-units.md` |
| 19 | `19-mcp-server.md` |
| 24 | `24-desktop-shell.md` |
| - | `_module-template.md` |
| - | `main.md` |

## Historial por módulo (`docs/changelog/`)

- `README.md`
- `01-document-generation-docx.md` ... `18-engineering-units.md` (por ID)
- `19-mcp-server.md`
- `20-code-quality-refactor.md`
- `21-architecture-and-performance.md`
- `22-repo-hygiene-cleanup.md`
- `24-desktop-shell.md`

## Referencias extendidas

| Archivo | Uso |
|---------|-----|
| `LLM_GUIDE_DOCX.md` | Deep-dive de API DOCX y uso de bajo nivel |

---

## 5) Qué es Inspyro

IDE web orientado a ingenierías y ciencias duras con ejecución local de Python que combina:

- Notebooks Jupyter con kernel real
- Autocompletado LSP via pylsp
- Generación DOCX/PDF desde código
- Grafos de dependencias interactivos
- Servidor MCP local para interacción con modelos de IA (Claude, GPT, Gemini, etc.)
- Shell desktop Electron Windows-first que encapsula la UI web sin navegador externo

---

## 6) Estructura del proyecto

```text
P1/
├── AGENTS.md
├── backend/
│   ├── main.py
│   └── app/
│       ├── routers/
│       ├── services/
│       └── core/
│   └── mcp_server/          ← Servidor MCP local (módulo 19)
│       ├── server.py        ← Entry point FastMCP 3.0
│       ├── bridge.py        ← Bridge REST+WS session-scoped
│       ├── runtime.py       ← Helpers de session/roots/progress/profile
│       ├── tools/           ← 52 herramientas MCP
│       ├── resources/       ← 14 resources MCP + 7 resource templates
│       └── prompts/         ← 7 prompts MCP
├── desktop/                 ← Shell Electron + packaging Windows (módulo 24)
│   ├── main.js              ← Main process + backend sidecar lifecycle
│   ├── preload.js           ← Bridge seguro `window.inspyroDesktop`
│   └── scripts/             ← Dev full + staging de recursos/runtime
├── frontend/
│   └── src/
├── tools/
│   └── release/
└── docs/
    ├── architecture/
    ├── modules/
    ├── changelog/
    ├── tools/
    └── llm-index.yaml
```

---

## 7) Convenciones del proyecto

- **Backend:** Python 3.12+, FastAPI, async/await
- **Frontend:** React 18, hooks, functional components
- **Desktop:** Electron + `electron-builder` (NSIS Windows)
- **Comunicación:** WebSocket JSON + REST
- **Estilos:** CSS vanilla (sin Tailwind)
- **Scripts release/paquetizado:** `tools/release/`
- **Scripts de diagnóstico backend:** `backend/dev/` usando convención `*_probe.py` o `*_debug.py`
- **Tests backend canónicos:** solo `backend/tests/test_*.py`
- **Prohibición:** no crear `test_*.py` en raíz del repo ni en `backend/dev/`

---

## 8) Setup y desarrollo

## Requisitos

### Software
- Python 3.12+
- Node.js 18+
- Microsoft Word o LibreOffice (para conversión PDF)

### Dependencias Python principales

```text
fastapi
uvicorn[standard]
jupyter_client
ipykernel
python-lsp-server[all]
python-docx
websockets
networkx
```

### Dependencias MCP (opcional, para servidor MCP)

```text
fastmcp>=3.0.0
mcp[cli]>=1.9.0
httpx>=0.27.0
websockets>=13.0
```

Instalar con: `pip install -r backend/mcp_server/requirements-mcp.txt`

## Instalación rápida (si es requerida)

### Windows

```powershell
git clone https://github.com/jfigz/Inspyro.git
cd P2
python -m venv venv_inspyro
.\venv_inspyro\Scripts\activate
pip install -r backend/requirements.txt
cd frontend
npm install
cd ..
.\restart_inspyro.ps1
```

### Linux/WSL

```bash
git clone https://github.com/jfigz/Inspyro.git
cd P2
python3 -m venv venv_inspyro
source venv_inspyro/bin/activate
pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
./restart_inspyro.sh
```

---

## 9) Comandos de desarrollo

### Windows (PowerShell)

```powershell
# Agente: debug inline (backend + frontend)
.\agent_debug.ps1 start

# Logs
.\agent_debug.ps1 logs

# Stop
.\agent_debug.ps1 stop

# Validación documental obligatoria al cierre
.\agent_debug.ps1 docs-check

# Sincronía estricta de contratos WS (runtime vs docs)
.\agent_debug.ps1 contracts-check

# Gate rápido para iteración de agentes
.\agent_debug.ps1 verify-fast

# Gate completo antes de merge
.\agent_debug.ps1 verify

# Onboarding automático de agente (doctor + deps condicional + gates)
.\agent_debug.ps1 bootstrap-agent

# Iniciar todo (flujo humano, desktop por defecto)
.\restart_inspyro.ps1

# Compatibilidad legacy: backend + frontend web
.\restart_inspyro.ps1 -Mode Web

# Shell desktop (requiere `cd desktop && npm install` una vez)
cd desktop; npm run dev       # usa frontend :3000 + backend :8000 ya levantados
cd desktop; npm run dev:full  # levanta backend + frontend + Electron (lo usa restart_inspyro.ps1)
cd desktop; npm run dist      # empaqueta instalador NSIS con runtime Python portable

# Dependencias
.\agent_debug.ps1 deps

# Smoke reproducible MCP
.\agent_debug.ps1 mcp-smoke

# Campaña exhaustiva MCP notebook-first
.\agent_debug.ps1 mcp-torture

# Servidor MCP (requiere backend activo en :8000)
cd backend; python -m mcp_server                                  # Streamable HTTP SSE/stateful en :8100
cd backend; python -m mcp_server --json-response --stateless-http # HTTP JSON amigable para clientes genéricos
cd backend; python -m mcp_server --wait-for-backend 20            # espera backend antes de fallar
cd backend; python -m mcp_server --stdio                          # modo stdio para CLI
fastmcp dev backend/mcp_server/server.py                          # Inspector web interactivo
```

### Linux

```bash
./restart_inspyro.sh
cd backend && source ../venv_inspyro/bin/activate && python main.py
cd frontend && npm start
```

---

## 10) Puertos

| Servicio | Puerto | URL |
|----------|--------|-----|
| Backend (FastAPI) | 8000 | http://localhost:8000 |
| Frontend (React) | 3000 | http://localhost:3000 |
| Desktop backend empaquetado | dinámico | same-origin del shell Electron |
| WebSocket principal | 8000 | ws://localhost:8000/ws |
| WebSocket LSP | 8000 | ws://localhost:8000/ws/lsp |
| Servidor MCP | 8100 | http://localhost:8100/mcp |

---

## 11) Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `INSPYRO_WS_DEBUG` | Logs de WebSocket | `0` |
| `INSPYRO_PDF_TIMEOUT` | Timeout general de conversión PDF (segundos) | `600` |
| `INSPYRO_NOTEBOOK_DEBUG` | Logs de kernel notebook | `0` |
| `INSPYRO_NOTEBOOK_EXECUTION_TIMEOUT` | Timeout por defecto de `notebook_execute_cell` | `600` |
| `INSPYRO_NOTEBOOK_PDF_TIMEOUT` | Timeout del postproceso DOCX/PDF disparado desde notebook | `600` |
| `INSPYRO_KERNEL_TIMEOUT` | Timeout low-level de `execute_cell()` cuando no se pasa override | `600` |
| `INSPYRO_KERNEL_IDLE_TIMEOUT` | Timeout espera idle del kernel | `10` |
| `INSPYRO_LOCK_TIMEOUT` | Timeout para locks por kernel | `60` |
| `INSPYRO_FILES_READ_MAX_BYTES` | Límite de lectura para `GET /api/files/read` (bytes) | `104857600` |
| `INSPYRO_TEMPLATE_PREVIEW_TIMEOUT` | Timeout previews de template | `20` |
| `INSPYRO_TEMPLATE_STYLE_PREVIEW_CONCURRENCY` | Concurrencia preview estilo | `1` |
| `INSPYRO_TEMPLATE_TABLE_PREVIEW_CONCURRENCY` | Concurrencia preview tabla | `1` |
| `INSPYRO_TEST_FORCE_DOCX` | Fuerza export DOCX en pruebas | - |
| `INSPYRO_MCP_PORT` | Puerto del servidor MCP | `8100` |
| `INSPYRO_MCP_HOST` | Host del servidor MCP | `127.0.0.1` |
| `INSPYRO_MCP_JSON_RESPONSE` | Responde HTTP en JSON puro en vez de SSE | `0` |
| `INSPYRO_MCP_STATELESS_HTTP` | Crea una sesión HTTP nueva por request | `0` |
| `INSPYRO_MCP_WAIT_FOR_BACKEND_SEC` | Espera/reintento del backend al arrancar MCP (segundos) | `0` |
| `INSPYRO_BACKEND_URL` | URL del backend para el bridge MCP | `http://127.0.0.1:8000` |
| `INSPYRO_BACKEND_WS_URL` | URL WS del backend para el bridge MCP | `ws://127.0.0.1:8000/ws` |
| `INSPYRO_MCP_LOG_LEVEL` | Nivel de logs del servidor MCP | `INFO` |
| `INSPYRO_MCP_WS_TIMEOUT` | Timeout WS del bridge MCP (segundos) | `60` |
| `INSPYRO_MCP_REST_TIMEOUT` | Timeout REST del bridge MCP (segundos) | `30` |
| `INSPYRO_MCP_CELL_TIMEOUT` | Timeout ejecución celda via MCP (segundos) | `600` |
| `INSPYRO_MCP_ARTIFACT_WAIT_TIMEOUT` | Espera máxima por artefactos DOCX/PDF tardíos en document tools MCP | `600` |
| `INSPYRO_MCP_BATCH_ARTIFACT_WAIT_TIMEOUT` | Espera máxima del resumen batch MCP por el DOCX final visible del lote | `600` |
| `INSPYRO_DESKTOP` | Activa runtime desktop/electron-safe en backend | `0` |
| `INSPYRO_SERVE_FRONTEND` | Sirve `frontend/build` desde FastAPI | `0` |
| `INSPYRO_FRONTEND_BUILD_DIR` | Ruta explícita al build del frontend para same-origin | auto |
| `INSPYRO_BACKEND_PORT` | Puerto backend configurable para desktop/prod | `8000` |
| `INSPYRO_ENABLE_DEV_CORS` | Rehabilita CORS de desarrollo cuando haga falta | `auto` |
| `REACT_APP_INSPYRO_DEBUG` | Activa trazas frontend verbose (`App`, viewers, hooks) solo cuando se necesiten diagnósticos | `0` |

---

## 12) Endpoints API

### REST

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/` | Info del servidor |
| GET | `/health` | Health check + métricas |
| GET | `/metrics` | Métricas detalladas |
| GET | `/pdf-status` | Estado de conversión PDF |
| GET | `/api/system/info` | Info de entorno y workspace |
| GET | `/api/files/tree?path=...` | Árbol de directorios |
| GET | `/api/files/read?path=...` | Leer archivo |
| POST | `/api/files/write` | Escribir archivo |
| POST | `/api/files/create` | Crear archivo/carpeta |
| DELETE | `/api/files/delete?path=...` | Eliminar |
| POST | `/api/files/rename` | Renombrar |
| GET | `/api/docx/download?token=...` | Descargar DOCX temporal |

### WebSocket `/ws`

El catálogo canónico vive en `docs/architecture/contracts-catalog.md`.

Mensajes de entrada clave:
- `notebook_*`
- `analyze_*`
- `sensitivity_analyze`
- `template_*`
- `execute_code`
- `reconvert_pdf` / `force_reconvert_pdf`
- `clear_mdoc`
- `ping`

---

## 13) Troubleshooting

### Backend no inicia

1. Verificar archivo principal:
```bash
ls backend/main.py
```
2. Verificar Python/venv:
```bash
python --version
```
3. Verificar puerto 8000:
```bash
# Linux
lsof -i :8000
# Windows
netstat -ano | findstr :8000
```

### WebSocket no conecta

1. Confirmar backend activo.
2. Verificar dependencia:
```bash
pip show websockets
```
3. Revisar logs con `./agent_debug.ps1 logs`.

### LSP no reconoce API custom

1. Verificar stubs:
```bash
ls backend/stubs/
```
2. Validar sintaxis:
```bash
python -m py_compile backend/stubs/docx_api.pyi
```
3. Reiniciar app.

### PDF no se genera

**Windows**
- Verificar Microsoft Word instalado.
- O LibreOffice: `soffice --version`

**Linux**
- Verificar LibreOffice: `soffice --version`
- Instalar si falta: `sudo apt install libreoffice`

### Notebook muy grande

Si un `.ipynb` pesa demasiado (outputs embebidos), puedes limpiar las salidas:

```powershell
python tools\clean_notebook_outputs.py "C:\ruta\archivo.ipynb" --in-place
```

Opcional: agrega `--drop-widgets` para eliminar estado de widgets embebido.
### Documentación inconsistente

1. Ejecutar validación documental:
```powershell
.\agent_debug.ps1 docs-check
```
2. Resolver errores de BOM, links, contratos WS o fechas.

---

## 14) Agregar nuevas APIs al LSP

1. Crear stub:
```bash
touch backend/stubs/mi_api.pyi
```
2. Definir signatures/docstrings.
3. Reiniciar aplicación para reconexión LSP.

---

## 15) Arquitectura de concurrencia (resumen)

### Locks por kernel

```python
async with _get_kernel_lock(kernel_id):
    await execute_cell(...)
```

### Lock por sesión de kernel

```python
# KernelSession.execute_lock serializa shell/iopub
await jupyter_kernel_manager.execute_cell(...)
```

### Pools de ejecución

```python
_cpu_pool = ProcessPoolExecutor(max_workers=4)
_io_pool = ThreadPoolExecutor(max_workers=8)
```

### Lock de conexiones WebSocket

```python
# ConnectionManager usa asyncio.Lock para connect/disconnect
async with self._lock:
    self.active_connections.append(websocket)
```

### Lock de caché PDF

```python
# threading.Lock (no asyncio.Lock) porque las conversiones
# corren en threads COM/STA separados del event loop
with _pdf_cache_lock:
    _pdf_cache[key] = pdf_b64
```

---

## 16) Limpieza de recursos

```python
@asynccontextmanager
async def lifespan(app):
    yield
    await jupyter_kernel_manager.shutdown_all_kernels()
```

También se limpian pools y tareas de background al apagar servicios.

---

## 17) Checklist de cierre para agentes IA

1. ¿Actualizaste módulos/documentos afectados por el cambio?
2. ¿Actualizaste `docs/llm-index.yaml` si cambió contratos o flujos?
3. ¿Actualizaste `Última actualización` en todos los archivos tocados?
4. ¿Moviste histórico largo a `docs/changelog/` cuando corresponde?
5. ¿Ejecutaste `./agent_debug.ps1 docs-check` y quedó en OK?
6. ¿Ejecutaste `./agent_debug.ps1 contracts-check` tras cambios de dispatcher/contratos?
