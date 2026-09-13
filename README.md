# Parti Dashboard GitHub Pages

Bu klasör GitHub Pages ile yayınlanacak sürümdür.

## Dosyalar

- `index.html`: URL üzerinden açılacak dashboard. Bu dosya `parti_takip_upload_single.html` tabanlıdır.
- `data/partiler.json`: Dashboardun okuduğu güncel veri.
- `data/tamirler.json`: Tamir kayıtları. Harici tamir Excel verilirse oradan, yoksa `partiler.xlsx` içindeki `İç Tamir Durumu` alanından üretilir.
- `data/hareket_saatleri.json`: Parti bazında son hareket saatlerini sağlar; GitHub Pages yüklemesinde `data/partiler.json` ile birlikte okunur.
- `convert_excel.js`: Excel dosyasını JSON veriye çevirir.
- `update_data.ps1`: Veriyi günceller, istenirse git push yapar.
- `ntfy_alarm_service.js`: PC üzerinde çalışan, GitHub parti verisini ve dashboard alarmlarını kontrol edip ntfy mobil bildirimine gönderen yerel alarm servisi.
- `NTFY_ALARM_BASLAT.bat`: ntfy konu adını sorarak alarm servisini başlatır.
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

## Anlık Islak Bekleyenler

Dashboarddaki **💧 Islak-Kuru** paneli artık geçmiş ıslak→kuru geçiş çizelgesini değil, anlık kart verisindeki bekleyen partileri gösterir:

- `Bekliyor` veya `Bir Sonraki` alanında `BOYAMA`, `YAŞ AÇMA` ya da `FIRÇA` (ve `BOYA` / `Y.AÇMA` kısaltmaları) olan kartlar taranır.
- Son hareketinden itibaren varsayılan **2 saat** eşiğini aşanlar en uzun bekleyen üstte olacak şekilde kart görünümünde gösterilir.
- Panel içinden 1, 2 veya 4 saatlik hazır eşikler seçilebilir; istenirse özel saat değeri uygulanabilir.
- Her kartta FIFO sırası, mevcut ıslak aşama, beklediği sonraki aşama, bekleme süresi, son hareket, kilo, firma ve reçete görünür.

## Liste Görünümleri ve Dışa Aktarma

Ana liste ve rapor panellerinde **🃏 Kartlar / 📋 Liste** görünüm geçişi bulunur. Liste veya kart görünümü açıkken ilgili panel araçlarından:

- **🖼️ PNG** ile görüntüyü dosya olarak indirebilir,
- **📱 WhatsApp PNG** ile PNG görüntüsünü WhatsApp paylaşım akışına gönderebilir,
- **📄 PDF** ile yazdırma/PDF ekranını açabilirsiniz.

PNG ve PDF çıktıları panelin kaydırma alanına değil, panel içeriğine göre hazırlanır.

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

## ntfy Mobil Alarm Servisi

İş yeri PC'si açıkken birden fazla telefona mobil bildirim göndermek için `NTFY_ALARM_BASLAT.bat` dosyasını çalıştırın. Bildirim kanalı olarak ücretsiz ntfy uygulaması kullanılır; Google Chat, Google Sheet, Apps Script, Telegram veya GitHub issue gerekmez.

Kurulum:

1. Android veya iPhone'a **ntfy** uygulamasını kurun.
2. Sadece bu ekipte paylaşacağınız uzun ve tahmin edilmesi zor bir konu adı seçin. Örnek: `parti-alarm-2026-ekip-7f3k9m2q`.
3. Bildirim alacak her telefonda ntfy uygulamasını açıp aynı konu adına abone olun.
4. İş yeri PC'sinde `NTFY_ALARM_BASLAT.bat` dosyasını çalıştırıp aynı konu adını girin.

Servis dashboardu PC'de şu adreste sunar:

```text
http://127.0.0.1:8783/index.html
```

Telefon ve PC aynı Wi‑Fi ağındaysa telefonda `http://PC_IP:8783/index.html` adresini açın. Dashboarddaki `💬 Mesaj Gönder` paneli iki cihazdan da aynı ntfy kanalına mesaj gönderir. `PC_IP`, iş yeri bilgisayarının yerel IPv4 adresidir; başlatma betiği bu adresi ekranda gösterir.
Dashboardu başka bir HTTP adresinden açıyorsanız adres sonuna `?ntfyService=http://PC_IP:8783` ekleyin; böylece mesaj düğmesi PC'deki servise bağlanır.

Dashboardda parti kartındaki alarm düğmesine basıp başlık, not, tarih, saat, hedef aşama ve hedef bekleme süresini dakika olarak kaydedin. Hedef aşama boş bırakılırsa bu bir tarih/saat alarmıdır ve canlı aşama beklemeden çalışır. Bir hedef aşama seçilirse bildirim, parti o aşamaya ulaştığında gönderilir; bu alarm tipinde tarih/saat alanı dikkate alınmaz. Hedef bekleme süresi `0` ise aşamaya ulaşır ulaşmaz bildirim gönderilir. Hedef süre `60` ise seçilen aşamaya ulaştıktan sonra en az 60 dakika beklenir. Aynı alarm bir kez gönderilir. “ntfy bağlantı testi” düğmesiyle mobil kanalı sınayabilirsiniz.

