@echo off
chcp 65001 >nul
echo ========================================
echo   港股模拟交易系统 - 一键启动
echo ========================================
echo.
echo 访问地址: http://localhost:3001
echo.
echo 关闭此窗口即可停止服务
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] 构建前端...
cd client
call npm run build
cd ..

echo.
echo [2/2] 启动服务器...
cd server
npx tsx src/index.ts

pause
