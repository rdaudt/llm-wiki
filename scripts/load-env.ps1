param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return
}

foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
        continue
    }
    $parts = $trimmed -split "=", 2
    if ($parts.Count -ne 2 -or $parts[0] -notmatch "^[A-Z][A-Z0-9_]*$") {
        throw "Invalid environment entry in $Path"
    }
    [Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
}
