# -*- coding: utf-8 -*-
"""
⭐ Parti kayitlarinin kalici kopyasi: data/parti_kayitlari.json

  python update_parti_kayitlari.py [--out data/parti_kayitlari.json]

Panodaki kayitlar cihazlar arasinda ntfy.sh kanalindan esitlenir; kanal mesajlari 12 saat tutar. Bu betik kanaldaki en yeni
tam anlik goruntuyu okuyup depodaki dosyayla birlestirir (her kayit kendi degisiklik zamaniyla, "u"); boylece hicbir cihaz
uzun sure acilmasa da kayitlar kaybolmaz. GUNCELLE_VE_PUSH.bat her calismada otomatik calistirir.
"""
import argparse
import json
import os
import time
import urllib.request

URL = "https://ntfy.sh/parti-kayit-80229929701cee76beb5"
OUT = os.path.join("data", "parti_kayitlari.json")
TOMB_DAYS = 60


def read_channel():
    with urllib.request.urlopen(URL + "/json?poll=1&since=all", timeout=30) as r:
        text = r.read().decode("utf-8")
    snaps = {}
    for line in text.splitlines():
        try:
            m = json.loads(line)
            if m.get("event") != "message":
                continue
            d = json.loads(m["message"])
            if not isinstance(d, dict) or d.get("v") != "sr1" or not isinstance(d.get("c"), list):
                continue
            s = snaps.setdefault(d["t"], {"t": d["t"], "n": d["c"][1], "got": set(), "r": {}, "x": {}, "k": None})
            s["got"].add(d["c"][0])
            if d.get("k"):
                s["k"] = d["k"]
            s["r"].update(d.get("r") or {})
            s["x"].update(d.get("x") or {})
        except Exception:
            pass
    full = [s for s in snaps.values() if len(s["got"]) >= s["n"]]
    return max(full, key=lambda s: s["t"]) if full else None


def u_of(rec):
    try:
        return int(rec[6] or 0)
    except Exception:
        return 0


def merge(base, s):
    r, x = base.setdefault("r", {}), base.setdefault("x", {})
    for p, rec in (s.get("r") or {}).items():
        if u_of(rec) > max(u_of(r[p]) if p in r else 0, x.get(p, 0)):
            r[p] = rec
            x.pop(p, None)
    for p, ms in (s.get("x") or {}).items():
        if ms > (u_of(r[p]) if p in r else 0) and ms > x.get(p, 0):
            r.pop(p, None)
            x[p] = ms
    k = s.get("k")
    if k and k.get("l") and (k.get("u") or 0) >= ((base.get("k") or {}).get("u") or 0):
        base["k"] = k
    lim = int(time.time() * 1000) - TOMB_DAYS * 86400000
    base["x"] = {p: ms for p, ms in x.items() if ms > lim}
    return base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    base = {"v": "sr1", "t": 0, "k": None, "r": {}, "x": {}}
    if os.path.exists(a.out):
        try:
            with open(a.out, encoding="utf-8") as f:
                j = json.load(f)
            if j.get("v") == "sr1":
                base.update(j)
        except Exception:
            pass
    before = json.dumps(base, sort_keys=True, ensure_ascii=False)
    try:
        s = read_channel()
    except Exception as e:
        print("Parti kayitlari kanali okunamadi: %s (dosya degismedi)" % e)
        s = None
    if s:
        merge(base, s)
        base["t"] = max(base.get("t") or 0, s["t"])
    if json.dumps(base, sort_keys=True, ensure_ascii=False) != before or not os.path.exists(a.out):
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(base, f, ensure_ascii=False, separators=(",", ":"))
    print("%s: %d kayit, %d kategori" % (a.out, len(base["r"]), len((base.get("k") or {}).get("l") or [])))


if __name__ == "__main__":
    main()
