@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
call "%~dp0scripts\node-env.cmd"
if errorlevel 1 (
  pause
  exit /b 1
)
node "%~dp0scripts\caregiver-preview.cjs"
if errorlevel 1 pause
