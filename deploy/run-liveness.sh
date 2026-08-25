#!/bin/bash
# career-ops liveness — two-tier: fast HTTP pass, then Camoufox browser-verify
# the URLs the HTTP pass called "live" (catches JS soft-404s). Annotate-only.
set -uo pipefail
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
export CAREER_OPS_ROOT=/Users/nick/apps/career-ops
cd /Users/nick/apps/career-ops-scrape
echo "===== liveness run $(date "+%Y-%m-%d %H:%M:%S") ====="
echo "--- tier 1: HTTP sweep ---"
./venv/bin/python liveness.py sweep --concurrency 12
echo "--- tier 2: browser verify (live set) ---"
/Users/nick/apps/camoufox-venv/bin/python liveness_browser.py verify --concurrency 3
/Users/nick/apps/camoufox-venv/bin/python liveness_browser.py stats
