/**
 * COMPASS FORK — extra routes for the simplified "Compass" UI served by the
 * :8100 (career-ops-compass) instance ONLY. Not part of upstream.
 *
 * Static Compass mockups live in public/compass/*.html (served by the
 * existing express.static). This module adds the small server surface the
 * wired flows need:
 *
 *   POST /api/compass/feedback  → shells out to a COMPASS-LOCAL copy of
 *       feedback.py (feedback.py add <url> <good|bad> --no-eval) so verdicts
 *       persist to THIS instance's data/feedback.jsonl. The copy is repointed
 *       at /Users/nick/apps/career-ops-compass (never the original tree).
 *
 *   POST /api/compass/setup     → shells out to the shared write_settings.py
 *       with --path pointing at THIS instance's portals.yml (comment-preserving
 *       ruamel writer + validate-portals.mjs). LLM/provider + Anthropic key are
 *       handled by the wire.js front-end via the existing /api/config endpoint
 *       (the same #/config .env path), so they are intentionally NOT here.
 *
 *   GET  /compass               → 302 to /compass/dashboard.html (landing).
 *
 * Isolation: every path below is under /Users/nick/apps/career-ops-compass.
 * The original /Users/nick/apps/career-ops tree is never read-for-write or
 * written. (write_settings.py + feedback.py default to the original paths;
 * that is exactly why we pass --path / use a repointed copy.)
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

const VENV_PY = '/Users/nick/apps/career-ops-scrape/venv/bin/python';
const WRITE_SETTINGS = '/Users/nick/apps/career-ops-scrape/write_settings.py';
const COMPASS_ROOT = '/Users/nick/apps/career-ops-compass';
const COMPASS_FEEDBACK_PY = COMPASS_ROOT + '/scrape/feedback.py';
const COMPASS_PORTALS = COMPASS_ROOT + '/portals.yml';
const COMPASS_FEEDBACK_JSONL = COMPASS_ROOT + '/data/feedback.jsonl';

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
    const args = [COMPASS_FEEDBACK_PY, 'add', url, verdict, '--no-eval'];
    if (reason) args.push('--reason', reason);
    execFile(VENV_PY, args, { timeout: 90000, cwd: COMPASS_ROOT + '/scrape', env: SUBPROC_ENV }, (err, stdout, stderr) => {
      let lastLine = null;
      try {
        const lines = readFileSync(COMPASS_FEEDBACK_JSONL, 'utf8').trim().split(/\n/);
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
      '--path', COMPASS_PORTALS,
      '--validator-dir', COMPASS_ROOT,
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
