/**
 * Pipeline routes — inbox of pending JD URLs + server-side preview proxy.
 *
 *   GET    /api/pipeline             → { urls: string[] }
 *   POST   /api/pipeline { url }     → append (URL gated by isValidJobUrl)
 *   GET    /api/pipeline/preview?url → stripped HTML snippet (≤ 8 KB)
 *   DELETE /api/pipeline?url=…       → remove
 *
 * The preview endpoint walks redirects manually, revalidating each
 * Location through isValidJobUrl (REVIEW-B1). Cap: 3 hops, 15 s timeout,
 * 8 KB body. SSRF surface is bounded by isValidJobUrl which rejects
 * loopback, file://, IP literals, etc.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PATHS, path as projPath } from '../paths.mjs';
import { parsePipeline, addPipelineUrl, removePipelineUrl } from '../parsers.mjs';
import { isValidJobUrl } from '../security.mjs';
import { safeReadPipeline } from '../store.mjs';
import { safeGet } from '../safe-fetch.mjs';
import { withFileLock } from '../file-lock.mjs';

const PREVIEW_TIMEOUT_MS = 15_000;
const PREVIEW_MAX_BODY_BYTES = 8000;
// Raw HTML budget for extraction — big enough to reach JSON-LD / JobPosting that
// often sits deep in the document (e.g. Ashby embeds it past 40 KB).
const PREVIEW_RAW_BUDGET = 1_500_000;

// ── JD extraction: pull the REAL job description out of a fetched HTML page ──
// Priority: (a) JSON-LD JobPosting.description, (b) og:description / meta
// description if substantial, (c) cleaned <body> text with <script>/<style> and
// CSS-in-JS/styled-components noise removed. A junk guard rejects CSS/markup
// shells (anti-bot challenges, JS-only boards) so we never return garbage.
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(+n); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCharCode(parseInt(n, 16)); } catch { return ' '; } })
    .replace(/&[a-z]+;/gi, ' ');
}
function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|li|h[1-6]|section|article|ul|ol|tr)>/gi, '\n')
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// Remove styled-components / CSS-in-JS leftovers that slip past <style> stripping.
function stripCssNoise(s) {
  return String(s || '')
    .replace(/\/\*![\s\S]*?\*\//g, ' ')                                   // /*!sc*/ markers
    .replace(/data-styled[.\w-]*\[[^\]]*\]\s*\{[^{}]*\}/g, ' ')           // data-styled.gN[id=...]{...}
    .replace(/[.#][-\w]+(?:\s*[,>+~]\s*[.#:\[\]"'=\w-]+)*\s*\{[^{}]*\}/g, ' ') // .class{...} rules
    .replace(/@[-\w]+[^{]*\{[^{}]*\}/g, ' ')                              // @media/@font-face blocks
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
// Junk guard: is this text actually a readable posting, not a CSS/JS shell?
function looksReadable(s) {
  s = String(s || '');
  if (s.length < 40) return false;
  if (/\/\*!sc\*\/|data-styled|awsWafCookie|gokuProps|__NEXT_DATA__|enable JavaScript|are you a (human|robot)/i.test(s)) return false;
  const words = s.match(/[A-Za-z][A-Za-z'-]{1,}/g) || [];
  if (words.length < 18) return false;                     // essentially empty extraction
  const braces = (s.match(/[{};]/g) || []).length;
  if (braces > s.length * 0.03) return false;              // CSS/code-heavy
  const spaces = (s.match(/\s/g) || []).length;
  if (spaces / s.length < 0.08) return false;              // minified-looking junk
  return true;
}
function extractJobDescription(html) {
  html = String(html || '');
  // (a) JSON-LD JobPosting.description
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let parsed = null;
    try { parsed = JSON.parse(b[1].trim()); }
    catch { try { parsed = JSON.parse(b[1].trim().replace(/,\s*([}\]])/g, '$1')); } catch { /* skip */ } }
    if (!parsed) continue;
    const arr = Array.isArray(parsed) ? parsed
      : (parsed['@graph'] && Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed]);
    for (const o of arr) {
      const t = o && o['@type'];
      const isJob = t && (Array.isArray(t) ? t.some((x) => /JobPosting/i.test(x)) : /JobPosting/i.test(t));
      if (isJob && o.description) {
        const txt = htmlToText(o.description);
        if (txt && txt.length >= 80) return { text: txt, source: 'jsonld' };
      }
    }
  }
  // og:description / meta description
  const ogM = html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i)
    || html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]*?)["']/i);
  const ogTxt = ogM ? decodeEntities(ogM[1]).replace(/\s+/g, ' ').trim() : '';
  // (c) cleaned body
  const bodyTxt = stripCssNoise(htmlToText(html));
  // Prefer a rich, readable body; then a substantial og; then a shorter readable body.
  if (bodyTxt && looksReadable(bodyTxt) && bodyTxt.length >= 600) return { text: bodyTxt, source: 'body' };
  if (ogTxt && ogTxt.length >= 120) return { text: ogTxt, source: 'og' };
  if (bodyTxt && looksReadable(bodyTxt)) return { text: bodyTxt, source: 'body' };
  return { text: '', source: 'none' };
}

