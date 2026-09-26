#!/usr/bin/env python3
"""
update_uretim_log.py
--------------------
Her veri guncellemesinde (data/partiler.json) KK / Sarim1 / Sarim2'ye GELEN ve buradan GECEN
partileri vardiya (08:00-08:00) bazinda data/uretim_log.json'a kaydeder. Parti sonradan listeden
cikse (sevk edilse) bile kaydi kalir.

Tespit (iki guncelleme arasindaki durum degisimi):
  gelen : parti o asamada beklemeye basladi -> zaman = son hareket (onceki asamanin bitisi).
          KK icin yalnizca son KK (sonrasi FZK/SEVK) sayilir.
  gecen : onceki guncellemede o asamadaydi, simdi ileride -> zaman = bu guncellemenin zamani
          (ERP'deki son hareket tarihi asama bitince hemen guncellenmedigi icin kullanilmaz).
          Hic beklerken gorulmeden gecenler de (iki guncelleme arasinda gelip gecen) sayilir.
          KK'da bekleyen parti listeden tamamen cikarsa (sevk) gecmis sayilir.
  e=1   : zaman tahmini (veri boslugu > 45 dk, ilk calisma veya hareket tarihi yok).

Kullanim:
  python update_uretim_log.py [partiler.json] [uretim_log.json]
"""

import sys
import os
import re
import json
from datetime import datetime, timedelta

SHIFT_START_HOUR = 8
KEEP_SHIFTS = 31
CATS = ("kk", "sr1", "sr2")


def tr_upper(s):
    return str(s or "").replace("i", "İ").replace("ı", "I").upper()


def key(s):
    return "".join(ch for ch in " ".join(tr_upper(s).split()) if ch.isalnum())


def is_kk(s):
    k = key(s)
    return k == "KK" or "KALITEKONTROL" in k or "KALİTEKONTROL" in k


def is_fzk(s):
    k = key(s)
    return k.startswith("FZK") or k.startswith("FİZİKSEL") or k.startswith("FIZIKSEL")


def is_sevk(s):
    return key(s).startswith("SEVK")


MATCH = {"kk": is_kk, "sr1": lambda s: "SARIM1" in key(s), "sr2": lambda s: "SARIM2" in key(s)}


def stage_equals(a, b):
    x, y = key(a), key(b)
    if not x or not y:
        return False
    if x == y:
        return True
    if x == "KK" or y == "KK":
        return is_kk(a) and is_kk(b)
    return x in y or y in x


def next_after(parts, stage, last):
    ti = [i for i, t in enumerate(parts) if stage_equals(t, stage)]
    li = [i for i, t in enumerate(parts) if last and stage_equals(t, last)]
    idx = -1
    if li and ti:
        idx = next((i for i in ti if i >= li[-1]), ti[-1])
    elif ti:
        idx = ti[0]
    return parts[idx + 1] if 0 <= idx < len(parts) - 1 else ""


def last_index(parts, stage):
    k = key(stage)
    for i in range(len(parts) - 1, -1, -1):
        if key(parts[i]) == k:
            return i
    for i in range(len(parts) - 1, -1, -1):
        if stage_equals(parts[i], stage):
            return i
    return -1


