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

rem Rebuilds only when app code changed since the last build (see scripts\build-if-changed.mjs)
call node scripts\build-if-changed.mjs
if errorlevel 1 (
  echo Build failed. See errors above.
  pause
  exit /b 1
)

echo Starting server in background...
rem Server output goes to pp-server.log; otherwise errors only exist in the minimized window
start "Pooling Prompt Server" /min cmd /c "npm run start >> pp-server.log 2>&1"

echo Waiting for server to be ready...
:waitloop
curl -s -o nul http://localhost:3000
if errorlevel 1 (
  timeout /t 1 /nobreak > nul
  goto waitloop
)

start http://localhost:3000
