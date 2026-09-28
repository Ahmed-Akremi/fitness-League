@echo off
rem Installs the test APK on an Android phone plugged in over USB and points the app at the API running on this PC.
rem Requirements: USB debugging enabled on the phone (Settings > Developer options), API running on port 3000.
setlocal
set ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
set APK=%~dp0..\build\app\outputs\flutter-apk\app-release.apk

if not exist "%ADB%" (echo adb introuvable : %ADB% & exit /b 1)
if not exist "%APK%" (echo APK introuvable : %APK% & exit /b 1)

"%ADB%" devices
"%ADB%" install -r "%APK%" || (echo Installation impossible : verifie le cable et le debogage USB. & exit /b 1)
rem The app calls http://localhost:3000 on the phone: forward it to this PC (redo after each reconnection).
"%ADB%" reverse tcp:3000 tcp:3000
echo.
echo OK : ouvre "Fitness League" sur le telephone (garde le cable branche).
endlocal
