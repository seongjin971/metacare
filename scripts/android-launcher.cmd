@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title 메타케어 Android 테스트

set "MODE=%~1"
if /i "%MODE%"=="apk" goto mode_ok
if /i "%MODE%"=="preview" goto mode_ok
echo Android 테스트.cmd 또는 Android 미리보기.cmd를 실행하세요.
exit /b 1

:mode_ok
for %%I in ("%~dp0..") do set "APP_DIR=%%~fI"

rem Reuse the existing test device. Never wipe data or target a physical phone.
set "ANDROID_HOME=E:\Dev\Tools\Android"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "ANDROID_AVD_HOME=%ANDROID_HOME%\avd"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
set "EMULATOR=%ANDROID_HOME%\emulator\emulator.exe"
set "AVD_NAME=MetaCare_API36"
set "APK=%APP_DIR%\.preview\builds\metacare-1.0.2.apk"
set "EXPO_GO_APK=%APP_DIR%\.preview\windows-test\Expo-Go-58.0.5.apk"
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "BOOT_ATTEMPTS=0"

if not exist "%ADB%" goto missing_tools
if not exist "%EMULATOR%" goto missing_tools
if not exist "%ANDROID_AVD_HOME%\%AVD_NAME%.ini" goto missing_avd
if /i "%MODE%"=="apk" if not exist "%APK%" goto missing_apk

echo 메타케어 Android 테스트를 준비합니다.
"%ADB%" start-server
if errorlevel 1 goto adb_failed
call :find_target
if defined TARGET_SERIAL goto wait_boot

rem A live or starting AVD owns this lock. Do not start a second instance.
if exist "%ANDROID_AVD_HOME%\%AVD_NAME%.avd\hardware-qemu.ini.lock" goto wait_boot
if defined PORT_5554_BUSY goto port_busy

echo Android 에뮬레이터를 여는 중입니다.
start "메타케어 Android" "%EMULATOR%" -avd "%AVD_NAME%" -port 5554 -gpu auto -no-boot-anim -timezone Asia/Seoul

:wait_boot
echo %AVD_NAME% 부팅을 기다립니다. 최대 약 4분이 걸릴 수 있습니다.

:boot_poll
call :find_target
if not defined TARGET_SERIAL goto boot_retry
set "BOOT_COMPLETE="
for /f "delims=" %%B in ('%ADB% -s %TARGET_SERIAL% shell getprop sys.boot_completed 2^>nul') do if "%%B"=="1" set "BOOT_COMPLETE=1"
if defined BOOT_COMPLETE goto device_ready

:boot_retry
set /a BOOT_ATTEMPTS+=1 >nul
if %BOOT_ATTEMPTS% GEQ 120 goto boot_timeout
timeout /t 2 /nobreak >nul
goto boot_poll

:device_ready
if /i "%MODE%"=="preview" goto preview

:install_apk
rem Recheck the AVD name immediately before every app-changing operation.
call :is_target_avd "%TARGET_SERIAL%"
if errorlevel 1 goto wrong_device
echo.
echo %AVD_NAME% [%TARGET_SERIAL%]에 APK를 설치합니다. 기존 기록은 유지합니다.
"%ADB%" -s "%TARGET_SERIAL%" install -r "%APK%"
if errorlevel 1 goto install_failed

call :is_target_avd "%TARGET_SERIAL%"
if errorlevel 1 goto wrong_device
echo.
echo 메타케어를 실행합니다.
"%ADB%" -s "%TARGET_SERIAL%" shell am start -W -n com.metacare.demo/.MainActivity
if errorlevel 1 goto launch_failed
echo.
echo 준비됐습니다. 에뮬레이터에서 앱을 테스트하세요.
echo 이 창을 닫아도 에뮬레이터는 계속 실행됩니다.
pause
exit /b 0

