<#
.SYNOPSIS
    Agent debug tools for Inspyro (PowerShell 7+)
#>

param(
    [string]$Command = "help",
    [string]$Arg2 = "",
    [string]$Arg3 = "",
    [switch]$Debug  # Enable INSPYRO_NOTEBOOK_DEBUG and INSPYRO_WS_DEBUG
)

# Flag to enable debug logging in backend
$script:EnableDebugLogs = $Debug -or ($env:INSPYRO_DEBUG -eq "1")

$ErrorActionPreference = "Stop"
$IsWindowsHost = $env:OS -eq "Windows_NT"

$ProjectRoot = $PSScriptRoot
$LogDir = Join-Path $ProjectRoot ".agent_logs"
$BackendLog = Join-Path $LogDir "backend.log"
$BackendErrLog = Join-Path $LogDir "backend.err.log"
$FrontendLog = Join-Path $LogDir "frontend.log"
$FrontendErrLog = Join-Path $LogDir "frontend.err.log"
$BackendPidPath = Join-Path $LogDir "backend.pid"
$FrontendPidPath = Join-Path $LogDir "frontend.pid"

$BackendPort = 8000
$FrontendPort = 3000

$BackendPattern = "main\.py"
$FrontendPattern = "react-scripts"

$AllArgs = @()
if ($Arg2) { $AllArgs += $Arg2 }
if ($Arg3) { $AllArgs += $Arg3 }
if ($args) { $AllArgs += $args }
$FollowLogs = -not ($AllArgs -contains "--no-follow")

function Ensure-LogDir {
    if (-not (Test-Path $LogDir)) {
        New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    }
}

function Ensure-File {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType File -Force -Path $Path | Out-Null
    }
}

function Clear-File {
    param([string]$Path)
    try {
        Set-Content -Path $Path -Value "" -ErrorAction Stop
    } catch {
    }
}

function Resolve-VenvPython {
    param([string[]]$Candidates)
    foreach ($candidate in $Candidates) {
        $basePath = Join-Path $ProjectRoot $candidate
        if ($IsWindowsHost) {
            $py = Join-Path $basePath "Scripts/python.exe"
        } else {
            $py = Join-Path $basePath "bin/python"
        }
        if (Test-Path $py) {
            return $py
        }
    }
    return $null
}

function Resolve-PythonExe {
    $venvPython = Resolve-VenvPython -Candidates @("venv_inspyro", "backend/.venv", ".venv", "venv")
    if ($venvPython) { return $venvPython }
    if (Get-Command python -ErrorAction SilentlyContinue) { return "python" }
    if (Get-Command python3 -ErrorAction SilentlyContinue) { return "python3" }
    return $null
}

