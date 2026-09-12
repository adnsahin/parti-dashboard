@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo  Parti Dashboard - Telegram Alarm Servisi
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo HATA: Node.js bulunamadi.
  echo https://nodejs.org/ adresinden Node.js kurun.
  pause
  exit /b 1
)

if "%TELEGRAM_BOT_TOKEN%"=="" set /p "TELEGRAM_BOT_TOKEN=BotFather tokenini girin: "
if "%TELEGRAM_CHAT_IDS%"=="" set /p "TELEGRAM_CHAT_IDS=Chat ID'lerini virgulle girin: "
if "%TELEGRAM_BOT_TOKEN%"=="" (
  echo HATA: Bot tokeni bos birakilamaz.
  pause
  exit /b 1
)
if "%TELEGRAM_CHAT_IDS%"=="" (
  echo HATA: En az bir Chat ID gerekli.
  pause
  exit /b 1
)

node "%~dp0telegram_alarm_service.js"
pause
