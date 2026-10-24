#!/usr/bin/env python3
"""Вписывает данные последнего релиза в docs/index.html.

Использование: update-site.py release.json docs/index.html
release.json получается командой: gh release view TAG --json tagName,publishedAt,url,assets
"""
import json, re, sys

rel = json.load(open(sys.argv[1], encoding="utf-8"))
page = sys.argv[2]

assets = [{"name": a["name"], "url": a["url"], "size": a.get("size", 0)} for a in rel.get("assets", [])]

def pick(*patterns):
    for p in patterns:
        for a in assets:
            if re.search(p, a["name"], re.I):
                return {"url": a["url"], "size": a["size"]}
    return None

data = {
    "tag": rel["tagName"],
    "date": rel.get("publishedAt", ""),
    "url": rel["url"],
    "win": pick(r"setup.*\.exe$", r"install.*\.exe$", r"\.exe$"),
    "linux": pick(r"\.AppImage$"),
    "tar": pick(r"linux.*\.tar\.(gz|xz)$"),
    "sums": [{"name": a["name"], "url": a["url"]} for a in assets
             if re.search(r"\.(sig|asc|minisig|sha256|sha512|cer|p7s)$|sha256sums|checksums?", a["name"], re.I)],
}

html = open(page, encoding="utf-8").read()
block = '<!--release:start--><script id="release-data" type="application/json">%s</script><!--release:end-->' % \
        json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
new, n = re.subn(r"<!--release:start-->.*?<!--release:end-->", lambda m: block, html, flags=re.S)
if n != 1:
    sys.exit("маркеры <!--release:start--> / <!--release:end--> не найдены в " + page)
open(page, "w", encoding="utf-8").write(new)
print("Сайт обновлён:", data["tag"], "| win:", bool(data["win"]), "| linux:", bool(data["linux"]), "| tar:", bool(data["tar"]))
