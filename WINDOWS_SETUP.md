# Configuración en Windows

Este proyecto es totalmente compatible con Windows. Sigue esta guía para preparar tu entorno.

## Prerrequisitos

1. **Python 3.10+**: [Descargar Python](https://www.python.org/downloads/)
   - *Importante*: Marca la casilla "Add Python to PATH" durante la instalación.
2. **Node.js (LTS)**: [Descargar Node.js](https://nodejs.org/)
3. **LibreOffice**: [Descargar LibreOffice](https://www.libreoffice.org/)
   - Necesario para la conversión de DOCX a PDF.
   - Instala en la ruta por defecto (`C:\Program Files\LibreOffice`) o añade el directorio `program` a tu PATH del sistema.
4. **Git**: [Descargar Git](https://git-scm.com/)

## Instalación

1. **Clonar el repositorio**:
   ```powershell
   git clone <URL_DEL_REPO>
   cd <NOMBRE_DEL_REPO>
   ```

2. **Crear entorno virtual**:
   ```powershell
   python -m venv venv_inspyro
   ```

3. **Instalar dependencias**:
   Ejecuta el script de herramientas de desarrollo (PowerShell):
   ```powershell
   .\dev_tools.ps1 deps
   ```
   Esto instalará las dependencias de Python (backend) y Node.js (frontend).

## Ejecución

Para iniciar la aplicación (Backend + Frontend):

```powershell
.\dev_tools.ps1 r
```
o
```powershell
.\dev_tools.ps1 restart
```

Esto abrirá dos ventanas nuevas: una para el servidor backend y otra para el frontend.

## Comandos Útiles

El script `dev_tools.ps1` es tu centro de control:

- `.\dev_tools.ps1 status` (`st`): Ver si los servidores están corriendo.
- `.\dev_tools.ps1 stop` (`s`): Detener todos los servidores.
- `.\dev_tools.ps1 test` (`t`): Probar conectividad rápidamente.
- `.\dev_tools.ps1 help`: Ver todos los comandos.

## Solución de Problemas常见

- **Políticas de Ejecución**: Si al ejecutar `.ps1` recibes un error de seguridad, ejecuta PowerShell como Administrador y corre:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```
- **LibreOffice no encontrado**: Si la generación de PDF falla, asegúrate de que `soffice.exe` esté accesible o en la ruta predeterminada `C:\Program Files\LibreOffice\program\soffice.exe`.