def parse_dt(s):
    m = re.search(r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?", str(s or "").split(" | ")[0])
    if not m:
        return None
    y = int(m.group(3))
    if y < 100:
        y += 2000
    try:
        return datetime(y, int(m.group(2)), int(m.group(1)), int(m.group(4) or 0), int(m.group(5) or 0))
    except ValueError:
        return None


def fmt(dt):
    return dt.strftime("%Y-%m-%dT%H:%M")


def unfmt(s):
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M")
    except (TypeError, ValueError):
        return None


def shift_key(dt):
    return (dt - timedelta(hours=SHIFT_START_HOUR)).strftime("%Y-%m-%d")


def shift_start(dt):
    d = dt - timedelta(hours=SHIFT_START_HOUR)
    return datetime(d.year, d.month, d.day, SHIFT_START_HOUR)


def num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


def group_cards(cards):
    """Panodaki gibi ayni parti + ayni asama satirlarini tek kart yap (kg toplanir)."""
    groups = {}
    for c in cards:
        parti = str(c.get("parti") or "").strip()
        stage = str(c.get("stage") or "").strip()
        if not parti:
            continue
        g = groups.get((parti, stage))
        if g is None:
            groups[(parti, stage)] = dict(c, parti=parti, stage=stage, kg=num(c.get("kg")))
        else:
            g["kg"] += num(c.get("kg"))
            if (parse_dt(c.get("hareket")) or datetime.min) > (parse_dt(g.get("hareket")) or datetime.min):
                g["hareket"], g["lastStage"] = c.get("hareket"), c.get("lastStage")
    return list(groups.values())


def at_stage(g, cat):
    """Parti bu kategoride su an bekliyor mu (KK icin: son KK)."""
    if not MATCH[cat](g["stage"]):
        return False
    if cat != "kk":
        return True
    parts = [t.strip() for t in str(g.get("flow") or "").split(",") if t.strip()]
    nxt = next_after(parts, g["stage"], g.get("lastStage"))
    return not nxt or is_fzk(nxt) or is_sevk(nxt)


def moved_on(g, cat):
    """Parti bu asamadan ileri gitmis mi (KK icin: son KK sonrasi; geri tamire donus sayilmaz)."""
    if MATCH[cat](g["stage"]):
        return False
    if cat != "kk" or is_fzk(g["stage"]) or is_sevk(g["stage"]):
        return True
    parts = [t.strip() for t in str(g.get("flow") or "").split(",") if t.strip()]
    ci, si = last_index(parts, g["stage"]), last_index(parts, "KK")
    return ci >= 0 and si >= 0 and ci > si


def passed_now(g, cat):
    return MATCH[cat](g.get("lastStage")) and moved_on(g, cat)


def info_of(g):
    return {"firma": str(g.get("firma") or "").strip(), "kumas": str(g.get("fabric") or "").strip(),
            "recete": str(g.get("recipe") or "").strip(), "siparis": str(g.get("customer") or "").strip()}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join("data", "partiler.json")
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join("data", "uretim_log.json")

    with open(src, encoding="utf-8") as f:
        pdata = json.load(f)
    try:
        now = datetime.fromisoformat(str(pdata.get("generatedAt"))[:16])
    except ValueError:
        now = datetime.now().replace(second=0, microsecond=0)

    log = None
    if os.path.exists(out):
        try:
            with open(out, encoding="utf-8") as f:
                log = json.load(f)
        except (OSError, ValueError):
            log = None
    if not isinstance(log, dict) or log.get("v") != 3:
        log = {"v": 3, "startedAt": fmt(shift_start(now)), "days": {}, "partiler": {}, "prev": {}}
    started = unfmt(log.get("startedAt")) or shift_start(now)
    days, partiler, prev = log["days"], log["partiler"], log.get("prev") or {}
    prev_at = unfmt(log.get("snapshotAt"))
    first_run = prev_at is None
    if prev_at and now <= prev_at:
        print("Uretim kaydi: ayni/eski veri (" + fmt(now) + "), atlandi.")
        return
    uncertain = first_run or now - prev_at > timedelta(minutes=45)

    def seen(cat_key, parti, when, hours):
        lo, hi = when - timedelta(hours=hours), when + timedelta(hours=hours)
        for day in days.values():
            r = day.get(cat_key, {}).get(parti)
            t = unfmt(r["t"]) if r else None
            if t and lo <= t <= hi:
                return True
        return False

    def add(cat_key, parti, when, kg, asama, info, estimated):
        if when is None or when < started or when > now:
            return False
        bucket = days.setdefault(shift_key(when), {}).setdefault(cat_key, {})
        if parti in bucket:
            return False
        rec = {"t": fmt(when), "kg": round(kg, 2), "a": asama}
        if estimated:
            rec["e"] = 1
        bucket[parti] = rec
        partiler[parti] = info
        return True

    groups = group_cards(pdata.get("cards") or [])
    prev_count = int(log.get("cardCount") or 0)
    if not groups or (prev_count and len(groups) < prev_count * 0.7):
        print("UYARI: partiler.json eksik gorunuyor (" + str(len(groups)) + " kart, onceki " + str(prev_count) + "), uretim kaydi atlandi.")
        return
    by_parti = {}
    for g in groups:
        by_parti.setdefault(g["parti"], []).append(g)

    # Her parti/asama icin durum: "at" = orada bekliyor, "done" = son yaptigi asama bu ve ilerlemis.
    # Kayit yalnizca durum DEGISINCE yapilir; ayni ziyaret iki kez (farkli vardiyada) sayilmaz.
    new_prev = {}
    added = 0
    for cat in CATS:
        gelen, gecen = cat + "Gelen", cat + "Gecen"
        for parti, gs in by_parti.items():
            pe = prev.get(parti) or {}
            before = "at" if cat in (pe.get("at") or {}) else "done" if cat in (pe.get("done") or []) else None
            here = [g for g in gs if at_stage(g, cat)]
            if here:
                kg, info = sum(g["kg"] for g in here), info_of(here[0])
                ne = new_prev.setdefault(parti, {})
                ne.setdefault("at", {})[cat] = kg
                ne["i"] = info
                if before != "at":
                    arrive = max((parse_dt(g.get("hareket")) for g in here), key=lambda d: d or datetime.min)
                    when = min(arrive, now) if arrive else (None if first_run else now)
                    if when and not seen(gelen, parti, when, 0):
                        added += add(gelen, parti, when, kg, str(here[0].get("lastStage") or ""), info, arrive is None)
                continue
            done = [g for g in gs if passed_now(g, cat)]
            if done:
                new_prev.setdefault(parti, {}).setdefault("done", []).append(cat)
            if before == "done":
                continue
            moved = done or [g for g in gs if moved_on(g, cat)]
            if before == "at" and moved:
                g = moved[0]
                if not seen(gecen, parti, now, 24):
                    added += add(gecen, parti, now, pe["at"][cat], g["stage"], info_of(g), uncertain)
            elif done and not before:
                g, kg = done[0], sum(x["kg"] for x in done)
                if first_run:
                    added += add(gecen, parti, parse_dt(g.get("hareket")), kg, g["stage"], info_of(g), True)
                elif not seen(gecen, parti, now, 24):
                    added += add(gecen, parti, now, kg, g["stage"], info_of(g), uncertain)
                    if not seen(gelen, parti, now, 24):
                        added += add(gelen, parti, now, kg, "", info_of(g), True)
        if cat == "kk":
            for parti, pe in prev.items():
                if parti not in by_parti and cat in (pe.get("at") or {}) and not seen(gecen, parti, now, 24):
                    added += add(gecen, parti, now, pe["at"][cat], "listeden çıktı", pe.get("i") or {}, True)

    keep = sorted(days)[-KEEP_SHIFTS:]
    log["days"] = {d: days[d] for d in keep}
    used = {p for d in keep for bucket in days[d].values() for p in bucket}
    log["partiler"] = {p: partiler[p] for p in partiler if p in used}
    log["prev"] = new_prev
    log["cardCount"] = len(groups)
    log["snapshotAt"] = fmt(now)
    log["shiftStartHour"] = SHIFT_START_HOUR

    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out)

    today = log["days"].get(shift_key(now), {})
    summary = " | ".join(c + ":" + str(len(today.get(c, {}))) for c in ("kkGelen", "kkGecen", "sr1Gecen", "sr2Gecen"))
    print("Uretim kaydi:", out, "| yeni", added, "| bugun", summary, "|", round(os.path.getsize(out) / 1024), "KB")


if __name__ == "__main__":
    main()
