<#
.SYNOPSIS
    Launcher práctico para Inspyro en Windows.

.DESCRIPTION
    Modo por defecto: Desktop.
    - Desktop: limpia procesos previos y arranca backend + frontend + Electron usando `desktop/scripts/dev-full.mjs`.
    - Web: arranca backend y frontend por separado, y opcionalmente MCP standalone.

.EXAMPLE
    .\restart_inspyro.ps1

.EXAMPLE
    .\restart_inspyro.ps1 -Mode Web -StartStandaloneMcp
#>

[CmdletBinding()]
param(
    [ValidateSet("Desktop", "Web")]
    [string]$Mode = "Desktop",
    [switch]$SkipDeps,
    [switch]$StartStandaloneMcp,
    [switch]$Inline
)

$ErrorActionPreference = "Stop"

$RootPath = $PSScriptRoot
$DesktopDir = Join-Path $RootPath "desktop"
$FrontendDir = Join-Path $RootPath "frontend"
$BackendDir = Join-Path $RootPath "backend"
$ComparableRootPath = $RootPath.ToLowerInvariant()

function Write-Section {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::Cyan
    )

    Write-Host ""
    Write-Host $Message -ForegroundColor $Color
}

function Quote-PwshLiteral {
    param([string]$Value)
    return "'" + ($Value -replace "'", "''") + "'"
}

function Resolve-PythonExe {
    $candidates = @(
        (Join-Path $RootPath "venv_inspyro\Scripts\python.exe"),
        (Join-Path $RootPath "backend\.venv\Scripts\python.exe"),
        (Join-Path $RootPath ".venv\Scripts\python.exe"),
        (Join-Path $RootPath "venv\Scripts\python.exe")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    $globalPython = Get-Command python -ErrorAction SilentlyContinue
    if ($globalPython) {
        return $globalPython.Source
    }

    throw "No se encontró Python. Revisa el venv del proyecto o tu PATH."
}

function Resolve-NpmCmd {
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCmd) {
        return $npmCmd.Source
    }

    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($npm) {
        return $npm.Source
    }

    throw "No se encontró npm en PATH."
}

function Test-NodeModulesReady {
    param([string]$Directory)
    return (Test-Path (Join-Path $Directory "node_modules"))
}

function Ensure-NodeDeps {
    param(
        [string]$Directory,
        [string]$Label
    )

    if ($SkipDeps) {
        return
    }

    if (Test-NodeModulesReady -Directory $Directory) {
        return
    }

    $npmCmd = Resolve-NpmCmd
    Write-Host "Instalando dependencias de $Label..." -ForegroundColor Yellow
    Push-Location $Directory
    try {
        & $npmCmd install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install falló en $Label"
        }
    }
    finally {
        Pop-Location
    }
}

function Get-ProcessCommandLine {
    param([System.Diagnostics.Process]$Process)

    try {
        return [string]$Process.CommandLine
    }
    catch {
        return ""
    }
}

function Stop-MatchingProcesses {
    param(
        [scriptblock]$Predicate,
        [string]$Label
    )

    $matches = @()
    foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
        try {
            if (& $Predicate $process) {
                $matches += $process
            }
        }
        catch {
            # ignore process inspection failures
        }
    }

    if (-not $matches -or $matches.Count -eq 0) {
        return
    }

    Write-Host "- Deteniendo $Label..." -ForegroundColor Yellow
    foreach ($process in $matches | Sort-Object Id -Unique) {
        try {
            Stop-Process -Id $process.Id -Force -ErrorAction Stop
        }
        catch {
            # ignore already-exited processes
        }
    }
}

function Free-Port {
    param([int]$Port)

    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        if (-not $conn.OwningProcess) {
            continue
        }
        try {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "Liberando puerto $Port (PID $($proc.Id))..." -ForegroundColor DarkGray
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            }
        }
        catch {
            # ignore
        }
    }
}

function Start-PowerShellWindow {
    param([string]$Command)

    Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $Command
}

function Wait-HttpReady {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    return $false
}

function Start-DesktopMode {
    if (-not (Test-Path (Join-Path $DesktopDir "package.json"))) {
        throw "No se encontró desktop/package.json. El shell desktop no está disponible."
    }

    Ensure-NodeDeps -Directory $FrontendDir -Label "frontend"
    Ensure-NodeDeps -Directory $DesktopDir -Label "desktop"

    $npmCmd = Resolve-NpmCmd
    $quotedDesktopDir = Quote-PwshLiteral $DesktopDir
    $quotedNpmCmd = Quote-PwshLiteral $npmCmd
    $command = "& { Set-Location -LiteralPath $quotedDesktopDir; & $quotedNpmCmd run dev:full }"

    if ($Inline) {
        Push-Location $DesktopDir
        try {
            & $npmCmd run dev:full
        }
        finally {
            Pop-Location
        }
        return
    }

    Start-PowerShellWindow -Command $command
}