:preview
title 메타케어 Android 미리보기
call :is_target_avd "%TARGET_SERIAL%"
if errorlevel 1 goto wrong_device
set "EXPO_GO_INSTALLED="
for /f "delims=" %%P in ('%ADB% -s %TARGET_SERIAL% shell pm path host.exp.exponent 2^>nul ^| findstr /b "package:"') do set "EXPO_GO_INSTALLED=1"
if defined EXPO_GO_INSTALLED goto ensure_metro
if not exist "%EXPO_GO_APK%" goto missing_expo_go
echo Expo Go를 설치합니다.
call :is_target_avd "%TARGET_SERIAL%"
if errorlevel 1 goto wrong_device
"%ADB%" -s "%TARGET_SERIAL%" install "%EXPO_GO_APK%"
if errorlevel 1 goto expo_install_failed

:ensure_metro
echo 현재 소스 미리보기 서버를 확인합니다.
set "METRO_ATTEMPTS=0"
call :check_metro
if errorlevel 3 goto metro_wait
if errorlevel 2 goto wrong_metro
if not errorlevel 1 goto open_preview
echo 미리보기 서버를 백그라운드에서 시작합니다.
"%POWERSHELL%" -NoLogo -NoProfile -Command "Start-Process -FilePath $env:ComSpec -ArgumentList '/d /c scripts\android-metro.cmd' -WorkingDirectory $env:APP_DIR -WindowStyle Hidden"
if errorlevel 1 goto metro_failed

:metro_wait
set /a METRO_ATTEMPTS+=1 >nul
if %METRO_ATTEMPTS% GEQ 30 goto metro_failed
timeout /t 2 /nobreak >nul
call :check_metro
if errorlevel 3 goto metro_wait
if errorlevel 2 goto wrong_metro
if errorlevel 1 goto metro_wait

:open_preview
call :is_target_avd "%TARGET_SERIAL%"
if errorlevel 1 goto wrong_device
"%ADB%" -s "%TARGET_SERIAL%" reverse tcp:8081 tcp:8081
if errorlevel 1 goto reverse_failed
call :is_target_avd "%TARGET_SERIAL%"
if errorlevel 1 goto wrong_device
"%ADB%" -s "%TARGET_SERIAL%" reverse tcp:8789 tcp:8789
if errorlevel 1 goto reverse_failed
call :is_target_avd "%TARGET_SERIAL%"
if errorlevel 1 goto wrong_device
rem A Quick Boot snapshot can restore Expo Go with a dead Metro connection and a
rem broken LogBox. Start a fresh Expo Go process after Metro and adb reverse are ready.
rem CMD protects the whole remote command; Android sh protects the URL's ampersands.
"%ADB%" -s "%TARGET_SERIAL%" shell "am start -S -W -a android.intent.action.VIEW -d 'exp://127.0.0.1:8081?__expo_disable_fab=1&__expo_disable_auto_launch=1&__expo_disable_onboarding=1' -p host.exp.exponent"
if errorlevel 1 goto preview_failed
echo.
echo 현재 소스가 Expo Go에서 열렸습니다. 코드 저장 시 변경 내용이 반영됩니다.
echo APK 앱과 미리보기는 기록 저장소가 서로 다릅니다.
echo 이 창을 닫아도 에뮬레이터와 미리보기 서버는 계속 실행됩니다.
pause
exit /b 0

:check_metro
rem 0=this app ready, 1=unused port, 2=another service/project, 3=busy server.
"%POWERSHELL%" -NoLogo -NoProfile -Command "$listener=Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue; if (-not $listener) { exit 1 }; try { $health=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8081/status' -TimeoutSec 3; $healthText=if ($health.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($health.Content) } else { [string]$health.Content }; if ($healthText.Trim() -ne 'packager-status:running') { exit 2 }; $project=Invoke-RestMethod -Uri 'http://127.0.0.1:8081/_expo/open?platform=android&runtime=expo' -TimeoutSec 3; if ($project.appId -eq 'com.metacare.demo') { exit 0 }; if ($project.appId) { exit 2 }; exit 3 } catch { exit 3 }"
exit /b %errorlevel%

