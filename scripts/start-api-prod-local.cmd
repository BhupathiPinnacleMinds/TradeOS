@echo off
cd /d C:\Users\bhupa\WorkSpace\TradeOS\apps\api
set HOST=0.0.0.0
echo Starting TradieOS API on http://localhost:3000/api and LAN http://192.168.0.234:3000/api ...
"C:\Program Files\nodejs\node.exe" dist\src\main.js
pause
