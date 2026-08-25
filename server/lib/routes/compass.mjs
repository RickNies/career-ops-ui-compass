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
import { readFileSync } from 'node:fs';

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
}
