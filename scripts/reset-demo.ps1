$ErrorActionPreference = "Stop"
$headers = @{ "Idempotency-Key" = "reset-$([guid]::NewGuid())" }
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4310/v1/demo/reset" -Headers $headers | Out-Null
Write-Host "Baseline state restored and selected."

