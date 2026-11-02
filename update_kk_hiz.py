# -*- coding: utf-8 -*-
"""
KK uretim hizi (kumas tipine gore): ERP "urt" raporundaki KK top kayitlarindan her partinin KK'da aktif islem suresi ve
kg/saat hizi; ham adina (kumas), ham koduna (ilk parca) ve ham tipine gore ortanca. Pano bu dosyayla KK'daki bekleyen
partiler icin "hizli uretilenler once" calisma programi simule eder.

  python update_kk_hiz.py urt.Xlsx [--out data/kk_hiz.json]

Kisi bilgisi yazilmaz. Aktif sure: partide her kisinin KENDI ardisik top kayitlari arasi <= 20 dk araliklar toplami + bir top
payi (ayni partide birden cok kisi calisinca kayitlar ic ice gecip sureyi kisaltmasin diye kisi bazinda); daha uzun aralik
(mola, is yoklugu, baska is) sayilmaz. Sure modeli: aktif dk = SABIT PARTI PAYI (tak-cikar, baslama) + kg / kumas hizi;
sabit pay butun partilerden dogrusal uydurmayla bulunur, kumas hizi bu pay dusulerek hesaplanir.
"""
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from statistics import median

from update_personel_top import clean, num, to_dt, read_sheet, tr_upper

GAP_MAX = 20      # dk; bundan uzun aralik aktif sure sayilmaz
MIN_ACT = 5       # dk; daha kisa olculen parti hiz hesabina girmez
MIN_TOPS = 2


def idx(head, pred):
    for i, h in enumerate(head):
        if pred(h):
            return i
    raise KeyError("kolon yok")


def ham_kod(ham):
    """ham adinin ilk parcasi: 'DWB010521-2' -> 'DWB010521', '90165 POLYESTER POLAR' -> '90165'"""
    m = re.match(r"[A-Z0-9]+", tr_upper(ham).replace(" ", " "))
    return m.group(0) if m and len(m.group(0)) >= 3 else ""


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        sys.exit(1)
    out = a[a.index("--out") + 1] if "--out" in a else os.path.join("data", "kk_hiz.json")
    head, rows = read_sheet(a[0])
    low = [h.lower() for h in head]
    iP = 0
    iH = idx(low, lambda h: h.startswith("ham ad"))
    iHT = idx(low, lambda h: h.startswith("ham tipi"))
    iM = idx(low, lambda h: h == "makina")
    iT = idx(low, lambda h: h == "tarih")
    iK = idx(low, lambda h: h == "kilo")
    iN = idx(low, lambda h: h == "net metre")
    iU = idx(low, lambda h: h.startswith("kaydeden"))
    tops = defaultdict(list)
    info = {}
    for r in rows:
        t = to_dt(r[iT])
        p = clean(r[iP])
        if not t or not p:
            continue
        tops[p].append((t, num(r[iK]), num(r[iN]), clean(r[iM]), clean(r[iU])))
        info[p] = (clean(r[iH]), clean(r[iHT]))
    # bir top payi: butun kisi-ici kisa araliklarin ortancasi (partide tek top giren kisi icin)
    allg = []
    for tl in tops.values():
        by = defaultdict(list)
        for x in sorted(tl):
            by[x[4]].append(x[0])
        for ts in by.values():
            allg += [g for g in ((ts[i + 1] - ts[i]).total_seconds() / 60 for i in range(len(ts) - 1)) if g <= GAP_MAX]
    one = median(allg) if allg else 4.5
    raw = []
    day_act = defaultdict(float)
    day_mach = defaultdict(set)
    day_night = defaultdict(int)
    for p, tl in tops.items():
        tl.sort()
        kg = sum(x[1] for x in tl)
        for t, _, _, m, _ in tl:
            d = (t - timedelta(hours=8)).date().isoformat()
            if m:
                day_mach[d].add(m)
            if t.hour < 8:
                day_night[d] += 1
        if len(tl) < MIN_TOPS or kg <= 0:
            continue
        by = defaultdict(list)
        for x in tl:
            by[x[4]].append(x[0])
        act = 0.0
        for ts in by.values():
            short = [g for g in ((ts[i + 1] - ts[i]).total_seconds() / 60 for i in range(len(ts) - 1)) if g <= GAP_MAX]
            act += (sum(short) + median(short)) if short else one
        if act < MIN_ACT:
            continue
        d = (tl[0][0] - timedelta(hours=8)).date().isoformat()
        day_act[d] += act / 60
        ham, tip = info[p]
        raw.append({"ham": tr_upper(ham), "kod": ham_kod(ham), "tip": tr_upper(tip), "kg": kg, "act": act, "n": len(tl), "t": tl[-1][0]})
    # sabit parti payi: aktif dk = a + b * kg (asiri buyuk partiler disarida)
    fit = [x for x in raw if x["kg"] < 2000]
    mx = sum(x["kg"] for x in fit) / len(fit)
    my = sum(x["act"] for x in fit) / len(fit)
    bb = sum((x["kg"] - mx) * (x["act"] - my) for x in fit) / sum((x["kg"] - mx) ** 2 for x in fit)
    setup = max(0.0, min(40.0, my - bb * mx))
    parts = []
    for x in raw:
        net = max(x["act"] - setup, x["act"] * 0.3)   # sabit pay dusulmus kg isleme suresi (cok kucuk partide en az %30)
        x["kgph"] = x["kg"] / (net / 60)
        parts.append(x)

    def agg(key):
        g = defaultdict(list)
        for x in parts:
            if x[key]:
                g[x[key]].append(x)
        return {k: [len(v), round(median(y["kgph"] for y in v), 1), round(median(y["kg"] for y in v)), round(median(y["act"] for y in v), 1)]
                for k, v in g.items()}

    days = sorted(day_act)
    tmax = max(x["t"] for x in parts)
    res = {
        "v": 1, "generatedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "to": tmax.strftime("%Y-%m-%dT%H:%M"),
        "gapMax": GAP_MAX, "n": len(parts), "setup": round(setup, 1), "oneTop": round(one, 1),
        "all": [len(parts), round(median(x["kgph"] for x in parts), 1), round(median(x["kg"] for x in parts)), round(median(x["act"] for x in parts), 1)],
        # gunluk KK aktif is saati (kisi toplami), makine sayisi, gece (00-08) top sayisi (>= 10: 24 saat calisilmis gun)
        "days": {d: [round(day_act[d], 1), len(day_mach.get(d, ())), day_night.get(d, 0)] for d in days},
        "ham": agg("ham"), "kod": agg("kod"), "tip": agg("tip"),
    }
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    print("%s: %d parti, %d kumas, %d gun, sabit parti payi %.1f dk, genel hiz %.0f kg/sa" % (out, len(parts), len(res["ham"]), len(days), setup, res["all"][1]))


if __name__ == "__main__":
    main()
