# Parti Dashboard GitHub Pages

Bu klasör GitHub Pages ile yayınlanacak sürümdür.

## Dosyalar

- `index.html`: URL üzerinden açılacak dashboard. Bu dosya `parti_takip_upload_single.html` tabanlıdır.
- `data/partiler.json`: Dashboardun okuduğu güncel veri.
- `data/tamirler.json`: Tamir kayıtları. Harici tamir Excel verilirse oradan, yoksa `partiler.xlsx` içindeki `İç Tamir Durumu` alanından üretilir.
- `data/hareket_saatleri.json`: Parti bazında son hareket saatlerini sağlar; GitHub Pages yüklemesinde `data/partiler.json` ile birlikte okunur.
- `convert_excel.js`: Excel dosyasını JSON veriye çevirir.
- `update_data.ps1`: Veriyi günceller, istenirse git push yapar.
- `tools/xlsx.full.min.js`: Excel okuma kütüphanesi.


## Günlük Mindmap ve Sesli Not

`index.html` içindeki **🧠 Günlük Mindmap** paneli:

- Kategori ekleyebilir, silebilir ve adını değiştirebilirsiniz.
- Her kategoriye alt dal ekleyebilir, silebilir ve adını değiştirebilirsiniz.
- `data/partiler.json` içindeki parti numarası, firma veya reçeteyi arayıp seçili alt dala ekleyebilir; parti kartındaki `×` ile çıkarabilirsiniz.
- Kategoriler ayrı şeritlerde, alt dallar ayrı kart alanlarında ve partiler kısa özet kartlarında gösterilir; böylece dallar arttığında bağlantılar üst üste binmez.
- Parti özetinde parti no, firma, reçete, kilo ve durum rengi görünür. Özet karta tıklayınca mevcut parti detay modalı açılır.
- Detay modalında partiye kaydedilen notlar mindmap kartında sarı **📝** satırı olarak, kısa önizleme halinde görünür; tam metin yine detay modalındadır.
- Günlük veya sesli not eklerken parti numarası seçmek zorunludur; not doğrudan o partinin kartında mor **📅** satırı olarak görünür. Mindmap altında bağlantısız günlük not kartı oluşturulmaz.
- **⚙ Otomatik kategoriler** güncel veriyi kurala göre gruplar: kalite kontrol ve tamir partileri son hareket saatine göre **Son 3 Gün** ve **3 Gün ve Öncesi** dallarına ayrılır; Sarım 1 olacaklar ayrı dalda görünür. **↩ Manuel görünüm** ile kaydedilmiş kişisel mindmap düzenine dönülebilir; otomatik görünüm manuel kategorileri değiştirmez.
- **⛶ Ekrana sığdır**, `−` / `＋` ve **Sıfırla** kontrolleriyle yoğun haritayı küçültüp büyütebilirsiniz; geniş içerik yatay/dikey kaydırılabilir.
- Gün seçimine göre notları ve kategori/alt dal/parti düzenini `localStorage` içinde `partiMindmap.v1` anahtarıyla tarayıcıya kaydeder.

JSON verisinin otomatik yüklenmesi için dashboardu GitHub Pages veya yerel HTTP sunucusu üzerinden açın. `file://` ile doğrudan açıldığında tarayıcı güvenliği JSON isteğini engelleyebilir; bu durumda Excel yükleme alanı kullanılabilir.
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

## Python ERP JSON Dönüşümü

ERP Excel'indeki gerçek son aşama ve hareket zamanını JSON'a aktarmak için:

```powershell
python .\update_partiler_json.py ".\partiler.xlsx" ".\data\partiler.json"
```

Betik `Son Yapılan Aşama`, `Sonra Yapılacak Aşama` ve `Son Hareket Tarihi` alanlarını her karta ekler. Yalnız `partiler.json` güncellenir; `tamirler.json` dosyasına dokunmaz. Mevcut otomatik BAT'ta, GitHub push işleminden hemen önce bu komutu çalıştırın.

## GitHub Pages

1. GitHub'da yeni repo oluştur.
2. Bu klasörün içeriğini repoya push et.
3. Repo ayarlarından `Settings > Pages` bölümünde branch olarak `main`, folder olarak `/root` seç.
4. URL şu formatta olur:

```text
https://KULLANICIADI.github.io/REPOADI/
```

## Çift Tıklama ile Kullanım

İlk kez GitHub repo bağlantısı kurmak için:

```text
ILK_KURULUM_GITHUB.bat
```

Sonraki veri güncellemelerinde sadece şunu çift tıkla:

```text
GUNCELLE_VE_PUSH.bat
```

## Güvenlik Notu

Repo public ise `data/partiler.json` herkes tarafından görülebilir. Firma, parti, termin ve tamir verileri hassassa public GitHub Pages kullanma.
