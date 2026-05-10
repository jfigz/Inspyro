# Protocolo de Publicación Pública de Inspyro

> **Última actualización:** 2026-05-09
> **Objetivo:** ejecutar releases públicos reproducibles con un agente IA, separando código privado, artefactos generados y despliegue web.

---

## 1. Principios obligatorios

1. `P1` es fuente local y privada: el protocolo puede crear un commit local de bump, pero nunca empuja ese repo.
2. `Inspyro-public` es espejo saneado exacto del producto publicable y se sincroniza solo desde archivos versionados de `P1`.
3. Ningún secreto, entorno virtual, build intermedio, output local, cache, evidencia de agentes o ruta privada debe quedar trackeado ni publicado.
4. Toda acción irreversible requiere confirmación textual explícita del usuario antes de continuar.
5. Si falla un gate, auditoría, build, smoke, push, release o verificación web, el agente se detiene.

---

## 2. Scripts canónicos

El flujo vive en `tools/release/`:

- `public_release.ps1`: orquestador para `plan`, `prepare`, `publish`, `web-only` y `dry-run`.
- `public_release.config.json`: configuración versionada con rutas relativas, repo público, dominio web, denylist y archivos de versión.
- `sync_public_repo.py`: copia archivos trackeados saneados hacia `Inspyro-public` y, con aprobación, borra tracking público obsoleto.
- `audit_public_tree.py`: falla ante rutas denylist, secretos probables, rutas privadas y artefactos generados.
- `update_webpage.py`: actualiza enlaces de release/instalador, badge de versión y cache buster de `Webpage/v3`.
- `deploy_hostinger.ps1`: sube `Webpage/v3` por FTP/FTPS usando secretos desde variables de entorno.

Comando de inspección inicial:

```powershell
.\tools\release\public_release.ps1 -Mode plan
```

Dry-run no publicable:

```powershell
.\tools\release\public_release.ps1 -Mode dry-run -Version 1.2.3 -DeleteMissingPublic -NoHostinger
```

Preparación local sin GitHub ni Hostinger:

```powershell
.\tools\release\public_release.ps1 -Mode prepare -Version 1.2.3 -DeleteMissingPublic -NoPublish -NoHostinger
```

Publicación completa:

```powershell
.\tools\release\public_release.ps1 -Mode publish -Version 1.2.3 -DeleteMissingPublic
```

---

## 3. Prompt mínimo para agentes

Si se quiere delegar un release a otro agente, basta con pasarle este archivo y pedir:

```text
crea un nuevo release
```

El agente debe leer este protocolo completo, entrar primero en planificación y preguntar la información faltante antes de ejecutar cualquier mutación. Como prompt explícito reutilizable, puede usarse:

```text
Lee y sigue estrictamente docs/release/public-publication-protocol.md.
Quiero crear un nuevo release público de Inspyro versión X.Y.Z.
Usa tools/release/public_release.ps1 como orquestador.
No empujes P1/P2. Solo usa P1 como fuente local.
Antes de cualquier acción irreversible, haz las preguntas críticas del protocolo.
Si falla cualquier gate, auditoría, build, smoke, publicación o verificación web, detente y reporta el bloqueo.
```

Si el usuario no entrega `X.Y.Z`, el agente debe preguntar la versión objetivo durante la planificación. Si falta información de Hostinger, aprobación de borrados públicos, aprobación de runtime, notas de release o publicación final, el agente debe preguntar justo antes del paso correspondiente.

---

## 4. Preguntas críticas para el usuario

Antes de mutar archivos:

1. Confirmar versión semver objetivo `X.Y.Z`.
2. Confirmar que se acepta continuar si `P1` o `Inspyro-public` tienen cambios locales.
3. Confirmar que se acepta borrar del tracking público lo que ya no exista en el espejo saneado.
4. Confirmar uso del runtime portable detectado para empaquetado, o detenerse si no existe.

Antes de publicar:

