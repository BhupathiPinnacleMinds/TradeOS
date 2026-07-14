$ErrorActionPreference = 'Stop'

Set-Location 'C:\Users\bhupa\WorkSpace\TradeOS\apps\api'

$env:HOST = '0.0.0.0'

Write-Host 'Starting TradieOS API on http://localhost:3000/api and LAN http://192.168.0.234:3000/api ...' -ForegroundColor Cyan
Write-Host 'Using apps/api/.env and built dist output.' -ForegroundColor DarkGray

& 'C:\Program Files\nodejs\node.exe' 'dist\src\main.js'
