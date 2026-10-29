# -*- coding: utf-8 -*-
"""
Personel adlarini SIFRELI olarak panoya tasir: data/personel_adlar.enc.json

  python sifrele_personel_adlari.py [--klasor ..]

- Ad -> kod eslemesi (personel_kodlari.json) GitHub'a GITMEZ; bu betik yalnizca
  { "P1": "Ad Soyad", ... } tablosunu AES-256-GCM ile sifreleyip yazar.
- Anahtar sifrenizden turetilir (PBKDF2-SHA256, 600 000 tur). Sifre hicbir yere yazilmaz;
  panoda "🔒 İsimleri göster" kutusuna ayni sifreyi girince isimler yalniz o tarayicida acilir.
- Dosya acik depoda durdugu icin sifre en az 12 karakter, tahmin edilemez olmali.
- Yeni personel eklendikce (kod listesi degisince) yeniden calistirin.
"""
import argparse
import base64
import getpass
import json
import os
import sys

try:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
except ImportError:
    sys.exit("cryptography kutuphanesi gerekli:  python -m pip install cryptography")

ITER = 600000
OUT = os.path.join("data", "personel_adlar.enc.json")


def codes_path(folder):
    for p in (os.path.join(folder, "personel_kodlari.json"), os.path.join("..", "yerel_personel", "personel_kodlari.json")):
        if os.path.exists(p):
            return p
    sys.exit("personel_kodlari.json bulunamadi (%s)" % folder)


def b64(x):
    return base64.b64encode(x).decode("ascii")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--klasor", default="..")
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    src = codes_path(a.klasor)
    with open(src, encoding="utf-8") as f:
        j = json.load(f)
    codes = j.get("codes", j)
    names = {}
    for ad, kod in codes.items():
        if isinstance(kod, str) and kod.startswith("P"):
            names[kod] = " ".join(str(ad).split())
    if not names:
        sys.exit("Kod listesinde kisi yok: " + src)
    pw = getpass.getpass("Sifre (ekranda gorunmez): ")
    if len(pw) < 12:
        print("UYARI: sifre 12 karakterden kisa; acik depoda tahmin edilmesi kolaylasir.")
        if input("Yine de devam edilsin mi? (e/h): ").strip().lower() != "e":
            sys.exit("Iptal edildi.")
    if getpass.getpass("Sifre (tekrar): ") != pw:
        sys.exit("Sifreler ayni degil.")
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pw.encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, json.dumps(names, ensure_ascii=False).encode("utf-8"), None)
    out = {"v": 1, "alg": "AES-GCM", "kdf": "PBKDF2-SHA256", "it": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct), "n": len(names)}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f)
    print("%s yazildi: %d kisi (sifreli). Sifreyi kaybederseniz bu betigi yeni sifreyle tekrar calistirin." % (a.out, len(names)))


if __name__ == "__main__":
    main()
