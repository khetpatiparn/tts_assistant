@echo off
setlocal
cd /d "%~dp0"

curl -s -o "%temp%\pp_check.txt" -w "%%{http_code}" http://localhost:3000 > "%temp%\pp_status.txt" 2>nul
set /p STATUS=<"%temp%\pp_status.txt"
if "%STATUS%"=="200" (
  echo Pooling Prompt is already running.
  start http://localhost:3000
  goto :eof
)

echo Building app...
call npm run build
if errorlevel 1 (
  echo Build failed. See errors above.
  pause
  exit /b 1
)

echo Starting server in background...
start "Pooling Prompt Server" /min cmd /c "npm run start"

echo Waiting for server to be ready...
:waitloop
curl -s -o nul http://localhost:3000
if errorlevel 1 (
  timeout /t 1 /nobreak > nul
  goto waitloop
)

start http://localhost:3000
