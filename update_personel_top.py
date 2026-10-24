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
        top = [g for g in gaps if g[0] >= GAP_MIN]   # tum bosluklar (cizelge icin)
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


SR_HEAVY = 0.4   # Sarim kg payi bu orani asarsa KK sureklilik / kapsam olculeri yaniltici -> notr


def cov_of(rows):
    return sum(max(0, 480 - r["f"] - r["l"]) / 480.0 * 100 for r in rows) / len(rows)


def heavy(rows):
    kg = sum(r["kkg"] + r["skg"] for r in rows)
    return kg > 0 and sum(r["skg"] for r in rows) / kg >= SR_HEAVY


def meters(rows, T, tcov):
    s = stats(rows)
    hv = heavy(rows)
    cov = cov_of(rows)
    M = [
        ("Üretim", "vardiya başına kg", s["kgv"] / T["kgv"], "%d kg" % s["kgv"], "takım %d" % T["kgv"], False, 0),
        ("Çalışma hızı", "çalıştığı sürede kg/saat", s["kpa"] / T["kpa"], "%d kg/sa" % s["kpa"], "takım %d" % T["kpa"], hv, 0),
        ("Süreklilik", "vardiyada kayıt bırakmadığı süre", (100 - s["idle"]) / (100 - T["idle"]), "%%%d çalışma" % (100 - s["idle"]), "takım %%%d" % (100 - T["idle"]), hv, 0),
        ("Vardiya kapsamı", "vardiyanın ilk–son kayıt arası", cov / max(1, tcov), "%%%d" % cov, "takım %%%d" % tcov, hv, cov - tcov),
    ]
    return s, M, hv


def grade(v, pts):
    g = (2 if v >= 5 else 1 if v > -5 else 0) if pts is not None else (2 if v >= 1.1 else 1 if v >= 0.9 else 0)
    return g, [(190, 60, 40), (200, 150, 0), (30, 130, 60)][g], ["Geliştirilmeli", "Ortalama", "İyi"][g]


def message(s, M, hv):
    out = []
    if hv:
        return "Ağırlıklı Sarım yaptığı için KK süreklilik / kapsam ölçüleri yanıltıcı olabilir; yalnız üretim ve hıza bakın."
    if M[1][2] >= 1.1:
        out.append("çalıştığı sürede hızlı")
    elif M[0][2] >= 1.1:
        out.append("üretimi yüksek")
    if M[2][2] < 0.9:
        out.append("vardiyanın önemli kısmında kayıt yok (boşluk saatlerine bakın)")
    if M[1][2] < 0.9:
        out.append("çalışırken hız takımın altında")
    if M[3][6] < -5:
        out.append("vardiya sonundan erken (%d dk) / geç başlıyor (%d dk)" % (s["early"], s["late"]))
    if not out:
        return "Takım ortalamasında seyrediyor."
    t = "; ".join(out)
    return t[0].upper() + t[1:] + "."


def feedback(s, T):
    good, imp = [], []
    if s["kpa"] >= T["kpa"] * 1.1:
        good.append("Çalıştığı sürede hızı takım ortalamasının üstünde (%d kg/sa, takım %d)." % (s["kpa"], T["kpa"]))
    if s["idle"] <= T["idle"] - 5:
        good.append("Kayıt aralarındaki boşluk payı takımdan düşük (%%%d, takım %%%d)." % (s["idle"], T["idle"]))
    if s["ne"] == 0:
        good.append("Hiçbir vardiyada erken bırakma görülmedi.")
    if s["kgv"] >= T["kgv"] * 1.1:
        good.append("Vardiya başına üretimi takım ortalamasının üstünde (%d kg, takım %d)." % (s["kgv"], T["kgv"]))
    if s["idle"] >= T["idle"] + 5:
        imp.append("Kayıt aralarında %%%d boşluk var (takım %%%d); bir kısmı iş yokluğu / mola olabilir." % (s["idle"], T["idle"]))
    if s["kpa"] <= T["kpa"] * 0.9:
        imp.append("Çalışırken hız %d kg/sa, takım %d: top başına süre / küçük top yapısı gözden geçirilebilir." % (s["kpa"], T["kpa"]))
    if s["ne"] >= max(3, s["n"] * 0.4):
        imp.append("%d vardiyanın %d'inde son kayıt vardiya bitiminden %d dk'dan fazla önce (ortalama %d dk)." % (s["n"], s["ne"], EARLY_MIN, s["early"]))
    if s["nl"] >= max(3, s["n"] * 0.4):
        imp.append("%d vardiyanın %d'inde ilk kayıt vardiya başından %d dk'dan sonra." % (s["n"], s["nl"], LATE_MIN))
    return good or ["Belirgin bir üstünlük çıkmadı; değerler takım ortalamasına yakın."], imp or ["Belirgin bir iyileştirme noktası çıkmadı."]


