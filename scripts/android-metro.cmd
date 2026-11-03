@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
for %%I in ("%~dp0..") do set "APP_DIR=%%~fI"
cd /d "%APP_DIR%"
call "%~dp0node-env.cmd"
if errorlevel 1 exit /b 1
if not exist ".preview\windows-test" mkdir ".preview\windows-test"
rem Redirected output makes the CLI non-interactive; CI would disable live reload.
set "CI="
call npm.cmd start -- --go --localhost --port 8081 > ".preview\windows-test\metro-launcher.log" 2>&1
exit /b %errorlevel%