function Resolve-NpmCmd {
    if ($IsWindowsHost) {
        $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    $cmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Resolve-NodeExe {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Save-Pid {
    param([int]$ProcessId, [string]$Path)
    Set-Content -Path $Path -Value $ProcessId
}

function Get-PidFromFile {
    param([string]$Path)
    if (Test-Path $Path) {
        $value = Get-Content -Path $Path -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($value -match '^\d+$') {
            return [int]$value
        }
    }
    return $null
}

function Test-Pid {
    param([int]$ProcessId)
    if (-not $ProcessId) { return $false }
    return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Get-PidsByPattern {
    param([string]$PatternRegex)
    $pids = @()
    if ($IsWindowsHost) {
        $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
        foreach ($proc in $procs) {
            if ($proc.CommandLine -and ($proc.CommandLine -match $PatternRegex)) {
                $pids += $proc.ProcessId
            }
        }
    } else {
        if (Get-Command pgrep -ErrorAction SilentlyContinue) {
            $pids = @(pgrep -f $PatternRegex 2>$null)
        } else {
            $lines = ps -eo pid,command 2>$null | Select-String -Pattern $PatternRegex
            foreach ($line in $lines) {
                $processId = ($line -split '\s+')[0]
                if ($processId -match '^\d+$') {
                    $pids += $processId
                }
            }
        }
    }
    return $pids | Select-Object -Unique
}

function Stop-ProcessByPattern {
    param([string]$PatternRegex)
    $pids = Get-PidsByPattern -PatternRegex $PatternRegex
    foreach ($processId in $pids) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    return ($pids.Count -gt 0)
}

function Free-Port {
    param([int]$Port)
    if (-not $Port) { return }
    if ($IsWindowsHost) {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        foreach ($conn in $conns) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
        return
    }
    if (Get-Command lsof -ErrorAction SilentlyContinue) {
        $pids = @(lsof -ti tcp:$Port 2>$null)
        foreach ($processId in $pids) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
        return
    }
    if (Get-Command fuser -ErrorAction SilentlyContinue) {
        fuser -k -n tcp $Port 2>$null | Out-Null
    }
}

function Start-Backend {
    Ensure-LogDir
    $backendDir = Join-Path $ProjectRoot "backend"
    if (-not (Test-Path $backendDir)) {
        Write-Error "backend dir not found: $backendDir"
        return $null
    }

    $pythonExe = Resolve-PythonExe
    if (-not $pythonExe) {
        Write-Error "python not found in PATH or venv"
        return $null
    }

    Ensure-File $BackendLog
    Clear-File $BackendLog
    Ensure-File $BackendErrLog
    Clear-File $BackendErrLog

    # Build environment variables - always include PYTHONUNBUFFERED for real-time logging
    $envVars = @{ "PYTHONUNBUFFERED" = "1" }
    
    # Add debug variables if debug mode is enabled
    if ($script:EnableDebugLogs) {
        $envVars["INSPYRO_NOTEBOOK_DEBUG"] = "1"
        $envVars["INSPYRO_WS_DEBUG"] = "1"
        Write-Host "[DEBUG] Debug logging enabled: INSPYRO_NOTEBOOK_DEBUG=1, INSPYRO_WS_DEBUG=1"
    }
    
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        $proc = Start-Process -FilePath $pythonExe `
            -ArgumentList @("-u", "main.py") `
            -WorkingDirectory $backendDir `
            -PassThru `
            -NoNewWindow `
            -RedirectStandardOutput $BackendLog `
            -RedirectStandardError $BackendErrLog `
            -Environment $envVars
    } else {
        # PowerShell 5.x: Set environment variables manually before starting
        $prevUnbuffered = $env:PYTHONUNBUFFERED
        $prevNotebookDebug = $env:INSPYRO_NOTEBOOK_DEBUG
        $prevWsDebug = $env:INSPYRO_WS_DEBUG
        
        $env:PYTHONUNBUFFERED = "1"
        if ($script:EnableDebugLogs) {
            $env:INSPYRO_NOTEBOOK_DEBUG = "1"
            $env:INSPYRO_WS_DEBUG = "1"
        }
        
        try {
            $proc = Start-Process -FilePath $pythonExe `
                -ArgumentList @("-u", "main.py") `
                -WorkingDirectory $backendDir `
                -PassThru `
                -NoNewWindow `
                -RedirectStandardOutput $BackendLog `
                -RedirectStandardError $BackendErrLog
        } finally {
            # Restore previous environment state
            if ($null -ne $prevUnbuffered) { $env:PYTHONUNBUFFERED = $prevUnbuffered }
            else { Remove-Item Env:PYTHONUNBUFFERED -ErrorAction SilentlyContinue }
            
            if ($null -ne $prevNotebookDebug) { $env:INSPYRO_NOTEBOOK_DEBUG = $prevNotebookDebug }
            else { Remove-Item Env:INSPYRO_NOTEBOOK_DEBUG -ErrorAction SilentlyContinue }
            
            if ($null -ne $prevWsDebug) { $env:INSPYRO_WS_DEBUG = $prevWsDebug }
            else { Remove-Item Env:INSPYRO_WS_DEBUG -ErrorAction SilentlyContinue }
        }
    }

    Save-Pid -ProcessId $proc.Id -Path $BackendPidPath
    Write-Host "Backend started (PID $($proc.Id))."
    return $proc.Id
}

function Start-Frontend {
    Ensure-LogDir
    $frontendDir = Join-Path $ProjectRoot "frontend"
    if (-not (Test-Path $frontendDir)) {
        Write-Error "frontend dir not found: $frontendDir"
        return $null
    }

    $packageJson = Join-Path $frontendDir "package.json"
    if (-not (Test-Path $packageJson)) {
        Write-Error "package.json not found: $packageJson"
        return $null
    }

    $npmCmd = Resolve-NpmCmd
    if (-not $npmCmd) {
        Write-Error "npm not found in PATH"
        return $null
    }

    Ensure-File $FrontendLog
    Clear-File $FrontendLog
    Ensure-File $FrontendErrLog
    Clear-File $FrontendErrLog

    $npmExt = [IO.Path]::GetExtension($npmCmd).ToLowerInvariant()
    if ($npmExt -eq ".ps1") {
        $proc = Start-Process -FilePath "powershell" `
            -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $npmCmd, "start") `
            -WorkingDirectory $frontendDir `
            -PassThru `
            -NoNewWindow `
            -RedirectStandardOutput $FrontendLog `
            -RedirectStandardError $FrontendErrLog
    } else {
        $proc = Start-Process -FilePath $npmCmd `
            -ArgumentList @("start") `
            -WorkingDirectory $frontendDir `
            -PassThru `
            -NoNewWindow `
            -RedirectStandardOutput $FrontendLog `
            -RedirectStandardError $FrontendErrLog
    }

    Save-Pid -ProcessId $proc.Id -Path $FrontendPidPath
    Write-Host "Frontend started (PID $($proc.Id))."
    return $proc.Id
}

function Stop-Backend {
    $stopped = $false
    $processId = Get-PidFromFile -Path $BackendPidPath
    if (Test-Pid -ProcessId $processId) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        $stopped = $true
    }
    if (-not $stopped) {
        $stopped = Stop-ProcessByPattern -PatternRegex $BackendPattern
    }
    Remove-Item $BackendPidPath -Force -ErrorAction SilentlyContinue
    if ($stopped) { Write-Host "Backend stopped." } else { Write-Host "Backend not running." }
}

function Stop-Frontend {
    $stopped = $false
    $processId = Get-PidFromFile -Path $FrontendPidPath
    if (Test-Pid -ProcessId $processId) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        $stopped = $true
    }
    if (-not $stopped) {
        $stopped = Stop-ProcessByPattern -PatternRegex $FrontendPattern
    }
    Remove-Item $FrontendPidPath -Force -ErrorAction SilentlyContinue
    if ($stopped) { Write-Host "Frontend stopped." } else { Write-Host "Frontend not running." }
}

function Start-Servers {
    param([bool]$Follow = $true)
    Start-Backend | Out-Null
    Start-Frontend | Out-Null

    if ($Follow) {
        Follow-Logs -Targets @("backend", "frontend")
    }
}

function Stop-Servers {
    Write-Host "Stopping backend..."
    Stop-Backend
    Write-Host "Stopping frontend..."
    Stop-Frontend
    Free-Port -Port $BackendPort
    Free-Port -Port $FrontendPort
}

function Test-Endpoint {
    param([string]$Url)
    try {
        if ($PSVersionTable.PSVersion.Major -lt 6) {
            Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop | Out-Null
        } else {
            Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 3 -ErrorAction Stop | Out-Null
        }
        return $true
    } catch {
        return $false
    }
}

function Invoke-WebRequestCompat {
    param(
        [string]$Uri,
        [string]$Method = "Get",
        [hashtable]$Headers = $null,
        [string]$Body = $null,
        [string]$ContentType = $null,
        [int]$TimeoutSec = 10
    )

    $methodUpper = $Method.ToUpperInvariant()

    if ($PSVersionTable.PSVersion.Major -ge 6) {
        $invokeParams = @{
            Uri = $Uri
            Method = $methodUpper
            TimeoutSec = $TimeoutSec
            ErrorAction = "Stop"
        }
        if ($Headers) { $invokeParams["Headers"] = $Headers }
        if (-not [string]::IsNullOrEmpty($Body)) { $invokeParams["Body"] = $Body }
        if ($ContentType) { $invokeParams["ContentType"] = $ContentType }
        return Invoke-WebRequest @invokeParams
    }

    if ($methodUpper -eq "GET" -and [string]::IsNullOrEmpty($Body)) {
        $invokeParams = @{
            Uri = $Uri
            Method = $methodUpper
            TimeoutSec = $TimeoutSec
            ErrorAction = "Stop"
            UseBasicParsing = $true
        }
        if ($Headers) { $invokeParams["Headers"] = $Headers }
        return Invoke-WebRequest @invokeParams
    }

    Add-Type -AssemblyName System.Net.Http | Out-Null
    $httpMethod = New-Object System.Net.Http.HttpMethod -ArgumentList $methodUpper
    $requestMessage = New-Object System.Net.Http.HttpRequestMessage -ArgumentList $httpMethod, $Uri

    if ($Headers) {
        foreach ($headerKey in @($Headers.Keys)) {
            $headerValue = [string]$Headers[$headerKey]
            [void]$requestMessage.Headers.TryAddWithoutValidation($headerKey, $headerValue)
        }
    }

    if (-not [string]::IsNullOrEmpty($Body)) {
        $mediaType = if ($ContentType) { $ContentType } else { "application/json" }
        $requestMessage.Content = New-Object System.Net.Http.StringContent -ArgumentList $Body, ([System.Text.Encoding]::UTF8), $mediaType
    }

    $httpClient = New-Object System.Net.Http.HttpClient
    $httpClient.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)

    try {
        $response = $httpClient.SendAsync($requestMessage).GetAwaiter().GetResult()
        $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        $responseHeaders = @{}
        foreach ($responseHeader in $response.Headers) {
            $responseHeaders[$responseHeader.Key] = ($responseHeader.Value -join ", ")
        }
        foreach ($contentHeader in $response.Content.Headers) {
            $responseHeaders[$contentHeader.Key] = ($contentHeader.Value -join ", ")
        }

        if (-not $response.IsSuccessStatusCode) {
            throw ("HTTP {0} from {1} {2}: {3}" -f [int]$response.StatusCode, $methodUpper, $Uri, $content)
        }

        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Content = [string]$content
            Headers = $responseHeaders
        }
    } finally {
        if ($requestMessage) {
            $requestMessage.Dispose()
        }
        if ($httpClient) {
            $httpClient.Dispose()
        }
    }
}

function ConvertFrom-McpPayload {
    param([string]$Content)

    if ([string]::IsNullOrWhiteSpace($Content)) {
        throw "MCP response was empty."
    }

    $trimmedContent = $Content.Trim()
    if ($trimmedContent.StartsWith("{") -or $trimmedContent.StartsWith("[")) {
        return ($trimmedContent | ConvertFrom-Json)
    }

    $dataLines = @()
    foreach ($line in ($Content -split "`r?`n")) {
        if ($line.StartsWith("data:")) {
            $dataLines += $line.Substring(5).TrimStart()
        }
    }

    if ($dataLines.Count -eq 0) {
        throw "MCP response did not contain JSON or SSE data payload."
    }

    return (($dataLines -join "`n") | ConvertFrom-Json)
}

function Assert-McpResponse {
    param(
        [object]$Message,
        [string]$RpcMethod
    )

    if ($null -eq $Message) {
        throw ("MCP {0} returned no message body." -f $RpcMethod)
    }

    if ($Message.error) {
        $errorCode = if ($null -ne $Message.error.code) { [string]$Message.error.code } else { "unknown" }
        $errorDetail = if ($Message.error.message) { [string]$Message.error.message } else { ($Message.error | ConvertTo-Json -Compress -Depth 10) }
        throw ("MCP {0} failed ({1}): {2}" -f $RpcMethod, $errorCode, $errorDetail)
    }

    return $Message
}

function Invoke-McpRequest {
    param(
        [string]$Uri,
        [hashtable]$Headers,
        [hashtable]$Payload,
        [int]$TimeoutSec = 15
    )

    $response = Invoke-WebRequestCompat `
        -Uri $Uri `
        -Method Post `
        -Headers $Headers `
        -Body ($Payload | ConvertTo-Json -Compress -Depth 20) `
        -ContentType "application/json" `
        -TimeoutSec $TimeoutSec

    $message = ConvertFrom-McpPayload -Content $response.Content
    $message = Assert-McpResponse -Message $message -RpcMethod ([string]$Payload.method)

    return [pscustomobject]@{
        Response = $response
        Message = $message
    }
}

function Run-McpSmoke {
    Write-Host "Running MCP smoke test..."

    $backendHealth = Invoke-WebRequestCompat -Uri "http://127.0.0.1:$BackendPort/health" -TimeoutSec 5
    $backendHealthJson = $backendHealth.Content | ConvertFrom-Json
    if ($backendHealthJson.status -ne "healthy") {
        throw ("Backend health is not healthy: {0}" -f $backendHealth.Content)
    }

    $mcpStatus = $null
    try {
        $mcpStatusResp = Invoke-WebRequestCompat -Uri "http://127.0.0.1:$BackendPort/api/mcp/status" -TimeoutSec 5
        $mcpStatus = $mcpStatusResp.Content | ConvertFrom-Json
    } catch {
        Write-Host "MCP status endpoint unavailable via backend; probing MCP URL directly."
    }

    $mcpPort = if ($mcpStatus -and $mcpStatus.port) { [int]$mcpStatus.port } else { 8100 }
    $mcpUrl = if ($mcpStatus -and $mcpStatus.url) { [string]$mcpStatus.url } else { "http://127.0.0.1:$mcpPort/mcp" }

    $requestHeaders = @{ Accept = "application/json, text/event-stream" }
    $initResult = Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{
        jsonrpc = "2.0"
        id = 1
        method = "initialize"
        params = @{
            protocolVersion = "2025-11-25"
            capabilities = @{}
            clientInfo = @{
                name = "agent_debug"
                version = "1.0"
            }
        }
    } -TimeoutSec 15

    $sessionId = $initResult.Response.Headers["Mcp-Session-Id"]
    $initMessage = $initResult.Message
    $protocolVersion = [string]$initMessage.result.protocolVersion
    if (-not $protocolVersion) {
        throw "MCP initialize did not return protocolVersion."
    }

    $transportMode = if ($sessionId) { "stateful" } else { "stateless" }
    $requestHeaders["MCP-Protocol-Version"] = $protocolVersion
    if ($sessionId) {
        $requestHeaders["Mcp-Session-Id"] = $sessionId
    }

    $initializedPayload = @{ jsonrpc = "2.0"; method = "notifications/initialized"; params = @{} } | ConvertTo-Json -Compress -Depth 10
    try {
        Invoke-WebRequestCompat -Uri $mcpUrl -Method Post -Headers $requestHeaders -Body $initializedPayload -ContentType "application/json" -TimeoutSec 10 | Out-Null
    } catch {
        if ($sessionId) {
            throw
        }
        Write-Host "MCP initialized notification skipped in stateless mode."
    }

    $allTools = @()
    $toolsCursor = $null
    do {
        $toolParams = @{}
        if ($toolsCursor) {
            $toolParams.cursor = $toolsCursor
        }
        $toolsMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{
            jsonrpc = "2.0"
            id = 2
            method = "tools/list"
            params = $toolParams
        } -TimeoutSec 15).Message
        $allTools += @($toolsMessage.result.tools)
        $toolsCursor = [string]$toolsMessage.result.nextCursor
        if ([string]::IsNullOrWhiteSpace($toolsCursor)) {
            $toolsCursor = $null
        }
    } while ($toolsCursor)
    $toolCount = @($allTools).Count
    $toolNames = @($allTools | ForEach-Object { [string]$_.name })

    $resourcesMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{ jsonrpc = "2.0"; id = 3; method = "resources/list"; params = @{} } -TimeoutSec 15).Message
    $resourceCount = @($resourcesMessage.result.resources).Count
    $resourceUris = @($resourcesMessage.result.resources | ForEach-Object { [string]$_.uri })

    $promptsMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{ jsonrpc = "2.0"; id = 4; method = "prompts/list"; params = @{} } -TimeoutSec 15).Message
    $promptCount = @($promptsMessage.result.prompts).Count
    $promptNames = @($promptsMessage.result.prompts | ForEach-Object { [string]$_.name })

    $resourceTemplatesMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{ jsonrpc = "2.0"; id = 10; method = "resources/templates/list"; params = @{} } -TimeoutSec 15).Message
    $resourceTemplateCount = @($resourceTemplatesMessage.result.resourceTemplates).Count
    $resourceTemplateUris = @($resourceTemplatesMessage.result.resourceTemplates | ForEach-Object { [string]$_.uriTemplate })

    if ($toolCount -lt 20) {
        throw ("MCP tools/list devolvio muy pocas tools para el perfil authoring por defecto: {0}" -f $toolCount)
    }
    if ($resourceCount -lt 10) {
        throw ("MCP resources/list devolvio muy pocos resources: {0}" -f $resourceCount)
    }
    if ($promptCount -lt 5) {
        throw ("MCP prompts/list devolvio muy pocos prompts: {0}" -f $promptCount)
    }
    if ($resourceTemplateCount -lt 5) {
        throw ("MCP resources/templates/list devolvio muy pocos templates: {0}" -f $resourceTemplateCount)
    }

    $requiredResources = @(
        "inspyro://manifest",
        "inspyro://guides/start-here",
        "inspyro://guides/notebook-workflow",
        "inspyro://guides/docx-quickstart",
        "inspyro://guides/artifact-lifecycle",
        "inspyro://guides/template-workflow",
        "inspyro://guides/analysis-units-workflow",
        "inspyro://guides/error-recovery",
        "inspyro://examples/notebook-docx-report"
    )
    foreach ($requiredResource in $requiredResources) {
        if (-not ($resourceUris -contains $requiredResource)) {
            throw ("MCP resources/list no expone el resource requerido: {0}" -f $requiredResource)
        }
    }

    $requiredPrompts = @(
        "create_engineering_notebook",
        "debug_cell_error",
        "review_notebook",
        "unit_conversion_help",
        "start_inspyro_session",
        "create_docx_report_notebook",
        "recover_mcp_notebook_session"
    )
    foreach ($requiredPrompt in $requiredPrompts) {
        if (-not ($promptNames -contains $requiredPrompt)) {
            throw ("MCP prompts/list no expone el prompt requerido: {0}" -f $requiredPrompt)
        }
    }

    $requiredTools = @(
        "get_system_info",
        "notebook_sync_cells",
        "execute_all_cells",
        "get_run_status",
        "get_kernel_status",
        "list_cells",
        "get_cell",
        "find_in_notebook",
        "cancel_run",
        "resume_run",
        "get_document_docx",
        "list_component_profiles",
        "set_component_profile"
    )
    foreach ($requiredTool in $requiredTools) {
        if (-not ($toolNames -contains $requiredTool)) {
            throw ("MCP tools/list no expone la tool requerida: {0}" -f $requiredTool)
        }
    }

    $forbiddenDefaultTools = @(
        "create_kernel",
        "attach_kernel",
        "kernel_status",
        "execution_status",
        "execute_cells",
        "execute_until",
        "add_cell",
        "delete_cell",
        "edit_cell",
        "move_cell",
        "read_file",
        "write_file",
        "create_file",
        "delete_file",
        "rename_file",
        "get_metrics",
        "get_pdf_status"
    )
    foreach ($forbiddenTool in $forbiddenDefaultTools) {
        if ($toolNames -contains $forbiddenTool) {
            throw ("MCP tools/list expone una tool que deberia quedar fuera del perfil authoring por defecto: {0}" -f $forbiddenTool)
        }
    }

    $requiredTemplates = @(
        "inspyro://workspace/tree/{path*}",
        "inspyro://workspace/file/{path*}",
        "inspyro://notebooks/{path*}/cells/{cell_id}",
        "inspyro://artifacts/{kernel_id}/{kind}",
        "inspyro://artifacts/{kernel_id}/{kind}/{execution_id}",
        "inspyro://artifacts/token/{kind}/{token}",
        "inspyro://runs/{run_id}"
    )
    foreach ($requiredTemplate in $requiredTemplates) {
        if (-not ($resourceTemplateUris -contains $requiredTemplate)) {
            throw ("MCP resources/templates/list no expone el template requerido: {0}" -f $requiredTemplate)
        }
    }

    $documentTool = @($allTools | Where-Object { [string]$_.name -eq "get_document_docx" }) | Select-Object -First 1
    if ($null -eq $documentTool -or $null -eq $documentTool.annotations -or -not $documentTool.annotations.readOnlyHint -or -not $documentTool.annotations.idempotentHint) {
        throw "MCP get_document_docx no expone annotations readOnlyHint/idempotentHint esperadas."
    }

    $systemInfoMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{
        jsonrpc = "2.0"
        id = 5
        method = "resources/read"
        params = @{ uri = "inspyro://system/info" }
    } -TimeoutSec 15).Message
    $systemInfoText = @($systemInfoMessage.result.contents | ForEach-Object { [string]$_.text }) -join "`n"
    $systemInfoJson = $null
    try {
        $systemInfoJson = $systemInfoText | ConvertFrom-Json
    } catch {
        throw "MCP resource system/info no devolvio JSON valido."
    }
    if (-not $systemInfoJson.workspace_path) {
        throw "MCP resource system/info no expone workspace_path canónico."
    }

    $startHereMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{
        jsonrpc = "2.0"
        id = 6
        method = "resources/read"
        params = @{ uri = "inspyro://guides/start-here" }
    } -TimeoutSec 15).Message
    $startHereText = @($startHereMessage.result.contents | ForEach-Object { [string]$_.text }) -join "`n"
    if ([string]::IsNullOrWhiteSpace($startHereText) -or $startHereText -notmatch [regex]::Escape("inspyro://guides/notebook-workflow")) {
        throw "MCP resource start-here no contiene la guia de notebook esperada."
    }
    if ($startHereText -notmatch [regex]::Escape("notebook_sync_cells")) {
        throw "MCP resource start-here no promueve notebook_sync_cells como flujo canonico."
    }

    $manifestMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{
        jsonrpc = "2.0"
        id = 11
        method = "resources/read"
        params = @{ uri = "inspyro://manifest" }
    } -TimeoutSec 15).Message
    $manifestText = @($manifestMessage.result.contents | ForEach-Object { [string]$_.text }) -join "`n"
    if ([string]::IsNullOrWhiteSpace($manifestText) -or $manifestText -notmatch [regex]::Escape("resource_templates")) {
        throw "MCP resource manifest no contiene el manifiesto esperado."
    }

    $exampleMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{
        jsonrpc = "2.0"
        id = 7
        method = "resources/read"
        params = @{ uri = "inspyro://examples/notebook-docx-report" }
    } -TimeoutSec 15).Message
    $exampleText = @($exampleMessage.result.contents | ForEach-Object { [string]$_.text }) -join "`n"
    if ([string]::IsNullOrWhiteSpace($exampleText) -or $exampleText -notmatch "build_doc" -or $exampleText -notmatch "get_document_docx") {
        throw "MCP resource notebook-docx-report no contiene el ejemplo esperado."
    }
    if ($exampleText -notmatch "notebook_sync_cells") {
        throw "MCP resource notebook-docx-report no usa notebook_sync_cells."
    }

    $startPromptMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{
        jsonrpc = "2.0"
        id = 8
        method = "prompts/get"
        params = @{
            name = "start_inspyro_session"
            arguments = @{ goal = "mcp smoke" }
        }
    } -TimeoutSec 15).Message
    $startPromptText = @($startPromptMessage.result.messages | ForEach-Object { [string]$_.content.text }) -join "`n"
    if ([string]::IsNullOrWhiteSpace($startPromptText) -or $startPromptText -notmatch [regex]::Escape("inspyro://guides/start-here")) {
        throw "MCP prompt start_inspyro_session no contiene onboarding valido."
    }
    if ($startPromptText -notmatch [regex]::Escape("notebook_sync_cells")) {
        throw "MCP prompt start_inspyro_session no promueve notebook_sync_cells."
    }

    $completionMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{
        jsonrpc = "2.0"
        id = 12
        method = "completion/complete"
        params = @{
            ref = @{
                type = "ref/prompt"
                name = "unit_conversion_help"
            }
            argument = @{
                name = "from_unit"
                value = "k"
            }
        }
    } -TimeoutSec 15).Message
    $completionValues = @($completionMessage.result.completion.values | ForEach-Object { [string]$_ })
    if (-not ($completionValues -contains "kN")) {
        throw "MCP completion/complete no devolvio la sugerencia esperada para unit_conversion_help.from_unit."
    }

    $analysisProfileMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{
        jsonrpc = "2.0"
        id = 13
        method = "tools/call"
        params = @{ name = "set_component_profile"; arguments = @{ profile = "analysis" } }
    } -TimeoutSec 15).Message
    if ([string]$analysisProfileMessage.result.structuredContent.status -ne "ok") {
        throw "MCP set_component_profile('analysis') no pudo activarse."
    }
    $analysisToolsMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{
        jsonrpc = "2.0"
        id = 14
        method = "tools/list"
        params = @{}
    } -TimeoutSec 15).Message
    $analysisToolNames = @($analysisToolsMessage.result.tools | ForEach-Object { [string]$_.name })
    foreach ($requiredAnalysisTool in @("analyze_dependencies", "analyze_impact", "run_sensitivity", "optimize_design", "compare_scenarios", "run_code_checks")) {
        if (-not ($analysisToolNames -contains $requiredAnalysisTool)) {
            throw ("MCP profile analysis no expone la tool requerida: {0}" -f $requiredAnalysisTool)
        }
    }
    if ($analysisToolNames -contains "notebook_sync_cells") {
        throw "MCP profile analysis no deberia seguir exponiendo notebook_sync_cells."
    }

    $filesProfileMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{
        jsonrpc = "2.0"
        id = 15
        method = "tools/call"
        params = @{ name = "set_component_profile"; arguments = @{ profile = "files" } }
    } -TimeoutSec 15).Message
    if ([string]$filesProfileMessage.result.structuredContent.status -ne "ok") {
        throw "MCP set_component_profile('files') no pudo activarse."
    }
    $filesToolsMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{
        jsonrpc = "2.0"
        id = 16
        method = "tools/list"
        params = @{}
    } -TimeoutSec 15).Message
    $filesToolNames = @($filesToolsMessage.result.tools | ForEach-Object { [string]$_.name })
    foreach ($requiredFilesTool in @("list_files", "read_file", "write_file", "create_file", "delete_file", "rename_file")) {
        if (-not ($filesToolNames -contains $requiredFilesTool)) {
            throw ("MCP profile files no expone la tool requerida: {0}" -f $requiredFilesTool)
        }
    }
    if ($filesToolNames -contains "notebook_sync_cells") {
        throw "MCP profile files no deberia seguir exponiendo notebook_sync_cells."
    }

    $healthMessage = (Invoke-McpRequest -Uri $mcpUrl -Headers $requestHeaders -Payload @{ jsonrpc = "2.0"; id = 9; method = "tools/call"; params = @{ name = "get_health"; arguments = @{} } } -TimeoutSec 15).Message
    $toolHealth = $healthMessage.result.structuredContent.status
    if ($toolHealth -ne "healthy") {
        throw ("MCP get_health returned unexpected status: {0}" -f $toolHealth)
    }

    $sessionLabel = if ($sessionId) { $sessionId } else { "n/a" }
    Write-Host ("MCP smoke OK - server={0} protocol={1} transport={2} session={3}" -f $initMessage.result.serverInfo.name, $protocolVersion, $transportMode, $sessionLabel)
    Write-Host ("MCP smoke OK - tools={0}, resources={1}, templates={2}, prompts={3}, get_health={4}" -f $toolCount, $resourceCount, $resourceTemplateCount, $promptCount, $toolHealth)
}

