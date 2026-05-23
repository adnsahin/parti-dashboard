# Parti Dashboard GitHub Pages

Bu klasör GitHub Pages ile yayınlanacak sürümdür.

## Dosyalar

- `index.html`: URL üzerinden açılacak dashboard.
- `data/partiler.json`: Dashboardun okuduğu güncel veri.
- `data/tamirler.json`: Tamir kayıtları. Harici tamir Excel verilirse oradan, yoksa `partiler.xlsx` içindeki `İç Tamir Durumu` alanından üretilir.
- `convert_excel.js`: Excel dosyasını JSON veriye çevirir.
- `update_data.ps1`: Veriyi günceller, istenirse git push yapar.
- `tools/xlsx.full.min.js`: Excel okuma kütüphanesi.

## Veri Güncelleme

Ana Excel `..\partiler.xlsx` ise:

```powershell
.\update_data.ps1
```

Bu komut hem `data/partiler.json` hem de `data/tamirler.json` üretir.

Tamir Excel de varsa:

```powershell
.\update_data.ps1 -MainExcel "..\partiler.xlsx" -RepairExcel "..\tamirler.xlsx"
```

Bu klasördeki mevcut tamir dosyası için:

```powershell
.\update_data.ps1 -MainExcel "..\partiler.xlsx" -RepairExcel "..\tamir.xlsx"
```

GitHub repo bağlantısı kurulduktan sonra veriyi güncelleyip push etmek için:

```powershell
.\update_data.ps1 -Push
```

## GitHub Pages

1. GitHub'da yeni repo oluştur.
2. Bu klasörün içeriğini repoya push et.
3. Repo ayarlarından `Settings > Pages` bölümünde branch olarak `main`, folder olarak `/root` seç.
4. URL şu formatta olur:

```text
https://KULLANICIADI.github.io/REPOADI/
```

## Güvenlik Notu

Repo public ise `data/partiler.json` herkes tarafından görülebilir. Firma, parti, termin ve tamir verileri hassassa public GitHub Pages kullanma.
