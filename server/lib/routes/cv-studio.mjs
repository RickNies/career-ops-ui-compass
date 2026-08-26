/**
 * CV Studio — "make it human / match my voice" route (v1.92.0, Epic 21).
 *
 * Given a chunk of CV text, builds a rewrite prompt that makes it read less
 * like generic AI prose and more like the CANDIDATE's own voice, grounded in
 * `voice-dna.md` (how their writing reads) and `writing-samples/` (their real
 * prose). Per DATA_CONTRACT these govern STYLE only — the rewrite may reorder,
 * tighten, and re-voice, but must NEVER introduce a factual claim, metric, or
 * achievement not already present in the input text.
 *
 *   POST /api/cv-studio/humanize  → rewritten text (live) or a copy-paste prompt
 *
 * No file writes — the user edits their CV via the existing PUT /api/cv. Live
 * runs use the shared provider cascade; no key → manual prompt (honest).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PATHS, path as projPath, PROJECT_ROOT } from '../paths.mjs';
import { resolveLocale, bundleProjectContext } from '../prompts.mjs';
import { cleanLlmMarkdown } from '../llm-output.mjs';
import { llmRateLimit } from '../rate-limit.mjs';
import { runActiveProvider, providerAvailable } from '../llm-dispatch.mjs';
import { runNodeScript } from '../runner.mjs';
import { parseJsonStdout, sanitizeDetail } from '../parent-relay.mjs';
import { isValidJobUrl } from '../security.mjs';
import { safeGet } from '../safe-fetch.mjs';

const MAX_TEXT = 20 * 1024;      // the CV chunk to rewrite
const MAX_SAMPLE = 8 * 1024;     // per writing sample
const MAX_SAMPLES = 3;           // how many samples to inline
const MAX_JD = 24 * 1024;        // the target job description to tailor against
const MAX_HEADLINE = 200;        // optional target-role / headline hint
const MAX_VERIFY = 64 * 1024;    // the generated document to fact-check (CV + cover letter)

/** Read voice-dna.md + up to N writing samples as a bounded grounding block. */
export function readVoiceContext() {
  const blocks = [];
  if (existsSync(PATHS.voiceDna)) {
    try { blocks.push(`--- voice-dna.md ---\n${readFileSync(PATHS.voiceDna, 'utf8').slice(0, MAX_SAMPLE)}`); } catch { /* ignore */ }
  }
  if (existsSync(PATHS.writingSamplesDir)) {
    let n = 0;
    for (const f of readdirSync(PATHS.writingSamplesDir).sort()) {
      if (n >= MAX_SAMPLES) break;
      if (!/\.(md|txt)$/i.test(f)) continue;
      try {
        blocks.push(`--- writing-samples/${f} ---\n${readFileSync(projPath('writing-samples', f), 'utf8').slice(0, MAX_SAMPLE)}`);
        n++;
      } catch { /* ignore */ }
    }
  }
  return blocks.join('\n\n');
}

const INSTRUCTIONS = [
  'Rewrite the CV TEXT below so it reads in the candidate\'s own voice — human,',
  'specific, and free of generic AI phrasing (no "leveraged", "spearheaded",',
  '"passionate about", "results-oriented" filler). Use the voice references to',
  'match their cadence and word choice.',
  '',
  'HARD RULES:',
  '  - Do NOT add any fact, metric, employer, date, or achievement that is not',
  '    already in the CV TEXT. Reorder, tighten, and re-voice only.',
  '  - Keep it truthful and concise. Prefer strong verbs and concrete nouns.',
  '  - Return ONLY the rewritten text (same markdown structure), no commentary.',
  '',
].join('\n');

export function buildHumanizePrompt(voiceCtx, text, lang) {
  return [
    voiceCtx ? `<voice_references>\n${voiceCtx}\n</voice_references>\n` : '',
    INSTRUCTIONS,
    'CV TEXT:',
    '"""',
    text,
    '"""',
    '',
    lang && lang !== 'en' ? `Respond in the candidate's language (${lang}).` : '',
  ].filter((x) => x !== '').join('\n');
}

