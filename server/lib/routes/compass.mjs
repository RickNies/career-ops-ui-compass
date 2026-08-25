/**
 * COMPASS FORK — extra routes for the simplified "Compass" UI served by the
 * :8100 (career-ops-compass) instance ONLY. Not part of upstream.
 *
 * Static Compass mockups live in public/compass/*.html (served by the
 * existing express.static). This module adds the small server surface the
 * wired flows need:
 *
 *   POST /api/compass/feedback  → shells out to the shared feedback.py
 *       (feedback.py add <url> <good|bad> --no-eval) so verdicts persist to the
 *       REAL data/feedback.jsonl — the same store the original :8099 uses.
 *
 *   POST /api/compass/setup     → shells out to the shared write_settings.py
 *       (comment-preserving ruamel writer + validate-portals.mjs) targeting the
 *       REAL portals.yml. LLM/provider + Anthropic key are NOT here — the
 *       Compass Setup page links to the full settings view (/spa#/config), which
 *       POSTs /api/config and writes this instance's .env.
 *
 *   GET  /compass               → 302 to /compass/dashboard.html (landing).
 *
 * LIVE-ON-REAL-DATA: this :8100 instance is repointed at /Users/nick/apps/
 * career-ops via CAREER_OPS_ROOT (plist), so its reads AND writes hit the same
 * real stores as :8099. "Companies to watch" is still withheld from the setup
 * writer (mockup entries lack a source key → would wipe tracked_companies).
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const VENV_PY = '/Users/nick/apps/career-ops-scrape/venv/bin/python';
const WRITE_SETTINGS = '/Users/nick/apps/career-ops-scrape/write_settings.py';
// LIVE ON REAL DATA — this :8100 instance is repointed at the real career-ops
// tree via CAREER_OPS_ROOT in its plist, so feedback + portals writes hit the
// SAME stores the original :8099 instance uses. We therefore reuse the original
// (unmodified) tools whose defaults already target the real tree.
const DATA_ROOT = process.env.CAREER_OPS_ROOT || '/Users/nick/apps/career-ops';
const FEEDBACK_PY = '/Users/nick/apps/career-ops-scrape/feedback.py'; // APP_DIR = real career-ops
const SCRAPE_DIR = '/Users/nick/apps/career-ops-scrape';
const REAL_PORTALS = DATA_ROOT + '/portals.yml';
const REAL_FEEDBACK_JSONL = DATA_ROOT + '/data/feedback.jsonl';
const REAL_APPS_MD = DATA_ROOT + '/data/applications.md';
const LIVENESS_STORE = DATA_ROOT + '/data/liveness.tsv';
const LIVENESS_PY = SCRAPE_DIR + '/liveness.py';

// launchd starts this server with a minimal PATH, so a spawned Python subprocess
// (write_settings.py) can't find `node` for its validate-portals.mjs step. Give
// every subprocess a PATH that includes Homebrew + /usr/local so `node` resolves.
const SUBPROC_ENV = Object.assign({}, process.env, {
  PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || ''),
});

export function registerCompassRoutes(app) {
  // Landing: bare /compass → dashboard.
  app.get('/compass', (_req, res) => res.redirect(302, '/compass/dashboard.html'));

  // ── Good/Bad verdict → persist server-side via the compass feedback tool ──
  app.post('/api/compass/feedback', (req, res) => {
    const body = req.body || {};
    const url = String(body.url || '').trim();
    const verdict = String(body.verdict || '').trim();
    const reason = body.reason != null ? String(body.reason).slice(0, 120) : '';
    if (!url || (verdict !== 'good' && verdict !== 'bad')) {
      return res.status(400).json({ error: 'url and verdict (good|bad) required' });
    }
    const args = [FEEDBACK_PY, 'add', url, verdict, '--no-eval'];
    if (reason) args.push('--reason', reason);
    execFile(VENV_PY, args, { timeout: 90000, cwd: SCRAPE_DIR, env: SUBPROC_ENV }, (err, stdout, stderr) => {
      let lastLine = null;
      try {
        const lines = readFileSync(REAL_FEEDBACK_JSONL, 'utf8').trim().split(/\n/);
        const raw = lines[lines.length - 1];
        lastLine = raw ? JSON.parse(raw) : null;
      } catch { /* ignore */ }
      if (err) {
        return res.status(500).json({
          error: 'feedback failed',
          details: String(stderr || err.message || '').slice(0, 600),
          lastLine,
        });
      }
      res.json({ ok: true, stdout: String(stdout || '').slice(0, 600), lastLine });
    });
  });

  // ── Setup Save → portals.yml (this instance's copy) via write_settings.py ──
  app.post('/api/compass/setup', (req, res) => {
    const settings = req.body && req.body.settings;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings object required' });
    }
    const args = [
      WRITE_SETTINGS,
      '--json', JSON.stringify(settings),
      '--path', REAL_PORTALS,
      '--validator-dir', DATA_ROOT,
    ];
    execFile(VENV_PY, args, { timeout: 60000, env: SUBPROC_ENV }, (err, stdout, stderr) => {
      if (err) {
        return res.status(500).json({
          error: 'write_settings failed',
          details: String(stderr || err.message || '').slice(0, 1000),
        });
      }
      res.json({ ok: true, output: String(stdout || '').slice(0, 2000) });
    });
  });

  // ── Liveness: read the annotate-only store (url → live|dead|unknown) ──
  app.get('/api/compass/liveness', (_req, res) => {
    const map = {};
    const counts = { live: 0, dead: 0, unknown: 0, total: 0 };
    try {
      const lines = readFileSync(LIVENESS_STORE, 'utf8').trim().split(/\r?\n/);
      for (const line of lines) {
        const c = line.split('\t');
        if (c.length >= 2 && c[0] && c[0] !== 'url') {
          map[c[0]] = c[1];
          if (counts[c[1]] === undefined) counts[c[1]] = 0;
          counts[c[1]]++; counts.total++;
        }
      }
    } catch { /* no store yet → empty map, UI shows everything */ }
    res.json({ map, counts, store: LIVENESS_STORE });
  });

  // ── Liveness: trigger a bounded sweep (default 100 URLs). The daily launchd
  //    agent (com.nick.career-ops-liveness) does the full staggered sweep. ──
  app.post('/api/compass/liveness/refresh', (req, res) => {
    const raw = parseInt((req.body && req.body.limit) || 100, 10);
    const limit = Math.min(1030, Math.max(1, isNaN(raw) ? 100 : raw));
    execFile(VENV_PY, [LIVENESS_PY, 'sweep', '--limit', String(limit), '--concurrency', '12'],
      { timeout: 300000, env: SUBPROC_ENV }, (err, stdout, stderr) => {
        if (err) return res.status(500).json({ error: 'liveness sweep failed', details: String(stderr || err.message || '').slice(0, 800) });
        res.json({ ok: true, output: String(stdout || '').slice(0, 800) });
      });
  });

  // ── Tracker STATUS update (the app itself only appends). Finds the row in
  //    applications.md by num (preferred) or url and rewrites its Status cell
  //    in place: backup → atomic temp-write → rename. Table format preserved;
  //    Status/URL columns are before Notes so escaped pipes in Notes are safe. ──
  app.post('/api/compass/tracker/status', (req, res) => {
    const body = req.body || {};
    const status = String(body.status || '').replace(/[\r\n|]/g, ' ').trim();
    if (!status) return res.status(400).json({ error: 'status required' });
    const num = body.num != null && String(body.num).trim() !== '' ? String(body.num).trim() : null;
    const url = body.url != null && String(body.url).trim() !== '' ? String(body.url).trim() : null;
    if (!num && !url) return res.status(400).json({ error: 'num or url required' });
    try {
      const content = readFileSync(REAL_APPS_MD, 'utf8');
      const lines = content.split(/\r?\n/);
      let hi = -1, cols = null;
      for (let i = 0; i < lines.length; i++) {
        if (/^\|\s*#\s*\|/.test(lines[i])) { hi = i; cols = lines[i].split('|').map((s) => s.trim()); break; }
      }
      if (hi < 0 || !cols) return res.status(500).json({ error: 'tracker table header not found' });
      const idxStatus = cols.findIndex((c) => /^status$/i.test(c));
      const idxNum = cols.findIndex((c) => /^#$/.test(c));
      const idxUrl = cols.findIndex((c) => /^url$/i.test(c));
      if (idxStatus < 0) return res.status(500).json({ error: 'Status column not found in tracker' });
      let target = -1, beforeLine = null;
      for (let i = hi + 2; i < lines.length; i++) {
        if (!/^\|/.test(lines[i])) continue;
        const cells = lines[i].split('|');
        const numCell = idxNum >= 0 ? (cells[idxNum] || '').trim() : '';
        const urlCell = idxUrl >= 0 ? (cells[idxUrl] || '') : '';
        const matchNum = num && numCell === num;
        const matchUrl = url && (urlCell.trim() === url || urlCell.indexOf(url) >= 0);
        if (matchNum || matchUrl) {
          if (cells.length <= idxStatus) continue;
          beforeLine = lines[i];
          cells[idxStatus] = ' ' + status + ' ';
          lines[i] = cells.join('|');
          target = i;
          break;
        }
      }
      if (target < 0) return res.status(404).json({ error: 'tracker row not found', num, url });
      const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
      writeFileSync(REAL_APPS_MD + '.bak-compass-' + ts, content);
      const tmp = REAL_APPS_MD + '.tmp-compass';
      writeFileSync(tmp, lines.join('\n'));
      renameSync(tmp, REAL_APPS_MD);
      res.json({ ok: true, num, url, status, before: (beforeLine || '').trim(), after: lines[target].trim() });
    } catch (e) {
      res.status(500).json({ error: 'status update failed', details: String((e && e.message) || e).slice(0, 300) });
    }
  });
}