function Run-McpTorture {
    Write-Host "Running MCP torture probe..."

    $backendHealth = Invoke-WebRequestCompat -Uri "http://127.0.0.1:$BackendPort/health" -TimeoutSec 5
    $backendHealthJson = $backendHealth.Content | ConvertFrom-Json
    if ($backendHealthJson.status -ne "healthy") {
        throw ("Backend health is not healthy: {0}" -f $backendHealth.Content)
    }

    $mcpStatus = $null
    try {
        $mcpStatusResp = Invoke-WebRequestCompat -Uri "http://127.0.0.1:$BackendPort/api/mcp/status" -TimeoutSec 5
        $mcpStatus = $mcpStatusResp.Content | ConvertFrom-Json
    } catch {
        Write-Host "MCP status endpoint unavailable via backend; using default MCP URL."
    }

    $mcpPort = if ($mcpStatus -and $mcpStatus.port) { [int]$mcpStatus.port } else { 8100 }
    $mcpUrl = if ($mcpStatus -and $mcpStatus.url) { [string]$mcpStatus.url } else { "http://127.0.0.1:$mcpPort/mcp" }
    $backendDir = Join-Path $ProjectRoot "backend"
    $pythonExe = Resolve-PythonExe
    if (-not $pythonExe) {
        throw "python not found in PATH or venv"
    }

    $probeArgs = @("-m", "dev.mcp_torture_probe", "--backend-url", "http://127.0.0.1:$BackendPort")
    if (-not ($AllArgs -contains "--mcp-url")) {
        $probeArgs += @("--mcp-url", $mcpUrl)
    }
    if ($AllArgs.Count -gt 0) {
        $probeArgs += $AllArgs
    }

    Push-Location $backendDir
    try {
        & $pythonExe @probeArgs
        if ($LASTEXITCODE -ne 0) {
            throw ("mcp-torture failed with exit code {0}" -f $LASTEXITCODE)
        }
    } finally {
        Pop-Location
    }

    Write-Host "mcp-torture completed successfully."
}

