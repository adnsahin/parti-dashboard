#!/usr/bin/env python3
"""
update_personel_top.py
----------------------
ERP "urt" (KK top bazli) ve istege bagli "urt222" (Sarim1) raporlarindan personel uretim / bosluk ozeti.

Uretilenler
  data/personel_top.json : KISI KODUYLA (P1, P2 ...) vardiya bazli ozet -> pano "Personel geri bildirimi" karti.
                           Adlar YAZILMAZ. Her calistirmada onceki kayitlarla birlestirilir (ayni vardiya guncellenir).
  --kartlar kart.pdf     : (yalniz bu bilgisayarda kalir) her personel icin ADLI + KODLU tek sayfalik A4 geri bildirim karti.

Ad -> kod eslemesi update_zaman_json.py ile ayni dosyadir (personel_kodlari.json); GitHub'a GITMEZ.

Kullanim:
  python update_personel_top.py urt.Xlsx [urt222.Xlsx] [--out data/personel_top.json] [--klasor ..] [--kartlar kartlar.pdf]
"""
import sys, os, json, glob
from datetime import datetime, timedelta
from collections import defaultdict
from openpyxl import load_workbook

GAP_MIN = 20          # iki kayit arasi bu kadar dakikayi gecerse "bosluk"
EARLY_MIN = 45        # son kayit vardiya bitisinden bu kadar once ise "erken birakma"
LATE_MIN = 30
MIN_REC = 8           # bir vardiya blogunda en az bu kadar kayit -> o vardiya calisilmis sayilir
BLOCKS = (8, 16, 0)   # vardiya baslangic saatleri: 08-16, 16-24, 00-08
KEEP_DAYS = 120


def clean(v):
    return "" if v is None else str(v).strip()


def num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


def to_dt(v):
    if isinstance(v, datetime):
        return v
    s = clean(v)
    for f in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, f)
        except ValueError:
            pass
    return None


def tr_upper(s):
    return clean(s).replace("i", "İ").replace("ı", "I").upper()


def read_sheet(path):
    ws = load_workbook(path, read_only=True, data_only=True).active
    it = ws.iter_rows(values_only=True)
    head = [clean(h) for h in next(it)]
    return head, [r for r in it if any(c is not None for c in r)]


def col(head, *names):
    # bozuk kodlamali basliklar icin: ilk kelimeyi / ASCII kismini ara
    low = [h.lower() for h in head]
    for n in names:
        n = n.lower()
        for i, h in enumerate(low):
            if h == n:
                return i
    for n in names:
        n = n.lower()
        for i, h in enumerate(low):
            if h.startswith(n):
                return i
    raise KeyError(names)


def load_events(urt, urt222):
    ev = []  # (kisi, zaman, tur, kg, metre)
    head, rows = read_sheet(urt)
    iT, iK, iM, iU = col(head, "Tarih"), col(head, "Kilo"), col(head, "Net Metre"), None
    iU = next(i for i, h in enumerate(head) if h.startswith("Kaydeden"))
    for r in rows:
        t = to_dt(r[iT])
        if t and clean(r[iU]):
            ev.append((clean(r[iU]), t, "kk", num(r[iK]), num(r[iM])))
    if urt222:
        head, rows = read_sheet(urt222)
        iG = next(i for i, h in enumerate(head) if h.startswith("Giri") and "Tarih" in h)
        iP = next(i for i, h in enumerate(head) if h.startswith("Giri") and "Personel" in h)
        iK = col(head, "Kilo")
        iA = next((i for i, h in enumerate(head) if h.startswith("A") and "Ad" in h and "Kodu" not in h and "Recete" not in h and "Re" not in h[:3]), None)
        for r in rows:
            t = to_dt(r[iG])
            if t and clean(r[iP]):
                ev.append((clean(r[iP]), t, "sr", num(r[iK]), 0.0))
    return ev


def block_of(t):
    h = t.hour
    a = 16 if h >= 16 else 8 if h >= 8 else 0
    base = t if a else t - timedelta(days=1)
    return base.date(), a


