@echo off
set LOG="%~dp0startup.log"
echo === startup %date% %time% === > %LOG%

cd /d "%~dp0"
echo [OK] path: %CD% >> %LOG%

echo [1/2] npm build... >> %LOG%
cd client
call npm run build >> %LOG% 2>&1
if %errorlevel% neq 0 (
    echo [FAIL] build error >> %LOG%
    cd ..
    start notepad %LOG%
    exit
)
cd ..
echo [OK] build done >> %LOG%

echo [2/2] start server... >> %LOG%
cd server
call npm run dev
pause
