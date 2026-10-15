@echo off
setlocal
cd /d "%~dp0"
echo stop > ".flow-worker.stop"
echo Stop requested. The worker finishes its current job (if any) and exits; watch flow-worker.log.