def build(ev, tmax):
    B = defaultdict(list)
    for p, t, k, kg, m in ev:
        B[(p,) + block_of(t)].append((t, k, kg, m))
    out = {}
    for (p, d, a), l in B.items():
        l.sort()
        st = datetime.combine(d + timedelta(days=1 if a == 0 else 0), datetime.min.time()).replace(hour=a)
        en = st + timedelta(hours=8)
        if en > tmax or len(l) < MIN_REC:
            continue
        ts = [x[0] for x in l]
        gaps = [((ts[i + 1] - ts[i]).total_seconds() / 60.0, i) for i in range(len(ts) - 1)]
        act = sum(g for g, _ in gaps if g < GAP_MIN)
        idle = sum(g for g, _ in gaps if g >= GAP_MIN)
        top = sorted([g for g in gaps if g[0] >= GAP_MIN], reverse=True)[:3]
        hrs = [0] * 24
        for t, k, kg, m in l:
            hrs[t.hour] += kg
        kk = [x for x in l if x[1] == "kk"]
        sr = [x for x in l if x[1] == "sr"]
        out[(p, d, a)] = {
            "d": d.isoformat(), "a": a, "kn": len(kk), "kkg": round(sum(x[2] for x in kk)), "km": round(sum(x[3] for x in kk)),
            "sn": len(sr), "skg": round(sum(x[2] for x in sr)),
            "f": round((ts[0] - st).total_seconds() / 60), "l": round((en - ts[-1]).total_seconds() / 60),
            "act": round(act), "idle": round(idle), "mg": round(max([g for g, _ in gaps] or [0])),
            "gp": [[round((ts[i] - st).total_seconds() / 60), round(g)] for g, i in top],
            "h": [round(x) for x in hrs],
        }
    return out


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


