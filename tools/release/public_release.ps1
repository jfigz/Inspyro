param(
    [ValidateSet("plan", "prepare", "publish", "web-only", "dry-run")]
    [string]$Mode = "plan",
    [string]$Version = "",
    [string]$ConfigPath = "",
    [switch]$DeleteMissingPublic,
    [switch]$ApproveRuntime,
    [switch]$ApproveReleaseNotes,
    [switch]$ConfirmPublish,
    [switch]$ConfirmHostinger,
    [switch]$NoGates,
    [switch]$NoBuild,
    [switch]$NoHostinger,
    [switch]$NoCommit,
    [switch]$NoPublish
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
    $scriptDir = Split-Path -Parent $PSCommandPath
    return (Resolve-Path (Join-Path $scriptDir "..\..")).Path
}

function Read-Config {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        $Path = Join-Path (Split-Path -Parent $PSCommandPath) "public_release.config.json"
    }
    return Get-Content -Raw -Path $Path | ConvertFrom-Json
}

function Invoke-Checked {
    param([string]$Label, [scriptblock]$Action)
    Write-Host "==> $Label"
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Label fallo con exit code $LASTEXITCODE"
    }
}

function Ask-Yes {
    param([string]$Question)
    $answer = Read-Host "$Question Escribe SI para confirmar"
    return ($answer -ceq "SI")
}

function Require-Version {
    if ([string]::IsNullOrWhiteSpace($Version) -or $Version -notmatch '^\d+\.\d+\.\d+$') {
        throw "Debes pasar -Version X.Y.Z con semver simple."
    }
}

function Test-GitCleanEnough {
    param([string]$Repo, [string]$Label)
    $status = git -C $Repo status --short
    if ($status) {
        Write-Host "Git status en ${Label}:"
        $status | ForEach-Object { Write-Host "  $_" }
        if (-not (Ask-Yes "Hay cambios locales en $Label. Continuar de todos modos?")) {
            throw "Cancelado por cambios locales en $Label."
        }
    }
}

function Set-JsonVersion {
    param([string]$Path, [string]$NewVersion)
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
    if (-not $python) { throw "Python no disponible para actualizar versiones JSON." }
    $code = @'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
version = sys.argv[2]
data = json.loads(path.read_text(encoding='utf-8'))
data['version'] = version
packages = data.get('packages')
if isinstance(packages, dict) and '' in packages and isinstance(packages[''], dict):
    packages['']['version'] = version
path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
'@
    & $python.Source -c $code $Path $NewVersion
    if ($LASTEXITCODE -ne 0) { throw "No se pudo actualizar version en $Path" }
}

function Update-VersionFiles {
    foreach ($file in $config.version_files) {
        Set-JsonVersion -Path (Join-Path $sourceRepo $file) -NewVersion $Version
    }
}

function New-ReleaseNotes {
    $notesPath = Join-Path $sourceRepo ("output\release-notes-v{0}.md" -f $Version)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $notesPath) | Out-Null
    $currentTag = "v$Version"
    $lastTag = git -C $publicRepo tag --list "v*" --sort=-v:refname | Where-Object { $_ -ne $currentTag } | Select-Object -First 1
    $range = if ($lastTag) { "$lastTag..HEAD" } else { "HEAD" }
    $commits = git -C $publicRepo log --oneline $range
    $body = @(
        "# Inspyro v$Version",
        "",
        "## Cambios",
        ""
    )
    if ($commits) {
        $body += ($commits | ForEach-Object { "- $_" })
    } else {
        $body += "- Release de mantenimiento."
    }
    $body += @("", "## Instalador", "", ("- Inspyro-Setup-{0}-x64.exe" -f $Version))
    Set-Content -Path $notesPath -Value ($body -join "`n") -Encoding utf8
    return $notesPath
}

$repoRoot = Resolve-RepoRoot
$config = Read-Config -Path $ConfigPath
$sourceRepo = $repoRoot
$publicRepo = (Resolve-Path (Join-Path $sourceRepo $config.public_repo)).Path
$webDir = Join-Path $sourceRepo $config.webpage_dir
$pythonScriptDir = Join-Path $sourceRepo "tools\release"
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) { throw "Python no disponible." }

if ($Mode -in @("prepare", "publish", "web-only", "dry-run")) {
    Require-Version
}

Write-Host "Public release protocol"
Write-Host "Mode: $Mode"
Write-Host "Source: $sourceRepo"
Write-Host "Public: $publicRepo"
Write-Host "Web: $webDir"

Invoke-Checked "preflight docs index exists" {
    if (-not (Test-Path (Join-Path $sourceRepo "docs\llm-index.yaml"))) {
        throw "docs\llm-index.yaml no existe."
    }
    $global:LASTEXITCODE = 0
}
Invoke-Checked "gh auth status" { gh auth status }
Test-GitCleanEnough -Repo $sourceRepo -Label "P1"
Test-GitCleanEnough -Repo $publicRepo -Label "Inspyro-public"

$runtimePython = Join-Path $sourceRepo "desktop\dist\win-unpacked\resources\python"
if (Test-Path $runtimePython) {
    Write-Host "Runtime portable encontrado: $runtimePython"
} elseif ($Mode -eq "publish" -and -not $ApproveRuntime) {
    throw "Runtime portable no encontrado y no hay aprobacion de runtime alternativo."
}

if ($Mode -eq "plan") {
    Write-Host "Plan OK. Ejecuta -Mode prepare o -Mode publish con -Version X.Y.Z."
    exit 0
}

