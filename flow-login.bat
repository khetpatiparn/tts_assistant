@echo off
setlocal
cd /d "%~dp0"
echo.
echo  Opening Chrome with the bot profile (.flow-profile).
echo  1) Sign in with the SPARE Google account (never the main one).
echo  2) Wait until the Flow page is fully loaded.
echo  3) Close ALL Chrome windows of this profile before running flow-worker.bat
echo     (Chrome keeps an exclusive lock on the cookie file while open).
echo.
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%~dp0.flow-profile" --no-first-run --no-default-browser-check "https://labs.google/fx/tools/flow?hl=en"
