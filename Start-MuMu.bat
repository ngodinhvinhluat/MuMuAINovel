@echo off
cd /d "%~dp0"
docker compose -f compose.local.yaml up -d --no-build
if errorlevel 1 (
  echo Please start Docker Desktop, then run this file again.
  pause
  exit /b 1
)
start "" http://localhost:8000
