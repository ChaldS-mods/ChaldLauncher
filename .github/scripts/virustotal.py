#!/usr/bin/env python3
"""Отправляет файлы релиза на VirusTotal и пишет результат в JSON для сайта.

Использование: virustotal.py OUT.json файл [файл ...]
Ключ API берётся из переменной окружения VT_API_KEY. Без ключа скрипт ничего не делает
(выходит с кодом 0 и не создаёт OUT.json), чтобы сборка не ломалась у форков.

Бесплатный ключ VirusTotal: 4 запроса в минуту, поэтому на 429 скрипт ждёт и повторяет.
Файлы больше 32 МБ грузятся через одноразовый upload_url (лимит VT — 650 МБ).
"""
import hashlib, json, os, sys, time, uuid
import urllib.error, urllib.request

API = "https://www.virustotal.com/api/v3"
KEY = os.environ.get("VT_API_KEY", "").strip()
DIRECT_LIMIT = 32 * 1024 * 1024
DEADLINE = time.time() + 40 * 60  # общий потолок ожидания, чтобы джоб не висел вечно


def call(method, url, data=None, headers=None, tries=6):
    h = {"x-apikey": KEY, "accept": "application/json"}
    h.update(headers or {})
    for i in range(tries):
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(20 * (i + 1))
                continue
            raise RuntimeError("VT %s %s -> HTTP %s: %s" % (method, url, e.code, e.read()[:300]))
        except (urllib.error.URLError, TimeoutError) as e:
            if i < tries - 1:
                time.sleep(10 * (i + 1))
                continue
            raise RuntimeError("VT %s %s -> %s" % (method, url, e))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def upload(path):
    size = os.path.getsize(path)
    url = API + "/files"
    if size > DIRECT_LIMIT:
        url = call("GET", API + "/files/upload_url")["data"]
    boundary = uuid.uuid4().hex
    name = os.path.basename(path).replace('"', "")
    head = ('--%s\r\nContent-Disposition: form-data; name="file"; filename="%s"\r\n'
            'Content-Type: application/octet-stream\r\n\r\n' % (boundary, name)).encode()
    tail = ("\r\n--%s--\r\n" % boundary).encode()
    with open(path, "rb") as f:
        body = head + f.read() + tail
    res = call("POST", url, body, {"content-type": "multipart/form-data; boundary=" + boundary})
    return res["data"]["id"]


def wait(analysis_id):
    while time.time() < DEADLINE:
        a = call("GET", API + "/analyses/" + analysis_id)["data"]["attributes"]
        if a.get("status") == "completed":
            return a
        time.sleep(20)
    raise RuntimeError("VT: анализ %s не завершился вовремя" % analysis_id)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    if not KEY:
        print("VT_API_KEY не задан, проверка VirusTotal пропущена")
        return
    out, files = sys.argv[1], sys.argv[2:]
    results, failed = [], 0
    for path in files:
        name = os.path.basename(path)
        try:
            digest = sha256(path)
            print("Отправляю %s (%s)" % (name, digest[:12]))
            attrs = wait(upload(path))
            st = attrs["stats"]
            malicious, suspicious = st.get("malicious", 0), st.get("suspicious", 0)
            total = malicious + suspicious + st.get("undetected", 0) + st.get("harmless", 0)
            results.append({
                "name": name,
                "sha256": digest,
                "malicious": malicious,
                "suspicious": suspicious,
                "total": total,
                "url": "https://www.virustotal.com/gui/file/" + digest,
                "date": attrs.get("date"),
            })
            print("  %s: %d злонамеренных, %d подозрительных из %d движков" % (name, malicious, suspicious, total))
        except Exception as e:  # один сбойный файл не должен ронять остальные
            failed += 1
            print("  не удалось проверить %s: %s" % (name, e), file=sys.stderr)
    if not results:
        sys.exit("VirusTotal: ни один файл не проверен")
    json.dump(results, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    if failed:
        print("Проверено %d из %d файлов" % (len(results), len(files)), file=sys.stderr)


if __name__ == "__main__":
    main()
