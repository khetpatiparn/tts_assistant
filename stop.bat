@echo off
setlocal enabledelayedexpansion

set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%P /F >nul 2>&1
  set FOUND=1
)

if "%FOUND%"=="1" (
  echo Pooling Prompt server stopped.
) else (
  echo No server was running on port 3000.
)

pause
