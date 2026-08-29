@echo off
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo  Parti Dashboard - Veri Guncelle ve Push
echo ========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo HATA: Git bulunamadi. Once Git for Windows kurulu olmali.
  echo https://git-scm.com/download/win
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo HATA: Node.js bulunamadi. Once Node.js kurulu olmali.
  echo https://nodejs.org/
  pause
  exit /b 1
)

if not exist "..\partiler.xlsx" (
  echo HATA: ..\partiler.xlsx bulunamadi.
  pause
  exit /b 1
)

if not exist "..\tamir.xlsx" (
  echo HATA: ..\tamir.xlsx bulunamadi.
  pause
  exit /b 1
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo HATA: GitHub repo baglantisi yok.
  echo.
  echo Bir kereye mahsus su komutu calistir:
  echo git remote add origin https://github.com/adnsahin/parti-dashboard.git
  echo.
  pause
  exit /b 1
)

echo Excel verileri JSON'a cevriliyor...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\update_data.ps1" -MainExcel "..\partiler.xlsx" -RepairExcel "..\tamir.xlsx"
if errorlevel 1 (
  echo.
  echo HATA: Veri guncelleme basarisiz.
  pause
  exit /b 1
)

git status --short > "%TEMP%\parti_dashboard_git_status.txt"
for %%A in ("%TEMP%\parti_dashboard_git_status.txt") do if %%~zA==0 (
  echo.
  echo Degisiklik yok. Push gerekmiyor.
  del "%TEMP%\parti_dashboard_git_status.txt" >nul 2>nul
  pause
  exit /b 0
)
del "%TEMP%\parti_dashboard_git_status.txt" >nul 2>nul

echo.
echo Degisiklikler commit ediliyor...
git add data/partiler.json data/tamirler.json README.md convert_excel.js index.html update_data.ps1
git commit -m "Update dashboard data"
if errorlevel 1 (
  echo.
  echo Commit atilamadi. Git kullanici ayarlari eksik olabilir.
  echo Gerekirse:
  echo git config --global user.name "Ad Soyad"
  echo git config --global user.email "mail@example.com"
  pause
  exit /b 1
)

echo.
echo GitHub'a gonderiliyor...
git pull --rebase --autostash origin main
if errorlevel 1 (
  echo.
  echo HATA: Pull basarisiz. Remote degisiklikler cekilemedi.
  pause
  exit /b 1
)

git push
if errorlevel 1 (
  echo.
  echo HATA: Push basarisiz. GitHub girisi veya repo yetkisini kontrol et.
  pause
  exit /b 1
)

echo.
echo TAMAM: Veriler guncellendi ve GitHub'a gonderildi.
pause
