@echo off
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo  Parti Dashboard - Ilk GitHub Kurulumu
echo ========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo HATA: Git bulunamadi. Once Git for Windows kurulu olmali.
  echo https://git-scm.com/download/win
  pause
  exit /b 1
)

if not exist ".git" (
  git init
  git branch -M main
)

echo GitHub'da olusturdugun repo adresini gir.
echo Ornek: https://github.com/kullanici/parti-dashboard.git
echo.
set /p REPO_URL=Repo URL: 

if "%REPO_URL%"=="" (
  echo Repo URL bos olamaz.
  pause
  exit /b 1
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin "%REPO_URL%"
) else (
  git remote set-url origin "%REPO_URL%"
)

git add index.html data/partiler.json data/tamirler.json README.md update_data.ps1 convert_excel.js tools/xlsx.full.min.js GUNCELLE_VE_PUSH.bat ILK_KURULUM_GITHUB.bat
git commit -m "Setup dashboard publish files"

echo.
echo GitHub'a ilk push yapiliyor...
git push -u origin main
if errorlevel 1 (
  echo.
  echo HATA: Push basarisiz. GitHub girisini/yetkisini kontrol et.
  pause
  exit /b 1
)

echo.
echo TAMAM.
echo Simdi GitHub'da Settings ^> Pages bolumunden:
echo Branch: main
echo Folder: /root
echo sec.
echo.
pause
