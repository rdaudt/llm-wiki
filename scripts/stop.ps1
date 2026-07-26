$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidDir = Join-Path $root "var\pids"
& (Join-Path $PSScriptRoot "viewer.ps1") -Action Stop -Target Staging
& (Join-Path $PSScriptRoot "viewer.ps1") -Action Stop -Target Published
foreach ($name in @("streamlit.pid", "streamlit-launcher.pid", "adapter.pid")) {
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
