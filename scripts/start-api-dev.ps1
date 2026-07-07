$ErrorActionPreference = 'Stop'

Set-Location 'C:\Users\bhupa\WorkSpace\TradeOS'

Write-Host 'Starting TradieOS API on http://localhost:3000/api ...' -ForegroundColor Cyan
pnpm --filter '@tradieos/api' start:dev
