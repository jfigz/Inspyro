param(
    [switch]$VerboseOutput
)

$ErrorActionPreference = "Stop"

function Add-Error {
    param(
        [System.Collections.Generic.List[string]]$List,
        [string]$Message
    )
    $List.Add($Message) | Out-Null
}

function Get-DocFiles {
    $files = New-Object System.Collections.Generic.List[string]
    $files.Add((Resolve-Path "AGENTS.md").Path) | Out-Null

    Get-ChildItem -Path "docs" -Recurse -File | Where-Object {
        $_.Extension -in @('.md', '.yaml', '.yml')
    } | ForEach-Object {
        $files.Add($_.FullName) | Out-Null
    }

    return $files
}

function Test-Utf8Bom {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    return ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)
}

function Validate-Bom {
    param(
        [string[]]$Files,
        [System.Collections.Generic.List[string]]$Errors
    )

    foreach ($file in $Files) {
        if (-not (Test-Utf8Bom -Path $file)) {
            Add-Error $Errors "[BOM] Falta UTF-8 BOM: $file"
        }
    }
}

function Validate-Links {
    param(
        [string[]]$MarkdownFiles,
        [System.Collections.Generic.List[string]]$Errors
    )

    $linkRegex = [regex]'\[[^\]]+\]\(([^)]+)\)'

    foreach ($file in $MarkdownFiles) {
        $content = Get-Content -Raw -Path $file
        $matches = $linkRegex.Matches($content)

        foreach ($m in $matches) {
            $target = $m.Groups[1].Value.Trim()
            if ([string]::IsNullOrWhiteSpace($target)) { continue }
            if ($target.StartsWith('http://') -or $target.StartsWith('https://') -or $target.StartsWith('#') -or $target.StartsWith('mailto:')) { continue }

            $cleanTarget = $target.Split('#')[0].Trim()
            if ([string]::IsNullOrWhiteSpace($cleanTarget)) { continue }

            $baseDir = Split-Path -Parent $file
            $resolved = Join-Path $baseDir $cleanTarget

            if (-not (Test-Path $resolved)) {
                Add-Error $Errors "[LINK] Link roto en $file -> $target"
            }
        }
    }
}

function Resolve-PythonForChecks {
    $venvCandidates = @(
        "venv_inspyro\Scripts\python.exe",
        "backend\.venv\Scripts\python.exe",
        ".venv\Scripts\python.exe"
    )

    foreach ($candidate in $venvCandidates) {
        $fullPath = Join-Path (Get-Location) $candidate
        if (Test-Path $fullPath) {
            return $fullPath
        }
    }

    if (Get-Command python -ErrorAction SilentlyContinue) { return "python" }
    if (Get-Command python3 -ErrorAction SilentlyContinue) { return "python3" }
    return $null
}

function Validate-ContractSync {
    param(
        [System.Collections.Generic.List[string]]$Errors
    )

    $checkerPath = "docs/tools/check_contract_sync.py"
    if (-not (Test-Path $checkerPath)) {
        Add-Error $Errors "[WS] No existe $checkerPath"
        return
    }

    $pythonExe = Resolve-PythonForChecks
    if (-not $pythonExe) {
        Add-Error $Errors "[WS] Python no disponible para ejecutar $checkerPath"
        return
    }

    $output = & $pythonExe $checkerPath 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Add-Error $Errors "[WS] contracts-check falló"
        foreach ($line in $output) {
            if ($line -and $line.ToString().Trim().Length -gt 0) {
                Add-Error $Errors ("[WS] {0}" -f $line.ToString().Trim())
            }
        }
    } elseif ($VerboseOutput) {
        Write-Host ($output -join [Environment]::NewLine)
    }
}

