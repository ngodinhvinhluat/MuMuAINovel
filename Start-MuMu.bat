@echo off
cd /d "%~dp0"
if exist "tools\cli-bridge\config.json" (
  tasklist /FI "WINDOWTITLE eq MuMu CLI Bridge*" | find /I "cmd.exe" >nul || start "MuMu CLI Bridge" /min cmd /c "%~dp0Start-CLI-Bridge.bat"
)
docker compose -f compose.local.yaml up -d --no-build
if errorlevel 1 (
  echo Please start Docker Desktop, then run this file again.
  pause
  exit /b 1
)
start "" http://localhost:8000
