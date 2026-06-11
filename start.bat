@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   港股模拟交易系统 - 一键启动
echo ========================================
echo.

cd /d "%~dp0"

:: 杀掉占用3001端口的旧进程
echo [0/3] 检查并释放 3001 端口...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING" 2^>nul') do (
    echo   发现旧进程 PID=%%a，正在关闭...
    taskkill /f /pid %%a >nul 2>&1
)
echo   端口已释放

:: 安装依赖（如需要）
echo.
echo [1/3] 检查依赖...
if not exist "server\node_modules" (
    echo   正在安装服务端依赖...
    cd server
    call npm install
    cd ..
)
if not exist "client\node_modules" (
    echo   正在安装前端依赖...
    cd client
    call npm install
    cd ..
)
echo   依赖就绪

:: 构建前端
echo.
echo [2/3] 构建前端...
cd client
call npm run build
if %errorlevel% neq 0 (
    echo   ❌ 前端构建失败！
    cd ..
    pause
    exit /b 1
)
cd ..
echo   ✅ 前端构建完成

:: 启动后端
echo.
echo [3/3] 启动服务器...
echo.
echo ========================================
echo   访问地址: http://localhost:3001
echo   港股行情: http://localhost:3001/hk
echo   关闭此窗口停止服务
echo ========================================
echo.

cd server
npx tsx src/index.ts

pause