export function registerPipelineRoutes(app) {
  app.get('/api/pipeline', (_req, res) => {
    res.json({ urls: safeReadPipeline() });
  });

  app.post('/api/pipeline', async (req, res) => {
    const url = (req.body?.url || req.body?.text || '').toString().trim();
    if (!url) return res.status(400).json({ error: 'url required' });
    if (!isValidJobUrl(url)) {
      // QA BUG-006 — human, sentence-cased. (The api.js client still
      // appends the "(POST /api/pipeline · HTTP 400)" where/why context
      // by design — that was an explicit product requirement.)
      return res.status(400).json({ error: "That doesn't look like a valid job posting URL — it must start with http:// or https:// and contain no script or template characters." });
    }
    // v1.20.1 (H-6) — same read-modify-write race as tracker.mjs. Two
    // concurrent POST /api/pipeline with distinct URLs would both read
    // the same content, both compute their own append, and the later
    // write would clobber the earlier. Serialize via the per-path
    // mutex.
    const result = await withFileLock(PATHS.pipeline, async () => {
      let content = '';
      try {
        content = readFileSync(PATHS.pipeline, 'utf8');
      } catch {
        content = '';
      }
      const before = parsePipeline(content);
      const deduped = before.includes(url);
      const updated = addPipelineUrl(content, url);
      mkdirSync(projPath('data'), { recursive: true });
      writeFileSync(PATHS.pipeline, updated);
      return { ok: true, deduped, urls: parsePipeline(updated) };
    });
    res.json(result);
  });

  // Server-side fetch proxy for the pipeline preview pane. Most ATS
  // boards (Greenhouse, Ashby, Lever) don't send CORS headers, so the
  // browser can't read them directly; we fetch on the server and return
  // a stripped text snippet.
  app.get('/api/pipeline/preview', async (req, res) => {
    const url = (req.query.url || '').toString();
    if (!isValidJobUrl(url)) return res.status(400).json({ error: 'invalid url' });
    // v1.20.1 (B-1) — safeGet does the DNS resolve ONCE, validates the
    // address against isPrivateOrLoopbackHost, then pins the TCP
    // connection to that exact IP (with SNI/Host targeting the original
    // hostname for cert validation). The DNS-rebind TOCTOU window
    // between an explicit dnsLookup and the second lookup `fetch()`
    // would do is closed because there is no second lookup.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PREVIEW_TIMEOUT_MS);
    try {
      const r = await safeGet(url, {
        signal: ctrl.signal,
        maxBytes: PREVIEW_RAW_BUDGET, // raw HTML budget (JSON-LD can sit deep in the page)
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      // Preserve the historical "(HTTP 4xx)" preview text for non-2xx
      // upstreams — the SPA renders this directly in the preview pane.
      if (r.status < 200 || r.status >= 300) {
        return res.json({ status: r.status, text: '(HTTP ' + r.status + ')' });
      }
      // Extract the REAL job description (JSON-LD → og/meta → cleaned body),
      // then junk-guard: if it's a CSS/JS shell (anti-bot challenge, JS-only
      // board), return thin instead of returning garbage the LLM would
      // hallucinate on. (A Camoufox browser fetch is the future fallback.)
      const ex = extractJobDescription(r.text);
      const text = (ex.text || '').slice(0, PREVIEW_MAX_BODY_BYTES);
      if (!text || !looksReadable(text)) {
        return res.json({ status: r.status, text: '', thin: true, reason: 'could not read posting (JS-rendered or bot-protected board — open the original to verify)' });
      }
      res.json({ status: r.status, text, source: ex.source });
    } catch (e) {
      const msg = e.message || String(e);
      // Map known safeGet errors to user-friendly preview text.
      if (msg.includes('resolves to private address')) {
        res.json({ status: 0, text: '(blocked: host resolves to private address)' });
      } else if (msg.includes('redirects from')) {
        res.json({ status: 0, text: '(too many redirects)' });
      } else if (msg.includes('unsafe redirect target')) {
        res.json({ status: 0, text: '(unsafe redirect target rejected)' });
      } else if (msg === 'aborted') {
        res.json({ status: 0, text: '(timeout)' });
      } else {
        res.json({ status: 0, text: '(' + msg + ')' });
      }
    } finally {
      clearTimeout(timer);
    }
  });

  app.delete('/api/pipeline', async (req, res) => {
    const url = (req.query.url || (req.body && req.body.url) || '').toString().trim();
    if (!url) return res.status(400).json({ error: 'url required (query ?url= or body.url)' });
    // v1.20.1 (H-6) — guard the read-modify-write so DELETE doesn't
    // race a concurrent POST add.
    const outcome = await withFileLock(PATHS.pipeline, async () => {
      let content = '';
      try {
        content = readFileSync(PATHS.pipeline, 'utf8');
      } catch {
        return { _status: 404, body: { error: 'pipeline not found' } };
      }
      const before = parsePipeline(content);
      if (!before.includes(url)) {
        return { _status: 404, body: { error: 'url not found in pipeline', url } };
      }
      writeFileSync(PATHS.pipeline, removePipelineUrl(content, url));
      return { _status: 200, body: { ok: true, removed: 1, url } };
    });
    res.status(outcome._status).json(outcome.body);
  });
}
