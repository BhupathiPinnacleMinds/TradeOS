$ErrorActionPreference = 'Stop'

Set-Location 'C:\Users\bhupa\WorkSpace\TradeOS\apps\mobile'

$env:EXPO_PUBLIC_API_URL = 'http://192.168.0.234:3000/api'
$env:CI = 'true'
$env:EXPO_NO_TELEMETRY = '1'
$env:EXPO_OFFLINE = '1'
$env:REACT_NATIVE_PACKAGER_HOSTNAME = '192.168.0.234'

Write-Host 'Starting TradieOS Expo on LAN without clearing Metro cache ...' -ForegroundColor Cyan
Write-Host 'Open this in Expo Go if QR scan is stubborn: exp://192.168.0.234:8081' -ForegroundColor Yellow
Write-Host 'API URL: ' -NoNewline
Write-Host $env:EXPO_PUBLIC_API_URL -ForegroundColor Green

.\node_modules\.bin\expo.CMD start --lan
