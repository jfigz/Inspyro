# 03 - File System API

> **Estado:** Expandido para explorer lazy
> **Ubicacion:** `backend/app/routers/files.py`
> **Última actualización:** 2026-05-03
> **Changelog:** `docs/changelog/03-file-system-api.md`

---

## Proposito

Proveer el backend del explorer con:
- arbol lazy por carpeta
- busqueda por nombre dentro del workspace
- lectura/escritura de archivos
- create/delete/rename/move/copy/duplicate
- apertura explícita con aplicación por defecto del sistema operativo
- validacion de seguridad de paths
- batches WS `workspace_fs_event` para refresco externo del shell

## Archivos

| Archivo | Descripcion |
|---------|-------------|
| `backend/app/routers/files.py` | Endpoints REST de filesystem y helpers de arbol/search/mutate |
| `backend/app/services/file_watcher.py` | Watcher del workspace activo, batching y broadcast `workspace_fs_event` |
| `backend/main.py` | Registra el router y sincroniza el watcher al cambiar workspace |

## Endpoints REST

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/api/files/tree?path=...&depth=1&show_hidden=0` | Arbol lazy de directorio |
| GET | `/api/files/search?path=...&query=...&limit=50&show_hidden=0` | Busqueda por nombre |
| GET | `/api/files/read?path=...` | Lectura de archivo |
| POST | `/api/files/write` | Escritura de archivo |
| POST | `/api/files/create` | Crear archivo/carpeta |
| DELETE | `/api/files/delete?path=...` | Eliminar |
| POST | `/api/files/rename` | Rename same-directory |
| POST | `/api/files/move` | Move/rename cross-directory |
| POST | `/api/files/copy` | Copiar archivo/carpeta |
| POST | `/api/files/duplicate` | Duplicar en la misma carpeta |
| POST | `/api/files/open-default` | Abrir archivo con aplicacion por defecto |

## Payloads relevantes

### `GET /api/files/tree`

```json
{
  "name": "workspace",
  "path": "C:\\workspace",
  "isDirectory": true,
  "relativePath": ".",
  "hasChildren": true,
  "writable": true,
  "hidden": false,
  "symlink": false,
  "modified": 1743264000.0,
  "children": [
    {
      "name": "src",
      "path": "C:\\workspace\\src",
      "isDirectory": true,
      "relativePath": "src",
      "hasChildren": true,
      "children": []
    }
  ]
}
```

### `GET /api/files/search`

```json
{
  "query": "main",
  "rootPath": "C:\\workspace",
  "results": [
    {
      "path": "C:\\workspace\\src\\main.py",
      "name": "main.py",
      "relativePath": "src/main.py",
      "parentPath": "C:\\workspace\\src",
      "isDirectory": false,
      "extension": ".py",
      "score": 300,
      "writable": true,
      "hidden": false
    }
  ]
}
```

### Mutaciones

- `/api/files/create` espera `{ path, name, type }`
- `/api/files/rename` espera `{ oldPath, newName }`
- `/api/files/move` espera `{ sourcePath, destinationPath }`
- `/api/files/copy` espera `{ sourcePath, destinationPath }`
- `/api/files/duplicate` espera `{ sourcePath }`
- `/api/files/open-default` espera `{ path }`, exige un archivo existente y seguro, y delega la apertura a la aplicacion por defecto del sistema operativo donde corre el backend.

## Politica de visibilidad

- Exclusiones duras siempre ocultas: `.git`, `node_modules`, caches, `venv`, `.venv`, `__pycache__`.
- Dotfiles normales dependen de `show_hidden`.
- `modified` de directorio no se emite en `workspace_fs_event`; create/delete/move ya cubren el refresco estructural del arbol.

## Limites de lectura

- `GET /api/files/read` rechaza archivos mayores a `INSPYRO_FILES_READ_MAX_BYTES` (default `104857600` bytes, 100 MB).

## Watcher del workspace

- El watcher observa solo el `active_workspace`.
- Si `watchdog` no esta disponible o no puede arrancar, el explorer sigue operativo con refresh manual y refresco dirigido por otros eventos del shell.
- El payload WS es:

```json
{
  "type": "workspace_fs_event",
  "workspace_path": "C:\\workspace",
  "events": [
    {
      "action": "moved",
      "path": "C:\\workspace\\src\\main.py",
      "oldPath": "C:\\workspace\\legacy\\main.py",
      "parentPath": "C:\\workspace\\src",
      "isDirectory": false,
      "hidden": false,
      "ts": 1743264000.0
    }
  ]
}
```

## Testing

- `backend/tests/test_files_api.py`
- `backend/tests/test_file_watcher.py`

Smoke util:

```bash
curl "http://localhost:8000/api/files/tree?path=.&depth=1"
curl "http://localhost:8000/api/files/search?path=.&query=main"
curl "http://localhost:8000/api/files/read?path=AGENTS.md"
```

## Cambios recientes

| Fecha | Cambio |
|-------|--------|
| 2026-03-29 | Arbol lazy con metadata rica, busqueda por nombre, `move/copy/duplicate` y watcher `workspace_fs_event` |
| 2026-02-09 | Endpoints async mueven I/O pesado a `run_in_executor` |
