$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidDir = Join-Path $root "var\pids"
foreach ($name in @("streamlit.pid", "streamlit-launcher.pid", "staging-viewer.pid", "staging-viewer-launcher.pid", "viewer.pid", "viewer-launcher.pid", "adapter.pid")) {
    $path = Join-Path $pidDir $name
    if (Test-Path -LiteralPath $path) {
        $processId = [int](Get-Content -LiteralPath $path)
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process) {
            Stop-Process -Id $processId
            $process.WaitForExit(5000) | Out-Null
        }
        Remove-Item -LiteralPath $path
    }
}
