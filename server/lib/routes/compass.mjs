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
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

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
const FIT_STORE = DATA_ROOT + '/data/fit-analysis.jsonl';

// AI fit-analysis (data/fit-analysis.jsonl), keyed by url → {score 0-100, verdict,
// why, strengths[], gaps[]}. Cached by mtime; re-read when the file changes (more
// batches are landing). Jobs without an entry are simply absent from the map.
let _fitCache = null, _fitMtime = -1;
function normFitUrl(u) { return String(u || '').split('#')[0].replace(/\/+$/, ''); }
function readFitMap() {
  try {
    const st = statSync(FIT_STORE);
    if (_fitCache && st.mtimeMs === _fitMtime) return _fitCache;
    const map = {};
    readFileSync(FIT_STORE, 'utf8').trim().split(/\r?\n/).forEach((l) => {
      if (!l) return;
      try { const j = JSON.parse(l); if (j && j.url) map[normFitUrl(j.url)] = { score: j.score, verdict: j.verdict, why: j.why || '', strengths: Array.isArray(j.strengths) ? j.strengths : [], gaps: Array.isArray(j.gaps) ? j.gaps : [] }; } catch { /* skip bad line */ }
    });
    _fitCache = map; _fitMtime = st.mtimeMs; return map;
  } catch { return _fitCache || {}; }
}

// Salary bands (data/salary.jsonl), keyed by url → {min,max,currency} in THOUSANDS
// (single-figure roles have min==max). Partial + growing; cached by mtime.
const SALARY_STORE = DATA_ROOT + '/data/salary.jsonl';
let _salCache = null, _salMtime = -1;
function readSalaryMap() {
  try {
    const st = statSync(SALARY_STORE);
    if (_salCache && st.mtimeMs === _salMtime) return _salCache;
    const map = {};
    readFileSync(SALARY_STORE, 'utf8').trim().split(/\r?\n/).forEach((l) => {
      if (!l) return;
      try {
        const j = JSON.parse(l);
        if (j && j.url && (j.salary_min != null || j.salary_max != null)) {
          map[normFitUrl(j.url)] = { min: j.salary_min != null ? j.salary_min : null, max: j.salary_max != null ? j.salary_max : null, currency: j.currency || 'USD', source: j.source || '' };
        }
      } catch { /* skip bad line */ }
    });
    _salCache = map; _salMtime = st.mtimeMs; return map;
  } catch { return _salCache || {}; }
}
const LIVENESS_STORE = DATA_ROOT + '/data/liveness.tsv';
const LIVENESS_PY = SCRAPE_DIR + '/liveness.py';

// ── Background generation job layer ──────────────────────────────────────────
// LLM generations (tailor/cover/evaluate/networking) run server-side async so
// they survive navigation. Persisted to data/compass-jobs.jsonl; artifacts to
// data/compass-artifacts/<id>.md. Work reuses the REAL endpoints via a loopback
// fetch (exact same prompt/provider logic, no duplication).
const JOBS_STORE = DATA_ROOT + '/data/compass-jobs.jsonl';
const ARTIFACT_DIR = DATA_ROOT + '/data/compass-artifacts';
// Pasted-JD cache (keyed by normalized url) — when a board is JS-rendered/bot-
// protected and the preview reads thin, the user pastes the real JD once; we cache
// it so future tailor/evaluate on the same job reuse it and don't re-prompt.
const JD_CACHE = DATA_ROOT + '/data/compass-jd-cache.json';
function normUrlSrv(u) { return String(u || '').split('#')[0].replace(/\/+$/, ''); }
function readJdCache() { try { return JSON.parse(readFileSync(JD_CACHE, 'utf8')); } catch { return {}; } }
function writeJdCache(map) { try { mkdirSync(dirname(JD_CACHE), { recursive: true }); writeFileSync(JD_CACHE, JSON.stringify(map)); } catch { /* best-effort */ } }
const SELF = 'http://127.0.0.1:' + (process.env.PORT || '8100');
// cover ≠ résumé: /api/cv-studio/tailor returns a COMBINED tailored-résumé doc, so
// `cover` routes to the dedicated cover-letter mode (modes/cover.md → just a letter).
const JOB_ENDPOINT = { tailor: '/api/cv-studio/tailor', cover: '/api/mode/cover', evaluate: '/api/evaluate', networking: '/api/networking/plan' };
const jobs = new Map();
const jobQueue = [];
let jobActive = 0;
const jobControllers = new Map(); // job.id → AbortController for the in-flight loopback fetch

