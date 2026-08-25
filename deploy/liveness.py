#!/usr/bin/env python3
"""liveness.py — probe job-posting URLs for dead / closed listings.

READ / ANNOTATE ONLY. Reads the job URLs out of the tracker (applications.md),
probes each one (follow redirects, ~8s timeout, capped concurrency since there
are ~1000), classifies live / dead / unknown, and writes a merge store:

    data/liveness.tsv:   url \t state \t http_status \t checked_at

DEAD  = HTTP 404/410, OR a closed-listing marker in the body (greenhouse /
        lever / ashby / workday patterns) even on an HTTP 200.
UNKNOWN = timeout / connection error / 401 / 403 / 5xx (could be a bot-block,
        NOT necessarily dead) — never marked dead.
LIVE  = 2xx/3xx with no closed marker.

It NEVER edits applications.md / pipeline.md — the UI does the hiding.

CLI:
    python liveness.py sweep [--limit N] [--concurrency C] [--only-unchecked]
    python liveness.py stats
"""
import argparse
import csv
import os
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests

APP_DIR = os.environ.get("CAREER_OPS_ROOT", "/Users/nick/apps/career-ops")
DATA_DIR = os.path.join(APP_DIR, "data")
APPS_MD = os.path.join(DATA_DIR, "applications.md")
STORE = os.path.join(DATA_DIR, "liveness.tsv")
UA = "Mozilla/5.0 (career-ops liveness bot) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
TIMEOUT = 8

# Closed-listing body markers (checked case-insensitively on <400 responses).
# Kept conservative to avoid false positives on live pages.
DEAD_MARKERS = [
    "no longer accepting applications",
    "no longer accepting application",
    "this job is no longer available",
    "this position is no longer available",
    "this job is no longer active",
    "this position has been filled",
    "the position has been filled",
    "this position has been closed",
    "this job posting is no longer active",
    "job posting is no longer available",
    "posting is no longer active",
    "this role is no longer available",
    "the job you are looking for is no longer",
    "this job is no longer open",
    "requisition is closed",
    "this requisition is closed",
    "position closed",
    "job not found",
    "this job does not exist",
    "the job you were looking for",
]


def norm(u):
    return u.split("#")[0].rstrip("/")


def extract_urls():
    urls = []
    if not os.path.exists(APPS_MD):
        return urls
    with open(APPS_MD, encoding="utf-8") as f:
        for line in f:
            if not line.lstrip().startswith("|"):
                continue
            for u in re.findall(r"https?://[^\s|)\]]+", line):
                urls.append(norm(u))
    seen, out = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def load_store():
    d = {}
    if os.path.exists(STORE):
        with open(STORE, encoding="utf-8") as f:
            for row in csv.reader(f, delimiter="\t"):
                if len(row) >= 2 and row[0] != "url":
                    d[row[0]] = {
                        "state": row[1],
                        "http_status": row[2] if len(row) > 2 else "",
                        "checked_at": row[3] if len(row) > 3 else "",
                        "method": row[4] if len(row) > 4 else "http",
                    }
    return d


def save_store(d):
    tmp = STORE + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["url", "state", "http_status", "checked_at", "method"])
        for u, v in sorted(d.items()):
            w.writerow([u, v["state"], v.get("http_status", ""), v.get("checked_at", ""), v.get("method", "http")])
    os.replace(tmp, STORE)


def probe(url):
    try:
        r = requests.get(url, timeout=TIMEOUT, allow_redirects=True,
                         headers={"User-Agent": UA})
        st = r.status_code
        if st in (404, 410):
            return ("dead", st)
        if st < 400:
            body = (r.text or "")[:200000].lower()
            for m in DEAD_MARKERS:
                if m in body:
                    return ("dead", st)
            return ("live", st)
        # 401 / 403 / 5xx → could be a bot-block, not necessarily dead
        return ("unknown", st)
    except requests.RequestException:
        return ("unknown", 0)


def sweep(limit, concurrency, only_unchecked):
    urls = extract_urls()
    store = load_store()
    if only_unchecked:
        urls = [u for u in urls if u not in store]
    if limit:
        urls = urls[:limit]
    if not urls:
        print("no urls to probe")
        return
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    results = {}
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futs = {ex.submit(probe, u): u for u in urls}
        for fut in as_completed(futs):
            u = futs[fut]
            try:
                state, st = fut.result()
            except Exception:
                state, st = ("unknown", 0)
            results[u] = {"state": state, "http_status": str(st), "checked_at": now, "method": "http"}
    store.update(results)
    save_store(store)
    c = Counter(v["state"] for v in results.values())
    print(f"swept {len(results)} urls @ concurrency {concurrency}: "
          f"live={c.get('live', 0)} dead={c.get('dead', 0)} unknown={c.get('unknown', 0)}")
    print(f"store now has {len(store)} urls total -> {STORE}")
    dead_urls = [u for u, v in results.items() if v["state"] == "dead"]
    for u in dead_urls[:15]:
        print("  DEAD:", results[u]["http_status"], u)


def stats():
    store = load_store()
    c = Counter(v["state"] for v in store.values())
    print(f"total {len(store)}: live={c.get('live', 0)} dead={c.get('dead', 0)} "
          f"unknown={c.get('unknown', 0)}  ({STORE})")


def main():
    ap = argparse.ArgumentParser(description="probe job URLs for dead/closed listings")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sweep", help="probe URLs and update the store")
    s.add_argument("--limit", type=int, default=0, help="cap number of URLs (0 = all)")
    s.add_argument("--concurrency", type=int, default=12)
    s.add_argument("--only-unchecked", action="store_true", help="skip URLs already in the store")
    sub.add_parser("stats", help="print store counts")
    a = ap.parse_args()
    if a.cmd == "sweep":
        sweep(a.limit, a.concurrency, a.only_unchecked)
    elif a.cmd == "stats":
        stats()


if __name__ == "__main__":
    main()
