<#
.SYNOPSIS
    Herramientas de desarrollo para Inspyro (Windows PowerShell)

.DESCRIPTION
    Script equivalente a dev_tools.sh para gestionar el entorno de desarrollo en Windows.

.EXAMPLE
    .\dev_tools.ps1 deps
    .\dev_tools.ps1 restart
#>

param(
    [string]$Command = "help",
    [string]$Arg2 = ""
)

$ErrorActionPreference = "Stop"

function Show-Status {
    Write-Host "ESTADO DE INSPYRO:" -ForegroundColor Cyan
    Write-Host "-----------------------------------------------------------------------" -ForegroundColor Cyan
    
    $backendProcess = Get-Process -Name "python" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*main.py*" }
    $frontendProcess = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*react-scripts start*" }

    if ($backendProcess) {
        Write-Host "Backend:  Corriendo (Ids: $($backendProcess.Id))" -ForegroundColor Green
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:8000/health" -Method Get -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Host "  -- API Respondiendo" -ForegroundColor Green
            }
        } catch {
             Write-Host "  -- API No responde" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Backend:  Detenido" -ForegroundColor Red
    }

    if ($frontendProcess) {
        Write-Host "Frontend: Corriendo" -ForegroundColor Green
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3000/" -Method Get -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Host "  -- Web Disponible" -ForegroundColor Green
            }
        } catch {
             Write-Host "  -- Web No disponible" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Frontend: Detenido" -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host "URLs:"
    Write-Host "- Frontend: http://localhost:3000"
    Write-Host "- Backend:  http://localhost:8000"
    Write-Host "- API Docs: http://localhost:8000/docs"
}

switch ($Command) {
    {$_ -in "deps", "sync", "dependencies"} {
        Write-Host "Sincronizando dependencias..." -ForegroundColor Cyan
        $RequirementsFile = Join-Path "backend" "requirements.txt"
        
        if (-not (Test-Path $RequirementsFile)) {
            Write-Error "No se encontro $RequirementsFile"
            exit 1
        }

        # Buscar venv
        $VenvCandidates = @("venv_inspyro", "backend\.venv", ".venv", "venv")
        $Updated = $false
        
        foreach ($VPath in $VenvCandidates) {
            if (Test-Path "$VPath\Scripts\Activate.ps1") {
                Write-Host "Actualizando entorno: $VPath" -ForegroundColor Cyan
                # Usar rutas absolutas o relativas explicitas a los ejecutables del venv
                & "$VPath\Scripts\python.exe" -m pip install --upgrade pip
                & "$VPath\Scripts\pip.exe" install -r $RequirementsFile
                $Updated = $true
            }
        }

        if (-not $Updated) {
            Write-Warning "No se detectaron entornos virtuales locales. Crea uno con: python -m venv venv_inspyro"
        }

        # Docker rebuild (opcional)
        if (Test-Path "docker-compose.yml") {
            if (Get-Command "docker" -ErrorAction SilentlyContinue) {
                if ($Arg2 -ne "--no-docker") {
                    Write-Host "Reconstruyendo imagen backend..." -ForegroundColor Cyan
                    docker compose build backend
                }
            }
        }
        
        # Frontend Dependencies
        if (Test-Path "frontend\package.json") {
             Write-Host "Instalando dependencias de frontend..." -ForegroundColor Cyan
             Push-Location "frontend"
             npm install
             Pop-Location
        }
    }

    {$_ -in "restart", "r"} {
        Write-Host "Reiniciando Inspyro..." -ForegroundColor Cyan
        .\restart_inspyro.ps1
    }

    {$_ -in "stop", "s"} {
        Write-Host "Deteniendo servidores..." -ForegroundColor Cyan
        Get-Process -Name "python" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*main.py*" } | Stop-Process -Force
        
        # En Windows detener node es mas agresivo
        Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*react-scripts start*" } | Stop-Process -Force
        
        Write-Host "Servidores detenidos" -ForegroundColor Green
    }

    {$_ -in "status", "st"} {
        Show-Status
    }

    {$_ -in "test", "t"} {
        Write-Host "PRUEBA RAPIDA DE CONECTIVIDAD" -ForegroundColor Cyan
        try {
            Invoke-WebRequest -Uri "http://localhost:8000/health" -Method Get -ErrorAction Stop | Out-Null
            Write-Host "Backend (8000): OK" -ForegroundColor Green
        } catch {
            Write-Host "Backend (8000): NO RESPONDE" -ForegroundColor Red
        }

        try {
            Invoke-WebRequest -Uri "http://localhost:3000/" -Method Get -ErrorAction Stop | Out-Null
            Write-Host "Frontend (3000): OK" -ForegroundColor Green
        } catch {
            Write-Host "Frontend (3000): NO RESPONDE" -ForegroundColor Red
        }
    }

    {$_ -in "setup", "sf", "setup-frontend"} {
        Write-Host "CONFIGURANDO FRONTEND..." -ForegroundColor Cyan
        Set-Location "frontend"
        npm install
        Set-Location ..
    }

    {$_ -in "clean", "cl"} {
        Write-Host "LIMPIEZA PROFUNDA..." -ForegroundColor Cyan
        Write-Host "-----------------------------------------------------------------------" -ForegroundColor Cyan
        
        # Detener procesos
        Write-Host "Deteniendo servidores..." -ForegroundColor Cyan
        Get-Process -Name "python" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*main.py*" } | Stop-Process -Force
        Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*react-scripts start*" } | Stop-Process -Force
        
        # Limpiar cache del frontend
        if (Test-Path "frontend\node_modules") {
            Write-Host "Eliminando node_modules..." -ForegroundColor Yellow
            Remove-Item "frontend\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
        }
        
        if (Test-Path "frontend\.next") {
            Write-Host "Eliminando cache .next..." -ForegroundColor Yellow
            Remove-Item "frontend\.next" -Recurse -Force -ErrorAction SilentlyContinue
        }
        
        if (Test-Path "frontend\build") {
            Write-Host "Eliminando directorio build..." -ForegroundColor Yellow
            Remove-Item "frontend\build" -Recurse -Force -ErrorAction SilentlyContinue
        }
        
        Write-Host "Reinstalando dependencias..." -ForegroundColor Cyan
        Set-Location "frontend"
        npm install
        Set-Location ..
        
        Write-Host "Limpieza completada" -ForegroundColor Green
    }
    
    Default {
        Write-Host "HERRAMIENTAS DE DESARROLLO INSPYRO (Windows)" -ForegroundColor Yellow
        Write-Host "Comandos:"
        Write-Host "  deps     - Instalar dependencias"
        Write-Host "  restart  - Reiniciar servidores"
        Write-Host "  stop     - Detener servidores"
        Write-Host "  status   - Ver estado"
        Write-Host "  setup    - Configurar frontend"
    }
}