function Show-Health {
    $backendOk = Test-Endpoint -Url "http://localhost:$BackendPort/health"
    if ($backendOk) {
        Write-Host "Backend health: OK"
    } else {
        Write-Host "Backend health: NO RESPONSE"
    }

    $frontendOk = Test-Endpoint -Url "http://localhost:$FrontendPort/"
    if ($frontendOk) {
        Write-Host "Frontend health: OK"
    } else {
        Write-Host "Frontend health: NO RESPONSE"
    }
}

function Show-Status {
    Write-Host "STATUS"

    $backendPid = Get-PidFromFile -Path $BackendPidPath
    if (Test-Pid -ProcessId $backendPid) {
        Write-Host "Backend: RUNNING (PID $backendPid)"
    } else {
        $pids = Get-PidsByPattern -PatternRegex $BackendPattern
        if ($pids.Count -gt 0) {
            Write-Host ("Backend: RUNNING (untracked PID(s): {0})" -f ($pids -join ", "))
        } else {
            Write-Host "Backend: STOPPED"
        }
    }

    $frontendPid = Get-PidFromFile -Path $FrontendPidPath
    if (Test-Pid -ProcessId $frontendPid) {
        Write-Host "Frontend: RUNNING (PID $frontendPid)"
    } else {
        $pids = Get-PidsByPattern -PatternRegex $FrontendPattern
        if ($pids.Count -gt 0) {
            Write-Host ("Frontend: RUNNING (untracked PID(s): {0})" -f ($pids -join ", "))
        } else {
            Write-Host "Frontend: STOPPED"
        }
    }

    Show-Health
    Write-Host "Logs: $LogDir"
}

