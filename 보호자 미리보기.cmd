@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "%~dp0scripts\caregiver-preview.cjs"
if errorlevel 1 pause
