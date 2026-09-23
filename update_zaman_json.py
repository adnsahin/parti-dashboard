#!/usr/bin/env python3
"""
update_zaman_json.py
--------------------
ERP "zaman" raporu (her satir = bir partinin tamamlanmis bir asamasi, giris/cikis tarihli)
-> data/zaman_ozet.json

Uretilenler:
  shifts  : Son N vardiyanin (08:00-08:00) gercek uretimi. Son KK ve Sarim1 icin gelen/uretim,
            FZK ve SEVK icin cikis; parti sayisi + kg.
  norms   : Her asamaya girmeden once partinin gecmiste ne kadar beklediginin dagilimi (saat).
  wet     : Islak bolge (BOYAMA cikisi -> ilk RAM girisi) gercek bekleme dagilimlari, adim ve vardiya bazinda.
  history : Aktif partilerin (partiler.json) asama gecmisi.

Kullanim:
  python update_zaman_json.py <zaman.xlsx> [zaman_ozet.json] [partiler.json]

Ornek:
  python update_zaman_json.py "zaman (1).Xlsx" .\\data\\zaman_ozet.json .\\data\\partiler.json
"""

import sys
import os
import json
import statistics
from datetime import datetime, timedelta
from collections import defaultdict
from openpyxl import load_workbook

SHIFT_START_HOUR = 8
KEEP_SHIFTS = 14
KK = "KALİTE KONTROL"
SARIM = "SARIM 1"
FZK = "FİZİKSEL KONTROL"
SEVK = "SEVK TESLİM"
MIN_NORM_N = 10
WET_PAINT = ("BOYAMA", "ÇİFT BOYAMA")
WET_STOP = (KK, FZK, SEVK)


def clean(v):
    return "" if v is None else str(v).strip()


def to_dt(v):
    if isinstance(v, datetime):
        return v
    s = clean(v)
    for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None


def to_num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


def shift_key(dt):
    return (dt - timedelta(hours=SHIFT_START_HOUR)).strftime("%Y-%m-%d")


def pct(sorted_vals, q):
    if not sorted_vals:
        return None
    i = min(len(sorted_vals) - 1, max(0, int(round(q * (len(sorted_vals) - 1)))))
    return sorted_vals[i]


def load_rows(path):
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    it = ws.iter_rows(values_only=True)
    head = [clean(h) for h in next(it)]
    ix = {h: i for i, h in enumerate(head)}

    def col(*names):
        for n in names:
            if n in ix:
                return ix[n]
        raise SystemExit("Kolon bulunamadi: " + " / ".join(names))

    c_parti = col("Parti / İş Emri", "Parti No")
    c_firma = col("Firma Adı")
    c_stage = col("Aşama Adı")
    c_makina = col("Makina")
    c_gir = col("Giriş Tarihi")
    c_cik = col("Çıkış Tarihi")
    c_kg = col("Aşama Çıkış Kilo")
    c_kg2 = col("Kilo")
    c_flow = col("Proses Adı")

    rows = []
    for r in it:
        parti = clean(r[c_parti])
        gir, cik = to_dt(r[c_gir]), to_dt(r[c_cik])
        if not parti or not gir or not cik:
            continue
        kg = to_num(r[c_kg]) or to_num(r[c_kg2])
        rows.append({
            "parti": parti, "firma": clean(r[c_firma]), "stage": clean(r[c_stage]),
            "makina": clean(r[c_makina]), "gir": gir, "cik": cik, "kg": kg,
            "flow": clean(r[c_flow]),
        })
    return rows


