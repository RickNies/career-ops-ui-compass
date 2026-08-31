/**
 * Shared "run against the active LLM provider" helper (v1.90.0).
 *
 * The provider cascade (Anthropic → Gemini → OpenAI → Qwen → OpenRouter →
 * GitHub Models → manual) was previously inlined per-endpoint in
 * `routes/llm.mjs`. New live-LLM features (mock interview, …) need the exact
 * same cascade, so it lives here as one well-bounded unit. `routes/llm.mjs`
 * keeps its own copy for now (adopting this is a separate refactor); this
 * module is the single source of truth for any NEW live-LLM route.
 *
 * Honesty contract: the same soft size-cap and manual fallback the rest of
 * the app uses. No provider key ⇒ `{ mode: 'manual' }` and the caller returns
 * the copy-paste prompt — never a fabricated answer.
 */
import { runAnthropic, hasAnthropicKey, hasGeminiKey } from './anthropic.mjs';
import { runGemini } from './gemini.mjs';
import {
  runOpenAI, runQwen, runOpenRouter, runGitHubModels, runHermes,
  hasOpenAIKey, hasQwenKey, hasOpenRouterKey, hasGitHubModelsKey, hasHermesKey,
} from './openai.mjs';
import { providerOrder } from './env-config.mjs';
import { recordUsage } from './llm-usage.mjs';

// Mirror llm.mjs BF-3 soft cap: 200 KB ≈ ~50K tokens.
export const PROMPT_SIZE_SOFT_CAP = 200 * 1024;

// v1.157.0 — a forced provider whose key isn't set falls back to the auto order
// among the configured keys (mirrors env-config.mjs::selectActiveProvider +
// routes/llm.mjs::_provGate), so a stale `LLM_PROVIDER=claude` never dead-ends a
// user whose only key is e.g. OpenRouter. A forced provider that DOES have a key
// stays forced.
function _hasKeyFor(p) {
  return (p === 'anthropic' && hasAnthropicKey())
    || (p === 'gemini' && hasGeminiKey())
    || (p === 'openai' && hasOpenAIKey())
    || (p === 'qwen' && hasQwenKey())
    || (p === 'openrouter' && hasOpenRouterKey())
    || (p === 'github' && hasGitHubModelsKey())
    || (p === 'hermes' && hasHermesKey());
}
function gate() {
  let o = providerOrder();
  if (o.length === 1 && !_hasKeyFor(o[0])) {
    o = ['anthropic', 'gemini', 'openai', 'qwen', 'openrouter', 'github', 'hermes'];
  }
  return {
    wantAnthropic: o.includes('anthropic'), wantGemini: o.includes('gemini'),
    wantOpenAI: o.includes('openai'), wantQwen: o.includes('qwen'),
    wantOpenRouter: o.includes('openrouter'), wantGitHub: o.includes('github'),
    wantHermes: o.includes('hermes'),
  };
}

/** First keyed provider in the auto tail (OpenAI → Qwen → OpenRouter → GitHub → Hermes), or null. */
function tailProvider(g) {
  if (g.wantOpenAI && hasOpenAIKey()) return { mode: 'openai', run: runOpenAI };
  if (g.wantQwen && hasQwenKey()) return { mode: 'qwen', run: runQwen };
  if (g.wantOpenRouter && hasOpenRouterKey()) return { mode: 'openrouter', run: runOpenRouter };
  if (g.wantGitHub && hasGitHubModelsKey()) return { mode: 'github', run: runGitHubModels };
  if (g.wantHermes && hasHermesKey()) return { mode: 'hermes', run: runHermes };
  return null;
}

/** True when at least one provider key is configured (any provider). */
export function providerAvailable() {
  return hasAnthropicKey() || hasGeminiKey() || hasOpenAIKey()
    || hasQwenKey() || hasOpenRouterKey() || hasGitHubModelsKey() || hasHermesKey();
}

// ─── Rate-limit / quota detection + local fallback (v1.158.0) ──────────────
// Providers surface a hit rate-limit/quota in different shapes — an HTTP 429,
// Gemini's `RESOURCE_EXHAUSTED` status, or a plain "rate limit"/"quota"
// message from Anthropic/OpenAI-compatible APIs. Every provider client in
// this app (anthropic.mjs / gemini.mjs / openai.mjs) folds its HTTP status
// into the `error` string it returns (`HTTP ${res.status}` when the body has
// no clearer detail), so matching on the string covers all of them without
// each client needing to plumb a separate status code through.
const RATE_LIMIT_PATTERNS = [
  /RESOURCE_EXHAUSTED/i, /rate.?limit/i, /\b429\b/, /\bquota\b/i, /too many requests/i,
];

/** True when `errorStr` (a provider's `{ error }` string) looks like a rate-limit/quota hit. */
export function isRateLimitError(errorStr) {
  return !!errorStr && RATE_LIMIT_PATTERNS.some((re) => re.test(String(errorStr)));
}