// ── "Tailor to a job" — SURGICAL résumé editor (résumé only, no cover letter) ──
//
// GENERIC rules — no hardcoded companies, roles, tracks, or personal history.
// Everything specific comes from <project_context> (the candidate's own cv.md /
// profile / two-pager) and the target JD. The pass is surgical: keep the résumé's
// structure intact and only re-word bullets + adjust metric emphasis to match the
// JD — NEVER fabricate a fact, metric, employer, date, or authorship claim not
// already in the materials, and never also produce a cover letter (that is the
// separate /api/mode/cover flow).
const TAILOR_INSTRUCTIONS = [
  'You are a SURGICAL résumé editor. You take the candidate\'s EXISTING résumé and',
  'make the smallest set of targeted edits that align it with ONE specific job.',
  'This is a tailoring pass, not a rewrite, and NOT a cover letter.',
  '',
  '## What "surgical" means (hard rules)',
  '- KEEP the résumé\'s structure intact: same sections, same order, same employers,',
  '  same job titles, same dates, same overall length. Do not reorganise or re-theme.',
  '- ONLY touch bullet points: re-word existing bullets and adjust the emphasis of',
  '  metrics so the JD\'s priorities read first. You may lightly reorder bullets',
  '  WITHIN a single role, but do not move content between roles.',
  '- Surface the JD\'s key terms/skills ONLY where the candidate genuinely already',
  '  has them (a bullet already implies it) — reword to use the JD\'s wording.',
  '- Do NOT add new bullets, new roles, or filler. Do NOT pad. If anything, tighten.',
  '- NEVER fabricate a fact, metric, employer, date, title, or authorship claim.',
  '  Every number must already exist in the materials. If a bullet would need a',
  '  metric it does not have, leave it qualitative — mark it NEEDS_METRIC rather',
  '  than inventing one.',
  '- Keep the headline/summary as-is unless a one-word tweak makes it match the',
  '  target role; if you change it, note it.',
  '- DO NOT write a cover letter, outreach note, or any other document. The cover',
  '  letter is a separate flow.',
  '',
  '## Output — return EXACTLY these two Markdown sections, nothing else',
  '## Tailored résumé',
  '<the FULL résumé with your surgical edits applied — same structure/sections/order',
  ' as the original, ready to copy straight out>',
  '',
  '## What changed & why',
  '<a short bullet list — one line per edit — each naming the role/section and the',
  ' JD requirement it now matches, e.g. "- Cloud Ops bullet: reworded \'managed',
  ' infrastructure\' → \'ran AWS/Terraform infra\' to match the JD\'s stack line."',
  ' Keep it concise; if you changed nothing in a section, do not mention it.>',
  '',
  'Use ONLY the candidate materials in <project_context> and the JD below.',
  '',
  '## Grounding (critical)',
  'Base every edit STRICTLY on the job description below. Do NOT assume or invent',
  "the company's industry, business model, or type (e.g. do not call it an 'agency',",
  "'studio', 'startup', 'media company', etc.) unless the JD explicitly states it.",
  'If the job description is missing, thin, or unreadable (boilerplate, navigation,',
  'or CSS/markup rather than a real posting), DO NOT fabricate a tailored résumé —',
  'say you could not read the posting and to open the original link to verify, and',
  'return the résumé unchanged.',
  '',
].join('\n');

/** Build the SURGICAL résumé-tailoring prompt (résumé only — no cover letter).
 *  Generic; personalisation comes entirely from `ctx` (bundleProjectContext)
 *  + the target `jd`. */
export function buildTailorPrompt(ctx, jd, headline, lang) {
  return [
    TAILOR_INSTRUCTIONS,
    headline ? `TARGET ROLE / HEADLINE HINT: ${headline}\n` : '',
    'TARGET JOB DESCRIPTION:',
    '"""',
    jd,
    '"""',
    ctx ? `\n<project_context>\n${ctx}\n</project_context>` : '',
    lang && lang !== 'en' ? `\nWrite the tailored résumé in the candidate's language (${lang}).` : '',
  ].filter((x) => x !== '').join('\n');
}

