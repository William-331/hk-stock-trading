@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   HK Stock Trading System
echo   Environment Installer
echo ========================================
echo.

echo [1/5] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found.
    echo Please install Node.js LTS first, then reopen Command Prompt and rerun install-env.bat.
    echo Download: https://nodejs.org/
    pause
    exit /b 1
)
for /f "delims=" %%i in ('node -v') do set NODE_VERSION=%%i
echo Detected Node.js: %NODE_VERSION%
echo.

echo [2/5] Checking npm...
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found.
    echo Please reinstall Node.js LTS and ensure npm is added to PATH.
    pause
    exit /b 1
)
for /f "delims=" %%i in ('npm -v') do set NPM_VERSION=%%i
echo Detected npm: %NPM_VERSION%
echo.
echo Note: If server dependency installation fails, please prefer a Node.js LTS version.
echo       This project uses better-sqlite3 and may be sensitive to unsupported Node versions.
echo.

echo [3/5] Installing root dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] Root dependency installation failed.
    echo Please check your network connection or npm configuration, then try again.
    pause
    exit /b 1
)
if not exist node_modules (
    echo [ERROR] Root node_modules folder was not created.
    pause
    exit /b 1
)
echo Root dependencies installed.
echo.

echo [4/5] Installing server dependencies...
cd server
call npm install
if errorlevel 1 (
    echo [ERROR] Server dependency installation failed.
    echo This may be related to better-sqlite3, Node.js version compatibility, or missing Windows runtime support.
    echo Please retry with a current Node.js LTS version.
    cd ..
    pause
    exit /b 1
)
if not exist node_modules (
    echo [ERROR] server\node_modules folder was not created.
    cd ..
    pause
    exit /b 1
)
cd ..
echo Server dependencies installed.
echo.

echo [5/5] Installing client dependencies...
cd client
call npm install
if errorlevel 1 (
    echo [ERROR] Client dependency installation failed.
    echo Please check your network connection or npm registry settings, then try again.
    cd ..
    pause
    exit /b 1
)
if not exist node_modules (
    echo [ERROR] client\node_modules folder was not created.
    cd ..
    pause
    exit /b 1
)
cd ..
echo Client dependencies installed.
echo.

if exist data (
    echo Existing data folder detected: data\
) else (
    echo No local data folder detected yet.
    echo The embedded SQLite database will be created automatically on first server start.
)
echo.
echo ========================================
echo   Environment setup completed
echo ========================================
echo Next step: run start.bat
echo URL after startup: http://localhost:3001
echo.
pause
exit /b 0
