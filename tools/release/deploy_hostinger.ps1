param(
    [string]$WebRoot = "",
    [string]$ConfigPath = "",
    [switch]$DryRun,
    [switch]$Verify
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

function Join-UrlPath {
    param([string]$Left, [string]$Right)
    $leftTrimmed = $Left.TrimEnd("/")
    $rightTrimmed = $Right.TrimStart("/")
    if ([string]::IsNullOrWhiteSpace($rightTrimmed)) { return $leftTrimmed }
    return "$leftTrimmed/$rightTrimmed"
}

function Assert-Env {
    param([string]$Name)
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Falta variable de entorno requerida: $Name"
    }
    return $value
}

function Get-TransferUrl {
    param([string]$Protocol, [string]$Host, [string]$RemotePath)
    $scheme = if ($Protocol -eq "ftps") { "ftp" } else { $Protocol }
    return ("{0}://{1}{2}" -f $scheme, $Host, $RemotePath)
}

$repoRoot = Resolve-RepoRoot
$config = Read-Config -Path $ConfigPath
if ([string]::IsNullOrWhiteSpace($WebRoot)) {
    $WebRoot = Join-Path $repoRoot $config.webpage_dir
}
$webRootPath = (Resolve-Path $WebRoot).Path

$hostName = Assert-Env "HOSTINGER_FTP_HOST"
$userName = Assert-Env "HOSTINGER_FTP_USER"
$password = Assert-Env "HOSTINGER_FTP_PASSWORD"
$protocol = [Environment]::GetEnvironmentVariable("HOSTINGER_PROTOCOL")
if ([string]::IsNullOrWhiteSpace($protocol)) { $protocol = "ftps" }
$remoteDir = [Environment]::GetEnvironmentVariable("HOSTINGER_REMOTE_DIR")
if ([string]::IsNullOrWhiteSpace($remoteDir)) { $remoteDir = $config.hostinger_remote_dir }
$domain = [Environment]::GetEnvironmentVariable("HOSTINGER_DOMAIN")
if ([string]::IsNullOrWhiteSpace($domain)) { $domain = $config.hostinger_domain }

if ($protocol -eq "sftp") {
    $winscp = Get-Command WinSCP.com -ErrorAction SilentlyContinue
    if (-not $winscp) {
        throw "HOSTINGER_PROTOCOL=sftp requiere WinSCP.com instalado. Usa HOSTINGER_PROTOCOL=ftps para curl.exe."
    }
    throw "SFTP detectado, pero no se ejecuta para evitar escribir secretos en scripts temporales. Configura FTPS o agrega un backend SFTP seguro."
}

if ($protocol -notin @("ftp", "ftps")) {
    throw "HOSTINGER_PROTOCOL debe ser ftp, ftps o sftp."
}

$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curl) { throw "curl.exe no esta disponible." }

$files = Get-ChildItem -Path $webRootPath -Recurse -File | Sort-Object FullName
foreach ($file in $files) {
    $rel = [IO.Path]::GetRelativePath($webRootPath, $file.FullName).Replace("\", "/")
    $remotePath = Join-UrlPath -Left $remoteDir -Right $rel
    $target = Get-TransferUrl -Protocol $protocol -Host $hostName -RemotePath $remotePath
    Write-Host ("UPLOAD {0} -> {1}" -f $rel, $target)
    if ($DryRun) { continue }

    $curlArgs = @("--fail", "--show-error", "--silent", "--ftp-create-dirs")
    if ($protocol -eq "ftps") { $curlArgs += "--ssl-reqd" }
    $curlArgs += @("--user", ("{0}:{1}" -f $userName, $password), "-T", $file.FullName, $target)
    & $curl.Source @curlArgs
    if ($LASTEXITCODE -ne 0) {
        throw ("Fallo upload Hostinger de {0} con curl exit {1}" -f $rel, $LASTEXITCODE)
    }
}

if ($Verify -and -not $DryRun) {
    $baseUrl = "https://$domain"
    foreach ($path in @("/", "/youtube.html")) {
        $url = "$baseUrl$path"
        Write-Host "VERIFY $url"
        $response = Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 30
        if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
            throw "Verificacion web fallo para $url con status $($response.StatusCode)"
        }
    }
}

Write-Host "Hostinger deploy completed."
