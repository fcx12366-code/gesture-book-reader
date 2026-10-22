@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\.bin\vite.cmd" (
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm.cmd run dev -- --open
pause