export function registerCvStudioRoutes(app) {
  app.post('/api/cv-studio/humanize', llmRateLimit, async (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const text = (typeof body.text === 'string' ? body.text : '').slice(0, MAX_TEXT).trim();
    if (!text || text.length < 20) {
      return res.status(400).json({ error: 'select at least ~20 characters of CV text to rewrite' });
    }
    const lang = resolveLocale(req);
    const prompt = buildHumanizePrompt(readVoiceContext(), text, lang);

    if (!body.run) {
      return res.json({
        mode: 'manual',
        prompt,
        message: providerAvailable()
          ? 'Set { run: true } to rewrite live, or copy this prompt into any LLM.'
          : 'No API key set — copy this prompt into any LLM, then paste the rewrite back.',
      });
    }
    const r = await runActiveProvider(prompt);
    if (r.mode === 'too-large') {
      return res.status(413).json({ error: 'prompt too large', details: [`assembled prompt is ${r.size} bytes; soft cap is ${r.cap}.`] });
    }
    if (r.mode === 'manual') return res.json({ mode: 'manual', prompt, message: 'No provider available — copy this prompt into any LLM.' });
    if (r.error) return res.status(502).json({ mode: r.mode, prompt, error: r.error });
    return res.json({ mode: r.mode, prompt, markdown: cleanLlmMarkdown(r.markdown), usage: r.usage });
  });

  // Surgically tailor the résumé to a specific JD (résumé only — the cover letter
  // is /api/mode/cover). Reads only the candidate's own materials + the JD; no
  // file writes. Returns the tailored résumé + a short "what changed & why" note.
  app.post('/api/cv-studio/tailor', llmRateLimit, async (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    // Prompt-override: if the caller supplies a `prompt`, run it VERBATIM instead
    // of rebuilding from jd/ctx. This is what the Tailoring page's editable prompt
    // uses — what you see in the textarea is exactly what runs.
    const override = (typeof body.prompt === 'string' ? body.prompt : '').trim();
    if (override) {
      if (override.length < 40) {
        return res.status(400).json({ error: 'prompt too short — paste or keep the assembled tailoring prompt (~40+ characters)' });
      }
      if (!body.run) {
        return res.json({ mode: 'manual', prompt: override, message: 'Set { run: true } to run this exact prompt, or copy it into any LLM.' });
      }
      const rr = await runActiveProvider(override);
      if (rr.mode === 'too-large') {
        return res.status(413).json({ error: 'prompt too large', details: [`prompt is ${rr.size} bytes; soft cap is ${rr.cap}.`] });
      }
      if (rr.mode === 'manual') return res.json({ mode: 'manual', prompt: override, message: 'No provider available — copy this prompt into any LLM.' });
      if (rr.error) return res.status(502).json({ mode: rr.mode, prompt: override, error: rr.error });
      return res.json({ mode: rr.mode, prompt: override, markdown: cleanLlmMarkdown(rr.markdown), usage: rr.usage });
    }
    const jd = (typeof body.jd === 'string' ? body.jd : '').slice(0, MAX_JD).trim();
    if (!jd || jd.length < 40) {
      return res.status(400).json({ error: 'paste the target job description (~40+ characters) to tailor against' });
    }
    const headline = (typeof body.headline === 'string' ? body.headline : '').replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_HEADLINE);
    const lang = resolveLocale(req);
    const ctx = bundleProjectContext({});
    if (!ctx) {
      return res.status(400).json({ error: 'no candidate materials yet — add your CV / profile first, so the tailoring is about you' });
    }
    const prompt = buildTailorPrompt(ctx, jd, headline, lang);

    if (!body.run) {
      return res.json({
        mode: 'manual',
        prompt,
        message: providerAvailable()
          ? 'Set { run: true } to tailor live, or copy this prompt into any LLM.'
          : 'No API key set — copy this prompt into any LLM, then paste the result back.',
      });
    }
    const r = await runActiveProvider(prompt);
    if (r.mode === 'too-large') {
      return res.status(413).json({ error: 'prompt too large', details: [`assembled prompt is ${r.size} bytes; soft cap is ${r.cap}.`] });
    }
    if (r.mode === 'manual') return res.json({ mode: 'manual', prompt, message: 'No provider available — copy this prompt into any LLM.' });
    if (r.error) return res.status(502).json({ mode: r.mode, prompt, error: r.error });
    return res.json({ mode: r.mode, prompt, markdown: cleanLlmMarkdown(r.markdown), usage: r.usage });
  });

  // v1.117.0 (modes/add.md, generalized) — "Add to CV".
  // Turn a source (a GitHub repo / article / portfolio URL, or pasted text)
  // into ATS-ready CV bullet points GROUNDED ONLY in that source. The model is
  // forbidden from inventing metrics, employers, or dates — anything not in
  // the source is omitted (the "keywords get reformulated, never fabricated"
  // rule). Returns SUGGESTIONS ONLY: no file is ever written — the user reviews
  // the bullets and pastes what they accept into the CV editor themselves,
  // which goes through the normal PUT /api/cv (stripDangerousMarkdown) path.
  // A URL source must pass isValidJobUrl and is fetched via the DNS-pinned
  // safeGet (the SSRF envelope), size-capped and HTML-stripped.
  app.post('/api/cv-studio/add-entry', llmRateLimit, async (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    let source = (typeof body.text === 'string' ? body.text : '').slice(0, MAX_JD).trim();
    let origin = 'pasted text';
    const url = (typeof body.url === 'string' ? body.url : '').trim();
    if (!source && url) {
      if (!isValidJobUrl(url)) {
        return res.status(400).json({ error: 'invalid or unsafe URL' });
      }
      try {
        const r = await safeGet(url, { timeoutMs: 15_000, maxBytes: 512 * 1024 });
        if (r.status < 200 || r.status >= 300) {
          return res.status(422).json({ error: `source fetch failed (HTTP ${r.status})` });
        }
        // Plain-TEXT extraction for an LLM prompt (never rendered as HTML —
        // the client renders answers through UI.md, the escape-first
        // boundary). Drop script/style CONTENT, strip tags to a fixed point
        // (a strip can reveal a new tag), then remove every remaining < / >
        // outright. The [<>] sweep below is what makes the bounded 8-pass loop
        // safe: even if the cap trips, no angle bracket — hence no partial
        // tag — can survive it (CodeQL incomplete-multi-character-sanitization).
        let text = String(r.body || '')
          .replace(/<script\b[\s\S]*?<\/script[^>]*>/gi, ' ')
          .replace(/<style\b[\s\S]*?<\/style[^>]*>/gi, ' ');
        let prev;
        let passes = 0;
        do { prev = text; text = text.replace(/<[^>]*>/g, ' '); } while (text !== prev && ++passes < 8);
        source = text
          .replace(/[<>]/g, ' ')
          .replace(/\s+/g, ' ')
          .slice(0, MAX_JD)
          .trim();
        origin = url;
      } catch (e) {
        return res.status(422).json({ error: `source fetch failed: ${String(e && e.message || e).slice(0, 200)}` });
      }
    }
    if (!source || source.length < 80) {
      return res.status(400).json({ error: 'provide a source: a URL or pasted text (~80+ characters) describing the project/publication/role' });
    }
    const lang = resolveLocale(req);
    const ctx = bundleProjectContext({});
    const prompt = [
      'You are career-ops CV Studio in "add to CV" mode.',
      `Respond in language: ${lang}.`,
      '',
      'TASK: turn the SOURCE below into CV-ready content the candidate can paste into their CV:',
      '1. A one-line entry title (project/publication/role name + a dash + a one-clause summary).',
      '2. 2-4 ATS-friendly bullet points (impact verbs; concrete tech nouns from the source).',
      '3. A "Skills to add" line listing only technologies/methods that literally appear in the source.',
      '',
      'HARD RULES:',
      '- Ground EVERY claim in the SOURCE text. If a metric, employer, date, or outcome is not in the source, OMIT it — never invent or estimate.',
      '- Do not claim authorship or a role the source does not state.',
      '- If the source is too thin to support even one honest bullet, say so instead of padding.',
      ctx ? '- The CANDIDATE CONTEXT is for tone/dedup only (skip bullets the CV already has) — never copy claims from it into the new entry.' : '',
      '',
      `SOURCE (${origin}):`,
      '"""',
      source,
      '"""',
      ctx ? '\nCANDIDATE CONTEXT (tone/dedup only):\n"""\n' + ctx.slice(0, 12_000) + '\n"""' : '',
    ].filter(Boolean).join('\n');

    if (!body.run) {
      return res.json({
        mode: 'manual',
        prompt,
        message: providerAvailable()
          ? 'Set { run: true } to generate live, or copy this prompt into any LLM.'
          : 'No API key set — copy this prompt into any LLM, then paste the result back.',
      });
    }
    const r = await runActiveProvider(prompt);
    if (r.mode === 'too-large') {
      return res.status(413).json({ error: 'prompt too large', details: [`assembled prompt is ${r.size} bytes; soft cap is ${r.cap}.`] });
    }
    if (r.mode === 'manual') return res.json({ mode: 'manual', prompt, message: 'No provider available — copy this prompt into any LLM.' });
    if (r.error) return res.status(502).json({ mode: r.mode, prompt, error: r.error });
    return res.json({ mode: r.mode, markdown: cleanLlmMarkdown(r.markdown), usage: r.usage });
  });

  // POST /api/cv-studio/verify-facts — a zero-token truthfulness gate. Writes the
  // client's generated CV / cover-letter text to a throwaway temp file (never the
  // parent), then runs verify-cv-facts.mjs against it with cv.md + profile +
  // two-pager as the source of truth, returning a pass / warn / block verdict plus
  // the exact invented metrics, unsupported facts, and forbidden / warn phrases.
  // No LLM, no writes to the user's files; the temp dir is removed in a finally.
  app.post('/api/cv-studio/verify-facts', llmRateLimit, async (req, res) => {
    const body = req.body || {};
    const text = (typeof body.text === 'string' ? body.text : '').slice(0, MAX_VERIFY).trim();
    if (!text) return res.status(400).json({ error: 'no text to verify' });
    const script = 'verify-cv-facts.mjs';
    if (!existsSync(resolve(PROJECT_ROOT, script))) {
      return res.json({ available: false, reason: 'script-not-found' });
    }
    let dir = null;
    try {
      dir = mkdtempSync(join(tmpdir(), 'coui-verify-'));
      const tmp = join(dir, 'candidate.md');
      writeFileSync(tmp, text, 'utf8');
      const argv = [tmp, '--source', 'cv.md', '--source', 'config/profile.yml', '--source', 'config/two-pager.yml', '--json'];
      const r = await runNodeScript(script, argv, { timeoutMs: 30_000 });
      const data = parseJsonStdout(r.stdout);
      // verify-cv-facts.mjs exits 1 on a 'block' verdict but still prints the
      // JSON verdict — a block is a SUCCESSFUL check, not a script error. Trust
      // the JSON whenever it carries a verdict; fail soft only on timeout or
      // unparseable output.
      if (r.killed) {
        return res.json({ available: false, reason: 'timeout', detail: sanitizeDetail(r.stderr) });
      }
      if (!data || typeof data.verdict !== 'string') {
        return res.json({ available: false, reason: 'script-error', detail: sanitizeDetail(r.stderr) });
      }
      return res.json({ available: true, ...data });
    } catch (e) {
      return res.json({ available: false, reason: 'script-error', detail: sanitizeDetail(String((e && e.message) || e)) });
    } finally {
      if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    }
  });
}
