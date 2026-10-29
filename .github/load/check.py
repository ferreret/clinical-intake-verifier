"""Puts the running app under the load of the 2026-10-29 incident, and fails if it gives way.

Two visitors each read a batch of 50 recorded documents at once, polling their batch as the
page does, then open pages of the viewer; a third only polls its session. Fails when a document
fails, a request errs, the third visitor waits more than MAX_WAIT_MS, or the server's log has
SQLITE_BUSY: what the SQLITE_BUSY incident looked like, which no unit test reproduced.

    python3 .github/load/check.py <app's base URL> <server log>
"""

import http.cookiejar
import json
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

MAX_WAIT_MS = 2000
base, log = sys.argv[1], sys.argv[2]


def client():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def call(path, body=None, raw=False):
        headers = {"content-type": "application/json", "x-technician": "T01"}
        data = None if body is None else json.dumps(body).encode()
        reply = opener.open(urllib.request.Request(base + path, data=data, headers=headers), timeout=120).read()
        return reply if raw else json.loads(reply)

    call("/api/session", {"technician": "T01"})
    return call


problems, waits, stop = [], [], threading.Event()


def bystander():
    call = client()
    while not stop.is_set():
        t0 = time.time()
        try:
            call("/api/session")
        except Exception as e:  # noqa: BLE001 - any failure is a finding
            problems.append(f"bystander: {e}")
        waits.append((time.time() - t0) * 1000)
        time.sleep(0.1)


def visitor(i, names):
    call = client()
    batch = call("/api/batches", {"provider": "gemini", "name": f"load {i}", "documents": names})["batch"]["id"]
    while True:
        docs = call(f"/api/batches/{batch}")["documents"]
        if all(d["state"] not in ("queued", "extracting") for d in docs):
            break
        time.sleep(1)
    for d in docs[:5]:
        call(f"/api/documents/{d['id']}/pages/1", raw=True)
    return [d for d in docs if d["state"] != "awaiting_verification"]


names = [d["name"] for d in client()("/api/bundled?provider=gemini")["documents"]]
watcher = threading.Thread(target=bystander, daemon=True)
watcher.start()
t0 = time.time()
try:
    with ThreadPoolExecutor(2) as pool:
        unread = [d for left in pool.map(visitor, [0, 1], [names[:50], names[50:100]]) for d in left]
except Exception as e:  # noqa: BLE001
    problems.append(f"visitor: {e}")
    unread = []
stop.set()
watcher.join()

worst = max(waits, default=0)
busy = open(log, encoding="utf-8", errors="replace").read().count("SQLITE_BUSY")
print(f"100 documents in {time.time() - t0:.0f} s; the bystander waited at most {worst:.0f} ms; SQLITE_BUSY in the log: {busy}")
problems += [f"{d['fileName']} ended {d['state']}: {d.get('error')}" for d in unread]
if worst > MAX_WAIT_MS:
    problems.append(f"the bystander waited {worst:.0f} ms (at most {MAX_WAIT_MS})")
if busy:
    problems.append(f"SQLITE_BUSY {busy} times in the server's log")
for p in problems:
    print(f"FAIL: {p}")
sys.exit(1 if problems else 0)
