@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   港股模拟交易系统
echo ========================================
echo.

echo [1/2] 构建前端...
cd client
call npm run build
if %errorlevel% neq 0 (
    echo 前端构建失败，请检查 Node.js 是否安装
    cd ..
    pause
    exit
)
cd ..

echo [2/2] 启动服务器...
echo 访问: http://localhost:3001
echo 港股: http://localhost:3001/hk
echo.

cd server
call npx tsx src/index.ts
pause
