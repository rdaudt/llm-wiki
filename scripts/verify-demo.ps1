$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
& (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $root ".env")
if (-not $env:OPENAI_API_KEY) { throw "OPENAI_API_KEY is required for the live demo." }
if (-not $env:SEC_USER_AGENT -or $env:SEC_USER_AGENT -notmatch "@") {
    throw "SEC_USER_AGENT must include an application name and monitored contact address."
}
$nodeVersion = (& node --version).TrimStart("v")
$pythonPath = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "Pinned Python environment is missing. Run scripts/bootstrap.ps1."
}
$pythonVersion = (& $pythonPath --version).Split(" ")[1]
if (-not $nodeVersion.StartsWith("24.")) { throw "Node 24.x is required; found $nodeVersion" }
if (-not $pythonVersion.StartsWith("3.12.")) { throw "Python 3.12.x is required; found $pythonVersion" }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "TypeScript build failed." }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw "TypeScript tests failed." }
& $pythonPath -m pytest
if ($LASTEXITCODE -ne 0) { throw "Python tests failed." }
& $pythonPath -m ruff check app tools python_tests
if ($LASTEXITCODE -ne 0) { throw "Ruff failed." }
$listeners = Get-NetTCPConnection -LocalPort 4310,4320,4321,8501 -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
    if ($listener.LocalAddress -notin @("127.0.0.1", "::1")) {
        throw "Service on port $($listener.LocalPort) is not loopback-only."
    }
}
Write-Host "Offline demo verification passed."
Write-Host "No SEC or OpenAI calls were made. Live checks are manual and cost-bearing."
