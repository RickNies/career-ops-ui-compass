# Compass — Career-Ops Job Search · Build Handoff

_Last updated: 2026-08-25. This is a self-contained pickup doc so another agent (or Nick) can resume. Private tooling — do not expose CV/data publicly._

## What this is
A self-hosted job-search app for **Nicole Doan, CPA** (media/content finance leader — FP&A / Strategic Finance, Director/Sr-Manager level, NYC, comp floor $150K). It's a **fork of Fighter90/career-ops-ui** with a friendly "Compass" UI layered on top, running on Nick's **Mac Studio** over Tailscale. Compass is a *complement* to the original app — it reuses the original's endpoints for all real work and adds only what the original lacked. **Retain-everything rule:** the merge must keep all ~38 original views.

## Architecture — two instances running side by side
- **Original (untouched, comparison):** `https://studio.tailf8abd3.ts.net:8099/` — launchd `com.nick.career-ops-ui`, code `/Users/nick/apps/career-ops/web-ui`, unmodified upstream v1.213.
- **Compass fork (active):** `https://studio.tailf8abd3.ts.net:8100/` → `/compass/dashboard.html` — launchd `com.nick.career-ops-compass`, code `/Users/nick/apps/career-ops-compass/web-ui`. The full original SPA is still reachable at `/spa` (all 38 views retained).
- **Data root:** the compass instance uses env `CAREER_OPS_ROOT=/Users/nick/apps/career-ops`, so BOTH instances share the SAME real data (.env, portals.yml, data/, cv.md). Writes from Compass affect the live stores.
- **Providers (via original #/config → .env):** Hermes = local Ollama `qwen3.6:latest` (free, default); Anthropic `claude-sonnet-5`; OpenAI `gpt-5`. Switchable in Compass Setup (native) or #/config.
- **Fork git:** compass code = `RickNies/career-ops-ui-compass` branch `compass` (pushed from the Studio). Infra/data mirror = `RickNies/career-ops-ui` (local checkout `~/Documents/repos/jobsearch`: scraper/, career-ops-data/, deploy/, mockups/).

## Access (SSH is ephemeral per session)
- SSH key is regenerated + re-authorized EACH session: `ssh-keygen -t ed25519 -f ~/.ssh/studio_key -N "" -C claude-sandbox-<date>`; Nick appends the pubkey to the Studio `~/.ssh/authorized_keys`; `ssh-keyscan -t ed25519 studio.tailf8abd3.ts.net >> ~/.ssh/known_hosts`.
- Command shape: `ssh -i ~/.ssh/studio_key -o IdentitiesOnly=yes -o BatchMode=yes nick@studio.tailf8abd3.ts.net '<cmd>'`, prefix remote cmds with `export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH`. Ollama at `127.0.0.1:11434`, tailscale CLI `/opt/homebrew/opt/tailscale/bin/tailscale`.

## Data stores (`/Users/nick/apps/career-ops/data/`, shared by both instances)
- `applications.md` — the tracker table (~878 rows after off-target cleanup): `# | Date | Company | Role | Location | Score | Status | URL | Report | Notes`. Score column now = fit/20 (/5 proportion) for scored rows.
- `pipeline.md` — job-URL inbox (fenced block).
- `fit-analysis.jsonl` — AI fit scores, keyed by url: `{url, score 0-100, verdict Strong|Good|Fair|Pass, why, strengths[], gaps[]}` (91 scored so far).
- `salary.jsonl` — extracted comp: `{url, salary_min, salary_max (K), currency, period, source jd|ats}` (57 so far).
- `liveness.tsv` — dead-link ledger: `url, state(live|dead|unknown), http_status, checked_at, method(http|browser)`. Sticky-dead.
- `feedback.jsonl` — enriched good/bad review store (label + job features + JD + AI eval) for future preference modeling.
- `compass-jobs.jsonl` + `compass-artifacts/<id>.md` — async generation jobs + their outputs.
- `scan-history.tsv`, `scrape-found.jsonl` — dedup + audit for discovery.
- `portals.yml` (parent dir) — SINGLE SOURCE OF TRUTH: `title_filter` (47 negatives after cleanup), `location_filter`, `tracked_companies` (~70), `discovery` (google_hosts/keyword_groups/google_locations, linkedin_keywords/pages).

## Cron schedule (launchd, Studio)
- `com.nick.career-ops-scan` — daily 07:00 (ATS scan of tracked_companies)
- `com.nick.career-ops-scrape` — daily 07:30 (Camoufox: builtin/cryptojobslist/dailyremote)
- `com.nick.career-ops-discover` — **Wed+Sun** 08:00 (Google `site:` discovery)
- `com.nick.career-ops-linkedin` — **Wed+Sun** 08:30 (LinkedIn guest API)
- `com.nick.career-ops-liveness` — daily 06:30 (two-tier: HTTP prefilter → Camoufox browser-verify, sticky-dead)
- `com.nick.career-ops-fitscore` — daily 09:00 (auto-score new ATS jobs on the LOCAL model = free)

## Scripts (`/Users/nick/apps/career-ops-scrape/`, mirrored to repo `scraper/`)
discover.py, linkedin.py, scrape.py (all read portals.yml discovery), filters.py, dedup.py (cross-source company+title dedup + salary parse), liveness.py + liveness_browser.py + run-liveness.sh (browser dead-link, sticky-dead), salary.py (JD→salary.jsonl), fit_score.py + run-fitscore.sh (auto-scorer), write_settings.py (comment-preserving portals.yml writer, backup+validate+auto-restore), feedback.py (enriched review store).

## What's built (compass fork commits, most recent last)
- Fork + 2nd instance on :8100; original untouched.
- Full **Setup migration** into Compass (config/portals/profile/cv/memory/health/usage/help/docs) via the same endpoints; companies-to-watch saves with source keys.
- Backend: portals.yml single-source-of-truth; feedback store; cross-source dedup + salary-unknown flag; **browser liveness (sticky-dead)**; portals writeback.
- **Async job layer** (`/api/compass/generate` + jobs) — generations run server-side, survive nav/restart; **Tasks page** + header activity badge; **global completion toasts** (cross-page, localStorage dedupe); **Cancel** endpoint (aborts in-flight).
- **Library workspace** — rich md render, per-artifact **inline accordions**, **version switcher (v1/v2)**, per-section Copy "Copied ✓", Edit, downloads (.docx/.md), **evaluation summary box (score/100 + verdict pill + why)**, "View job detail" per card, grouped by job (Application materials / Evaluation).
- **Documents/cover** — cover now uses the real cover endpoint (`/api/mode/cover`), not the résumé generator; versioned + rich.
- **Jobs feed** — dual card buttons (View internal / View posting↗), fit **/100 score + colored verdict pill + "why it fits"** + strengths/gaps, **sort=best** by fit; nav consistent + header pixel-stable (1320px).
- **Saved/My Jobs** — real application-stage rows only, empty state, non-destructive **Remove** (resets to Scanned).
- **Model fixes:** Anthropic `max_tokens` 8192→16384/cap32000 (sonnet-5 extended thinking); OpenAI `max_completion_tokens` for gpt-5/o-series (conditional on api.openai.com so Ollama/OpenRouter unaffected).
- **Off-target cleanup:** tracker 1030→878 (cut sales/data-eng/controller/accounting/eng); title_filter negatives 25→47.
- **AI fit analysis batch 1:** 91 ATS jobs scored /100 via in-session Sonnet subagents (free — no app API cost). Distribution 6 Strong / 22 Good / 12 Fair / 51 Pass. Top: Tlatech 87, Trace3 85, Abnormal 84, Kalshi/OpenAI 82, Polymarket 80. Wired to cards + /5 on :8099.
- **Salary + auto-scorer backend** (this session): salary.py → salary.jsonl (57), fit_score.py + fitscore cron (daily 9:00, local model).

## In flight / pending (pick up here)
1. **Liveness sweep** — restarted detached (`nohup`, was 375/854, 47 dead); check `/tmp/liveness-resume.log` + `data/liveness.tsv` for final counts.
2. **Salary filter + "still open" badge UI** — NOT done yet (agent hit transient rate-limits twice). Retry: wire jobs-feed salary slider + Setup comp floor to `salary.jsonl` (unknown salary PASSES THROUGH, flagged, never dropped); wire card badge to liveness (live→green "Open", unknown→"Unverified", dead already hidden).
3. **Remaining ~700 fit scores** — only ATS-reachable (91) are scored. Workday/builtin/LinkedIn/WTTJ jobs need **browser JD fetch** (Camoufox) → then score (same Sonnet-subagent or local-model path). Do after the liveness sweep frees the browser. Prep pattern: fetch JDs → fit-input.jsonl → 5 chunk files → parallel `model:sonnet` general-purpose subagents → aggregate → fit-analysis.jsonl → sync.

## Roadmap (not started, priority order)
- **Email digest** of new matches (highest real-world value for a non-technical user).
- Follow-up reminders; application funnel/outcome stats.
- Onboarding (Tailscale on Nicole's devices); promote :8100 to primary + retire :8099; make `OLLAMA_KEEP_ALIVE` permanent across reboot.

## Known issues & gotchas
- **Sandbox loses SSH + GitHub-push auth on session reset** — re-auth SSH (above); push the infra repo (`jobsearch`) from Nick's Mac or re-auth git. The **Studio** retains push auth for the compass fork.
- `write_settings.py` replaces list sections WHOLESALE — a UI save must POST the FULL list (esp. tracked_companies) or it wipes them.
- Companies-to-watch entries need a source key (careers_url/api/provider) or they're skipped.
- Two newer-model token-param bugs already fixed (see Model fixes) — expect the same class if adding models.

## How to pick up
1. Re-auth SSH to the Studio. 2. Read this doc + confirm both instances (`curl 127.0.0.1:8100/api/health`, `:8099`). 3. Check the in-flight items above. 4. Compass agent for UI work commits to `RickNies/career-ops-ui-compass@compass` from the Studio checkout; scraper/data changes live on the Studio + mirror to `jobsearch`.
