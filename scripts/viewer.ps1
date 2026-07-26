param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Start", "Stop")]
    [string]$Action,
    [Parameter(Mandatory = $true)]
    [ValidateSet("Published", "Staging")]
    [string]$Target
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidDir = Join-Path $root "var\pids"
New-Item -ItemType Directory -Force -Path $pidDir | Out-Null

if ($Target -eq "Published") {
    $port = 4320
    $workspace = Join-Path $root "var\wiki"
    $listenerPidFile = Join-Path $pidDir "viewer.pid"
    $launcherPidFile = Join-Path $pidDir "viewer-launcher.pid"
} else {
    $port = 4321
    $workspace = Join-Path $root "var\staging-wiki"
    $listenerPidFile = Join-Path $pidDir "staging-viewer.pid"
    $launcherPidFile = Join-Path $pidDir "staging-viewer-launcher.pid"
}

function Stop-OwnedProcess([string]$PidFile) {
    if (-not (Test-Path -LiteralPath $PidFile)) { return }
    $processId = [int](Get-Content -LiteralPath $PidFile)
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $processId
        $process.WaitForExit(5000) | Out-Null
    }
    Remove-Item -LiteralPath $PidFile -Force
}

if ($Action -eq "Stop") {
    Stop-OwnedProcess $listenerPidFile
    Stop-OwnedProcess $launcherPidFile
    $deadline = (Get-Date).AddSeconds(10)
    while (
        (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) -and
        (Get-Date) -lt $deadline
    ) {
        Start-Sleep -Milliseconds 200
    }
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Viewer port $port is still occupied after stopping owned processes."
    }
    exit 0
}

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Viewer port $port is already in use."
}
New-Item -ItemType Directory -Force -Path (Join-Path $workspace ".llmwiki") | Out-Null
$schema = Join-Path $workspace ".llmwiki\schema.yaml"
if (-not (Test-Path -LiteralPath $schema)) {
    Copy-Item -LiteralPath (Join-Path $root "wiki\schema.yaml") -Destination $schema
}
$launcher = Start-Process `
    -FilePath (Join-Path $root "node_modules\.bin\llmwiki.cmd") `
    -ArgumentList "view", "--port", "$port" `
    -WorkingDirectory $workspace `
    -WindowStyle Hidden `
    -PassThru
Set-Content -LiteralPath $launcherPidFile -Value $launcher.Id

$ready = $false
$deadline = (Get-Date).AddSeconds(30)
do {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port" -UseBasicParsing
        $ready = $response.StatusCode -eq 200
    } catch {}
    if ($ready) { break }
    Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $deadline)
if (-not $ready) {
    Stop-OwnedProcess $launcherPidFile
    throw "$Target viewer did not become healthy on port $port within 30 seconds."
}

$owner = Get-NetTCPConnection -LocalPort $port -State Listen |
    Where-Object { $_.LocalAddress -in @("127.0.0.1", "::1") } |
    Select-Object -First 1 -ExpandProperty OwningProcess
if (-not $owner) {
    Stop-OwnedProcess $launcherPidFile
    throw "Could not identify the viewer process listening on port $port."
}
Set-Content -LiteralPath $listenerPidFile -Value $owner