`KK / Sarım 1 Sonrası Öncelik` panelinde genel liste ve alt kategoriler için `🃏 Kartlar` / `📋 Liste` görünümü bulunur. Panel veya açık alt kategori içindeki `📨 ntfy Liste` düğmesi, listedeki parti özetini tek bir ntfy mesajı olarak gönderir; çok uzun listeler mesaj sınırı nedeniyle otomatik kısaltılır.

`🔎 Filtre Alarmı` panelinden bir veya birden fazla kumaş türü, aşama alanı (`Şu an beklediği aşama`, `Bir sonraki aşama` veya `Son yapılan aşama`), aşama ve minimum bekleme dakikası seçilebilir. Koşulları sağlayan yeni partiler otomatik olarak tek liste halinde ntfy’ye gönderilir; aynı parti ve hareket kaydı tekrar gönderilmez.

Servis, verideki `Sonra Yapılacak Aşama` / mevcut aşama ve `Son Hareket Tarihi` alanlarını kullanarak geçen bekleme süresini hesaplar. GitHub verisi 15 dakikada bir push ediliyorsa hedef süre kontrolünün veri kaynağına yansıması en fazla yaklaşık 16 dakika sürebilir.

Konu adı ntfy.sh üzerinde fiilen paylaşılmış bir kanal anahtarıdır; repoya veya herkese açık mesaja yazmayın. Servis yerel ağdan dashboard erişimi için `0.0.0.0:8783` üzerinde dinler; bilgisayarın güvenlik duvarında bu porta yalnızca güvenilen yerel ağ erişimi verin. ntfy.sh yerine özel ntfy sunucusu kullanıyorsanız servisi başlatmadan önce `NTFY_SERVER_URL` ortam değişkenini, gerekiyorsa `NTFY_ACCESS_TOKEN` değişkenini ayarlayın.
### ntfy olmadan yerel alarm ekranı

`NTFY_ALARM_BASLAT.bat` çalıştırılırken ntfy konu adı boş bırakılırsa servis ntfy'ye mesaj göndermez; alarm olaylarını yalnızca yerel SSE ekranına yayınlar. Telefonda ve PC'de aynı Wi‑Fi ağı kullanılır:

1. BAT dosyasında topic sorusunu boş bırakıp Enter'a basın.
2. Başlatma betiğinin gösterdiği PC IPv4 adresini öğrenin.
3. Telefonda `http://PC_IP:8783/alarm-demo.html` adresini açın.
4. `Ses etkinleştir` ve `PC alarmına bağlan` düğmelerine basın.

Bu modda tarayıcı sayfası açık kaldığı sürece kart ve liste alarmları ntfy olmadan gelir. Telefon ekranı kapalıyken veya tarayıcı arka plandayken mobil işletim sistemi web bağlantısını durdurabilir; arka plan bildirimi için ntfy uygulaması gerekir.
## Netlify üzerinden bağımsız alarm

Alarm ekranını Netlify'da çalıştırmak için `netlify.toml`, `package.json` ve `netlify/functions/alarm.js` dosyaları kullanılır. Netlify Blobs, son 100 alarmı kalıcı depoda tutar; demo sayfası bu endpoint'i üç saniyede bir kontrol eder.

1. Bu repoyu Netlify'da yayınlayın.
2. Netlify panelinde **Site configuration > Environment variables** bölümüne güçlü ve gizli bir `ALARM_RELAY_TOKEN` ekleyin. Değişkeni ekledikten sonra yeni deploy yapın.
3. Netlify adresindeki `alarm-demo.html` sayfasını açın.
4. Sayfadaki **Netlify alarm adresi** alanına `https://SITENIZ.netlify.app/api/alarm` yazın; token alanına aynı gizli değeri girin.
5. Netlify sayfasında **Ses etkinleştir**, **Tam ekranı dene** ve **Netlify alarmına bağlan** düğmelerine basın.
6. PC'de `NTFY_ALARM_BASLAT.bat` çalıştırılırken ntfy topic alanını boş bırakın; Netlify alarm endpointi sorusuna aynı `/api/alarm` adresini, token sorusuna da aynı değeri girin.

Token ayarlanmazsa endpoint anonim POST/GET kabul eder; bu yalnızca herkese açık olmayan geçici denemeler için uygundur. Token tarayıcıda kalıcı olarak saklanmaz ve relay isteğinde HTTP başlığıyla gönderilir. Bu akışta telefon ve PC'nin aynı ağda olması gerekmez. PC'nin internete erişmesi ve Netlify sayfasının açık olması yeterlidir. Telefon tarayıcısı arka planda veya ekran kapalıyken çalışmayı durdurabilir; arka plan/kapalı ekran bildirimi için Web Push veya ntfy uygulaması gerekir.


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
