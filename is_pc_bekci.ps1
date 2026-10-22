# ─────────────────────────────────────────────────────────────────────────────
#  İş PC bekçisi — veri zinciri takıldığında haber verir, istenirse toparlar
#
#  Zincir: 1) ERP'de F8 → Excel'e kaydet   2) Excel'i düzenle → partiler.xlsx   3) GitHub'a push
#  Bekçi her çalıştığında (Görev Zamanlayıcı, 2 dakikada bir) her adımın ÇIKTISININ ne zaman
#  güncellendiğine bakar; eskiyen ilk adım = takılan adım.
#    • Mesai saatinde veri ESIK_DK dakikadan uzun gelmezse telefona ntfy bildirimi (saatte en çok bir kez)
#    • OTOMATIK_YENIDEN_BASLAT açıksa takılan adımın programını kapatıp yeniden başlatır (30 dk'da en çok bir kez)
#    • Veri tekrar gelince "veri yeniden geliyor" bildirimi
#    • Komut kanalını dinler (panodaki düğme ya da telefondaki ntfy uygulaması). YALNIZ şu komutlar:
#         durum <PIN>               → adımların durumunu telefona gönderir
#         yeniden-baslat <PIN>      → takılan adımı (hepsi güncelse hiçbirini) yeniden başlatır
#         yeniden-baslat 2 <PIN>    → 2. adımı yeniden başlatır
#      Başka hiçbir şey çalıştırılmaz; PIN tutmayan komut yok sayılır.
#
#  Kurulum: aşağıdaki AYARLAR bölümünü doldurun, sonra IS_PC_BEKCI_KUR.bat'ı bir kez çalıştırın.
# ─────────────────────────────────────────────────────────────────────────────

# ═══════════════ AYARLAR ═══════════════
$NTFY_SUNUCU      = 'https://ntfy.sh'
$BILDIRIM_KANALI  = ''                                        # telefonda ntfy uygulamasında abone olduğunuz kanal (boşsa bildirim gitmez)
$KOMUT_KANALI     = 'parti-pc-komut-eb81eaf0d66d5baeb187'      # panodaki düğme buraya yazar — değiştirirseniz index.html'de de değiştirin
$PIN              = ''                                        # en az 4 haneli; boşsa komutlar kapalı (yalnız bildirim)
$MESAI_BAS        = 8                                         # saat (08:00)
$MESAI_BIT        = 24                                        # saat (24 = gece yarısı)
$ESIK_DK          = 20                                        # bu kadar dakika yeni çıktı yoksa "takıldı" sayılır
$OTOMATIK_YENIDEN_BASLAT = $false                             # $true: takılan adımı kendisi yeniden başlatır

# Adımlar sırayla. Dosya: o adımın kaydettiği dosya (son değişme saati izlenir). Git: push adımı (son commit saati).
# Baslat: yeniden başlatmak için çalıştırılacak dosya (.exe / .bat / .ahk / .py / .lnk). Surec: kapatılacak işlem
# adı (Görev Yöneticisi > Ayrıntılar'daki ad, .exe olmadan; ör. 'AutoHotkey64', 'python', 'EXCEL'). Boş bırakılabilir.
$ADIMLAR = @(
    @{ Ad = '1) ERP → Excel (F8)';      Dosya = 'C:\BURAYA\erp_listesi.xlsx'; Baslat = ''; Surec = '' },
    @{ Ad = '2) Excel düzenleme';       Dosya = (Join-Path $PSScriptRoot '..\partiler.xlsx'); Baslat = ''; Surec = '' },
    @{ Ad = '3) GitHub push';           Git = $PSScriptRoot;   Baslat = ''; Surec = '' }
)
# ═══════════════════════════════════════

$ErrorActionPreference = 'Continue'
$durumKlasor = Join-Path $env:LOCALAPPDATA 'parti-bekci'
$durumDosya  = Join-Path $durumKlasor 'durum.json'
$logDosya    = Join-Path $durumKlasor 'bekci.log'
New-Item -ItemType Directory -Force $durumKlasor | Out-Null

function Log($m) { $s = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $m; Add-Content -Path $logDosya -Value $s -Encoding UTF8
    if ((Get-Item $logDosya).Length -gt 512KB) { Get-Content $logDosya -Tail 2000 | Set-Content $logDosya -Encoding UTF8 } }

function Bildir($mesaj, $oncelik = 'default') {
    if (-not $BILDIRIM_KANALI) { Log "bildirim (kanal yok): $mesaj"; return }
    try {
        $b = [Text.Encoding]::UTF8.GetBytes($mesaj)
        Invoke-RestMethod -Method Post -Uri "$NTFY_SUNUCU/$BILDIRIM_KANALI" -Body $b -Headers @{ Title = 'Is PC bekcisi'; Priority = $oncelik; Tags = 'factory' } -TimeoutSec 20 | Out-Null
        Log "bildirim: $mesaj"
    } catch { Log "bildirim HATASI: $($_.Exception.Message)" }
}

function Durum-Oku { try { if (Test-Path $durumDosya) { return Get-Content $durumDosya -Raw -Encoding UTF8 | ConvertFrom-Json } } catch {}
    return [pscustomobject]@{ uyariAt = 0; baslatAt = 0; takili = ''; komutT = 0; komutIds = @() } }
function Durum-Yaz($d) { $d | ConvertTo-Json | Set-Content $durumDosya -Encoding UTF8 }
function Simdi { [int64]([DateTimeOffset]::Now.ToUnixTimeSeconds()) }

