$ErrorActionPreference = 'Stop'

Set-Location 'C:\Users\bhupa\WorkSpace\TradeOS\apps\mobile'

$env:EXPO_PUBLIC_API_URL = 'http://192.168.0.234:3000/api'
$env:EXPO_NO_TELEMETRY = '1'

Remove-Item Env:\EXPO_OFFLINE -ErrorAction SilentlyContinue
Remove-Item Env:\REACT_NATIVE_PACKAGER_HOSTNAME -ErrorAction SilentlyContinue

Write-Host 'Starting TradieOS Expo using tunnel mode ...' -ForegroundColor Cyan
Write-Host 'API URL: ' -NoNewline
Write-Host $env:EXPO_PUBLIC_API_URL -ForegroundColor Green

.\node_modules\.bin\expo.CMD start --tunnel --clear
