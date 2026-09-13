@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo  Parti Dashboard - Google Chat Alarm Servisi
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo HATA: Node.js bulunamadi.
  echo https://nodejs.org/ adresinden Node.js kurun.
  pause
  exit /b 1
)

if "%GOOGLE_CHAT_WEBHOOK_URL%"=="" set /p "GOOGLE_CHAT_WEBHOOK_URL=Google Chat veya Apps Script Web App adresini girin: "
if "%GOOGLE_CHAT_WEBHOOK_URL%"=="" (
  echo HATA: Google Chat / Apps Script adresi bos birakilamaz.
  pause
  exit /b 1
)

if "%GOOGLE_CHAT_POLL_SECONDS%"=="" set "GOOGLE_CHAT_POLL_SECONDS=60"
echo Kontrol araligi: %GOOGLE_CHAT_POLL_SECONDS% saniye
echo.
node "%~dp0google_chat_alarm_service.js"
pause
