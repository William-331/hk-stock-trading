@echo off
cd /d "%~dp0"

echo ========================================
echo   HK Stock Trading System
echo ========================================
echo.

echo [*] Free port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " 2^>nul') do taskkill /f /pid %%a >nul 2>&1

echo [1/2] Build frontend...
cd client
call npm run build
if errorlevel 1 (
    echo Build failed - check Node.js install
    cd ..
    pause
    exit
)
cd ..

echo [2/2] Start server...
echo.
echo ========================================
echo   URL: http://localhost:3001
echo   HK:  http://localhost:3001/hk
echo ========================================
echo.

cd server
start "HK Server" cmd /c "npm run dev && pause"
timeout /t 3 /nobreak >nul
start "" http://localhost:3001/#/login
echo Server starting... browser will open shortly.
pause
