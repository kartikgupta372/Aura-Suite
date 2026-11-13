@echo off
setlocal
title Installing Inkboard
cd /d "%~dp0"
echo.
echo  Installing Inkboard ... (needs Node.js and an internet connection, takes about a minute)
echo.
where npm >nul 2>nul || (echo  Node.js was not found. Install it from https://nodejs.org and run this again. & pause & exit /b 1)
call npm install --no-audit --no-fund
if errorlevel 1 (echo. & echo  npm install failed - see the messages above. & pause & exit /b 1)
if not exist "node_modules\electron\dist\electron.exe" (echo  Electron did not download correctly. Run this file again. & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\make-shortcuts.ps1" "%~dp0"
echo.
echo  Done! Inkboard is on your Desktop and in the Start menu. Opening it now...
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
timeout /t 3 >nul
