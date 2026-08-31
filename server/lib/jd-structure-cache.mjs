/**
 * jd-structure-cache.mjs — read-through reader for the pipeline's one-time
 * JD-structuring store (career-ops/data/jd-structure.jsonl).
 *
 * TIER 2 (JD fit-scoring quality): career-ops-scrape/jd_structure.py
 * segments a raw job description into {level, responsibilities[],
 * required[], preferred[], other} ONCE per posting (on the daily fit-score
 * cron, or the promote.py path) and appends one record per url to this
 * file: {url, structure, source, ts}. This module is READ-ONLY from the
 * Node side — the structuring logic itself is never duplicated across
 * languages, only computed in Python and consumed here.
 *
 * Key convention: url is normalized with the SAME weak-but-consistent
 * normalizer the whole Python pipeline already keys jd-cache.jsonl with
 * (dedup.norm_url: strip a " | ..." tail + a trailing slash — see
 * jd_structure.py). `normPipelineUrl` below is the identical helper
 * routes/pipeline.mjs already uses to read that sibling Python-authoritative
 * cache (data/jd-cache.jsonl) — deliberately NOT url-key.mjs's
 * normalizeUrl(), which is stricter (forces https, sorts query params,
 * strips tracking params) and would silently miss every Python-written key.
 */
import { readFileSync, statSync } from 'node:fs';
import { path as projPath } from './paths.mjs';

const JD_STRUCTURE_PATH = projPath('data', 'jd-structure.jsonl');

function normPipelineUrl(u) { return String(u || '').split('#')[0].replace(/\/+$/, ''); }

let _map = null;
let _mtime = -1;

function readCache() {
  try {
    const st = statSync(JD_STRUCTURE_PATH);
    if (_map && st.mtimeMs === _mtime) return _map;
    const map = {};
    const lines = readFileSync(JD_STRUCTURE_PATH, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j && j.url && j.structure && typeof j.structure === 'object') {
          map[normPipelineUrl(j.url)] = j.structure; // last line for a url wins
        }
      } catch { /* skip malformed line */ }
    }
    _map = map;
    _mtime = st.mtimeMs;
    return map;
  } catch {
    // File missing (fresh checkout, or no job has been structured yet) —
    // callers must treat this the same as "not structured", never throw.
    return _map || {};
  }
}

/**
 * Look up the cached structure for a posting url.
 * @param {string} url
 * @returns {object|null} the {level,responsibilities,required,preferred,other}
 *   structure, or null when nothing is cached for this url yet.
 */
export function getJdStructure(url) {
  const key = normPipelineUrl(url);
  if (!key) return null;
  return readCache()[key] || null;
}
