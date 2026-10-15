@echo off
setlocal enabledelayedexpansion

rem Also stop the Flow bot: it finishes its current job (if any) and exits by itself
echo stop > "%~dp0.flow-worker.stop"
echo Flow worker asked to stop (it finishes the current job first).

set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3050" ^| findstr "LISTENING"') do (
  taskkill /PID %%P /F >nul 2>&1
  set FOUND=1
)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%P /F >nul 2>&1
  set FOUND=1
)

if "%FOUND%"=="1" (
  echo Pooling Prompt server stopped.
) else (
  echo No server was running on port 3050 or 3000.
)

pause
