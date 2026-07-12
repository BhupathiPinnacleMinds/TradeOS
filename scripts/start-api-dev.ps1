$ErrorActionPreference = 'Stop'

Set-Location 'C:\Users\bhupa\WorkSpace\TradeOS'

Write-Host 'Starting TradieOS API on http://localhost:3000/api ...' -ForegroundColor Cyan
$pnpmCandidates = @(
  'C:\Program Files\nodejs\pnpm.cmd',
  'C:\Users\bhupa\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd',
  'C:\Users\bhupa\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
)

$pnpm = $pnpmCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $pnpm) {
  $pnpm = 'pnpm'
}

& $pnpm --filter '@tradieos/api' start:dev