# ---------- A4 kartlar (adli, yerel) ----------
def font(sz, bold=False):
    from PIL import ImageFont
    for f in (("arialbd.ttf" if bold else "arial.ttf"), "C:/Windows/Fonts/" + ("arialbd.ttf" if bold else "arial.ttf"), "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(f, sz)
        except OSError:
            pass
    return ImageFont.load_default()


def stats(rows):
    n = len(rows)
    S = lambda k: sum(r[k] for r in rows)
    act = max(1, S("act"))
    kg = S("kkg") + S("skg")
    return {"n": n, "kn": S("kn"), "kg": kg, "kkg": S("kkg"), "km": S("km"), "sn": S("sn"), "skg": S("skg"),
            "tpa": S("kn") / (act / 60.0), "kpa": S("kkg") / (act / 60.0), "mpa": S("km") / (act / 60.0),
            "idle": 100.0 * S("idle") / max(1, S("idle") + S("act")), "late": S("f") / n, "early": S("l") / n,
            "ne": sum(1 for r in rows if r["l"] > EARLY_MIN), "nl": sum(1 for r in rows if r["f"] > LATE_MIN),
            "kgv": kg / n, "knv": S("kn") / n, "mv": S("km") / n, "maxg": max(r["mg"] for r in rows)}


def hm(minutes, a):
    t = (a * 60 + minutes) % 1440
    return "%02d:%02d" % (t // 60, t % 60)


def feedback(s, T):
    good, imp = [], []
    if s["kpa"] >= T["kpa"] * 1.1:
        good.append("Aktif çalıştığı sürede hızı takım ortalamasının üstünde (%d kg/sa, takım %d)." % (s["kpa"], T["kpa"]))
    if s["idle"] <= T["idle"] - 5:
        good.append("Kayıt aralarındaki boşluk payı takımdan düşük (%%%d, takım %%%d)." % (s["idle"], T["idle"]))
    if s["ne"] == 0:
        good.append("Hiçbir vardiyada erken bırakma görülmedi.")
    if s["kgv"] >= T["kgv"] * 1.1:
        good.append("Vardiya başına üretimi takım ortalamasının üstünde (%d kg, takım %d)." % (s["kgv"], T["kgv"]))
    if s["idle"] >= T["idle"] + 5:
        imp.append("Kayıt aralarında %%%d boşluk var (takım %%%d). Bu aralıkların bir kısmı iş yokluğu / mola olabilir; saatleri aşağıda." % (s["idle"], T["idle"]))
    if s["kpa"] <= T["kpa"] * 0.9:
        imp.append("Aktif çalışırken hız %d kg/sa, takım %d: top başına süre / küçük top yapısı gözden geçirilebilir." % (s["kpa"], T["kpa"]))
    if s["ne"] >= max(3, s["n"] * 0.4):
        imp.append("%d vardiyanın %d'inde son kayıt vardiya bitiminden %d dk'dan fazla önce (ortalama %d dk)." % (s["n"], s["ne"], EARLY_MIN, s["early"]))
    if s["nl"] >= max(3, s["n"] * 0.4):
        imp.append("%d vardiyanın %d'inde ilk kayıt vardiya başından %d dk'dan sonra." % (s["n"], s["nl"], LATE_MIN))
    return good or ["Belirgin bir üstünlük çıkmadı; değerler takım ortalamasına yakın."], imp or ["Belirgin bir iyileştirme noktası çıkmadı."]


def draw_card(name, code, rows, T, team_h, period):
    from PIL import Image, ImageDraw
    W, H = 1240, 1754
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    s = stats(rows)
    d.rectangle([0, 0, W, 130], fill=(31, 56, 100))
    d.text((50, 25), name, fill="white", font=font(52, True))
    d.text((50, 88), "Kod: %s   •   %s   •   %d vardiya" % (code, period, s["n"]), fill=(210, 220, 240), font=font(26))
    d.text((W - 50, 40), "Üretim geri bildirim kartı", fill=(210, 220, 240), font=font(26), anchor="ra")
    y = 160
    d.text((50, y), "Üretim (KK)", fill=(31, 56, 100), font=font(32, True))
    y += 50
    hdr = ["", "Sizin", "Takım ort.", "Fark"]
    xs = [50, 560, 780, 1000]
    for x, h in zip(xs, hdr):
        d.text((x, y), h, fill=(90, 90, 90), font=font(24, True))
    y += 36
    items = [("Vardiya başına kg", s["kgv"], T["kgv"], "%d", 1), ("Vardiya başına top", s["knv"], T["knv"], "%d", 1),
             ("Vardiya başına metre (bilgi)", s["mv"], T["mv"], "%d", 0), ("Aktif saatte kg", s["kpa"], T["kpa"], "%d", 1),
             ("Aktif saatte top", s["tpa"], T["tpa"], "%.1f", 1), ("Kayıt aralarında boşluk payı %", s["idle"], T["idle"], "%d", -1),
             ("Ort. geç başlama (dk)", s["late"], T["late"], "%d", -1), ("Ort. erken bırakma (dk)", s["early"], T["early"], "%d", -1)]
    for lab, a, b, f, good in items:
        diff = a - b
        c = (60, 60, 60)
        if good and abs(diff) > 0.05 * max(1, abs(b)):
            c = (30, 130, 60) if diff * good > 0 else (190, 60, 40)
        d.text((xs[0], y), lab, fill=(30, 30, 30), font=font(27))
        d.text((xs[1], y), f % a, fill=(0, 0, 0), font=font(27, True))
        d.text((xs[2], y), f % b, fill=(90, 90, 90), font=font(27))
        d.text((xs[3], y), ("%+d" % round(diff)) if f == "%d" else ("%+.1f" % diff), fill=c, font=font(27, True))
        y += 40
    d.text((50, y + 4), "Metre kumaş cinsine bağlıdır (hafif kumaşta çok, ağırda az); performans ölçüsü olarak kullanılmaz.", fill=(120, 120, 120), font=font(21))
    y += 50
    d.text((50, y), "Saat saat üretim (kg / saat, bu vardiyalarda)", fill=(31, 56, 100), font=font(32, True))
    y += 56
    # saat profili: kisinin kg/saat'i (mavi) ve takim (gri cizgi)
    h0 = [0.0] * 24
    cnt = [0] * 24
    for r in rows:
        for hh in range(8):
            hour = (r["a"] + hh) % 24
            h0[hour] += r["h"][hour]
            cnt[hour] += 1
    mine = [h0[i] / cnt[i] if cnt[i] else None for i in range(24)]
    order = list(range(8, 24)) + list(range(0, 8))
    mx = max([v for v in mine if v] + [v for v in team_h if v] + [1])
    ch_h, bw = 300, 48
    base = y + ch_h
    for i, hour in enumerate(order):
        x = 48 + i * (bw - 2)
        v = mine[hour]
        if v:
            bh = int(ch_h * v / mx)
            d.rectangle([x, base - bh, x + bw - 8, base], fill=(57, 135, 229))
            d.text((x + (bw - 8) // 2, base - bh - 20), "%d" % v, fill=(30, 30, 30), font=font(17), anchor="ma")
        t = team_h[hour]
        if t:
            ty = base - int(ch_h * t / mx)
            d.line([x, ty, x + bw - 8, ty], fill=(217, 89, 38), width=4)
        d.text((x + (bw - 8) // 2, base + 6), "%02d" % hour, fill=(90, 90, 90), font=font(18), anchor="ma")
    d.rectangle([50, base + 38, 70, base + 54], fill=(57, 135, 229))
    d.text((78, base + 34), "Siz", fill=(30, 30, 30), font=font(21))
    d.line([140, base + 46, 170, base + 46], fill=(217, 89, 38), width=4)
    d.text((178, base + 34), "Takım ortalaması (aynı saatte)", fill=(30, 30, 30), font=font(21))
    y = base + 90
    d.text((50, y), "En uzun kayıt boşlukları (≥ %d dk)" % GAP_MIN, fill=(31, 56, 100), font=font(32, True))
    y += 50
    gl = []
    for r in rows:
        for st, ln in r["gp"]:
            gl.append((ln, r["d"], hm(st, r["a"]), hm(st + ln, r["a"])))
    gl.sort(reverse=True)
    for ln, dd, a, b in gl[:6]:
        d.text((50, y), "%s  %s–%s" % (datetime.fromisoformat(dd).strftime("%d.%m"), a, b), fill=(30, 30, 30), font=font(26))
        d.text((420, y), "%d dk" % ln, fill=(190, 60, 40), font=font(26, True))
        y += 38
    d.text((50, y + 2), "Boşluk = iki kayıt arası; iş yokluğu, mola ya da başka iş olabilir.", fill=(120, 120, 120), font=font(21))
    y += 56
    good, imp = feedback(s, T)
    d.text((50, y), "Güçlü yönler", fill=(30, 130, 60), font=font(32, True))
    y += 46
    for g in good:
        y = wrap(d, "• " + g, 50, y, W - 100, font(26), (30, 30, 30))
    y += 14
    d.text((50, y), "Konuşulabilecek noktalar", fill=(190, 100, 20), font=font(32, True))
    y += 46
    for g in imp:
        y = wrap(d, "• " + g, 50, y, W - 100, font(26), (30, 30, 30))
    d.text((50, H - 50), "Kaynak: ERP KK kaydı (top bazlı). Vardiya blokları 08-16 / 16-24 / 00-08 varsayılmıştır; kayıt saati dışında iş görülmüş olabilir.", fill=(130, 130, 130), font=font(19))
    return im


def wrap(d, text, x, y, w, f, fill):
    line = ""
    for word in text.split(" "):
        t = (line + " " + word).strip()
        if d.textlength(t, font=f) > w and line:
            d.text((x, y), line, fill=fill, font=f)
            y += 36
            line = "   " + word
        else:
            line = t
    d.text((x, y), line, fill=fill, font=f)
    return y + 38


def make_cards(path, shifts, codes, min_shifts):
    by = defaultdict(list)
    for r in shifts:
        by[r["p"]].append(r)
    inv = {v: k for k, v in codes.items()}
    team = [r for p, l in by.items() if len(l) >= min_shifts for r in l]
    T = stats(team)
    h = [0.0] * 24
    c = [0] * 24
    for r in team:
        for hh in range(8):
            hour = (r["a"] + hh) % 24
            h[hour] += r["h"][hour]
            c[hour] += 1
    team_h = [h[i] / c[i] if c[i] else None for i in range(24)]
    days = sorted(r["d"] for r in team)
    period = "%s – %s" % (datetime.fromisoformat(days[0]).strftime("%d.%m.%Y"), datetime.fromisoformat(days[-1]).strftime("%d.%m.%Y"))
    pages = []
    for p, l in sorted(by.items(), key=lambda x: -sum(r["kkg"] + r["skg"] for r in x[1])):
        if len(l) < min_shifts:
            continue
        pages.append(draw_card(inv.get(p, p), p, l, T, team_h, period))
    if pages:
        pages[0].save(path, "PDF", resolution=150, save_all=True, append_images=pages[1:])
    return len(pages)


def main():
    a = [x for x in sys.argv[1:]]
    opt = {}
    pos = []
    i = 0
    while i < len(a):
        if a[i].startswith("--"):
            opt[a[i][2:]] = a[i + 1] if i + 1 < len(a) else ""
            i += 2
        else:
            pos.append(a[i])
            i += 1
    if not pos:
        print(__doc__)
        sys.exit(1)
    urt, urt222 = pos[0], (pos[1] if len(pos) > 1 else None)
    out = opt.get("out", os.path.join("data", "personel_top.json"))
    folder = opt.get("klasor", "..")
    if not os.path.exists(os.path.join(folder, "personel_kodlari.json")) and os.path.exists(os.path.join("..", "yerel_personel", "personel_kodlari.json")):
        folder = os.path.join("..", "yerel_personel")
    codes_path = os.path.join(folder, "personel_kodlari.json")
    cj = load_json(codes_path, {"note": "Ad -> kod eslemesi. GitHub'a GONDERMEYIN.", "codes": {}})
    codes = cj.setdefault("codes", {})
    norm = {tr_upper(k): v for k, v in codes.items()}

    ev = load_events(urt, urt222)
    tmax = max(e[1] for e in ev)
    built = build(ev, tmax)
    shifts = []
    for (p, d, a_), r in built.items():
        k = tr_upper(p)
        if k not in norm:
            n = len(codes) + 1
            codes[p] = norm[k] = "P%d" % n
        r["p"] = norm[k]
        shifts.append(r)
    with open(codes_path, "w", encoding="utf-8") as f:
        json.dump(cj, f, ensure_ascii=False, indent=1)

    # onceki kayitlarla birlestir
    prev = load_json(out, {})
    merged = {(r["p"], r["d"], r["a"]): r for r in prev.get("shifts", [])}
    for r in shifts:
        merged[(r["p"], r["d"], r["a"])] = r
    cutoff = (tmax - timedelta(days=KEEP_DAYS)).date().isoformat()
    allr = [r for r in merged.values() if r["d"] >= cutoff]
    allr.sort(key=lambda r: (r["d"], r["a"], r["p"]))
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "generatedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "to": tmax.strftime("%Y-%m-%dT%H:%M"),
                   "gapMin": GAP_MIN, "earlyMin": EARLY_MIN, "lateMin": LATE_MIN, "shifts": allr}, f, ensure_ascii=False, separators=(",", ":"))
    print("%s: %d vardiya (bu çalıştırmada %d), kişi %d" % (out, len(allr), len(shifts), len({r["p"] for r in allr})))
    if "kartlar" in opt:
        try:
            n = make_cards(opt["kartlar"], [r for r in allr if r["d"] >= (tmax - timedelta(days=int(opt.get("gun", 40)))).date().isoformat()], codes, int(opt.get("min", 5)))
            print("%s: %d kart" % (opt["kartlar"], n))
        except ImportError:
            print("Kart PDF için Pillow gerekli: pip install pillow")


if __name__ == "__main__":
    main()
