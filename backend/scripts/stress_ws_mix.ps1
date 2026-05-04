param(
    [string]$WsUrl = "ws://localhost:8000/ws",
    [int]$Connections = 5,
    [int]$Iterations = 20,
    [double]$TimeoutS = 30,
    [double]$SleepMs = 0,
    [string]$Out = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$venvPy = Join-Path $projectRoot "venv_inspyro\\Scripts\\python.exe"

if (Test-Path $venvPy) {
    $pythonExe = $venvPy
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonExe = "python"
} else {
    throw "Python no encontrado. Instala entorno o agrega python al PATH."
}

$scriptPath = Join-Path $PSScriptRoot "stress_ws_mix.py"

$args = @(
    $scriptPath,
    "--ws-url", $WsUrl,
    "--connections", $Connections,
    "--iterations", $Iterations,
    "--timeout-s", $TimeoutS,
    "--sleep-ms", $SleepMs
)

if ($Out) {
    $args += @("--out", $Out)
}

& $pythonExe @args
exit $LASTEXITCODE
