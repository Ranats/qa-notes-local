@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or later and reopen this file.
  pause
  exit /b 1
)
node server.cjs
pause
