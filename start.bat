@echo off
cd /d "%~dp0"

echo ========================================
echo   港股模拟交易系统
echo ========================================
echo.

echo [*] 释放 3001 端口...
powershell -Command "Stop-Process -Id (Get-NetTCPConnection -LocalPort 3001 -EA 0).OwningProcess -Force -EA 0" 2>nul
echo.

echo [1/2] 构建前端...
cd client
call npm run build
if errorlevel 1 ( echo 构建失败 && cd .. && pause && exit )
cd ..

echo [2/2] 启动服务器...
echo 访问: http://localhost:3001
echo.

cd server
call npm run dev
pause