function Start-LogTailJob {
    param([string]$Label, [string]$Path)
    Ensure-File $Path

    $scriptBlock = {
        param($label, $path)
        Get-Content -Path $path -Wait -Tail 20 | ForEach-Object {
            "[{0}] {1}" -f $label, $_
        }
    }

    if (Get-Command Start-ThreadJob -ErrorAction SilentlyContinue) {
        return Start-ThreadJob -ScriptBlock $scriptBlock -ArgumentList $Label, $Path
    }

    return Start-Job -ScriptBlock $scriptBlock -ArgumentList $Label, $Path
}

function Follow-Logs {
    param([string[]]$Targets)

    Ensure-LogDir
    if (-not $Targets -or $Targets.Count -eq 0) {
        $Targets = @("backend", "frontend")
    }

    $jobs = @()
    if ($Targets -contains "backend") {
        $jobs += Start-LogTailJob -Label "backend" -Path $BackendLog
    }
    if ($Targets -contains "frontend") {
        $jobs += Start-LogTailJob -Label "frontend" -Path $FrontendLog
    }

    if (-not $jobs -or $jobs.Count -eq 0) {
        Write-Host "No logs selected."
        return
    }

    try {
        Write-Host "Following logs. Press Ctrl+C to stop."
        Receive-Job -Wait -Job $jobs
    } finally {
        foreach ($job in $jobs) {
            Stop-Job -Job $job -Force -ErrorAction SilentlyContinue
        }
        foreach ($job in $jobs) {
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        }
    }
}

