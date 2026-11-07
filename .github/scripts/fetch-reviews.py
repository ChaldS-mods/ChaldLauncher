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
from datetime import datetime

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


SEP = r"\s*[:：=—–-]?\s*"
LBL_R = r"оценка|ацэнка|оцінка|рейтинг|балл|rating|score"
LBL_P = r"(?:платформа|platform)\b" + SEP + r"|(?:ос|os|система)\s*[:：=—–-]\s*"
LBL_T = r"текст|тэкст|отзыв|адгук|відгук|мнение|комментарий|коммент|text|review|comment"
BULLET = re.compile(r"^(?:[>\-–•▸·*]+\s*|\d+[.)]\s+(?=[^\d\s]))+")
STARS = "⭐★"


def parse(c):
    """Отзыв = несколько строк с ключевыми словами в любом порядке и в любом регистре:
    «Оценка», «Платформа», «Текст» (или «Отзыв»). Двоеточие необязательно, допустимы маркеры списка
    («-», «•», «1.»), жирный шрифт и «4,5/5», «4.5 из 5», «⭐⭐⭐⭐». Если метки «Текст» нет,
    текстом считаются строки без меток. Язык отзыва не проверяется."""
    c = c.replace("**", "").replace("__", "").replace("`", "")
    r = p = tl = None
    free = []
    for line in c.split("\n"):
        ln = BULLET.sub("", line.strip()).strip()
        if not ln:
            continue
        mr = re.match(r"(?:%s)\b%s(.*)$" % (LBL_R, SEP), ln, re.I)
        mp = re.match(r"(?:%s)(.+)$" % LBL_P, ln, re.I)
        mt = re.match(r"(?:%s)\b%s(.*)$" % (LBL_T, SEP), ln, re.I)
        if mr and r is None:
            rest = mr.group(1)
            mn = re.match(r"(\d+(?:[.,]\d+)?)", rest)
            if mn:
                r = float(mn.group(1).replace(",", "."))
            elif any(ch in rest for ch in STARS):
                r = float(sum(rest.count(ch) for ch in STARS))
            else:
                free.append(ln)  # слово «оценка» в обычном тексте
        elif mp and p is None:
            p = platform(mp.group(1))
        elif mt and tl is None:
            tl = [mt.group(1)]
        elif tl is not None:
            tl.append(ln)
        else:
            free.append(ln)
    t = clean(" ".join(x for x in (tl if tl is not None else free) if x))
    if r is None or not p or not (0.5 <= r <= 5) or len(t) < 3:
        return None
    return round(r, 1), p, t


try:  # диагностика: чей это токен и включён ли Message Content Intent у приложения
    app, bot = get(API + "/applications/@me"), get(API + "/users/@me")
    print("Токен принадлежит боту %s (id %s), приложение «%s», Message Content Intent включён: %s" % (
        bot.get("username"), bot.get("id"), app.get("name"), bool((app.get("flags") or 0) & ((1 << 18) | (1 << 19)))))
except SystemExit as e:
    print("Диагностика токена не удалась:", e)

msgs, before = [], None
for _ in range(MAX_PAGES):
    batch = get("%s/channels/%s/messages?limit=100%s" % (API, CHANNEL, "&before=" + before if before else ""))
    msgs += batch
    if len(batch) < 100:
        break
    before = batch[-1]["id"]

for m in msgs[:10]:  # диагностика: без текста сообщений
    a = m.get("author", {})
    print("msg type=%s bot=%s content_len=%d embeds=%d attachments=%d" % (
        m.get("type"), bool(a.get("bot")), len(m.get("content") or ""),
        len(m.get("embeds") or []), len(m.get("attachments") or [])))
humans = [m for m in msgs if not m.get("author", {}).get("bot") and m.get("type") in (0, 19)]
if humans and not any((m.get("content") or "").strip() for m in humans):
    print("::warning::У обычных сообщений пустой текст: проверь MESSAGE CONTENT INTENT у бота, "
          "либо в сообщениях только вложения/embed")

GAP = 300  # Enter в Discord отправляет сообщение, поэтому строки одного автора ближе 5 минут склеиваются
ts = lambda m: datetime.fromisoformat(m["timestamp"]).timestamp()
groups = {}  # автор -> группы сообщений от старых к новым
for m in reversed(msgs):  # Discord отдаёт от новых к старым
    a = m.get("author", {})
    c = (m.get("content") or "").strip()
    if a.get("bot") or m.get("type") not in (0, 19) or not c:
        continue
    t, name, d = ts(m), a.get("global_name") or a.get("username") or "", m["timestamp"][:10]
    gl = groups.setdefault(a.get("id"), [])
    if gl and parse(c) is None and t - gl[-1]["last"] <= GAP:
        gl[-1]["parts"].append(c)
        gl[-1].update(last=t, name=name, d=d)
    else:  # полный отзыв в одном сообщении всегда начинает новую группу
        gl.append({"parts": [c], "last": t, "name": name, "d": d})
found = []
for gl in groups.values():  # от автора берём последнюю группу, которая разбирается как отзыв
    for g in reversed(gl):
        rv = parse("\n".join(g["parts"]))
        if rv:
            e = {"r": rv[0], "p": rv[1], "t": rv[2], "d": g["d"]}
            if SHOW_AUTHOR:
                e["a"] = clean(g["name"])[:32]
            found.append((g["last"], e))
            break
out = [e for _, e in sorted(found, key=lambda x: -x[0])]

block = '<!--reviews:start--><script id="reviews-data" type="application/json">%s</script><!--reviews:end-->' % \
        json.dumps(out, ensure_ascii=False).replace("</", "<\\/")
html = open(page, encoding="utf-8").read()
new, n = re.subn(r"<!--reviews:start-->.*?<!--reviews:end-->", lambda m: block, html, flags=re.S)
if n != 1:
    sys.exit("маркеры <!--reviews:start--> / <!--reviews:end--> не найдены в " + page)
if new != html:
    open(page, "w", encoding="utf-8").write(new)
print("Отзывов на сайте:", len(out), "| сообщений прочитано:", len(msgs), "| изменено:", new != html)
