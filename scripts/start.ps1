$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $root ".env")
$pidDir = Join-Path $root "var\pids"
New-Item -ItemType Directory -Force -Path $pidDir | Out-Null

$adapter = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory $root -WindowStyle Hidden -PassThru
$ui = Start-Process -FilePath (Join-Path $root ".venv\Scripts\streamlit.exe") -ArgumentList "run", "app\streamlit_app.py", "--server.address", "127.0.0.1" -WorkingDirectory $root -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $pidDir "adapter.pid") -Value $adapter.Id
Set-Content -LiteralPath (Join-Path $pidDir "streamlit.pid") -Value $ui.Id

$deadline = (Get-Date).AddSeconds(30)
do {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:4310/health"
        if ($health.ok) { break }
    } catch {}
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
if (-not $health.ok) { throw "Adapter did not become healthy." }
Start-Process "http://127.0.0.1:8501"