function Install-Deps {
    $requirements = Join-Path $ProjectRoot "backend/requirements.txt"
    $pythonExe = Resolve-PythonExe
    if ($pythonExe -and (Test-Path $requirements)) {
        Write-Host "Installing backend dependencies..."
        & $pythonExe -m pip install --upgrade pip
        & $pythonExe -m pip install -r $requirements
    } else {
        Write-Host "Backend dependencies not installed (missing python or requirements.txt)."
    }

    $frontendDir = Join-Path $ProjectRoot "frontend"
    $packageJson = Join-Path $frontendDir "package.json"
    $npmCmd = Resolve-NpmCmd
    if ($npmCmd -and (Test-Path $packageJson)) {
        Write-Host "Installing frontend dependencies..."
        Push-Location $frontendDir
        & $npmCmd install
        Pop-Location
    } else {
        Write-Host "Frontend dependencies not installed (missing npm or package.json)."
    }
}

function Show-Doctor {
    Write-Host "PROJECT ROOT: $ProjectRoot"
    Write-Host ("POWERSHELL: {0}" -f $PSVersionTable.PSVersion)

    $pythonExe = Resolve-PythonExe
    if ($pythonExe) {
        $pyVersion = & $pythonExe --version 2>$null
        Write-Host ("PYTHON: {0}" -f $pyVersion)
    } else {
        Write-Host "PYTHON: NOT FOUND"
    }

    if (Get-Command node -ErrorAction SilentlyContinue) {
        $nodeVersion = & node --version 2>$null
        Write-Host ("NODE: {0}" -f $nodeVersion)
    } else {
        Write-Host "NODE: NOT FOUND"
    }

    $npmCmd = Resolve-NpmCmd
    if ($npmCmd) {
        $npmVersion = & $npmCmd --version 2>$null
        Write-Host ("NPM: {0}" -f $npmVersion)
    } else {
        Write-Host "NPM: NOT FOUND"
    }

    $backendReq = Join-Path $ProjectRoot "backend/requirements.txt"
    if (Test-Path $backendReq) {
        Write-Host "backend/requirements.txt: OK"
    } else {
        Write-Host "backend/requirements.txt: MISSING"
    }

    $frontendPkg = Join-Path $ProjectRoot "frontend/package.json"
    if (Test-Path $frontendPkg) {
        Write-Host "frontend/package.json: OK"
    } else {
        Write-Host "frontend/package.json: MISSING"
    }

    $frontendNodeModules = Join-Path $ProjectRoot "frontend/node_modules"
    if (Test-Path $frontendNodeModules) {
        Write-Host "frontend/node_modules: OK"
    } else {
        Write-Host "frontend/node_modules: MISSING"
    }
}

