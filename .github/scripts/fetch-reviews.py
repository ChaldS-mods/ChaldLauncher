#!/usr/bin/env python3
"""Читает отзывы из канала Discord и вписывает их в docs/index.html.

Использование: fetch-reviews.py docs/index.html
Окружение: DISCORD_BOT_TOKEN (обязательно; без него скрипт ничего не делает и выходит с кодом 0),
           REVIEWS_CHANNEL_ID (по умолчанию канал отзывов), REVIEWS_SHOW_AUTHOR=0 — не показывать ник.

Шаблон сообщения:
  Оценка: 4.5
  Платформа: Windows
  Текст: Удобно ставить моды с Modrinth, интерфейс приятный.

Источник правды — канал: удалил сообщение в Discord, и отзыв пропадёт с сайта при следующей проверке.
От одного автора берётся только последний корректный отзыв. Сообщения ботов игнорируются.
"""
import json, os, re, sys, time
import urllib.error, urllib.request

API = "https://discord.com/api/v10"
TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
CHANNEL = os.environ.get("REVIEWS_CHANNEL_ID", "1563873955759267871").strip()
SHOW_AUTHOR = os.environ.get("REVIEWS_SHOW_AUTHOR", "1") != "0"
MAX_PAGES, MAX_TEXT = 5, 400  # до 500 последних сообщений
page = sys.argv[1]

if not TOKEN:
    print("DISCORD_BOT_TOKEN не задан, пропускаю")
    sys.exit(0)


def get(url, tries=4):
    for i in range(tries):
        req = urllib.request.Request(url, headers={
            "Authorization": "Bot " + TOKEN,
            "User-Agent": "DiscordBot (https://github.com/ChaldS-mods/ChaldLauncher, 1.0)"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read()[:300]
            if e.code == 429 and i < tries - 1:
                try:
                    wait = float(json.loads(body).get("retry_after", 2))
                except Exception:
                    wait = 2
                time.sleep(min(wait, 30) + 0.5)
                continue
            if e.code >= 500 and i < tries - 1:
                time.sleep(3 * (i + 1))
                continue
            hint = {401: "неверный токен бота", 404: "канал не найден",
                    403: "у бота нет доступа к каналу (нужны View Channel и Read Message History)"}.get(e.code, "")
            sys.exit("Discord HTTP %s %s %s" % (e.code, hint, body))
        except urllib.error.URLError as e:
            if i < tries - 1:
                time.sleep(3 * (i + 1))
                continue
            sys.exit("Discord: %s" % e)


PLAT = [(r"win|вин", "Windows"), (r"lin|лин|ubuntu|debian|arch", "Linux"), (r"mac|мак", "macOS")]


def platform(s):
    s = re.sub(r"\s+", " ", s).strip()
    for rx, name in PLAT:
        if re.search(rx, s, re.I):
            return name
    return (s[:1].upper() + s[1:])[:20]


def clean(s):
    s = re.sub(r"<a?:\w+:\d+>|<(?:@[!&]?|#)\d+>|@(?:everyone|here)", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= MAX_TEXT else s[:MAX_TEXT - 1].rstrip() + "…"


def parse(c):
    c = c.replace("**", "").replace("__", "")
    mr = re.search(r"^\s*(?:оценка|rating)\s*[:：]\s*(\d+(?:[.,]\d+)?)(?:\s*/\s*5)?\s*$", c, re.I | re.M)
    mp = re.search(r"^\s*(?:платформа|platform)\s*[:：]\s*(.+?)\s*$", c, re.I | re.M)
    mt = re.search(r"^\s*(?:текст|отзыв|text|review)\s*[:：]\s*(.+)", c, re.I | re.M | re.S)
    if not (mr and mp and mt):
        return None
    r = float(mr.group(1).replace(",", "."))
    t, p = clean(mt.group(1)), platform(mp.group(1))
    if not (0.5 <= r <= 5) or len(t) < 3 or not p:
        return None
    return round(r, 1), p, t


msgs, before = [], None
for _ in range(MAX_PAGES):
    batch = get("%s/channels/%s/messages?limit=100%s" % (API, CHANNEL, "&before=" + before if before else ""))
    msgs += batch
    if len(batch) < 100:
        break
    before = batch[-1]["id"]

humans = [m for m in msgs if not m.get("author", {}).get("bot")]
if humans and not any((m.get("content") or "").strip() for m in humans):
    print("::warning::Тексты сообщений пустые: включи MESSAGE CONTENT INTENT у бота (Developer Portal -> Bot)")

seen, out = set(), []
for m in msgs:  # Discord отдаёт от новых к старым
    a = m.get("author", {})
    if a.get("bot") or m.get("type") not in (0, 19) or a.get("id") in seen:
        continue
    rv = parse(m.get("content") or "")
    if not rv:
        continue
    seen.add(a.get("id"))
    e = {"r": rv[0], "p": rv[1], "t": rv[2], "d": (m.get("timestamp") or "")[:10]}
    if SHOW_AUTHOR:
        e["a"] = clean(a.get("global_name") or a.get("username") or "")[:32]
    out.append(e)

block = '<!--reviews:start--><script id="reviews-data" type="application/json">%s</script><!--reviews:end-->' % \
        json.dumps(out, ensure_ascii=False).replace("</", "<\\/")
html = open(page, encoding="utf-8").read()
new, n = re.subn(r"<!--reviews:start-->.*?<!--reviews:end-->", lambda m: block, html, flags=re.S)
if n != 1:
    sys.exit("маркеры <!--reviews:start--> / <!--reviews:end--> не найдены в " + page)
if new != html:
    open(page, "w", encoding="utf-8").write(new)
print("Отзывов на сайте:", len(out), "| сообщений прочитано:", len(msgs), "| изменено:", new != html)
