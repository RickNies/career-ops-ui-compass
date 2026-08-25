#!/usr/bin/env python3
"""liveness_browser.py — BROWSER (Camoufox) liveness verifier.

Renders each job URL in anti-detect Firefox (same stack as scrape.py) and
classifies live/dead/unknown from the LOADED DOM. This catches JS soft-404s the
HTTP probe (liveness.py) misses — e.g. Workday returns HTTP 200 with a 156-char
"the page you are looking for doesn't exist" shell for a filled req.

Two-tier: run AFTER liveness.py (the fast HTTP pass). By default it re-verifies
the URLs the HTTP pass called 'live' (in tracker order, so the TOP/visible jobs
go first), writing method=browser into data/liveness.tsv.

READ / ANNOTATE ONLY — never edits applications.md / pipeline.md.

CLI:
  python liveness_browser.py verify [--limit N] [--concurrency C]
                                    [--include-unknown] [--all] [--url U]
  python liveness_browser.py stats
"""
import argparse
import asyncio
import csv
import os
import re
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import urlparse

from camoufox.async_api import AsyncCamoufox

APP_DIR = os.environ.get("CAREER_OPS_ROOT", "/Users/nick/apps/career-ops")
DATA_DIR = os.path.join(APP_DIR, "data")
APPS_MD = os.path.join(DATA_DIR, "applications.md")
STORE = os.path.join(DATA_DIR, "liveness.tsv")

# Closed / not-found markers seen in RENDERED text (greenhouse/lever/ashby/workday
# + generic soft-404 homepages). Kept specific to avoid false positives.
CLOSED = [
    "no longer accepting application", "no longer accepting applications",
    "this job is no longer available", "this position is no longer available",
    "this job is no longer active", "position has been filled", "the position has been filled",
    "this position has been closed", "this position is closed", "posting is no longer active",
    "this role is no longer available", "opening has been filled", "the opening has been filled",
    "job posting is no longer", "not currently accepting", "no longer open",
    "requisition is closed", "position closed", "job not found", "this job does not exist",
    "the page you are looking for doesn't exist", "the page you're looking for doesn't exist",
    "page you are looking for doesn't exist", "page not found", "page cannot be found",
    "we couldn't find that page", "this page could not be found", "job has expired",
    "posting has expired", "this link is no longer active", "the job you were looking for",
    "no longer exists", "has been removed",
]
APPLY = ["apply for this job", "apply now", "submit application", "apply to this job",
         "start your application", "easy apply", " apply ", "apply on company", "application form"]
BOTWALL = ["verify you are human", "checking your browser", "enable javascript and cookies",
           "just a moment", "attention required", "access denied", "captcha",
           "are you a robot", "cf-browser-verification", "unusual traffic"]
BROWSE_CTA = ["all jobs", "current openings", "search jobs", "search for jobs", "browse jobs",
              "view all jobs", "other jobs", "see all openings", "explore jobs"]


def norm(u):
    return u.split("#")[0].rstrip("/")


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_store():
    d = {}
    if os.path.exists(STORE):
        with open(STORE, encoding="utf-8") as f:
            for row in csv.reader(f, delimiter="\t"):
                if row and row[0] != "url" and len(row) >= 2:
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


def title_map():
    m = {}
    if not os.path.exists(APPS_MD):
        return m
    with open(APPS_MD, encoding="utf-8") as f:
        for line in f:
            if not line.lstrip().startswith("|"):
                continue
            cells = [c.strip() for c in line.split("|")]
            url = None
            for c in cells:
                mm = re.search(r"https?://\S+", c)
                if mm:
                    url = norm(mm.group(0))
                    break
            if url and len(cells) > 4 and cells[4].lower() != "role":
                m[url] = cells[4]
    return m


def has_any(body, arr):
    return any(x in body for x in arr)