function Invoke-ExternalOrThrow {
    param(
        [string]$Label,
        [scriptblock]$Action
    )

    Write-Host ("==> {0}" -f $Label)
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw ("{0} failed with exit code {1}" -f $Label, $LASTEXITCODE)
    }
}

function Test-BackendPytestAvailable {
    $pythonExe = Resolve-PythonExe
    if (-not $pythonExe) { return $false }
    & $pythonExe -c "import pytest" 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Test-FrontendNodeModulesReady {
    $frontendNodeModules = Join-Path $ProjectRoot "frontend/node_modules"
    return (Test-Path $frontendNodeModules)
}

function Run-ContractsCheck {
    $pythonExe = Resolve-PythonExe
    if (-not $pythonExe) {
        throw "python not found in PATH or venv"
    }
    $checkerPath = Join-Path $ProjectRoot "docs/tools/check_contract_sync.py"
    if (-not (Test-Path $checkerPath)) {
        throw "contracts checker not found: $checkerPath"
    }
    Invoke-ExternalOrThrow -Label "contracts-check" -Action {
        & $pythonExe $checkerPath
    }
}

function Run-DocsCheck {
    $checkerPath = Join-Path $ProjectRoot "docs/tools/validate_docs.ps1"
    if (-not (Test-Path $checkerPath)) {
        Write-Error "docs checker not found: $checkerPath"
        return
    }

    Write-Host "Running documentation checks..."
    & $checkerPath -VerboseOutput
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Documentation checks failed."
    }
}

function Run-BackendPytest {
    param(
        [string[]]$PytestArgs
    )

    $pythonExe = Resolve-PythonExe
    if (-not $pythonExe) {
        throw "python not found in PATH or venv"
    }

    Push-Location (Join-Path $ProjectRoot "backend")
    try {
        & $pythonExe -m pytest @PytestArgs
        if ($LASTEXITCODE -ne 0) {
            throw ("backend pytest failed with exit code {0}" -f $LASTEXITCODE)
        }
    } finally {
        Pop-Location
    }
}

function Run-FrontendCiTests {
    $npmCmd = Resolve-NpmCmd
    if (-not $npmCmd) {
        throw "npm not found in PATH"
    }

    Push-Location (Join-Path $ProjectRoot "frontend")
    $prevCi = $env:CI
    try {
        $env:CI = "true"
        & $npmCmd test -- --watch=false --runInBand
        if ($LASTEXITCODE -ne 0) {
            throw ("frontend tests failed with exit code {0}" -f $LASTEXITCODE)
        }
    } finally {
        if ($null -ne $prevCi) { $env:CI = $prevCi } else { Remove-Item Env:CI -ErrorAction SilentlyContinue }
        Pop-Location
    }
}

function Run-FrontendBuild {
    $npmCmd = Resolve-NpmCmd
    if (-not $npmCmd) {
        throw "npm not found in PATH"
    }

    Push-Location (Join-Path $ProjectRoot "frontend")
    try {
        & $npmCmd run build
        if ($LASTEXITCODE -ne 0) {
            throw ("frontend build failed with exit code {0}" -f $LASTEXITCODE)
        }
    } finally {
        Pop-Location
    }
}

function Run-VerifyFast {
    Write-Host "Running fast verification suite..."
    Run-DocsCheck
    if ($LASTEXITCODE -ne 0) {
        throw "docs-check failed"
    }
    Run-ContractsCheck
    Run-BackendPytest -PytestArgs @(
        "-q",
        "tests/test_websocket_dispatcher_hardening.py",
        "tests/test_contract_sync_guard.py",
        "tests/test_stress_ws_mix.py",
        "tests/test_template_binding.py"
    )
    Run-FrontendCiTests
    Write-Host "verify-fast completed successfully."
}

function Run-Verify {
    Write-Host "Running full verification suite..."
    Run-DocsCheck
    if ($LASTEXITCODE -ne 0) {
        throw "docs-check failed"
    }
    Run-ContractsCheck
    Run-BackendPytest -PytestArgs @("-q")
    Run-FrontendCiTests
    Run-FrontendBuild
    Write-Host "verify completed successfully."
}

function Run-StressWs {
    $pythonExe = Resolve-PythonExe
    if (-not $pythonExe) {
        throw "python not found in PATH or venv"
    }
    $stressScript = Join-Path $ProjectRoot "backend/scripts/stress_ws_mix.py"
    if (-not (Test-Path $stressScript)) {
        throw "stress script not found: $stressScript"
    }

    Write-Host "Running websocket mixed stress scenario..."
    & $pythonExe $stressScript
    if ($LASTEXITCODE -ne 0) {
        throw ("stress-ws failed with exit code {0}" -f $LASTEXITCODE)
    }
    Write-Host "stress-ws completed successfully."
}

function Run-BootstrapAgent {
    Write-Host "Bootstrapping agent environment..."
    Show-Doctor

    $needsBackendDeps = -not (Test-BackendPytestAvailable)
    $needsFrontendDeps = -not (Test-FrontendNodeModulesReady)
    if ($needsBackendDeps -or $needsFrontendDeps) {
        Write-Host "Installing dependencies (conditional bootstrap)..."
        Install-Deps
    } else {
        Write-Host "Dependencies already available; skipping install."
    }

    Run-DocsCheck
    if ($LASTEXITCODE -ne 0) {
        throw "docs-check failed"
    }

    Run-VerifyFast
    Write-Host "Bootstrap complete. Next: use './agent_debug.ps1 verify' before merge."
}

