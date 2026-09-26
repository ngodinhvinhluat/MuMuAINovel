@echo off
cd /d "%~dp0"
docker compose -f compose.local.yaml stop
taskkill /FI "WINDOWTITLE eq MuMu CLI Bridge*" /T /F >nul 2>nul
pause
