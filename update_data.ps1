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

  node ".\convert_excel.js" $main.Path $repair ".\data\partiler.json"

  if ($Push) {
    if (-not (Test-Path -LiteralPath ".git")) {
      git init
      git branch -M main
    }
    git add index.html data/partiler.json README.md update_data.ps1 convert_excel.js tools/xlsx.full.min.js
    git commit -m "Update dashboard data"
    git push
  }
}
finally {
  Pop-Location
}