def classify(status, final_url, orig_url, body, title):
    if has_any(body, BOTWALL) and len(body) < 4000:
        return "unknown"                       # genuine bot-wall — do NOT mark dead
    if status in (404, 410):
        return "dead"
    if has_any(body, CLOSED):
        return "dead"
    if len(body) < 400 and not has_any(body, APPLY):
        return "dead"                          # soft-404 shell (Workday 156-char case)
    # redirected off the job path onto a bare listing / homepage
    try:
        op = urlparse(orig_url).path.rstrip("/")
        fp = urlparse(final_url).path.rstrip("/")
        last = op.split("/")[-1]
        if fp != op and last and last not in final_url and (len(body) < 1500 or has_any(body, BROWSE_CTA)):
            return "dead"
    except Exception:
        pass
    # tracked title absent AND a browse CTA present → the posting is gone
    if title:
        t = re.sub(r"[^a-z0-9 ]", " ", title.lower())
        t = re.sub(r"\s+", " ", t).strip()
        head = " ".join(t.split()[:3])
        if head and head not in body and has_any(body, BROWSE_CTA) and len(body) < 2500:
            return "dead"
    if has_any(body, APPLY):
        return "live"
    if len(body) > 1500:
        return "live"
    return "unknown"


async def verify_one(browser, url, title, sem):
    async with sem:
        try:
            p = await browser.new_page()
            try:
                r = await p.goto(url, wait_until="domcontentloaded", timeout=30000)
                st = r.status if r else 0
                try:
                    await p.wait_for_load_state("networkidle", timeout=7000)
                except Exception:
                    pass
                await p.wait_for_timeout(1200)
                final = p.url
                try:
                    body = (await p.inner_text("body")).lower()
                except Exception:
                    body = ""
                return url, (classify(st, final, url, body, title), st, len(body))
            finally:
                await p.close()
        except Exception:
            return url, ("unknown", 0, 0)


async def run(urls, titles, concurrency):
    sem = asyncio.Semaphore(concurrency)
    out = {}
    async with AsyncCamoufox(headless=True) as b:
        tasks = [verify_one(b, u, titles.get(u, ""), sem) for u in urls]
        done = 0
        for coro in asyncio.as_completed(tasks):
            u, (state, st, blen) = await coro
            out[u] = {"state": state, "http_status": str(st), "checked_at": now(), "method": "browser"}
            done += 1
            if state == "dead":
                print(f"  DEAD ({st}, {blen}c): {u}", flush=True)
    return out


def select_urls(args, store, titles):
    if args.url:
        return [norm(args.url)]
    order = list(titles.keys())  # tracker order → top/visible jobs first
    want = []
    for u in order:
        s = store.get(u, {}).get("state")
        m = store.get(u, {}).get("method")
        if args.all:
            want.append(u)
        elif s == "live" or s is None or (args.include_unknown and s == "unknown"):
            if m != "browser" or s is None:  # skip already browser-verified unless forced
                want.append(u)
            elif args.all:
                want.append(u)
    return want[:args.limit] if args.limit else want


def main():
    ap = argparse.ArgumentParser(description="browser (Camoufox) liveness verifier")
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify")
    v.add_argument("--limit", type=int, default=0)
    v.add_argument("--concurrency", type=int, default=4)
    v.add_argument("--include-unknown", action="store_true")
    v.add_argument("--all", action="store_true", help="verify every URL regardless of prior state")
    v.add_argument("--url", default=None)
    sub.add_parser("stats")
    a = ap.parse_args()

    store = load_store()
    titles = title_map()
    if a.cmd == "stats":
        c = Counter(v["state"] for v in store.values())
        mm = Counter(v.get("method", "http") for v in store.values())
        print(f"total {len(store)}: live={c.get('live', 0)} dead={c.get('dead', 0)} "
              f"unknown={c.get('unknown', 0)} | methods {dict(mm)} ({STORE})")
        return

    urls = select_urls(a, store, titles)
    if not urls:
        print("nothing to verify")
        return
    print(f"browser-verifying {len(urls)} urls @ concurrency {a.concurrency} …", flush=True)
    res = asyncio.run(run(urls, titles, a.concurrency))
    store.update(res)
    save_store(store)
    c = Counter(v["state"] for v in res.values())
    print(f"browser-verified {len(res)}: live={c.get('live', 0)} dead={c.get('dead', 0)} unknown={c.get('unknown', 0)}")
    gc = Counter(v["state"] for v in store.values())
    print(f"store now: live={gc.get('live', 0)} dead={gc.get('dead', 0)} unknown={gc.get('unknown', 0)} total={len(store)}")


if __name__ == "__main__":
    main()
