$ErrorActionPreference = 'Stop'

Set-Location 'C:\Users\bhupa\WorkSpace\TradeOS'

Write-Host 'Starting TradieOS API on http://localhost:3000/api ...' -ForegroundColor Cyan
$pnpm = 'C:\Users\bhupa\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd'

if (Test-Path $pnpm) {
  & $pnpm --filter '@tradieos/api' start:dev
} else {
  pnpm --filter '@tradieos/api' start:dev
}