def build(rows, waiting):
    by = defaultdict(list)
    for r in rows:
        by[r["parti"]].append(r)
    for lst in by.values():
        lst.sort(key=lambda r: (r["cik"], r["gir"]))

    events = defaultdict(lambda: defaultdict(dict))  # shift -> metric -> {parti: kg}
    waits = defaultdict(list)                        # stage -> [saat]

    def add(metric, when, parti, kg):
        events[shift_key(when)][metric].setdefault(parti, kg)

    for parti, lst in by.items():
        kk_total = sum(1 for t in (lst[0]["flow"] or "").split("+") if t.strip() == "KK")
        kk_visit = 0
        for i, r in enumerate(lst):
            prev = lst[i - 1] if i > 0 else None
            nxt = lst[i + 1] if i + 1 < len(lst) else None
            st = r["stage"]

            if nxt is not None and nxt["gir"] >= r["cik"]:
                w = (nxt["gir"] - r["cik"]).total_seconds() / 3600
                waits[nxt["stage"]].append(w)

            arrive = prev["cik"] if prev is not None and prev["cik"] <= r["gir"] else r["gir"]

            if st == KK:
                kk_visit += 1
                final = (nxt is not None and nxt["stage"] in (FZK, SEVK)) or (
                    nxt is None and kk_total > 0 and kk_visit >= kk_total)
                if final:
                    add("kkGelen", arrive, parti, r["kg"])
                    add("kkUretim", r["cik"], parti, r["kg"])
                    waits["KK_SON"].append(max(0.0, (r["gir"] - arrive).total_seconds() / 3600))
            elif st == SARIM:
                if prev is None or prev["stage"] != SARIM:
                    add("srGelen", arrive, parti, r["kg"])
                if nxt is None or nxt["stage"] != SARIM:
                    add("srUretim", r["cik"], parti, r["kg"])
            elif st == FZK:
                add("fzk", r["cik"], parti, r["kg"])
            elif st == SEVK:
                add("sevk", r["cik"], parti, r["kg"])

    # Dosyada yalniz TAMAMLANMIS asamalar var: su an KK / Sarim1 sirasinda bekleyen parti icin
    # henuz satir yok. Bunlarin "gelis" zamani = son tamamlanan asamanin cikisi.
    for parti, stage in waiting.items():
        lst = by.get(parti)
        if not lst:
            continue
        kk_total = sum(1 for t in (lst[0]["flow"] or "").split("+") if t.strip() == "KK")
        arrive = lst[-1]["cik"]
        if stage == KK:
            kk_done = sum(1 for r in lst if r["stage"] == KK)
            if kk_total > 0 and kk_done + 1 >= kk_total:
                add("kkGelen", arrive, parti, lst[-1]["kg"])
        elif stage == SARIM:
            add("srGelen", arrive, parti, lst[-1]["kg"])

    metrics = ("kkGelen", "kkUretim", "srGelen", "srUretim", "fzk", "sevk")
    days = sorted(events)[-KEEP_SHIFTS:]
    shifts = {}
    for d in days:
        shifts[d] = {m: {"n": len(events[d][m]), "kg": round(sum(events[d][m].values()))} for m in metrics}

    norms = {}
    for stage, vals in waits.items():
        if len(vals) < MIN_NORM_N:
            continue
        s = sorted(vals)
        norms[stage] = {"n": len(s), "med": round(pct(s, .5), 2), "p75": round(pct(s, .75), 2), "p90": round(pct(s, .9), 2)}
    return by, shifts, norms


def norm_obj(vals):
    s = sorted(vals)
    return {"n": len(s), "med": round(pct(s, .5), 2), "p75": round(pct(s, .75), 2), "p90": round(pct(s, .9), 2)}


