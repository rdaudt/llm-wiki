$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$varRoot = [System.IO.Path]::GetFullPath((Join-Path $root "var"))
& (Join-Path $PSScriptRoot "stop.ps1")
foreach ($name in @("wiki", "staging-wiki", "builds")) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $varRoot $name))
    if ([System.IO.Path]::GetDirectoryName($target) -ne $varRoot) {
        throw "Refusing to clear unexpected runtime path: $target"
    }
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}
& (Join-Path $PSScriptRoot "start.ps1")
Write-Host "Runtime knowledge was cleared and all live services restarted."