:find_target
set "TARGET_SERIAL="
set "PORT_5554_BUSY="
rem ADB separates device columns with a tab. Match only numeric emulator serials.
for /f "tokens=1,2" %%A in ('%ADB% devices ^| findstr /r /c:"^emulator-[0-9][0-9]*[	 ]"') do call :inspect_device "%%A" "%%B"
exit /b

:inspect_device
if "%~1"=="emulator-5554" set "PORT_5554_BUSY=1"
if not "%~2"=="device" exit /b
if defined TARGET_SERIAL exit /b
call :is_target_avd "%~1"
if not errorlevel 1 set "TARGET_SERIAL=%~1"
exit /b

:is_target_avd
rem The emulator console emits CR-CR-LF; FINDSTR /X tolerates its line endings.
"%ADB%" -s "%~1" emu avd name 2>nul | findstr /x /c:"%AVD_NAME%" >nul
exit /b %errorlevel%

:missing_tools
echo [오류] E:\Dev\Tools\Android의 adb.exe 또는 emulator.exe를 찾을 수 없습니다.
goto failed

:missing_avd
echo [오류] 기존 테스트 기기 %AVD_NAME%을 찾을 수 없습니다.
goto failed

:missing_apk
echo [오류] 설치할 APK가 없습니다:
echo "%APK%"
goto failed

:adb_failed
echo [오류] Android 연결 도구를 시작하지 못했습니다.
goto failed

:port_busy
echo [오류] emulator-5554를 다른 에뮬레이터가 사용 중입니다.
echo 현재 기기에는 설치하지 않았습니다. 해당 에뮬레이터를 확인한 뒤 다시 실행하세요.
goto failed

:boot_timeout
echo [오류] 약 4분 안에 %AVD_NAME%의 부팅을 확인하지 못했습니다.
echo 에뮬레이터 창에서 부팅 상태를 확인한 뒤 이 파일을 다시 실행하세요.
echo 기록 삭제나 다른 기기로의 설치는 하지 않았습니다.
goto failed

:wrong_device
echo [오류] 연결된 기기가 %AVD_NAME%인지 확인되지 않아 중단했습니다.
goto failed

:install_failed
echo [오류] APK 설치에 실패했습니다. 위의 Android 오류를 확인하세요.
echo 기존 앱을 삭제하거나 데이터를 초기화하지 않았습니다.
goto failed

:launch_failed
echo [오류] APK는 설치됐지만 앱 실행에 실패했습니다. 에뮬레이터에서 메타케어를 눌러 보세요.
goto failed

:missing_expo_go
echo [오류] 미리보기용 Expo Go APK가 없습니다:
echo "%EXPO_GO_APK%"
goto failed

:expo_install_failed
echo [오류] Expo Go 설치에 실패했습니다. 위의 Android 오류를 확인하세요.
goto failed

:wrong_metro
echo [오류] 8081 포트를 다른 서비스 또는 다른 앱의 개발 서버가 사용 중입니다.
echo 기존 프로세스는 종료하지 않았습니다. 포트 사용 상태를 확인하세요.
goto failed

:metro_failed
echo [오류] 미리보기 서버 준비를 확인하지 못했습니다.
echo 기존 프로세스는 종료하지 않았습니다. 다음 로그를 확인하세요:
echo "%APP_DIR%\.preview\windows-test\metro-launcher.log"
goto failed

:reverse_failed
echo [오류] 에뮬레이터와 PC 개발 서버의 포트를 연결하지 못했습니다.
goto failed

:preview_failed
echo [오류] Expo Go 미리보기를 열지 못했습니다. 위의 Android 오류를 확인하세요.
goto failed

:failed
echo.
pause
exit /b 1
