@echo off
cd /d "%~dp0"

echo ========================================
echo   HK Stock Trading System
echo ========================================
echo.

echo [*] Free port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " 2^>nul') do taskkill /f /pid %%a >nul 2>&1
echo.

echo [1/2] Build frontend...
cd client
call npm run build
if errorlevel 1 (
    echo Build failed
    cd ..
    pause
    exit
)
cd ..

echo [2/2] Start server...
echo URL: http://localhost:3001
echo HK:  http://localhost:3001/hk
echo.

cd server
call npm run dev
pause
