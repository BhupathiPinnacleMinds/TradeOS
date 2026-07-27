$ErrorActionPreference = 'Stop'

Set-Location 'C:\Users\bhupa\WorkSpace\TradeOS\apps\api'

Write-Host 'Starting TradieOS API on http://localhost:3000/api and LAN http://192.168.0.234:3000/api ...' -ForegroundColor Cyan
$env:CI = 'true'
$env:HOST = '0.0.0.0'
$existingApiListeners = @(netstat -ano | Select-String 'LISTENING' | Select-String ':3000')

if ($existingApiListeners.Count -gt 0) {
  Write-Host 'Port 3000 is already in use. Stop the existing API process before starting a new one:' -ForegroundColor Yellow
  $existingApiListeners | ForEach-Object { Write-Host $_.Line -ForegroundColor Yellow }
  Write-Host 'Tip: close the old API PowerShell window, or stop the listed PID in Task Manager.' -ForegroundColor Yellow
  exit 1
}

$pnpmCandidates = @(
  'C:\Program Files\nodejs\pnpm.cmd',
  'C:\Users\bhupa\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd',
  'C:\Users\bhupa\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
)

$pnpm = $pnpmCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $pnpm) {
  $pnpm = 'pnpm'
}

& $pnpm start:dev