# her adımın son çıktı saati (unix sn; 0 = bulunamadı)
function Adim-Saati($a) {
    if ($a.Git) {
        try { $t = & git -C $a.Git log -1 --format=%ct 2>$null; if ($t) { return [int64]$t } } catch {}
        return 0
    }
    if ($a.Dosya -and (Test-Path -LiteralPath $a.Dosya)) {
        return [int64]([DateTimeOffset](Get-Item -LiteralPath $a.Dosya).LastWriteTime).ToUnixTimeSeconds()
    }
    return 0
}

function Durum-Metni($saatler) {
    $now = Simdi; $satir = @()
    for ($i = 0; $i -lt $ADIMLAR.Count; $i++) {
        $t = $saatler[$i]
        $yas = if ($t -gt 0) { [math]::Round(($now - $t) / 60) } else { -1 }
        $satir += $ADIMLAR[$i].Ad + ': ' + $(if ($yas -lt 0) { 'bulunamadi' } elseif ($yas -le $ESIK_DK) { "$yas dk once ✅" } else { "$yas dk once ⚠️" })
    }
    return ($satir -join "`n")
}

function Yeniden-Baslat($i) {
    $a = $ADIMLAR[$i]
    if (-not $a.Baslat) { Log "$($a.Ad): Baslat ayarlanmamis, atlandi"; return $false }
    if ($a.Surec) { Get-Process -Name $a.Surec -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 3 }
    try {
        Start-Process -FilePath $a.Baslat -WorkingDirectory (Split-Path -Parent $a.Baslat)
        Log "$($a.Ad): yeniden baslatildi ($($a.Baslat))"; return $true
    } catch { Log "$($a.Ad): baslatma HATASI $($_.Exception.Message)"; return $false }
}

# ── ana akış ──
$d = Durum-Oku
$now = Simdi
$saatler = @($ADIMLAR | ForEach-Object { Adim-Saati $_ })
$takilan = -1
for ($i = 0; $i -lt $ADIMLAR.Count; $i++) {
    if ($saatler[$i] -gt 0 -and ($now - $saatler[$i]) -gt $ESIK_DK * 60) { $takilan = $i; break }
}
$h = (Get-Date).Hour
$mesai = if ($MESAI_BIT -gt $MESAI_BAS) { $h -ge $MESAI_BAS -and $h -lt $MESAI_BIT } else { $h -ge $MESAI_BAS -or $h -lt $MESAI_BIT }

# 1) takılma / düzelme
if ($takilan -ge 0 -and $mesai) {
    $ad = $ADIMLAR[$takilan].Ad; $yas = [math]::Round(($now - $saatler[$takilan]) / 60)
    if ($d.takili -ne $ad -or ($now - [int64]$d.uyariAt) -gt 3600) {
        $ek = ''
        if ($OTOMATIK_YENIDEN_BASLAT -and ($now - [int64]$d.baslatAt) -gt 1800) {
            if (Yeniden-Baslat $takilan) { $d.baslatAt = $now; $ek = "`n🔄 Bu adim otomatik yeniden baslatildi." }
        }
        Bildir ("⚠️ Veri gelmiyor — takilan adim: $ad ($yas dk once)`n" + (Durum-Metni $saatler) + $ek) 'high'
        $d.uyariAt = $now; $d.takili = $ad
    }
} elseif ($takilan -lt 0 -and $d.takili) {
    Bildir ("✅ Veri yeniden geliyor`n" + (Durum-Metni $saatler))
    $d.takili = ''; $d.uyariAt = 0
}

# 2) komutlar (yalnız PIN'li, yalnız izinli komutlar)
if ($PIN.Length -ge 4 -and $KOMUT_KANALI) {
    # işlenen komutlar: saat + kimlik listesiyle (aynı komut iki kez çalışmaz; ilk çalışmada son 10 dk)
    if (-not ($d.PSObject.Properties.Name -contains 'komutT')) { $d | Add-Member komutT 0 -Force; $d | Add-Member komutIds @() -Force }
    $since = if ([int64]$d.komutT -gt 0) { [string]$d.komutT } else { '10m' }
    $ids = @($d.komutIds)
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "$NTFY_SUNUCU/$KOMUT_KANALI/json?poll=1&since=$since" -TimeoutSec 20
        $text = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
        foreach ($line in ($text -split "`n")) {
            if (-not $line.Trim()) { continue }
            $m = $line | ConvertFrom-Json
            if ($m.event -ne 'message' -or $ids -contains $m.id) { continue }
            $ids = @($ids + $m.id | Select-Object -Last 50); $d.komutIds = $ids
            if ([int64]$m.time -gt [int64]$d.komutT) { $d.komutT = [int64]$m.time }
            $p = ([string]$m.message).Trim().ToLower() -split '\s+'
            if ($p.Count -lt 2 -or $p[-1] -ne $PIN) { Log "komut yok sayildi (PIN yok/yanlis)"; continue }
            switch ($p[0]) {
                'durum' { Bildir ("📋 Durum`n" + (Durum-Metni $saatler)) }
                'yeniden-baslat' {
                    $n = if ($p.Count -ge 3 -and $p[1] -match '^\d+$') { [int]$p[1] - 1 } else { $takilan }
                    if ($n -lt 0 -or $n -ge $ADIMLAR.Count) { Bildir "Takilan adim yok, yeniden baslatilacak bir sey yok.`n$(Durum-Metni $saatler)" }
                    elseif (Yeniden-Baslat $n) { $d.baslatAt = $now; Bildir "🔄 $($ADIMLAR[$n].Ad) yeniden baslatildi (komutla)." }
                    else { Bildir "❌ $($ADIMLAR[$n].Ad) yeniden baslatilamadi (Baslat ayari bos ya da hata; bekci.log)." }
                }
                default { Log "bilinmeyen komut yok sayildi: $($p[0])" }
            }
        }
    } catch { Log "komut okuma HATASI: $($_.Exception.Message)" }
}

Durum-Yaz $d
