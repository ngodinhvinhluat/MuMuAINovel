@echo off
cd /d "%~dp0tools\cli-bridge"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 18+ first, then install Claude Code / Codex CLI.
  pause
  exit /b 1
)
title MuMu CLI Bridge
node server.js
pause
