@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem "start.bat silent" = run at Windows sign-in (Startup shortcut): start the server and the
rem Flow bot but do not open a browser tab - the app is opened from its installed taskbar icon
set SILENT=0
if /i "%~1"=="silent" set SILENT=1

curl.exe -s -o "%temp%\pp_check.txt" -w "%%{http_code}" http://localhost:3050 > "%temp%\pp_status.txt" 2>nul
set /p STATUS=<"%temp%\pp_status.txt"
if "%STATUS%"=="200" (
  echo Pooling Prompt is already running.
  call :startworker
  call :openapp
  goto :eof
)

rem Rebuilds only when app code changed since the last build (see scripts\build-if-changed.mjs)
call node scripts\build-if-changed.mjs
if errorlevel 1 (
  echo Build failed. See errors above.
  pause
  exit /b 1
)

rem Clean up any lingering process on legacy port 3000 to prevent log locking
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%P /F >nul 2>&1
)

echo Starting server in background...
rem Server runs in a hidden window (no console on the taskbar); output goes to pp-server.log.
rem Stop it with stop.bat - there is no window to close.
powershell -NoProfile -Command "Start-Process -FilePath cmd.exe -ArgumentList '/c npm run start >> pp-server.log 2>&1' -WorkingDirectory '%CD%' -WindowStyle Hidden"

echo Waiting for server to be ready...
set WAIT_COUNT=0
:waitloop
curl.exe -s -o nul http://localhost:3050
if errorlevel 1 (
  set /a WAIT_COUNT+=1
  if !WAIT_COUNT! geq 30 (
    echo.
    echo Server failed to respond after 30s. Please check pp-server.log.
    pause
    exit /b 1
  )
  timeout /t 1 /nobreak > nul
  goto waitloop
)

call :startworker
call :openapp
goto :eof

:openapp
if "%SILENT%"=="1" goto :eof
start http://localhost:3050
goto :eof

:startworker
rem Flow bot starts with the app. Safe to run while a bot is already running: the new one
rem exits by itself because the Chrome profile is locked (see worker/index.ts main()).
echo Starting Flow worker in background (log: flow-worker.log)...
powershell -NoProfile -Command "Start-Process -FilePath cmd.exe -ArgumentList '/c npm run flow-worker >> flow-worker.log 2>&1' -WorkingDirectory '%CD%' -WindowStyle Hidden"
goto :eof
