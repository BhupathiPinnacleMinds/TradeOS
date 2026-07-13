@echo off
cd /d C:\Users\bhupa\WorkSpace\TradeOS\apps\api
set HOST=0.0.0.0
echo Starting TradieOS API with logs at C:\Users\bhupa\WorkSpace\TradeOS\api-runtime.log ...
echo ==== TradieOS API start %DATE% %TIME% ====>> C:\Users\bhupa\WorkSpace\TradeOS\api-runtime.log
"C:\Program Files\nodejs\node.exe" dist\src\main.js >> C:\Users\bhupa\WorkSpace\TradeOS\api-runtime.log 2>>&1
echo ==== TradieOS API exited with code %ERRORLEVEL% at %DATE% %TIME% ====>> C:\Users\bhupa\WorkSpace\TradeOS\api-runtime.log
pause
