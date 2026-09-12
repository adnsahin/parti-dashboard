@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo  WhatsApp Grubu - Telegram Aktarim Servisi
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo HATA: Node.js bulunamadi.
  echo https://nodejs.org/ adresinden Node.js kurun.
  pause
  exit /b 1
)

if not exist "node_modules\whatsapp-web.js" (
  echo WhatsApp bagimliliklari kuruluyor...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo HATA: npm bagimlilik kurulumu basarisiz.
    pause
    exit /b 1
  )
)

if "%WHATSAPP_GROUPS%"=="" set /p "WHATSAPP_GROUPS=Aktarilacak grup adlarini virgulle girin: "
if "%WHATSAPP_GROUPS%"=="" (
  echo HATA: En az bir WhatsApp grup adi gerekli.
  pause
  exit /b 1
)

if "%WHATSAPP_KEYWORDS%"=="" set /p "WHATSAPP_KEYWORDS=Istege bagli anahtar kelimeler (bos=tumu): "

node "%~dp0whatsapp_telegram_bridge.js"
pause
