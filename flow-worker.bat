@echo off
setlocal
cd /d "%~dp0"
if exist ".flow-worker.stop" del ".flow-worker.stop"
echo Starting Flow worker in background (log: flow-worker.log). Chrome window will open - do not close it.
start "Flow Worker" /min cmd /c "npm run flow-worker >> flow-worker.log 2>&1"
