@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo  Parti Dashboard - ntfy Mobil Alarm Servisi
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo HATA: Node.js bulunamadi.
  echo https://nodejs.org/ adresinden Node.js kurun.
  pause
  exit /b 1
)

if "%NTFY_TOPIC%"=="" set /p "NTFY_TOPIC=ntfy konu adini girin: "
if "%NTFY_TOPIC%"=="" (
  echo HATA: ntfy konu adi bos birakilamaz.
  pause
  exit /b 1
)

if "%NTFY_SERVER_URL%"=="" set "NTFY_SERVER_URL=https://ntfy.sh"
if "%NTFY_POLL_SECONDS%"=="" set "NTFY_POLL_SECONDS=60"
echo ntfy sunucusu: %NTFY_SERVER_URL%
echo Kontrol araligi: %NTFY_POLL_SECONDS% saniye
echo.
node "%~dp0ntfy_alarm_service.js"
pause