function Validate-DateFormat {
    param(
        [string[]]$MarkdownFiles,
        [System.Collections.Generic.List[string]]$Errors
    )

    $headerPattern = [regex]'^\s*>\s*\*\*Última actualización:\*\*\s*(.+)$'
    $datePattern = [regex]'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'

    foreach ($file in $MarkdownFiles) {
        $hasHeader = $false
        $validHeader = $false

        foreach ($line in Get-Content -Path $file) {
            $m = $headerPattern.Match($line)
            if ($m.Success) {
                $hasHeader = $true
                $rawDate = $m.Groups[1].Value.Trim()
                if ($datePattern.IsMatch($rawDate)) {
                    $validHeader = $true
                }
                else {
                    Add-Error $Errors "[DATE] Formato inválido en $file -> $line"
                }
            }
        }

        if (-not $hasHeader) {
            Add-Error $Errors "[DATE] Falta línea 'Última actualización' en $file"
        }
        elseif (-not $validHeader) {
            Add-Error $Errors "[DATE] Ninguna línea válida de fecha en $file"
        }
    }
}

function Get-LlmIndexSourceFiles {
    param([string]$Path)

    $sourceFiles = New-Object System.Collections.Generic.List[string]
    $inModules = $false
    $inSourceFiles = $false

    foreach ($line in Get-Content -Path $Path) {
        $trimmed = $line.Trim()

        if ($trimmed -eq "modules:") {
            $inModules = $true
            continue
        }
        if (-not $inModules) { continue }

        if ($trimmed -match '^\s*source_files:\s*\[') {
            $inSourceFiles = $true
        }

        if ($inSourceFiles) {
            $matches = [regex]::Matches($line, '"([^"]+)"')
            foreach ($m in $matches) {
                $sourceFiles.Add($m.Groups[1].Value) | Out-Null
            }
            if ($trimmed -match '\]') {
                $inSourceFiles = $false
            }
        }
    }

    return $sourceFiles
}

function Validate-LlmIndexSourceFiles {
    param(
        [System.Collections.Generic.List[string]]$Errors
    )

    $indexPath = "docs/llm-index.yaml"
    if (-not (Test-Path $indexPath)) {
        Add-Error $Errors "[LLM] No existe $indexPath"
        return
    }

    $ignoreValues = @("main", "analysis", "lsp", "pint", "agents")
    $entries = Get-LlmIndexSourceFiles -Path $indexPath
    foreach ($entry in $entries) {
        if ([string]::IsNullOrWhiteSpace($entry)) { continue }
        if ($ignoreValues -contains $entry) { continue }
        if ($entry.Contains("*")) { continue }

        $candidate = $entry.Trim()
        if ($candidate.EndsWith("/")) {
            $candidate = $candidate.TrimEnd("/")
        }

        $resolved = Join-Path (Get-Location) $candidate
        if (-not (Test-Path $resolved)) {
            Add-Error $Errors "[LLM] source_files inexistente en llm-index: $entry"
        }
    }
}

function Validate-TestScriptPlacement {
    param(
        [System.Collections.Generic.List[string]]$Errors
    )

    Get-ChildItem -Path "." -File -Filter "test_*.py" | ForEach-Object {
        Add-Error $Errors "[TEST] test script fuera de backend/tests: $($_.FullName)"
    }

    $backendDev = "backend/dev"
    if (Test-Path $backendDev) {
        Get-ChildItem -Path $backendDev -File -Filter "test_*.py" | ForEach-Object {
            Add-Error $Errors "[TEST] test script en backend/dev no permitido: $($_.FullName)"
        }
    }
}

$allDocFiles = Get-DocFiles
$markdownFiles = $allDocFiles | Where-Object { $_.ToLower().EndsWith('.md') }
$errors = New-Object System.Collections.Generic.List[string]

Validate-Bom -Files $allDocFiles -Errors $errors
Validate-Links -MarkdownFiles $markdownFiles -Errors $errors
Validate-ContractSync -Errors $errors
Validate-LlmIndexSourceFiles -Errors $errors
Validate-TestScriptPlacement -Errors $errors
Validate-DateFormat -MarkdownFiles $markdownFiles -Errors $errors

if ($errors.Count -gt 0) {
    Write-Host "[docs-check] FAILED ($($errors.Count) error(es))" -ForegroundColor Red
    foreach ($err in $errors) {
        Write-Host " - $err" -ForegroundColor Red
    }
    exit 1
}

Write-Host "[docs-check] OK - sin errores" -ForegroundColor Green
if ($VerboseOutput) {
    Write-Host "Archivos verificados: $($allDocFiles.Count)"
}
exit 0