1. Confirmar que las notas de release generadas fueron revisadas y aprobadas.
2. Confirmar `git push` de `main` y tag `vX.Y.Z` en `jfigz/Inspyro`.
3. Confirmar creación de GitHub Release con el instalador principal.
4. Confirmar upload a Hostinger para `openpyro.org`.

El agente no debe reemplazar estas confirmaciones por suposiciones.

---

## 5. Flujo de ejecución

### Preflight

1. Leer `docs/llm-index.yaml`.
2. Ejecutar `git status --short --branch` en fuente local y espejo público.
3. Verificar `gh auth status`.
4. Verificar que el tag `vX.Y.Z` no exista en `Inspyro-public` ni en `origin`.
5. Verificar runtime portable para `desktop` cuando se hará build.

### Preparación local

1. Actualizar versión en `desktop/package.json`, `desktop/package-lock.json`, `frontend/package.json` y `frontend/package-lock.json`.
2. Crear commit local en fuente privada: `Bump Inspyro to vX.Y.Z`.
3. Ejecutar `.\agent_debug.ps1 bootstrap-agent`, `verify-fast`, `contracts-check` y `verify`.
4. Sincronizar `Inspyro-public` con `sync_public_repo.py --delete-missing`.
5. Ejecutar `audit_public_tree.py` contra el espejo público.
6. Actualizar `Webpage/v3` con `update_webpage.py` y generar `output/openpyro-v3-hostinger.zip`.

### Build y release

1. En `Inspyro-public`, ejecutar `docs-check` y `verify-fast`.
2. Ejecutar `npm ci` en `frontend` y `desktop` si corresponde.
3. Ejecutar `npm run dist` y `npm run smoke:packaged` en `desktop`.
4. Validar `desktop/dist/Inspyro-Setup-X.Y.Z-x64.exe` y calcular SHA256.
5. Crear commit público `Release vX.Y.Z`.
6. Crear tag anotado `vX.Y.Z`.
7. Subir `main` y el tag.
8. Crear GitHub Release `Inspyro vX.Y.Z` con el instalador.

### Web y Hostinger

1. Variables requeridas:

```powershell
$env:HOSTINGER_FTP_HOST = "..."
$env:HOSTINGER_FTP_USER = "..."
$env:HOSTINGER_FTP_PASSWORD = "..."
```

2. Variables opcionales:

```powershell
$env:HOSTINGER_PROTOCOL = "ftps"
$env:HOSTINGER_REMOTE_DIR = "/public_html"
$env:HOSTINGER_DOMAIN = "openpyro.org"
```

3. Subir `Webpage/v3` con `deploy_hostinger.ps1`.
4. Verificar `https://openpyro.org/` y `https://openpyro.org/youtube.html`.
5. Confirmar que el HTML publicado contiene la versión, cache buster y URL del instalador nuevos.

---

## 6. Criterios de stop y rollback

Detener inmediatamente si:

- hay cambios locales que el usuario no aprueba;
- falla cualquier gate de `agent_debug.ps1`;
- la auditoría pública detecta secretos, rutas privadas o artefactos generados;
- el build o smoke empaquetado falla;
- el instalador esperado no existe;
- `gh release create` falla;
- Hostinger no devuelve contenido actualizado.

Rollback recomendado:

- antes de push público, corregir localmente y repetir desde `prepare`;
- después de push/tag, crear commit correctivo y nuevo release patch;
- si solo falla Hostinger, relanzar `web-only` tras corregir credenciales o ruta remota.

---

## 7. Aceptación

Un release queda aceptado solo cuando:

1. `Inspyro-public` no contiene denylist ni hallazgos de auditoría.
2. El instalador `Inspyro-Setup-X.Y.Z-x64.exe` existe y pasó smoke empaquetado.
3. GitHub Release `vX.Y.Z` existe con el instalador adjunto.
4. `openpyro.org` y `youtube.html` muestran enlaces actualizados.
5. El agente reporta SHA256 del instalador y URL final del release.
