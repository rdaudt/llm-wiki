$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$nodeVersion = (& node --version).TrimStart("v")
$pythonVersion = (& python --version).Split(" ")[1]
if (-not $nodeVersion.StartsWith("24.")) {
    throw "Node 24.x is required; found $nodeVersion"
}
if (-not $pythonVersion.StartsWith("3.12.")) {
    throw "Python 3.12.x is required; found $pythonVersion"
}

npm ci
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r requirements.lock
Write-Host "Pinned dependencies installed."
