param(
  [string]$MainExcel = "..\partiler.xlsx",
  [string]$RepairExcel = "",
  [switch]$Push
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $Root
try {
  $main = Resolve-Path -LiteralPath $MainExcel
  $repair = "-"
  if ($RepairExcel -and (Test-Path -LiteralPath $RepairExcel)) {
    $repair = (Resolve-Path -LiteralPath $RepairExcel).Path
  }

  $python = "python"
  if (Test-Path "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe") {
    $python = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
  }
  & $python ".\update_hareket_saatleri.py" $main.Path ".\data\hareket_saatleri.json"
  & $python ".\update_partiler_json.py" $main.Path $repair ".\data\partiler.json" ".\data\tamirler.json"

  # KK / Sarim1 / Sarim2 gelen-gecen kaydi (vardiya bazli, data/uretim_log.json). Hata verirse veri guncellemesi durmaz.
  try {
    & $python ".\update_uretim_log.py" ".\data\partiler.json" ".\data\uretim_log.json"
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath ".git") -and (Test-Path -LiteralPath ".\data\uretim_log.json")) {
      git add data/uretim_log.json
    }
  } catch {
    Write-Warning "Uretim kaydi guncellenemedi: $_"
  }

  if ($Push) {
    if (-not (Test-Path -LiteralPath ".git")) {
      git init
      git branch -M main
    }
    git add index.html data/partiler.json data/tamirler.json data/hareket_saatleri.json README.md update_data.ps1 update_partiler_json.py update_hareket_saatleri.py
    git commit -m "Update dashboard data"
    git push
  }
}
finally {
  Pop-Location
}