function Run-PlaywrightE2E {
    param(
        [string[]]$ExtraArgs
    )

    $nodeExe = Resolve-NodeExe
    if (-not $nodeExe) {
        throw "node not found in PATH"
    }

    $runnerPath = Join-Path $ProjectRoot "frontend/tests/helpers/runPlaywrightSuite.cjs"
    if (-not (Test-Path $runnerPath)) {
        throw "playwright runner not found: $runnerPath"
    }

    Write-Host "Running Playwright E2E suite with isolated harness..."
    $global:LASTEXITCODE = 0
    & $nodeExe $runnerPath @ExtraArgs
    $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
    if ($exitCode -ne 0) {
        throw ("playwright-e2e failed with exit code {0}" -f $exitCode)
    }
    Write-Host "playwright-e2e completed successfully."
}

function Run-FrontendTemplateBindingUnitTests {
    $npmCmd = Resolve-NpmCmd
    if (-not $npmCmd) {
        throw "npm not found in PATH"
    }

    Push-Location (Join-Path $ProjectRoot "frontend")
    $prevCi = $env:CI
    try {
        $env:CI = "true"
        & $npmCmd test -- --watch=false --runInBand `
            src/App.test.js `
            src/components/template-editor/TemplateEditorContainer.test.js `
            src/hooks/useTemplateMessageHandler.test.js
        if ($LASTEXITCODE -ne 0) {
            throw ("frontend template binding tests failed with exit code {0}" -f $LASTEXITCODE)
        }
    } finally {
        if ($null -ne $prevCi) { $env:CI = $prevCi } else { Remove-Item Env:CI -ErrorAction SilentlyContinue }
        Pop-Location
    }
}

function Run-TemplateBindingBank {
    Write-Host "Running template-binding-bank..."
    Run-BackendPytest -PytestArgs @("-q", "tests/test_template_binding.py")
    Run-FrontendTemplateBindingUnitTests
    Run-PlaywrightE2E -ExtraArgs @("template-binding-bank.spec.ts")
    Write-Host "template-binding-bank completed successfully. Reports: output/template-binding-bank/<run-id>/summary.json"
}

function Show-Help {
    Write-Host "AGENT DEBUG TOOLS (PowerShell 7+)"
    Write-Host "Usage: ./agent_debug.ps1 <command> [args] [-Debug]"
    Write-Host ""
    Write-Host "Start/Stop:"
    Write-Host "  start [--no-follow]       Start backend + frontend"
    Write-Host "  restart [--no-follow]     Restart backend + frontend"
    Write-Host "  stop                      Stop backend + frontend"
    Write-Host "  backend [--no-follow]     Start backend only"
    Write-Host "  frontend [--no-follow]    Start frontend only"
    Write-Host "  stop-backend              Stop backend only"
    Write-Host "  stop-frontend             Stop frontend only"
    Write-Host ""
    Write-Host "Debug:"
    Write-Host "  status                    Show process status and health"
    Write-Host "  health                    Run health checks only"
    Write-Host "  logs [backend|frontend]   Follow logs"
    Write-Host "  deps                      Install backend + frontend dependencies"
    Write-Host "  doctor                    Environment checks"
    Write-Host "  playwright-e2e [args]     Run Playwright suite with isolated sandbox harness"
    Write-Host "  template-binding-bank     Backend/unit + Playwright/MCP bank for JSON template binding"
    Write-Host "  mcp-smoke                 initialize + tools/resources/prompts + get_health"
    Write-Host "  mcp-torture               exhaustive MCP notebook-first torture campaign"
    Write-Host "  docs-check                Validate docs (BOM, links, WS contracts, dates)"
    Write-Host "  contracts-check           Validate WS runtime/docs sync only"
    Write-Host "  stress-ws                Run mixed WS stress benchmark (execute/template/reconvert)"
    Write-Host "  verify-fast               docs-check + contracts-check + critical backend/frontend tests"
    Write-Host "  verify                    docs-check + contracts-check + full backend/frontend checks"
    Write-Host "  bootstrap-agent           doctor + conditional deps + docs-check + verify-fast"
    Write-Host ""
    Write-Host "Flags:"
    Write-Host "  -Debug                    Enable INSPYRO_NOTEBOOK_DEBUG and INSPYRO_WS_DEBUG"
    Write-Host "                            for detailed backend logging (useful for debugging)"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  ./agent_debug.ps1 restart -Debug              # Start with debug logging"
    Write-Host "  ./agent_debug.ps1 start --no-follow -Debug    # Start in background with debug"
    Write-Host "  ./agent_debug.ps1 bootstrap-agent             # Agent onboarding flow"
    Write-Host "  ./agent_debug.ps1 playwright-e2e              # Full Playwright suite in isolated sandbox"
    Write-Host "  ./agent_debug.ps1 playwright-e2e responsive-smoke.spec.ts"
    Write-Host "  ./agent_debug.ps1 template-binding-bank       # Exhaustive JSON template binding bank"
    Write-Host "  ./agent_debug.ps1 mcp-smoke                  # MCP end-to-end smoke test"
    Write-Host "  ./agent_debug.ps1 mcp-torture --keep-artifacts"
    Write-Host "  ./agent_debug.ps1 verify-fast                 # Fast quality gate"
    Write-Host "  ./agent_debug.ps1 verify                      # Full quality gate"
    Write-Host ""
    Write-Host "Logs directory: $LogDir"
}

$CommandLower = $Command.ToLowerInvariant()

switch ($CommandLower) {
    "start" { Start-Servers -Follow:$FollowLogs }
    "restart" { Stop-Servers; Start-Servers -Follow:$FollowLogs }
    "stop" { Stop-Servers }
    "backend" {
        Start-Backend | Out-Null
        if ($FollowLogs) { Follow-Logs -Targets @("backend") }
    }
    "frontend" {
        Start-Frontend | Out-Null
        if ($FollowLogs) { Follow-Logs -Targets @("frontend") }
    }
    "stop-backend" { Stop-Backend }
    "stop-frontend" { Stop-Frontend }
    "status" { Show-Status }
    "health" { Show-Health }
    "logs" {
        if ($Arg2 -and ($Arg2 -in @("backend", "frontend"))) {
            Follow-Logs -Targets @($Arg2)
        } else {
            Follow-Logs -Targets @("backend", "frontend")
        }
    }
    "deps" { Install-Deps }
    "doctor" { Show-Doctor }
    "playwright-e2e" { Run-PlaywrightE2E -ExtraArgs $AllArgs }
    "template-binding-bank" { Run-TemplateBindingBank }
    "mcp-smoke" { Run-McpSmoke }
    "mcp-torture" { Run-McpTorture }
    "docs-check" { Run-DocsCheck }
    "contracts-check" { Run-ContractsCheck }
    "stress-ws" { Run-StressWs }
    "verify-fast" { Run-VerifyFast }
    "verify" { Run-Verify }
    "bootstrap-agent" { Run-BootstrapAgent }
    default { Show-Help }
}
