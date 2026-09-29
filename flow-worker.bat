@echo off
setlocal
cd /d "%~dp0"
if exist ".flow-worker.stop" del ".flow-worker.stop"
echo Starting Flow worker in background (log: flow-worker.log). Chrome window will open - do not close it.
powershell -NoProfile -Command "Start-Process -FilePath cmd.exe -ArgumentList '/c npm run flow-worker >> flow-worker.log 2>&1' -WorkingDirectory '%CD%' -WindowStyle Hidden"