def wrap(d, text, x, y, w, f, fill, lh=34):
    line = ""
    for word in text.split(" "):
        t = (line + " " + word).strip()
        if d.textlength(t, font=f) > w and line:
            d.text((x, y), line, fill=fill, font=f)
            y += lh
            line = "  " + word
        else:
            line = t
    d.text((x, y), line, fill=fill, font=f)
    return y + lh + 4


def draw_card(name, code, rows, T, tcov, period):
    from PIL import Image, ImageDraw
    W, H = 1240, 1754
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    s, M, hv = meters(rows, T, tcov)
    d.rectangle([0, 0, W, 130], fill=(31, 56, 100))
    d.text((50, 22), name, fill="white", font=font(52, True))
    d.text((50, 86), "Kod: %s   •   %s   •   %d vardiya" % (code, period, s["n"]), fill=(210, 220, 240), font=font(26))
    d.text((W - 50, 40), "Üretim geri bildirim kartı", fill=(210, 220, 240), font=font(26), anchor="ra")
    y = 155
    d.text((50, y), "Takıma göre durumunuz", fill=(31, 56, 100), font=font(32, True))
    d.text((W - 50, y + 8), "beyaz çizgi = takım ortalaması", fill=(120, 120, 120), font=font(21), anchor="ra")
    y += 52
    BX, BW = 360, 560
    for lab, sub, v, txt, ref, neutral, pts in M:
        usepts = lab == "Vardiya kapsamı"
        g, col, gt = (1, (150, 150, 150), "Yorumlanmaz") if neutral else grade(pts if usepts else v, pts if usepts else None)
        d.text((50, y), lab, fill=(30, 30, 30), font=font(28, True))
        d.text((50, y + 34), sub, fill=(120, 120, 120), font=font(19))
        d.rounded_rectangle([BX, y + 8, BX + BW, y + 32], 8, fill=(228, 230, 236))
        fw = int(BW * min(1.5, max(0.03, v)) / 1.5)
        d.rounded_rectangle([BX, y + 8, BX + fw, y + 32], 8, fill=col)
        mx = BX + int(BW / 1.5)
        d.rectangle([mx - 2, y + 2, mx + 2, y + 38], fill=(40, 40, 40))
        d.text((BX + BW + 24, y + 2), txt, fill=col if not neutral else (110, 110, 110), font=font(27, True))
        d.text((BX + BW + 24, y + 36), "%s • %s" % (ref, gt), fill=(120, 120, 120), font=font(19))
        y += 82
    y += 4
    y = wrap(d, message(s, M, hv), 50, y, W - 100, font(27, True), (30, 30, 30))
    y += 8
    # vardiya cizelgesi
    d.text((50, y), "Vardiya çizelgesi (her şerit 8 saatlik vardiya)", fill=(31, 56, 100), font=font(32, True))
    y += 48
    for x0, c, t in ((50, (46, 158, 106), "Kayıt var (çalışıyor)"), (360, (224, 123, 57), "Kayıt yok ≥ %d dk" % GAP_MIN), (640, (139, 58, 58), "Vardiya başı / sonu boş")):
        d.rectangle([x0, y + 4, x0 + 26, y + 22], fill=c)
        d.text((x0 + 34, y), t, fill=(60, 60, 60), font=font(21))
    y += 38
    R = sorted(rows, key=lambda r: (r["d"], r["a"] or 24))[-22:]
    sx, sw = 225, 470
    for r in R:
        dt = datetime.fromisoformat(r["d"])
        d.text((50, y + 1), "%s %s %s" % (dt.strftime("%d.%m"), ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"][dt.weekday()], {8: "08-16", 16: "16-24", 0: "00-08"}[r["a"]]), fill=(30, 30, 30), font=font(21, True))
        d.rectangle([sx, y, sx + sw, y + 22], fill=(150, 80, 80))
        a0, a1 = max(0, r["f"]), 480 - r["l"]
        px = lambda m: sx + int(sw * min(480, max(0, m)) / 480)
        if a1 > a0:
            d.rectangle([px(a0), y, px(a1), y + 22], fill=(46, 158, 106))
        for st, ln in r.get("gp", []):
            d.rectangle([px(st), y, max(px(st) + 1, px(st + ln)), y + 22], fill=(224, 123, 57))
        gl = sum(g[1] for g in r.get("gp", []))
        d.text((sx + sw + 18, y + 1), "%d kg • %d top • boşluk %d dk%s" % (r["kkg"] + r["skg"], r["kn"], gl, " • %d dk erken" % r["l"] if r["l"] > EARLY_MIN else ""), fill=(60, 60, 60), font=font(19))
        y += 30
    y += 14
    good, imp = feedback(s, T)
    if hv:
        good = [g for g in good if g.startswith("Vardiya başına")] or ["Üretim dışındaki ölçüler Sarım ağırlığı nedeniyle yorumlanmadı."]
        imp = ["Ağırlıklı Sarım yaptığı için KK kayıt boşluğu / erken-geç bırakma yorumlanmadı."]
    d.text((50, y), "Güçlü yönler", fill=(30, 130, 60), font=font(30, True))
    y += 42
    for g in good:
        y = wrap(d, "• " + g, 50, y, W - 100, font(25), (30, 30, 30), 31)
    y += 6
    d.text((50, y), "Konuşulabilecek noktalar", fill=(190, 100, 20), font=font(30, True))
    y += 42
    for g in imp:
        y = wrap(d, "• " + g, 50, y, W - 100, font(25), (30, 30, 30), 31)
    d.text((50, H - 66), "Kaynak: ERP KK top kaydı. Vardiyalar 08-16 / 16-24 / 00-08 varsayıldı.", fill=(130, 130, 130), font=font(18))
    d.text((50, H - 40), "Boşluk iş yokluğu, mola ya da başka iş olabilir; konuşma ipucudur, suçlama değildir.", fill=(130, 130, 130), font=font(18))
    return im


def make_cards(path, shifts, codes, min_shifts):
    by = defaultdict(list)
    for r in shifts:
        by[r["p"]].append(r)
    inv = {v: k for k, v in codes.items()}
    ok = {p: l for p, l in by.items() if len(l) >= min_shifts}
    base = [r for p, l in ok.items() if not heavy(l) for r in l] or [r for l in ok.values() for r in l]
    T = stats(base)
    tcov = cov_of(base)
    days = sorted(r["d"] for l in ok.values() for r in l)
    period = "%s – %s" % (datetime.fromisoformat(days[0]).strftime("%d.%m.%Y"), datetime.fromisoformat(days[-1]).strftime("%d.%m.%Y"))
    n = 0
    tmp = []
    import tempfile
    for p, l in sorted(ok.items(), key=lambda x: -sum(r["kkg"] + r["skg"] for r in x[1])):
        im = draw_card(inv.get(p, p), p, l, T, tcov, period)
        f = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        f.close()
        im.save(f.name, "JPEG", quality=92)
        im.close()
        tmp.append(f.name)
        n += 1
    if tmp:
        from PIL import Image
        first = Image.open(tmp[0]).convert("RGB")
        rest = [Image.open(t).convert("RGB") for t in tmp[1:]]
        first.save(path, "PDF", resolution=150, save_all=True, append_images=rest)
        for t in tmp:
            try:
                os.remove(t)
            except OSError:
                pass
    return n


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