const PROVIDER_LABELS = {
  anthropic: 'Anthropic', gemini: 'Gemini', openai: 'OpenAI', qwen: 'Qwen',
  openrouter: 'OpenRouter', github: 'GitHub Models', hermes: 'Hermes',
};

/**
 * The exact user-facing copy for a rate-limited provider — always names the
 * provider and always points at Settings, so a rate limit is never a silent
 * dead end. `fellBack: true` appends a note that the request was retried and
 * succeeded via the local Qwen model instead.
 */
export function rateLimitMessage(providerMode, fellBack) {
  const label = PROVIDER_LABELS[providerMode] || providerMode || 'your provider';
  const base = `You've hit ${label}'s rate limit for now — switch models or providers in Settings.`;
  return fellBack ? `${base} We retried automatically with the local Qwen model instead.` : base;
}

/**
 * When `error` looks like a rate-limit/quota hit AND a different provider
 * (local Qwen) is configured, retry once via Qwen so the user isn't just
 * stuck. Returns:
 *   null                                          — not applicable (not a
 *                                                    rate-limit error, the
 *                                                    failing provider WAS
 *                                                    qwen, or no Qwen key)
 *   { mode: 'qwen', markdown, usage, message }     — fallback succeeded
 *   { mode: 'qwen', error, message }               — fallback attempted, also failed
 * Callers merge the `null`-vs-not decision with their own error handling;
 * `message` is always the exact rate-limit copy from rateLimitMessage().
 */
export async function tryRateLimitFallback(primaryMode, error, fullPrompt, opts = {}) {
  if (!isRateLimitError(error) || primaryMode === 'qwen' || !hasQwenKey()) return null;
  const r = await runQwen(fullPrompt, opts);
  if (!r.error) {
    recordUsage('qwen', r.usage);
    return { mode: 'qwen', markdown: r.markdown, usage: r.usage, message: rateLimitMessage(primaryMode, true) };
  }
  return { mode: 'qwen', error: r.error, message: rateLimitMessage(primaryMode, false) };
}

/**
 * Run `fullPrompt` through the active provider cascade.
 *
 * @returns one of:
 *   { mode, markdown, usage }                       — success
 *   { mode, markdown, usage, rateLimited, message,
 *     fellBackTo: 'qwen', rateLimitProvider }        — the first-choice provider
 *                                                       was rate-limited; Qwen
 *                                                       picked it up automatically
 *   { mode, error, rateLimited, message }            — rate-limited AND no
 *                                                       (working) fallback
 *   { mode, error }                                  — the chosen provider
 *                                                       errored for another reason
 *   { mode: 'manual' }                                — no provider available
 *                                                        (caller returns the
 *                                                        copy-paste prompt)
 *   { mode: 'too-large', size, cap }                  — prompt exceeds the soft cap
 */
export async function runActiveProvider(fullPrompt, { sizeCap = PROMPT_SIZE_SOFT_CAP } = {}) {
  if (typeof fullPrompt !== 'string' || !fullPrompt) return { mode: 'manual' };
  if (fullPrompt.length > sizeCap) return { mode: 'too-large', size: fullPrompt.length, cap: sizeCap };

  const g = gate();
  let primary;
  if (g.wantAnthropic && hasAnthropicKey()) {
    const r = await runAnthropic(fullPrompt);
    if (!r.error) recordUsage('anthropic', r.usage);
    primary = r.error ? { mode: 'anthropic', error: r.error } : { mode: 'anthropic', markdown: r.markdown, usage: r.usage };
  } else if (g.wantGemini && hasGeminiKey()) {
    const r = await runGemini(fullPrompt);
    if (!r.error) recordUsage('gemini', r.usage);
    primary = r.error ? { mode: 'gemini', error: r.error } : { mode: 'gemini', markdown: r.markdown, usage: r.usage };
  } else {
    const tp = tailProvider(g);
    if (tp) {
      const r = await tp.run(fullPrompt);
      if (!r.error) recordUsage(tp.mode, r.usage);
      primary = r.error ? { mode: tp.mode, error: r.error } : { mode: tp.mode, markdown: r.markdown, usage: r.usage };
    } else {
      primary = { mode: 'manual' };
    }
  }

  if (!primary.error) return primary;

  // No silent failures on a rate limit: always tell the user, and fall back
  // to local Qwen automatically when it's configured and wasn't the provider
  // that just failed.
  const fb = await tryRateLimitFallback(primary.mode, primary.error, fullPrompt);
  if (fb && !fb.error) {
    return { mode: 'qwen', markdown: fb.markdown, usage: fb.usage, rateLimited: true, fellBackTo: 'qwen', rateLimitProvider: primary.mode, message: fb.message };
  }
  if (isRateLimitError(primary.error)) {
    return { ...primary, rateLimited: true, message: fb ? fb.message : rateLimitMessage(primary.mode, false) };
  }
  return primary;
}
