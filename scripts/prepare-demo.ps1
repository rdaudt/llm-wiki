$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $root ".env")
if (-not $env:OPENAI_API_KEY) { throw "OPENAI_API_KEY is required to prepare live snapshots." }
if (-not $env:SEC_USER_AGENT) { throw "SEC_USER_AGENT is required to fetch SEC material." }
Set-Location $root
python -m tools.corpus
npm run build
npm test
Write-Host "Compiler preparation boundary validated. Run the pinned compiler workflow with the configured API key."
