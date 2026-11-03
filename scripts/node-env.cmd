@echo off
setlocal
set /p "METACARE_VERSION="<"%~dp0..\.nvmrc"
node.exe -e "process.exit(process.versions.node === process.argv[1] ? 0 : 1)" "%METACARE_VERSION%" 2>nul
if not errorlevel 1 exit /b 0

set "METACARE_RUNTIME=E:\Dev\Tools\node-v%METACARE_VERSION%-win-x64"
if exist "%METACARE_RUNTIME%\node.exe" (
  endlocal & set "PATH=%METACARE_RUNTIME%;%PATH%" & exit /b 0
)
echo MetaCare requires Node.js %METACARE_VERSION%. Install that version or select it on PATH.
exit /b 1
