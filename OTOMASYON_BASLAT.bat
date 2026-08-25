@echo off
cd /d "%~dp0"
echo Egemen ERP Otomasyonu baslatiliyor...
start "" "%~dp0ahk\AutoHotkey64.exe" "%~dp0egemen_otomasyon.ahk"