function loadJobs() {
  try {
    readFileSync(JOBS_STORE, 'utf8').trim().split(/\n/).forEach((l) => { if (l) { const j = JSON.parse(l); jobs.set(j.id, j); } });
  } catch { /* none yet */ }
  // A job left 'running'/'queued' by a prior crash can never finish — mark it errored.
  let dirty = false;
  for (const j of jobs.values()) { if (j.status === 'running' || j.status === 'queued') { j.status = 'error'; j.error = 'interrupted (server restart)'; dirty = true; } }
  // Backfill company/role for older '(unknown)' jobs from their JD / artifact.
  for (const j of jobs.values()) { if (fillMeta(j)) dirty = true; }
  if (dirty) persistJobs();
}
function persistJobs() {
  try {
    mkdirSync(dirname(JOBS_STORE), { recursive: true });
    const tmp = JOBS_STORE + '.tmp';
    writeFileSync(tmp, [...jobs.values()].map((j) => JSON.stringify(j)).join('\n') + '\n');
    renameSync(tmp, JOBS_STORE);
  } catch { /* best-effort */ }
}
async function providerCap() {
  try { const s = await (await fetch(SELF + '/api/status/providers')).json(); return (s && s.activeProvider && s.activeProvider !== 'hermes') ? 3 : 1; }
  catch { return 1; }
}
// Resolve a real company/role for a job that came in without them (manual role,
// JS-thin board). Mine the JD text first, then the AI output (eval/tailor/cover
// all name the role). Returns {company, role} (either may be '').
function cleanMeta(s) {
  return String(s || '').replace(/[|*_`#]+/g, ' ').replace(/\benable JavaScript\b.*$/i, '')
    .replace(/[\s.,;:–—-]+$/, '').replace(/^[\s.,;:–—-]+/, '').replace(/\s+/g, ' ').trim().slice(0, 90);
}
function extractMeta(jd, md) {
  let company = '', role = '';
  const firstLine = (String(jd || '').split('\n').map((s) => s.trim()).filter(Boolean)[0]) || '';
  let m = firstLine.match(/^(.{3,110}?)\s+(?:@|·|\||\bat\b)\s+(.{2,70})$/i);
  if (m) { role = m[1]; company = m[2]; }
  const cm = String(jd || '').match(/\bcompany\s*[:\-]\s*([^\n|]{2,70})/i); if (cm && !company) company = cm[1];
  const rm = String(jd || '').match(/\b(?:role|title|position)\s*[:\-]\s*([^\n|]{2,110})/i); if (rm && !role) role = rm[1];
  if ((!role || !company) && md) {
    const he = md.match(/(?:Job )?Evaluation\s*[—\-–]\s*(.+?)\s*\(([^)]{2,70})\)/i); // "Evaluation — Role (Company)"
    if (he) { role = role || he[1]; company = company || he[2]; }
    const cl = md.match(/Cover Letter\s*[:\-]\s*(.+)/i); if (cl && !role) role = cl[1];
    const h1 = md.match(/^#\s+(.+)$/m); if (h1 && !role) role = h1[1]; // tailor "# Role"
    const rs = md.match(/^\s*[-•]?\s*Role\s*[:\-]\s*(.+)$/mi); if (rs && !role) role = rs[1];
  }
  return { company: cleanMeta(company), role: cleanMeta(role) };
}
function fillMeta(job) {
  if (job.company && job.role) return false;
  let md = '';
  if (job.artifactPath) { try { md = readFileSync(job.artifactPath, 'utf8'); } catch { /* gone */ } }
  const e = extractMeta(job.jd, md);
  let changed = false;
  if (!job.company && e.company) { job.company = e.company; changed = true; }
  if (!job.role && e.role) { job.role = e.role; changed = true; }
  return changed;
}
function bodyForJob(job) {
  if (job.type === 'networking') return { company: job.company, role: job.role, jd: job.jd || '', run: true };
  if (job.type === 'evaluate') return { jd: job.jd || '', save: false };
  if (job.type === 'cover') return { jd: job.jd || '', company: job.company, role: job.role, run: true }; // → /api/mode/cover
  // tailor → /api/cv-studio/tailor. A verbatim prompt override (from the Tailoring
  // page's editable prompt) runs as-is; otherwise the endpoint rebuilds from jd.
  if (job.prompt) return { prompt: job.prompt, run: true };
  return { jd: job.jd || '', headline: job.role || '', run: true };
}
async function runJob(job) {
  if (job.status === 'cancelled') return; // cancelled while queued → skip entirely
  const ctrl = new AbortController();
  jobControllers.set(job.id, ctrl);
  const opt = { signal: ctrl.signal };
  job.status = 'running'; job.started = new Date().toISOString(); persistJobs();
  try {
    try { const s = await (await fetch(SELF + '/api/status/providers', opt)).json(); job.provider = s.activeProvider; job.model = s.activeModel; persistJobs(); } catch (e) { if (ctrl.signal.aborted) throw e; /* else keep null */ }
    // Fetch the JD from the posting if we only have a URL.
    if (!job.jd && job.url) {
      try { const pv = await (await fetch(SELF + '/api/pipeline/preview?url=' + encodeURIComponent(job.url), opt)).json(); job.jd = (pv && pv.text) || ''; } catch (e) { if (ctrl.signal.aborted) throw e; /* thin */ }
    }
    // If the live preview read thin, fall back to a pasted-JD the user cached for
    // this url (guided-paste flow) — so evaluate/cover/tailor run on the REAL JD.
    if ((!job.jd || job.jd.length < 40) && job.url) {
      const cached = readJdCache()[normUrlSrv(job.url)];
      if (cached && cached.length >= 40) job.jd = cached;
    }
    // tailor/cover need a JD floor; synthesize from role/company if the board was JS-thin.
    if ((job.type === 'tailor' || job.type === 'cover') && (!job.jd || job.jd.length < 40)) {
      job.jd = (job.role || 'Finance role') + ' at ' + (job.company || 'the company') + '. Responsibilities include FP&A, budgeting, forecasting, and business partnering.';
    }
    if (job.type === 'evaluate' && (!job.jd || job.jd.length < 50)) throw new Error('no readable JD to evaluate (JS-rendered board)');
    const r = await fetch(SELF + JOB_ENDPOINT[job.type], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyForJob(job)), signal: ctrl.signal });
    const j = await r.json();
    const md = j.markdown || j.report || '';
    if (!md) throw new Error(j.error || j.message || ('no result (mode ' + (j.mode || '?') + ')'));
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const art = ARTIFACT_DIR + '/' + job.id + '.md';
    writeFileSync(art, md);
    job.artifactPath = art; job.bytes = md.length; job.status = 'done'; job.finished = new Date().toISOString();
    // Resolve company/role from the JD + AI output if they came in empty.
    if (!job.company || !job.role) { const e = extractMeta(job.jd, md); if (!job.company && e.company) job.company = e.company; if (!job.role && e.role) job.role = e.role; }
  } catch (e) {
    // A cancel aborts the fetch → land here; keep 'cancelled' (set by the cancel
    // endpoint), don't overwrite it with 'error'.
    if (job.status === 'cancelled' || ctrl.signal.aborted) {
      if (job.status !== 'cancelled') { job.status = 'cancelled'; job.finished = new Date().toISOString(); }
    } else {
      job.status = 'error'; job.error = String((e && e.message) || e).slice(0, 300); job.finished = new Date().toISOString();
    }
  } finally {
    jobControllers.delete(job.id);
  }
  persistJobs();
}
async function pumpJobs() {
  const cap = await providerCap();
  while (jobActive < cap && jobQueue.length) {
    const job = jobQueue.shift();
    if (job.status === 'cancelled') continue; // cancelled while queued → free the slot, skip
    jobActive++;
    runJob(job).finally(() => { jobActive--; pumpJobs(); });
  }
}
function enqueueJob(job) { jobQueue.push(job); pumpJobs(); }
loadJobs();

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

  // Read the AI fit-analysis, keyed by normalized url. Join to tracker rows client-side.
  app.get('/api/compass/fit', (_req, res) => {
    const map = readFitMap();
    res.json({ map, count: Object.keys(map).length });
  });

  // Read the salary bands (thousands), keyed by normalized url.
  app.get('/api/compass/salary', (_req, res) => {
    const map = readSalaryMap();
    res.json({ map, count: Object.keys(map).length });
  });

  // Real "where your search runs" data: newest scan date + how many jobs landed
  // that day (from data/scan-history.tsv), and genuine last-ran times from the
  // cron log mtimes. Cheap: one file read + a few stat()s. No fabricated "ran today".
  app.get('/api/compass/runs', (_req, res) => {
    const out = { ok: true, lastNew: null, logs: {} };
    try {
      const tsv = readFileSync(DATA_ROOT + '/data/scan-history.tsv', 'utf8');
      const dayCount = {};
      let maxDate = '';
      tsv.split('\n').forEach((ln) => {
        const d = ln.split('\t')[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
        dayCount[d] = (dayCount[d] || 0) + 1;
        if (d > maxDate) maxDate = d;
      });
      if (maxDate) out.lastNew = { date: maxDate, count: dayCount[maxDate] || 0 };
    } catch { /* no scan-history yet */ }
    // Genuine last-ran timestamps from cron log mtimes (real, per pipeline).
    const LOGS = {
      scan: '/tmp/career-ops-scan.log',
      scrape: '/tmp/career-ops-scrape.log',
      discover: '/tmp/career-ops-discover.log',
      linkedin: '/tmp/career-ops-linkedin.log',
      liveness: '/tmp/career-ops-liveness.out.log',
      fitscore: '/tmp/career-ops-fitscore.out.log',
    };
    for (const [k, p] of Object.entries(LOGS)) {
      try { out.logs[k] = statSync(p).mtime.toISOString(); } catch { /* missing */ }
    }
    res.json(out);
  });

  // Pasted-JD cache: GET returns the cached JD for a url (or ''); POST stores one.
  app.get('/api/compass/jd-cache', (req, res) => {
    const u = normUrlSrv(req.query.url || '');
    const m = readJdCache();
    res.json({ url: u, jd: (u && m[u]) || '' });
  });
  app.post('/api/compass/jd-cache', (req, res) => {
    const b = req.body || {};
    const u = normUrlSrv(b.url || '');
    const jd = String(b.jd || '').slice(0, 20000).trim();
    if (!u || jd.length < 40) return res.status(400).json({ error: 'url and jd (40+ chars) required' });
    const m = readJdCache(); m[u] = jd; writeJdCache(m);
    res.json({ ok: true, bytes: jd.length });
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

  // ── Background generation: create a job, run async, return jobId now ──
  app.post('/api/compass/generate', (req, res) => {
    const b = req.body || {};
    const type = String(b.type || '').trim();
    if (!JOB_ENDPOINT[type]) return res.status(400).json({ error: 'type must be one of tailor|cover|evaluate|networking' });
    const job = {
      id: randomUUID().slice(0, 8), type,
      company: String(b.company || '').slice(0, 200), role: String(b.role || '').slice(0, 200),
      url: String(b.url || '').trim(), jobNum: b.jobNum != null ? String(b.jobNum) : null,
      jd: b.jd ? String(b.jd).slice(0, 20000) : '',
      prompt: (type === 'tailor' && b.prompt) ? String(b.prompt).slice(0, 40000) : '',
      status: 'queued', provider: null, model: null,
      created: new Date().toISOString(), started: null, finished: null,
      artifactPath: null, bytes: 0, error: null,
    };
    jobs.set(job.id, job); persistJobs(); enqueueJob(job);
    res.json({ jobId: job.id, status: job.status });
  });

  app.get('/api/compass/jobs', (_req, res) => {
    const list = [...jobs.values()].sort((a, b) => String(b.created).localeCompare(String(a.created)));
    res.json({ jobs: list, inFlight: jobActive, queued: jobQueue.length });
  });

  // Cancel a running OR queued job. Idempotent (no-op on a finished job).
  app.post('/api/compass/jobs/:id/cancel', (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return res.status(404).json({ error: 'job not found' });
    if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') {
      return res.json({ ok: true, status: j.status, noop: true });
    }
    j.status = 'cancelled'; j.finished = new Date().toISOString(); j.error = null;
    const ctrl = jobControllers.get(j.id);
    if (ctrl) { try { ctrl.abort(); } catch { /* ignore */ } } // running → abort the loopback fetch (frees the slot in runJob.finally)
    const qi = jobQueue.indexOf(j); if (qi >= 0) jobQueue.splice(qi, 1); // queued → drop it
    persistJobs();
    res.json({ ok: true, status: 'cancelled' });
  });

  app.get('/api/compass/jobs/:id', (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return res.status(404).json({ error: 'job not found' });
    let markdown = '';
    if (j.artifactPath) { try { markdown = readFileSync(j.artifactPath, 'utf8'); } catch { /* gone */ } }
    res.json(Object.assign({}, j, { markdown }));
  });
}
