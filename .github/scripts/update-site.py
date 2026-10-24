#!/usr/bin/env python3
"""Вписывает данные последнего релиза в docs/index.html.

Использование: update-site.py release.json docs/index.html [all-releases.json] [virustotal.json]
virustotal.json (необязательно): результат virustotal.py; если не передан, а на странице уже есть
проверка для того же тега, она сохраняется.
all-releases.json (необязательно): gh api repos/OWNER/REPO/releases --paginate | jq -s add — для счётчика скачиваний
release.json получается командой: gh release view TAG --json tagName,publishedAt,url,assets
"""
import json, os, re, sys

rel = json.load(open(sys.argv[1], encoding="utf-8"))
page = sys.argv[2]

assets = [{"name": a["name"], "url": a["url"], "size": a.get("size", 0)} for a in rel.get("assets", [])]

def pick(*patterns):
    for p in patterns:
        for a in assets:
            if re.search(p, a["name"], re.I):
                return {"url": a["url"], "size": a["size"]}
    return None

def count(rels):
    st = {"total": 0, "win": 0, "lin": 0}
    for r in rels:
        if r.get("draft"):
            continue
        for a in r.get("assets", []):
            c = a.get("download_count", a.get("downloadCount", 0)) or 0
            if re.search(r"\.exe$|win.*\.zip$", a["name"], re.I):
                st["win"] += c; st["total"] += c
            elif re.search(r"\.AppImage$|\.tar\.(gz|xz)$", a["name"], re.I):
                st["lin"] += c; st["total"] += c
    return st

allrels = json.load(open(sys.argv[3], encoding="utf-8")) if len(sys.argv) > 3 else [rel]

data = {
    "tag": rel["tagName"],
    "body": rel.get("body", ""),
    "stats": count(allrels),
    "date": rel.get("publishedAt", ""),
    "url": rel["url"],
    "win": pick(r"setup.*\.exe$", r"install.*\.exe$", r"\.exe$"),
    "linux": pick(r"\.AppImage$"),
    "tar": pick(r"linux.*\.tar\.(gz|xz)$"),
    "sums": [{"name": a["name"], "url": a["url"]} for a in assets
             if re.search(r"\.(sig|asc|minisig|sha256|sha512|cer|p7s)$|sha256sums|checksums?", a["name"], re.I)],
}

html = open(page, encoding="utf-8").read()

vt = None
if len(sys.argv) > 4 and os.path.exists(sys.argv[4]):
    vt = json.load(open(sys.argv[4], encoding="utf-8"))
else:
    m = re.search(r'<!--release:start--><script id="release-data" type="application/json">(.*?)</script>', html, re.S)
    try:
        old = json.loads(m.group(1).replace("<\\/", "</")) if m else {}
    except ValueError:
        old = {}
    if old.get("tag") == data["tag"]:
        vt = old.get("vt")
if vt:
    data["vt"] = vt

block = '<!--release:start--><script id="release-data" type="application/json">%s</script><!--release:end-->' % \
        json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
new, n = re.subn(r"<!--release:start-->.*?<!--release:end-->", lambda m: block, html, flags=re.S)
if n != 1:
    sys.exit("маркеры <!--release:start--> / <!--release:end--> не найдены в " + page)
open(page, "w", encoding="utf-8").write(new)
print("Сайт обновлён:", data["tag"], "| скачиваний:", data["stats"]["total"], "| win:", bool(data["win"]), "| linux:", bool(data["linux"]), "| tar:", bool(data["tar"]), "| virustotal:", len(data.get("vt", [])))
