$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
npm run build
npm test
npm run verify:snapshots
python -m pytest
python -m ruff check app tools python_tests
python -m tools.corpus
$listeners = Get-NetTCPConnection -LocalPort 4310,8501 -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
    if ($listener.LocalAddress -notin @("127.0.0.1", "::1")) {
        throw "Service on port $($listener.LocalPort) is not loopback-only."
    }
}
Write-Host "Offline demo verification passed."
