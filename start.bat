@echo off
chcp 65001 >nul
echo ========================================
echo   02110 模拟交易系统 - 一键启动
echo ========================================
echo.
echo 后端: http://localhost:3001
echo 前端: http://localhost:5173
echo.
echo 关闭此窗口即可停止所有服务
echo ========================================
echo.

cd /d "%~dp0"

echo 正在启动服务，稍后会自动打开浏览器...
echo.

npm run dev

pause
