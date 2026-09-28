@echo off
setlocal
cd /d "%~dp0"

curl -s -o "%temp%\pp_check.txt" -w "%%{http_code}" http://localhost:3000 > "%temp%\pp_status.txt" 2>nul
set /p STATUS=<"%temp%\pp_status.txt"
if "%STATUS%"=="200" (
  echo Pooling Prompt is already running.
  call :startworker
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

call :startworker
start http://localhost:3000
goto :eof

:startworker
rem Flow bot starts with the app. Safe to run while a bot is already running: the new one
rem exits by itself because the Chrome profile is locked (see worker/index.ts main()).
echo Starting Flow worker in background (log: flow-worker.log)...
start "Flow Worker" /min cmd /c "npm run flow-worker >> flow-worker.log 2>&1"
goto :eof
