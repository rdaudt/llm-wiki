$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidDir = Join-Path $root "var\pids"
foreach ($name in @("adapter.pid", "streamlit.pid")) {
    $path = Join-Path $pidDir $name
    if (Test-Path -LiteralPath $path) {
        $processId = [int](Get-Content -LiteralPath $path)
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process) { Stop-Process -Id $processId }
        Remove-Item -LiteralPath $path
    }
}

