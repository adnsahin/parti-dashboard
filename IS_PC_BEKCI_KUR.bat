@echo off
setlocal
cd /d "%~dp0"
echo ========================================
echo  Is PC bekcisi - kurulum
echo ========================================
echo.
echo Once is_pc_bekci.ps1 icindeki AYARLAR bolumunu doldurun
echo (bildirim kanali, PIN, adimlarin dosya yollari).
echo.

rem Gorunmez calistirici: konsol penceresi acilmaz, ERP otomasyonunun odagini calmaz
> "%~dp0is_pc_bekci.vbs" echo CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""%~dp0is_pc_bekci.ps1""", 0, False

rem 2 dakikada bir, yalniz bu kullanici oturum acikken (ERP otomasyonu da oturumda calisir)
schtasks /Create /F /TN "PartiDashboard\IsPcBekcisi" /SC MINUTE /MO 2 /TR "wscript.exe \"%~dp0is_pc_bekci.vbs\"" /IT
if errorlevel 1 (
  echo.
  echo HATA: Gorev olusturulamadi.
  pause
  exit /b 1
)

echo.
echo Deneme calismasi...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0is_pc_bekci.ps1"
echo.
echo TAMAM. Bekci 2 dakikada bir calisacak.
echo Kayit: %LOCALAPPDATA%\parti-bekci\bekci.log
echo Kaldirmak icin: schtasks /Delete /TN "PartiDashboard\IsPcBekcisi" /F
pause
