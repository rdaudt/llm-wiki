$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $root ".env")
$pidDir = Join-Path $root "var\pids"
New-Item -ItemType Directory -Force -Path $pidDir | Out-Null

$occupied = Get-NetTCPConnection -LocalPort 4310,4320,4321,8501 -State Listen -ErrorAction SilentlyContinue
if ($occupied) {
    $ports = ($occupied | Select-Object -ExpandProperty LocalPort -Unique | Sort-Object) -join ", "
    throw "Required port(s) already in use: $ports. Run scripts/stop.ps1 or stop the owning process."
}

$adapter = Start-Process -FilePath "node.exe" -ArgumentList "--import", "tsx", "src/server.ts" -WorkingDirectory $root -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $pidDir "adapter.pid") -Value $adapter.Id
$adapterDeadline = (Get-Date).AddSeconds(30)
$adapterReady = $false
do {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:4310/health"
        $adapterReady = [bool]$health.ok
    } catch {}
    if ($adapterReady) { break }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $adapterDeadline)
if (-not $adapterReady) {
    & (Join-Path $PSScriptRoot "stop.ps1")
    throw "Adapter did not become healthy within 30 seconds."
}

$stagingRoot = Join-Path $root "var\staging-wiki"
New-Item -ItemType Directory -Force -Path (Join-Path $stagingRoot ".llmwiki") | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $stagingRoot ".llmwiki\schema.yaml"))) {
    Copy-Item -LiteralPath (Join-Path $root "wiki\schema.yaml") -Destination (Join-Path $stagingRoot ".llmwiki\schema.yaml")
}
$viewer = Start-Process -FilePath (Join-Path $root "node_modules\.bin\llmwiki.cmd") -ArgumentList "view", "--port", "4320" -WorkingDirectory (Join-Path $root "var\wiki") -WindowStyle Hidden -PassThru
$stagingViewer = Start-Process -FilePath (Join-Path $root "node_modules\.bin\llmwiki.cmd") -ArgumentList "view", "--port", "4321" -WorkingDirectory $stagingRoot -WindowStyle Hidden -PassThru
$ui = Start-Process -FilePath (Join-Path $root ".venv\Scripts\python.exe") -ArgumentList "-m", "streamlit", "run", "app\streamlit_app.py", "--server.address", "127.0.0.1", "--server.port", "8501", "--server.headless", "true" -WorkingDirectory $root -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $pidDir "viewer-launcher.pid") -Value $viewer.Id
Set-Content -LiteralPath (Join-Path $pidDir "staging-viewer-launcher.pid") -Value $stagingViewer.Id
Set-Content -LiteralPath (Join-Path $pidDir "streamlit-launcher.pid") -Value $ui.Id

$serviceDeadline = (Get-Date).AddSeconds(30)
$viewerReady = $false
$stagingViewerReady = $false
$uiReady = $false
do {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:4320" -UseBasicParsing
        $viewerReady = $response.StatusCode -eq 200
    } catch {}
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:4321" -UseBasicParsing
        $stagingViewerReady = $response.StatusCode -eq 200
    } catch {}
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:8501/_stcore/health" -UseBasicParsing
        $uiReady = $response.StatusCode -eq 200
    } catch {}
    if ($viewerReady -and $stagingViewerReady -and $uiReady) { break }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $serviceDeadline)
if (-not $viewerReady -or -not $stagingViewerReady -or -not $uiReady) {
    & (Join-Path $PSScriptRoot "stop.ps1")
    throw "Published viewer, staging viewer, and Streamlit did not become healthy within 30 seconds."
}

foreach ($service in @(@{ Port = 4320; Name = "viewer.pid" }, @{ Port = 4321; Name = "staging-viewer.pid" }, @{ Port = 8501; Name = "streamlit.pid" })) {
    $owner = Get-NetTCPConnection -LocalPort $service.Port -State Listen |
        Where-Object { $_.LocalAddress -in @("127.0.0.1", "::1") } |
        Select-Object -First 1 -ExpandProperty OwningProcess
    if (-not $owner) {
        & (Join-Path $PSScriptRoot "stop.ps1")
        throw "Could not identify the port $($service.Port) listener process."
    }
    Set-Content -LiteralPath (Join-Path $pidDir $service.Name) -Value $owner
}
Start-Process "http://127.0.0.1:8501"