$dryRun = ($Mode -eq "dry-run")

if ($Mode -in @("prepare", "publish", "dry-run")) {
    if (-not $dryRun) {
        if (-not (Ask-Yes "Actualizar version y commit local en P1 a v$Version?")) { throw "Cancelado antes del bump." }
        Update-VersionFiles
        if (-not $NoCommit) {
            git -C $sourceRepo add -- $config.version_files
            git -C $sourceRepo commit -m "Bump Inspyro to v$Version"
        }
    }

    if (-not $NoGates -and -not $dryRun) {
        Invoke-Checked "bootstrap-agent" { & (Join-Path $sourceRepo "agent_debug.ps1") bootstrap-agent }
        Invoke-Checked "verify-fast" { & (Join-Path $sourceRepo "agent_debug.ps1") verify-fast }
        Invoke-Checked "contracts-check" { & (Join-Path $sourceRepo "agent_debug.ps1") contracts-check }
        Invoke-Checked "verify" { & (Join-Path $sourceRepo "agent_debug.ps1") verify }
    }

    $syncArgs = @(
        (Join-Path $pythonScriptDir "sync_public_repo.py"),
        "--config", (Join-Path $pythonScriptDir "public_release.config.json")
    )
    if (-not $dryRun) {
        $syncArgs += @("--manifest", (Join-Path $sourceRepo "output\public-sync-plan.json"))
    }
    if ($DeleteMissingPublic) { $syncArgs += "--delete-missing" }
    if ($dryRun) { $syncArgs += "--dry-run" }
    elseif (-not (Ask-Yes "Sincronizar espejo publico y aplicar borrados aprobados?")) { throw "Cancelado antes de sync publico." }
    Invoke-Checked "sync public repo" { & $python.Source @syncArgs }

    Invoke-Checked "audit public tree" {
        & $python.Source (Join-Path $pythonScriptDir "audit_public_tree.py") --config (Join-Path $pythonScriptDir "public_release.config.json") --root $publicRepo
    }
}

if ($Mode -in @("publish") -and -not $NoPublish) {
    if (-not $NoGates) {
        Invoke-Checked "public docs-check" { & (Join-Path $publicRepo "agent_debug.ps1") docs-check }
        Invoke-Checked "public verify-fast" { & (Join-Path $publicRepo "agent_debug.ps1") verify-fast }
    }
    if (-not $NoBuild) {
        if (Test-Path $runtimePython) { $env:INSPYRO_DESKTOP_PYTHON_HOME = $runtimePython }
        Invoke-Checked "frontend npm ci" { Push-Location (Join-Path $publicRepo "frontend"); npm ci; Pop-Location }
        Invoke-Checked "desktop npm ci" { Push-Location (Join-Path $publicRepo "desktop"); npm ci; Pop-Location }
        Invoke-Checked "desktop dist" { Push-Location (Join-Path $publicRepo "desktop"); npm run dist; Pop-Location }
        Invoke-Checked "packaged smoke" { Push-Location (Join-Path $publicRepo "desktop"); npm run smoke:packaged; Pop-Location }
    }

    $installer = Join-Path $publicRepo "desktop\dist\Inspyro-Setup-$Version-x64.exe"
    if (-not (Test-Path $installer)) { throw "No existe instalador esperado: $installer" }
    $hash = (Get-FileHash $installer -Algorithm SHA256).Hash
    Write-Host "Installer SHA256: $hash"

    if (-not $NoCommit) {
        git -C $publicRepo add -A
        git -C $publicRepo commit -m "Release v$Version"
        git -C $publicRepo tag -a "v$Version" -m "Inspyro v$Version"
    }

    $notesPath = New-ReleaseNotes
    Write-Host "Notas generadas: $notesPath"
    if (-not $ApproveReleaseNotes) {
        throw "Revisa las notas y relanza con -ApproveReleaseNotes para publicar."
    }
    if (-not $ConfirmPublish -and -not (Ask-Yes "Confirmar push, tag y GitHub Release v$Version?")) {
        throw "Cancelado antes de publicar en GitHub."
    }
    git -C $publicRepo push origin main
    git -C $publicRepo push origin "v$Version"
    gh release create "v$Version" $installer --repo $config.github_repo --title "Inspyro v$Version" --notes-file $notesPath
}

if ($Mode -in @("prepare", "publish", "web-only", "dry-run")) {
    $webArgs = @(
        (Join-Path $pythonScriptDir "update_webpage.py"),
        "--config", (Join-Path $pythonScriptDir "public_release.config.json"),
        "--version", $Version,
        "--zip", (Join-Path $sourceRepo $config.web.hostinger_zip)
    )
    if ($dryRun) { $webArgs += "--dry-run" }
    Invoke-Checked "update webpage" { & $python.Source @webArgs }

    if ($Mode -in @("publish", "web-only") -and -not $NoHostinger -and -not $dryRun) {
        if (-not $ConfirmHostinger -and -not (Ask-Yes "Confirmar upload Hostinger para openpyro.org?")) {
            throw "Cancelado antes de Hostinger."
        }
        Invoke-Checked "deploy Hostinger" {
            & (Join-Path $pythonScriptDir "deploy_hostinger.ps1") -WebRoot $webDir -ConfigPath (Join-Path $pythonScriptDir "public_release.config.json") -Verify
        }
    }
}

Write-Host "Public release protocol finished."