def wet_stats(by):
    """Islak asamalar = BOYA/BOYAMA cikisi ile ilk RAM* asamasi ARASINDAKI tum asamalar.
    RAM* (RAM, RAM APRE, RAM KURUTMA ...) ve sonrasi KURU sayilir, islak bekleme degildir.
    Islak bekleme = bir onceki asamanin cikisi -> bu islak asamanin girisi (saat)."""
    hops = defaultdict(list)
    totals = []
    stage_counts = defaultdict(int)
    dry_counts = defaultdict(int)
    rows = []
    per_shift = defaultdict(lambda: {"n": 0, "waits": [], "kg": 0.0})
    for parti, lst in by.items():
        i = 0
        while i < len(lst):
            if lst[i]["stage"] not in WET_PAINT:
                i += 1
                continue
            zone, j, ram = [lst[i]], i + 1, None
            while j < len(lst):
                st = lst[j]["stage"]
                if st in WET_PAINT or st in WET_STOP:
                    break
                if st.startswith("RAM"):
                    ram = lst[j]
                    break
                zone.append(lst[j])
                j += 1
            if ram is None or len(zone) < 2:
                i = max(j, i + 1)
                continue
            steps, total = [], 0.0
            for a_, b_ in zip(zone[:-1], zone[1:]):
                w = max(0.0, (b_["gir"] - a_["cik"]).total_seconds() / 3600)
                total += w
                hops[b_["stage"]].append(w)
                stage_counts[b_["stage"]] += 1
                steps.append([b_["stage"], round(w, 2), fmt(b_["gir"])])
            dry_counts[ram["stage"]] += 1
            totals.append(total)
            end = zone[-1]["cik"]
            ps = per_shift[shift_key(end)]
            ps["n"] += 1
            ps["waits"].append(total)
            ps["kg"] += zone[0]["kg"]
            rows.append({"end": end, "row": [parti, zone[0]["firma"], round(zone[0]["kg"]), fmt(zone[0]["cik"]), steps, round(total, 2), ram["stage"], fmt(ram["gir"])]})
            i = j + 1
    if not totals:
        return None
    days = sorted(per_shift)[-KEEP_SHIFTS:]
    keep = set(days)
    rows = [r["row"] for r in sorted(rows, key=lambda r: r["end"], reverse=True) if shift_key(r["end"]) in keep]
    return {
        "definition": "Islak = BOYA/BOYAMA ile ilk RAM* arasindaki asamalar; RAM* ve sonrasi kuru",
        "passages": len(totals),
        "total": norm_obj(totals),
        "hops": {k: norm_obj(v) for k, v in hops.items() if len(v) >= MIN_NORM_N},
        "wetStages": dict(sorted(stage_counts.items(), key=lambda kv: -kv[1])),
        "dryStages": dict(sorted(dry_counts.items(), key=lambda kv: -kv[1])),
        "shifts": {d: {"n": per_shift[d]["n"], "med": round(pct(sorted(per_shift[d]["waits"]), .5), 2),
                       "over2": sum(1 for w in per_shift[d]["waits"] if w > 2), "kg": round(per_shift[d]["kg"])} for d in days},
        "rows": rows,
    }


def fmt(dt):
    return dt.strftime("%Y-%m-%dT%H:%M")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join("data", "zaman_ozet.json")
    partiler = sys.argv[3] if len(sys.argv) > 3 else os.path.join("data", "partiler.json")

    rows = load_rows(src)
    cards = []
    if os.path.exists(partiler):
        with open(partiler, encoding="utf-8") as f:
            cards = json.load(f).get("cards", [])
    waiting = {clean(c.get("parti")): clean(c.get("stage")) for c in cards}
    by, shifts, norms = build(rows, waiting)

    history = {}
    if cards:
        active = {clean(c.get("parti")) for c in cards}
        for p in active:
            if p in by:
                history[p] = [[r["stage"], fmt(r["gir"]), fmt(r["cik"]), r["makina"]] for r in by[p]]

    payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": os.path.basename(src),
        "from": fmt(min(r["gir"] for r in rows if r["cik"].year >= 2026)) if rows else "",
        "to": fmt(max(r["cik"] for r in rows)) if rows else "",
        "shiftStartHour": SHIFT_START_HOUR,
        "shifts": shifts,
        "norms": norms,
        "wet": wet_stats(by),
        "history": history,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print("Yazildi:", out, "|", len(rows), "satir |", len(shifts), "vardiya |", len(norms), "norm |", len(history), "parti gecmisi |",
          round(os.path.getsize(out) / 1024), "KB")


if __name__ == "__main__":
    main()
