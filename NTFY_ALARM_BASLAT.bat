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

if "%NTFY_TOPIC%"=="" set /p "NTFY_TOPIC=ntfy konu adini girin (bos birakirsaniz sadece yerel alarm ekrani calisir): "
if "%NTFY_TOPIC%"=="" (
  echo ntfy kapali. Yerel alarm ekrani http://PC_IP:8783/alarm-demo.html adresinden dinlenebilir.
)
if "%ALARM_RELAY_URL%"=="" set /p "ALARM_RELAY_URL=Netlify alarm endpointi (bos birakabilirsiniz): "
if not "%ALARM_RELAY_URL%"=="" if "%ALARM_RELAY_TOKEN%"=="" set /p "ALARM_RELAY_TOKEN=Netlify alarm tokeni (ayarlandiysa girin): "

if "%NTFY_SERVER_URL%"=="" set "NTFY_SERVER_URL=https://ntfy.sh"
if "%NTFY_POLL_SECONDS%"=="" set "NTFY_POLL_SECONDS=60"
if "%NTFY_ALARM_HOST%"=="" set "NTFY_ALARM_HOST=0.0.0.0"
echo ntfy sunucusu: %NTFY_SERVER_URL%
echo Kontrol araligi: %NTFY_POLL_SECONDS% saniye
echo Dashboard PC: http://127.0.0.1:8783/index.html
echo Telefonda ayni Wi-Fi icin PC'nin yerel IP adresini kullanin: http://PC_IP:8783/index.html
ipconfig | findstr /R /C:"IPv4 Address" /C:"IPv4 Adresi"
echo.
node "%~dp0ntfy_alarm_service.js"
pause
