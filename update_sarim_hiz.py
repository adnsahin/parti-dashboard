# -*- coding: utf-8 -*-
"""
Sarim hizi (kumasa gore): ERP "zaman" raporundaki (ya da urt222) SARIM 1 / SARIM 2 asama kayitlarindan.

  python update_sarim_hiz.py zaman.xlsx [urt222.xlsx ...] [--out data/sarim_hiz.json]

Sarim kayitlarinda giris = cikis (tek an) oldugu icin sure dogrudan yok. Ayni asamadaki ardisik iki kaydin arasi, sonraki
partinin sarim suresi sayilir (makine o partiyi isliyordu). 1 dk'dan kisa araliklar (toplu giris) ve 60 dk'dan uzun araliklar
(bekleme, mola, is yoklugu) kullanilmaz. Sure modeli: dk = SABIT PARTI PAYI + kg / kumas hizi; sabit pay butun orneklerden
dogrusal uydurmayla bulunur. Ornekler onceki json'daki orneklerle birlestirilir (ayni parti + asama + saat tek sayilir),
son 120 gun tutulur. Kisi bilgisi yazilmaz.
"""
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from statistics import median

from update_personel_top import clean, num, to_dt, read_sheet, tr_upper

GAP_MIN, GAP_MAX, KEEP_DAYS = 1.0, 60.0, 120


def ham_kod(ham):
    m = re.match(r"[A-Z0-9]+", tr_upper(ham))
    return m.group(0) if m and len(m.group(0)) >= 3 else ""


def load(path):
    head, rows = read_sheet(path)
    ix = {h: i for i, h in enumerate(head)}
    need = ["Aşama Adı", "Giriş Tarihi", "Kilo"]
    if any(k not in ix for k in need):
        print("Not: %s icinde asama / giris tarihi kolonu yok, atlandi." % path)
        return []
    iK2, iH = ix.get("Aşama Çıkış Kilo"), ix.get("Ham Adı")
    out = []
    for r in rows:
        st = tr_upper(clean(r[ix["Aşama Adı"]]))
        if not st.startswith("SARIM"):
            continue
        t = to_dt(r[ix["Giriş Tarihi"]])
        if not t:
            continue
        kg = (num(r[iK2]) if iK2 is not None else 0) or num(r[ix["Kilo"]])
        out.append({"p": clean(r[0]), "st": "sr2" if "2" in st else "sr1", "t": t, "kg": kg, "ham": tr_upper(clean(r[iH])) if iH is not None else ""})
    return out


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        sys.exit(1)
    out = a[a.index("--out") + 1] if "--out" in a else os.path.join("data", "sarim_hiz.json")
    files = [x for i, x in enumerate(a) if not x.startswith("--") and (i == 0 or a[i - 1] != "--out")]
    recs = {}
    for f in files:
        for r in load(f):
            recs[(r["p"], r["st"], r["t"])] = r
    # ardisik kayit araliklari -> ornek [tarih, asama, ham, kg, aralik dk, anahtar]
    samples = {}
    for st in ("sr1", "sr2"):
        L = sorted((r for r in recs.values() if r["st"] == st), key=lambda r: r["t"])
        for x, y in zip(L, L[1:]):
            g = (y["t"] - x["t"]).total_seconds() / 60
            if GAP_MIN <= g <= GAP_MAX and y["kg"] > 0:
                k = y["p"] + "|" + st + "|" + y["t"].strftime("%Y-%m-%dT%H:%M:%S")
                samples[k] = [y["t"].strftime("%Y-%m-%d"), st, y["ham"], round(y["kg"], 1), round(g, 2)]
    prev = {}
    if os.path.exists(out):
        try:
            with open(out, encoding="utf-8") as f:
                prev = json.load(f)
        except (OSError, ValueError):
            prev = {}
    for k, v in (prev.get("s") or {}).items():
        samples.setdefault(k, v)
    if not samples:
        print("Sarim kaydi bulunamadi; %s degismedi." % out)
        return
    last = max(v[0] for v in samples.values())
    cut = (datetime.strptime(last, "%Y-%m-%d") - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    samples = {k: v for k, v in samples.items() if v[0] >= cut}
    S = list(samples.values())
    # Sarim kayitlari parti basina tek an oldugu icin sabit pay + kg modeli guvenilir cikmiyor (aralik operatorun kayit
    # aliskanligina bagli); hiz = parti kg / partinin araligi (sabit pay hizin icinde). Pano en az 5 dk sayar.
    setup = 0.0

    def kgph(s):
        return min(6000.0, max(60.0, s[3] / (s[4] / 60)))

    def agg(key):
        g = defaultdict(list)
        for s in S:
            k = key(s)
            if k:
                g[k].append(kgph(s))
        return {k: [len(v), round(median(v), 1)] for k, v in g.items()}

    res = {
        "v": 1, "generatedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "from": min(s[0] for s in S), "to": last, "gapMin": GAP_MIN, "gapMax": GAP_MAX, "setup": round(setup, 1),
        "n": {st: sum(1 for s in S if s[1] == st) for st in ("sr1", "sr2")},
        "all": [len(S), round(median(kgph(s) for s in S), 1)],
        "ham": agg(lambda s: s[2]), "kod": agg(lambda s: ham_kod(s[2])),
        "s": samples,
    }
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    print("%s: %d ornek (Sarim1 %d, Sarim2 %d), %d kumas, sabit parti payi %.1f dk, genel hiz %.0f kg/sa, %s - %s"
          % (out, len(S), res["n"]["sr1"], res["n"]["sr2"], len(res["ham"]), setup, res["all"][1], res["from"], res["to"]))


if __name__ == "__main__":
    main()