function Start-WebMode {
    $pythonExe = Resolve-PythonExe
    $npmCmd = Resolve-NpmCmd

    Ensure-NodeDeps -Directory $FrontendDir -Label "frontend"

    $quotedRoot = Quote-PwshLiteral $RootPath
    $quotedPython = Quote-PwshLiteral $pythonExe
    $quotedNpm = Quote-PwshLiteral $npmCmd

    $backendCommand = "& { Set-Location -LiteralPath $quotedRoot; `$env:INSPYRO_DEV_RELOAD='1'; Set-Location -LiteralPath '.\backend'; & $quotedPython main.py }"
    $frontendCommand = "& { Set-Location -LiteralPath $quotedRoot; Set-Location -LiteralPath '.\frontend'; Remove-Item Env:BROWSER -ErrorAction SilentlyContinue; & $quotedNpm start }"

    if ($Inline) {
        throw "El modo Inline solo está soportado para Desktop."
    }

    Start-PowerShellWindow -Command $backendCommand
    Start-PowerShellWindow -Command $frontendCommand

    if ($StartStandaloneMcp) {
        Write-Host "- Esperando backend para iniciar MCP standalone..." -ForegroundColor Magenta
        if (Wait-HttpReady -Url "http://127.0.0.1:8000/health" -TimeoutSeconds 45) {
            $mcpCommand = "& { Set-Location -LiteralPath $quotedRoot; Set-Location -LiteralPath '.\backend'; & $quotedPython -m mcp_server }"
            Start-PowerShellWindow -Command $mcpCommand
        }
        else {
            Write-Warning "Backend no respondió a tiempo; no se inició MCP standalone."
        }
    }
}

Write-Host "REINICIANDO INSPYRO - Windows" -ForegroundColor Cyan
Write-Host "-----------------------------------------------------------------------" -ForegroundColor Cyan
Write-Host ("Modo: {0}" -f $Mode) -ForegroundColor Green

if ($Mode -eq "Desktop" -and $StartStandaloneMcp) {
    Write-Warning "Se ignora -StartStandaloneMcp en modo Desktop. El MCP debe arrancarse desde la UI/back-end manager para mantener el estado consistente."
}

Write-Section "DETENIENDO PROCESOS PREVIOS..." Yellow

Stop-MatchingProcesses -Label "Electron" -Predicate {
    param($proc)
    $commandLine = (Get-ProcessCommandLine $proc).ToLowerInvariant()
    $proc.ProcessName -ieq "electron" -and (
        $commandLine -like "*$ComparableRootPath*" -or
        $commandLine -like "*inspyro-desktop*"
    )
}

Stop-MatchingProcesses -Label "Desktop dev-full" -Predicate {
    param($proc)
    $commandLine = (Get-ProcessCommandLine $proc).ToLowerInvariant()
    $proc.ProcessName -ieq "node" -and (
        $commandLine -like "*$ComparableRootPath*" -and (
            $commandLine -like "*desktop\scripts\dev-full.mjs*" -or
            $commandLine -like "*npm*run*dev:full*" -or
            $commandLine -like "*\desktop\main.js*"
        )
    )
}

Stop-MatchingProcesses -Label "Frontend CRA" -Predicate {
    param($proc)
    $commandLine = (Get-ProcessCommandLine $proc).ToLowerInvariant()
    $proc.ProcessName -ieq "node" -and $commandLine -like "*react-scripts*start*" -and $commandLine -like "*$ComparableRootPath*"
}

Stop-MatchingProcesses -Label "Backend FastAPI" -Predicate {
    param($proc)
    $commandLine = (Get-ProcessCommandLine $proc).ToLowerInvariant()
    $proc.ProcessName -ieq "python" -and $commandLine -like "*main.py*" -and $commandLine -like "*$ComparableRootPath*"
}

Stop-MatchingProcesses -Label "MCP standalone" -Predicate {
    param($proc)
    $commandLine = (Get-ProcessCommandLine $proc).ToLowerInvariant()
    $proc.ProcessName -ieq "python" -and $commandLine -like "*-m mcp_server*" -and $commandLine -like "*$ComparableRootPath*"
}

Start-Sleep -Seconds 2

Write-Section "LIBERANDO PUERTOS..." DarkYellow
Free-Port 3000
Free-Port 8000
Free-Port 8100

Write-Section "INICIANDO SERVICIOS..." Green

switch ($Mode) {
    "Desktop" { Start-DesktopMode }
    "Web" { Start-WebMode }
}

Write-Section "RESUMEN" Cyan
if ($Mode -eq "Desktop") {
    Write-Host "- Se lanzó Inspyro Desktop (backend + frontend + Electron)." -ForegroundColor Green
    Write-Host "- La app abrirá una ventana nativa cuando backend y frontend estén listos." -ForegroundColor Green
    Write-Host "- MCP se inicia desde la UI, no como proceso standalone." -ForegroundColor DarkGray
}
else {
    Write-Host "- Frontend:    http://localhost:3000" -ForegroundColor Cyan
    Write-Host "- Backend:     http://localhost:8000" -ForegroundColor Cyan
    Write-Host "- API Docs:    http://localhost:8000/docs" -ForegroundColor Cyan
    if ($StartStandaloneMcp) {
        Write-Host "- MCP Server:  http://localhost:8100/mcp" -ForegroundColor Magenta
    }
}
