/* ============================================================================
 * COMPASS FORK — real-backend wiring (served only by the :8100 instance, which
 * is repointed at the REAL /Users/nick/apps/career-ops data via CAREER_OPS_ROOT).
 * Loaded AFTER each mockup's inline <script> so it can override the demo globals
 * (JOBS / render / saveReview / buildMenu / runQA …) with LIVE data.
 * ==========================================================================*/
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function hostFrom(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function normUrl(u) { return String(u || '').split('#')[0].replace(/\/+$/, ''); }
  function initials(name) {
    var w = String(name || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
    return (w[0][0] + w[1][0] + (w[2] ? w[2][0] : '')).toUpperCase().slice(0, 3);
  }
  var PALETTE = ['#B5623B', '#96702F', '#2E5C8A', '#16324F', '#2F6F5B', '#6B4E8A'];
  function colorFor(name) { var h = 0, s = String(name || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length]; }
  function locKeyFor(loc) {
    var l = String(loc || '').toLowerCase();
    if (/remote/.test(l)) return 'remote';
    if (/new york|\bny\b|nyc/.test(l)) return 'new-york';
    if (/los angeles|\bla\b/.test(l)) return 'los-angeles';
    if (/san francisco|bay area|\bsf\b/.test(l)) return 'sf-bay';
    return 'other';
  }
  function scoreToFit(row) {
    var n = (typeof row.scoreNum === 'number' && !isNaN(row.scoreNum)) ? row.scoreNum : parseFloat(String(row.score || '').split('/')[0]);
    if (isNaN(n) || n == null) return 60;
    return Math.max(0, Math.min(100, Math.round((n / 5) * 100)));
  }
  function levelFor(t) { t = String(t || ''); if (/director/i.test(t)) return 'Director'; if (/(sr\.?|senior)\s*(manager|mgr)/i.test(t)) return 'Sr Manager'; if (/manager|mgr/i.test(t)) return 'Manager'; return 'Other'; }
  function funcFor(t) { t = String(t || ''); if (/fp&?\s?a/i.test(t)) return 'FP&A'; if (/strateg/i.test(t)) return 'Strategic Finance'; if (/corporate/i.test(t)) return 'Corporate Finance'; if (/account|controll/i.test(t)) return 'Accounting'; return 'Finance'; }
  function distinct(a) { var seen = {}, out = []; a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } }); return out; }
  function jGet(u) { return fetch(u).then(function (r) { return r.json(); }); }
  function jPost(u, b) { return fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); }); }

  function banner(msg) {
    var b = document.getElementById('compassWireBanner');
    if (!b) { b = document.createElement('div'); b.id = 'compassWireBanner'; b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#16324F;color:#fff;font:600 12.5px/1.4 system-ui,sans-serif;padding:8px 16px;text-align:center;box-shadow:0 -2px 12px rgba(0,0,0,.18)'; document.body.appendChild(b); }
    b.innerHTML = '🧭 COMPASS FORK (:8100, LIVE on real career-ops data) — ' + esc(msg);
  }
  function toastMsg(msg, type) { if (window.toast) { try { window.toast(msg, type || 'info'); return; } catch (e) {} } }

  function mapRow(row) {
    var title = row.role || '';
    var j = {
      id: 'c' + (row.num || Math.random().toString(36).slice(2)),
      num: row.num, title: title, company: row.company || '', domain: hostFrom(row.url),
      mono: initials(row.company || ''), color: colorFor(row.company || ''),
      loc: row.location || '', locKey: locKeyFor(row.location), work: /remote/i.test(row.location || '') ? 'Remote' : 'On-site',
      salMin: null, salMax: null, fit: scoreToFit(row), age: 0, isNew: false, saved: false,
      cat: row.status || 'Evaluated', func: funcFor(title), level: levelFor(title),
      why: row.notes || (row.status ? ('Status: ' + row.status) : 'Imported from tracker.'),
      url: row.url || '', status: row.status || '', score: row.score || '',
      fitScored: false, verdict: '', strengths: [], gaps: []
    };
    // Join the AI fit-analysis by url when present (partial store — 91 scored).
    var f = fitFor(row.url);
    if (f && typeof f.score === 'number') {
      j.fit = f.score; j.fitScored = true; j.verdict = f.verdict || '';
      j.strengths = f.strengths || []; j.gaps = f.gaps || [];
      if (f.why) j.why = f.why;         // richer "why it fits"
    }
    // Join the real salary band (thousands) when present. Unknown → stays null
    // (matches() passes it through when "show no-salary" is on; card shows "not listed").
    var sal = salaryFor(row.url);
    if (sal) { j.salMin = (sal.min != null ? sal.min : sal.max); j.salMax = (sal.max != null ? sal.max : sal.min); j.salSource = sal.source || ''; }
    return j;
  }
  function setCurrentJob(job) { try { sessionStorage.setItem('compass_current_job', JSON.stringify(job)); } catch (e) {} }
  function getCurrentJob() { try { return JSON.parse(sessionStorage.getItem('compass_current_job') || 'null'); } catch (e) { return null; } }

  // Liveness store (annotate-only): url → live|dead|unknown. Dead rows are hidden;
  // for shown jobs the full state drives the "still open?" badge.
  function loadDead() {
    return jGet('/api/compass/liveness').then(function (j) {
      var map = (j && j.map) || {};
      window.__liveState = {}; Object.keys(map).forEach(function (u) { window.__liveState[normUrl(u)] = map[u]; });
      window.__deadSet = new Set(Object.keys(map).filter(function (u) { return map[u] === 'dead'; }).map(normUrl));
      window.__liveCounts = (j && j.counts) || {};
      return window.__deadSet;
    }).catch(function () { window.__deadSet = new Set(); window.__liveState = {}; return window.__deadSet; });
  }
  function isDead(url) { return window.__deadSet && window.__deadSet.has(normUrl(url)); }
  // 'live' | 'dead' | 'unknown' | null (not yet checked → treated as unverified).
  function liveStateFor(url) { return (window.__liveState && window.__liveState[normUrl(url)]) || null; }

  // AI fit-analysis map (url → {score,verdict,why,strengths,gaps}); partial.
  function loadFit() {
    return jGet('/api/compass/fit').then(function (j) { window.__fitMap = (j && j.map) || {}; return window.__fitMap; }).catch(function () { window.__fitMap = {}; return {}; });
  }
  function fitFor(url) { return (window.__fitMap && window.__fitMap[normUrl(url)]) || null; }
  // Salary bands (thousands), partial + growing.
  function loadSalary() {
    return jGet('/api/compass/salary').then(function (j) { window.__salaryMap = (j && j.map) || {}; return window.__salaryMap; }).catch(function () { window.__salaryMap = {}; return {}; });
  }
  function salaryFor(url) { return (window.__salaryMap && window.__salaryMap[normUrl(url)]) || null; }
  function fmtSalary(s) { // {min,max} in K → "$185–225K" or "$260K"
    if (!s) return '';
    var lo = s.min, hi = s.max;
    if (lo == null && hi == null) return '';
    if (lo != null && hi != null && lo !== hi) return '$' + lo + '–' + hi + 'K';
    var v = (hi != null ? hi : lo); return '$' + v + 'K';
  }
  // still-open badge from liveness state (inline-styled so it's robust across pages):
  // live → green "Open"; anything else → subtle "Unverified" (never "Open").
  function openPillHtml(url) {
    if (liveStateFor(url) === 'live') return '<span class="compass-livebadge" data-live="open" style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:#e3efe9;color:#2f6f5b;font:700 11px system-ui;white-space:nowrap"><span style="width:6px;height:6px;border-radius:50%;background:#2f6f5b"></span>Open</span>';
    return '<span class="compass-livebadge" data-live="unknown" title="Not yet confirmed live" style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:#eee9de;color:#6b6255;font:700 11px system-ui;white-space:nowrap">Unverified</span>';
  }
  function setOpenBadge(el, url) {
    if (!el) return;
    if (liveStateFor(url) === 'live') { el.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:#e3efe9;color:#2f6f5b;font:700 11px system-ui'; el.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#2f6f5b"></span>Open'; el.removeAttribute('title'); el.setAttribute('data-live', 'open'); }
    else { el.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:#eee9de;color:#6b6255;font:700 11px system-ui'; el.innerHTML = 'Unverified'; el.title = 'Not yet confirmed live'; el.setAttribute('data-live', 'unknown'); }
    el.className = 'compass-livebadge';
  }
  // Verdict → [textColor, bgColor]. Reuses the evaluation summary-box semantics.
  function verdictColors(v) {
    v = String(v || '').toLowerCase();
    if (/strong|good/.test(v)) return ['#2f6f5b', '#e3efe9'];
    if (/fair|medium/.test(v)) return ['#8a6a3b', '#f6ecd6'];
    if (/pass|weak|poor/.test(v)) return ['#9c5231', '#f4e3db'];
    return ['#6b6255', '#eee9de'];
  }
  function verdictPill(v) { var c = verdictColors(v); return '<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:' + c[1] + ';color:' + c[0] + ';font:700 11px system-ui;white-space:nowrap">' + esc(v) + '</span>'; }

  // Active-provider cache (one GET per page load) so LLM progress copy is honest:
  // Claude/cloud = fast; hermes = local + "can take a few minutes".
  var PROV = { activeProvider: null, activeModel: null, loaded: false };
  function loadProvider() {
    return jGet('/api/status/providers').then(function (s) { PROV.activeProvider = (s && s.activeProvider) || null; PROV.activeModel = (s && s.activeModel) || null; PROV.loaded = true; }).catch(function () { PROV.loaded = false; });
  }
  var PROV_NAMES = { anthropic: 'Claude', gemini: 'Gemini', openai: 'OpenAI', qwen: 'Qwen', openrouter: 'OpenRouter', github: 'GitHub Models', hermes: 'the local model' };
  function provIsLocal() { return PROV.activeProvider === 'hermes' || !PROV.activeProvider; }
  // Progress line for an in-flight LLM action, e.g. llmProgress('Tailoring').
  function llmProgress(verb) {
    if (!PROV.activeProvider) return verb + '…'; // honest neutral fallback (no provider claim)
    var model = PROV.activeModel ? ' (' + PROV.activeModel + ')' : '';
    if (PROV.activeProvider === 'hermes') return verb + ' on the local model' + model + ' — can take a few minutes…';
    return verb + ' with ' + (PROV_NAMES[PROV.activeProvider] || PROV.activeProvider) + model + '…';
  }
  // Short descriptor for banners/buttons, e.g. "running on Claude (claude-sonnet-5)".
  function llmDesc() {
    if (!PROV.activeProvider) return 'the configured provider';
    var model = PROV.activeModel ? ' (' + PROV.activeModel + ')' : '';
    return (PROV.activeProvider === 'hermes' ? 'the local model' + model + ', slow' : PROV_NAMES[PROV.activeProvider] + model + ', fast');
  }

  // Start a background generation job and poll it to completion.
  function startJob(payload, cbStarted, cbDone, cbError) {
    jPost('/api/compass/generate', payload).then(function (r) {
      var id = r.body && r.body.jobId;
      if (!id) { cbError('could not start job (' + ((r.body && r.body.error) || r.status) + ')'); return; }
      if (cbStarted) cbStarted(id);
      var t = setInterval(function () {
        jGet('/api/compass/jobs/' + id).then(function (j) {
          if (j.status === 'done') { clearInterval(t); cbDone(j); }
          else if (j.status === 'error') { clearInterval(t); cbError(j.error || 'generation failed', j); }
        }).catch(function () { });
      }, 3000);
    }).catch(function (e) { cbError(String(e)); });
  }
  function libLink() { return '<a href="library.html" style="color:#2f6f5b;font-weight:600">Generated-content Library</a>'; }

  var page = (location.pathname.split('/').pop() || '').toLowerCase();

  // CANONICAL nav — rebuilt identically on EVERY Compass page so the item set,
  // order, styling and active-highlight are consistent (fixes per-page drift +
  // the JS-injected Library link that missed the active state). Active is driven
  // by the current page. Uses the mockups' `.nav a.active{background:ink;color:#fff}`
  // blue-button style, which every page's CSS already defines.
  var NAV_ITEMS = [
    { href: 'dashboard.html', label: 'Dashboard' },
    { href: 'jobs.html', label: 'Jobs' },
    { href: 'saved.html', label: 'My Jobs' },
    { href: 'documents.html', label: 'Documents' },
    { href: 'outreach.html', label: 'Outreach' },
    { href: 'library.html', label: 'Library' },
    { href: 'setup.html', label: 'Setup' }
  ];
  // The header must be PIXEL-STABLE across pages, but each page's .topbar-in has
  // a different max-width (Jobs 1320 / most 960 / Setup 760), which shifts the
  // centered brand+nav when navigating. Force ONE header geometry everywhere
  // (widest = 1320px) so brand/nav x-positions never move. Content .wrap keeps
  // its own per-page width — only the HEADER is standardized.
  function ensureHeaderStyles() {
    if (document.getElementById('compassHeaderStyles')) return;
    var st = document.createElement('style'); st.id = 'compassHeaderStyles';
    st.textContent = '.topbar-in{max-width:1320px !important;margin-left:auto !important;margin-right:auto !important;padding-left:22px !important;padding-right:22px !important}';
    document.head.appendChild(st);
  }
  function renderNav() {
    ensureHeaderStyles();
    var nav = document.querySelector('nav.nav') || document.querySelector('.nav');
    if (!nav) return;
    var cur = page || 'dashboard.html';
    nav.innerHTML = NAV_ITEMS.map(function (n) { return '<a href="' + n.href + '"' + (n.href === cur ? ' class="active"' : '') + '>' + esc(n.label) + '</a>'; }).join('');
    // Setup is now a first-class nav item — hide the redundant gear icon if present.
    var gear = document.querySelector('.gear'); if (gear) gear.style.display = 'none';
  }

  // ======================= JOBS ============================================
  var PAGE_SIZE = 50;
  function compassRender() {
    if (!window.JOBS || typeof window.matches !== 'function' || typeof window.cardHTML !== 'function') return;
    var all = window.JOBS.filter(window.matches);
    var st = window.state ? window.state.sort : 'best';
    // "best" = AI-scored jobs first (by fit score desc), then the rest.
    if (st === 'best') all.sort(function (a, b) { var as = a.fitScored ? 1 : 0, bs = b.fitScored ? 1 : 0; if (as !== bs) return bs - as; return (b.fit || 0) - (a.fit || 0); });
    else if (st === 'new') all.sort(function (a, b) { return a.age - b.age; });
    else if (st === 'salary') all.sort(function (a, b) { return (b.salMax || 0) - (a.salMax || 0); });
    window.__compassMatched = all;
    var shown = Math.min(window.__compassShown || PAGE_SIZE, all.length);
    var list = document.getElementById('list');
    if (list) list.innerHTML = all.slice(0, shown).map(window.cardHTML).join('');
    var empty = document.getElementById('empty'); if (empty) empty.style.display = all.length ? 'none' : 'block';
    var cnt = document.getElementById('count');
    if (cnt) cnt.innerHTML = 'Showing <b>' + shown + '</b> of <b>' + all.length + '</b> matching · ' + window.JOBS.length + ' live jobs loaded';
    var mb = document.getElementById('compassMore');
    if (!mb && list) { mb = document.createElement('div'); mb.id = 'compassMore'; mb.style.cssText = 'text-align:center;margin:16px 0 90px'; list.parentNode.insertBefore(mb, list.nextSibling); }
    if (mb) {
      if (shown < all.length) { mb.innerHTML = '<button class="btn btn--outline" type="button">Load more — ' + (all.length - shown) + ' more</button>'; mb.firstChild.onclick = function () { window.__compassShown = shown + PAGE_SIZE; compassRender(); }; }
      else mb.innerHTML = '';
    }
    if (window.renderRail) window.renderRail();
    if (window.renderActiveFilters) window.renderActiveFilters();
    if (window.bindCards) window.bindCards();
    enhanceCards(list);
    if (window.saveFilters) window.saveFilters();
  }

  // Add a secondary "View job posting ↗" (external, new tab) UNDER the internal
  // "View" button on each card. Hidden for rows with no url.
  function enhanceCards(root) {
    (root || document).querySelectorAll('.card[data-id]').forEach(function (card) {
      var side = card.querySelector('.side');
      if (!side || side.querySelector('.compass-ext')) return;
      var job = (window.JOBS || []).find(function (x) { return x.id === card.getAttribute('data-id'); });
      if (!job || !job.url) return;
      var viewBtn = side.querySelector('.view');
      var a = document.createElement('a');
      a.className = 'btn btn--outline btn--sm compass-ext';
      a.href = job.url; a.target = '_blank'; a.rel = 'noopener';
      a.style.cssText = 'margin-top:8px;white-space:nowrap';
      a.innerHTML = 'View job posting <span style="font-size:12px">↗</span>';
      a.addEventListener('click', function (e) { e.stopPropagation(); }); // don't trigger the card→internal nav
      if (viewBtn && viewBtn.parentNode) viewBtn.parentNode.insertBefore(a, viewBtn.nextSibling);
      else side.appendChild(a);
      // AI fit-analysis: colored verdict pill (replaces the generic fit label) +
      // an expandable strengths/gaps. Score /100 is already the ring number.
      if (job.fitScored) {
        var lbl = card.querySelector('.fit .lbl');
        if (lbl && job.verdict) lbl.innerHTML = verdictPill(job.verdict);
        var why = card.querySelector('.why');
        if (why && !why.querySelector('.fit-sg') && ((job.strengths && job.strengths.length) || (job.gaps && job.gaps.length))) {
          var det = document.createElement('details'); det.className = 'fit-sg'; det.style.cssText = 'margin-top:7px';
          det.addEventListener('click', function (e) { e.stopPropagation(); });
          det.innerHTML = '<summary style="cursor:pointer;font:600 12px system-ui;color:#2f6f5b">Strengths &amp; gaps</summary>' +
            '<div style="margin-top:6px;font:12.5px/1.55 system-ui">' +
            (job.strengths || []).map(function (s) { return '<div style="color:#2f6f5b">✓ ' + esc(s) + '</div>'; }).join('') +
            (job.gaps || []).map(function (s) { return '<div style="color:#9c5231">△ ' + esc(s) + '</div>'; }).join('') + '</div>';
          why.appendChild(det);
        }
      }
      // Real "still open?" badge from the liveness map (live → Open, else Unverified).
      setOpenBadge(card.querySelector('.meta [data-live]'), job.url);
    });
  }

  function wireJobs() {
    // GET /api/tracker with NO paging params → { rows: <ALL rows> }
    jGet('/api/tracker').then(function (data) {
      var rows = (data && data.rows) || [];
      var loaded = rows.length;
      window.JOBS = rows.map(mapRow).filter(function (j) { return !isDead(j.url); });
      window.JOBS.forEach(function (j) { j.open = !isDead(j.url); });
      var hidden = loaded - window.JOBS.length;
      window.__compassShown = PAGE_SIZE;

      document.addEventListener('click', function (e) {
        var card = e.target.closest ? e.target.closest('.card[data-id]') : null;
        if (!card) return;
        var id = card.getAttribute('data-id');
        var job = (window.JOBS || []).find(function (x) { return x.id === id; });
        if (job) setCurrentJob(job);
      }, true);

      if (typeof window.saveReview === 'function' && !window.__compassFbWrapped) {
        var orig = window.saveReview;
        window.saveReview = function (id, verdict, reason, note) {
          orig(id, verdict, reason, note);
          if (verdict !== 'good' && verdict !== 'bad') return;
          var job = (window.JOBS || []).find(function (x) { return x.id === id; });
          if (!job || !job.url) return;
          jPost('/api/compass/feedback', { url: job.url, verdict: verdict, reason: reason || '' })
            .then(function (r) { toastMsg(r.body && r.body.ok ? 'Recorded to feedback.jsonl (' + verdict + ')' : 'Saved locally — server write failed', r.body && r.body.ok ? 'success' : 'info'); })
            .catch(function () { toastMsg('Saved locally — server unreachable', 'info'); });
        };
        window.__compassFbWrapped = true;
      }

      try {
        var cats = distinct(window.JOBS.map(function (j) { return j.cat; }));
        var funcs = distinct(window.JOBS.map(function (j) { return j.func; }));
        var levels = distinct(window.JOBS.map(function (j) { return j.level; }));
        window.CATS = cats; window.FUNCS = funcs; window.LEVELS = levels;
        if (typeof window.buildMenu === 'function') { window.buildMenu('catMenu', 'cat-cb', cats); window.buildMenu('funcMenu', 'func-cb', funcs); window.buildMenu('lvlMenu', 'lvl-cb', levels); }
        if (typeof window.wireCb === 'function' && window.state) {
          window.wireCb('.cat-cb', window.state.cats, 'catLabel', '', 'Status');
          window.wireCb('.func-cb', window.state.funcs, 'funcLabel', '', 'Function');
          window.wireCb('.lvl-cb', window.state.levels, 'lvlLabel', '', 'Level');
        }
        var cl = document.getElementById('catLabel'); if (cl) cl.textContent = 'Status';
      } catch (e) { /* keep default menus */ }

      if (typeof window.runQA !== 'undefined') window.runQA = compassRunQA;

      // Salary display: real band where known, "Salary not listed" where unknown.
      window.fmtSal = function (j) { if (j.salMin == null && j.salMax == null) return 'Salary not listed'; return fmtSalary({ min: j.salMin, max: j.salMax }); };
      // Setup comp floor (localStorage compass_setup.floor, in K): drop jobs whose
      // KNOWN max is below the floor; unknown-salary jobs are kept (flagged).
      var COMP_FLOOR = (function () { try { var s = JSON.parse(localStorage.getItem('compass_setup') || 'null'); return s && s.floor ? +s.floor : 0; } catch (e) { return 0; } })();
      if (typeof window.matches === 'function' && !window.__compassMatchesWrapped) {
        var baseMatches = window.matches;
        // The mockup's own salary slider (state.salLow/High + "show no-salary") runs
        // inside baseMatches and already passes unknown-salary rows through by default.
        window.matches = function (j) { if (!baseMatches(j)) return false; if (COMP_FLOOR && j.salMax != null && j.salMax < COMP_FLOOR) return false; return true; };
        window.__compassMatchesWrapped = true;
      }

      window.render = compassRender;   // paginated render over the full set
      compassRender();
      var knownSal = window.JOBS.filter(function (j) { return j.salMax != null; }).length;
      banner('Jobs LIVE — ' + window.JOBS.length + ' shown of ' + loaded + ' (' + hidden + ' dead hidden). Salary is REAL where known (' + knownSal + ' with a band, filtered by the slider' + (COMP_FLOOR ? ' + $' + COMP_FLOOR + 'K comp floor' : '') + '); unknown-salary jobs pass through, flagged "not listed". "Open" = liveness-confirmed live, else "Unverified".');
    }).catch(function (e) { banner('Could not load live jobs: ' + e); });
  }

  function compassRunQA() {
    var inp = document.getElementById('qaUrl'); if (!inp) return;
    var url = inp.value.trim(); if (!url) { inp.focus(); return; }
    var host = document.querySelector('.qa-body') || (window.qaBody || null);
    function set(html) { if (host) host.innerHTML = html; }
    set('<h2>Adding your job…</h2><ul class="qa-steps">' +
      '<li id="qsPipe" class="doing">Saving the link to your pipeline…</li>' +
      '<li id="qsPrev">Reading the posting (live fetch)…</li>' +
      '<li id="qsEval">' + esc(llmProgress('Scoring your fit')) + '</li></ul>' +
      '<div class="qa-actions"><button class="btn btn--outline" id="qaCancel2" type="button">Close</button></div>');
    var c = document.getElementById('qaCancel2'); if (c) c.onclick = function () { if (window.closeModal) window.closeModal(); };
    function done(id) { var el = document.getElementById(id); if (el) { el.classList.remove('doing'); el.classList.add('done'); } }
    function doing(id) { var el = document.getElementById(id); if (el) el.classList.add('doing'); }
    var jd = '';
    jPost('/api/pipeline', { url: url }).then(function (r) {
      done('qsPipe'); doing('qsPrev'); var p = r.body;
      var el = document.getElementById('qsPipe'); if (el) el.textContent = p && p.ok ? (p.deduped ? 'Already in your pipeline ✓' : 'Saved to pipeline ✓') : ('Pipeline: ' + (p && p.error || 'error'));
      return jGet('/api/pipeline/preview?url=' + encodeURIComponent(url));
    }).then(function (prev) {
      done('qsPrev'); doing('qsEval'); jd = (prev && prev.text) || '';
      var el = document.getElementById('qsPrev'); if (el) el.textContent = jd ? ('Read the posting ✓ (' + jd.length + ' chars)') : 'Posting fetched (thin — JS-rendered board)';
      if (!jd || jd.length < 40) throw new Error('no readable JD text to score (JS-rendered board)');
      var ev = document.getElementById('qsEval'); if (ev) ev.textContent = llmProgress('Scoring your fit') + ' — background job, also in the Library';
      // route evaluation through the background job layer
      startJob({ type: 'evaluate', company: '', role: '', url: url, jd: jd },
        null,
        function (j) {
          done('qsEval'); var md = j.markdown || '';
          var m = md.match(/(\d(?:\.\d)?)\s*\/\s*5/) || md.match(/score[^\d]*(\d(?:\.\d)?)/i);
          var score = m ? Math.round(parseFloat(m[1]) / 5 * 100) : null;
          set('<div class="qa-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>Added &amp; scored</div>' +
            (score != null ? '<div class="qa-result"><div class="r-ring">' + score + '</div><div><div class="r-t">Fit scored by ' + esc(j.provider || 'AI') + '</div><div class="r-m">Live evaluation of the posting you added.</div></div></div>' : '') +
            '<div style="max-height:240px;overflow:auto;background:#faf7f0;border:1px solid #e6ddc9;border-radius:10px;padding:12px;margin-top:12px;font:13px/1.5 system-ui;white-space:pre-wrap">' + esc(md.slice(0, 4000) || '(no evaluation text)') + '</div>' +
            '<div class="qa-actions" style="margin-top:12px"><button class="btn btn--primary" id="qaDone2" type="button">Done</button></div>');
          var d = document.getElementById('qaDone2'); if (d) d.onclick = function () { if (window.closeModal) window.closeModal(); };
        },
        function (err) { done('qsEval'); set('<div class="qa-ok" style="background:#f3e2da;color:#9c5231">Scoring failed</div><p style="font:13.5px system-ui;color:#6b6255;margin-top:10px">' + esc(err) + '. The link is in your pipeline.</p><div class="qa-actions" style="margin-top:12px"><button class="btn btn--primary" id="qaDone2" type="button">Done</button></div>'); var d2 = document.getElementById('qaDone2'); if (d2) d2.onclick = function () { if (window.closeModal) window.closeModal(); }; });
      return null;
    }).catch(function (e) {
      done('qsPipe');
      set('<div class="qa-ok" style="background:#f3e2da;color:#9c5231"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6 6 18M6 6l12 12"/></svg>Saved to pipeline; live scoring unavailable</div>' +
        '<p style="font:13.5px system-ui;color:#6b6255;margin-top:10px">' + esc(String(e.message || e)) + '. The link is in your pipeline; score it later from Evaluate.</p>' +
        '<div class="qa-actions" style="margin-top:12px"><button class="btn btn--primary" id="qaDone3" type="button">Done</button></div>');
      var d = document.getElementById('qaDone3'); if (d) d.onclick = function () { if (window.closeModal) window.closeModal(); };
    });
  }

  // ======================= DASHBOARD =======================================
  function matchHTML(row) {
    var fit = scoreToFit(row); var cls = fit >= 86 ? 'fm-strong' : 'fm-good';
    var loc = (row.location || '') + (row.location && !/remote/i.test(row.location) ? ' · On-site' : '');
    return '<div class="match" data-num="' + esc(row.num) + '">' +
      '<div class="fitmini ' + cls + '">' + fit + '</div>' +
      '<span class="logo" style="--mc:' + colorFor(row.company) + '" data-mono="' + esc(initials(row.company)) + '"><img src="https://logo.clearbit.com/' + esc(hostFrom(row.url)) + '" alt="' + esc(row.company) + ' logo" onerror="this.parentNode.classList.add(\'failed\');this.remove()"></span>' +
      '<div class="minfo"><div class="t"><a href="job-detail.html">' + esc(row.role) + '</a></div><div class="m"><span>' + esc(row.company) + '</span><span>' + esc(loc) + '</span></div></div>' +
      '<a class="btn btn--outline btn--sm go" href="job-detail.html">View<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>' +
      '</div>';
  }
  function wireDash() {
    Promise.all([jGet('/api/dashboard'), jGet('/api/tracker')]).then(function (arr) {
      var d = arr[0] || {}, t = arr[1] || {};
      var live = ((t.rows) || []).filter(function (r) { return !isDead(r.url); });
      var apps = live.length;
      var by = d.byStatus || {};
      var applied = Object.keys(by).filter(function (k) { return /appl|interview|offer|hired|respond|screen|phone/i.test(k); }).reduce(function (s, k) { return s + by[k]; }, 0);
      var avgFit = (d.avgScore != null) ? Math.round((d.avgScore / 5) * 100) : null;
      var reviewed = 0; try { reviewed = Object.keys(JSON.parse(localStorage.getItem('compass_reviews') || '{}')).length; } catch (e) {}
      var ns = document.querySelectorAll('.stat .n');
      if (ns[0]) ns[0].textContent = apps;
      if (ns[2]) ns[2].textContent = applied;
      if (ns[3]) ns[3].textContent = Math.max(0, apps - reviewed);
      if (ns[4] && avgFit != null) ns[4].textContent = avgFit;
      var top = live.slice(0, 6);
      var m = document.getElementById('matches');
      if (m) {
        m.innerHTML = top.map(matchHTML).join('');
        m.querySelectorAll('.match').forEach(function (el, i) { el.addEventListener('click', function () { setCurrentJob(mapRow(top[i])); }, true); });
      }
      var lc = window.__liveCounts || {};
      banner('Dashboard LIVE — ' + apps + ' live jobs (dead hidden). Liveness: ' + (lc.dead || 0) + ' dead / ' + (lc.total || 0) + ' checked. Applied count from real statuses. "Saved" tile + schedules are demo.');
    }).catch(function (e) { banner('Could not load live dashboard: ' + e); });
  }

  // ======================= JOB DETAIL ======================================
  function wireDetail() {
    var job = getCurrentJob();
    var boot = job ? Promise.resolve(job) : jGet('/api/tracker?pageSize=1&page=1').then(function (d) { return d.rows && d.rows[0] ? mapRow(d.rows[0]) : null; });
    boot.then(function (job) {
      if (!job) { banner('No tracker row to show.'); return; }
      window.JOB_ID = job.id || window.JOB_ID;
      var h1 = document.querySelector('.head h1'); if (h1) h1.textContent = job.title;
      var co = document.querySelector('.head .company'); if (co) co.textContent = job.company;
      var logo = document.querySelector('.head .logo'); if (logo) { logo.setAttribute('data-mono', job.mono); logo.style.setProperty('--mc', job.color); var img = logo.querySelector('img'); if (img) { img.src = 'https://logo.clearbit.com/' + job.domain; img.alt = job.company + ' logo'; } }
      var pin = document.querySelector('.meta .pin'); if (pin && pin.lastChild && pin.lastChild.nodeType === 3) pin.lastChild.textContent = (job.loc || 'Location n/a') + ' · ' + job.work;
      // SINGLE SOURCE OF TRUTH for the fit score: fit-analysis /100 (GET /api/compass/fit).
      // Paint the SAME number on the "How you match" ring AND the right-rail ring.
      var ring = document.querySelector('.match-ring');
      var railR = document.querySelector('.fit-inline .r');
      var railTxt = document.querySelector('.fit-inline .txt');
      // Real salary band + still-open badge in the meta.
      var meta = document.querySelector('.meta');
      if (meta) {
        var sal = salaryFor(job.url);
        var salSpan = Array.prototype.filter.call(meta.querySelectorAll('span'), function (s) { return /\$|salary/i.test(s.textContent) && !s.classList.contains('pin') && !s.classList.contains('badge'); })[0];
        if (salSpan) salSpan.textContent = sal ? fmtSalary(sal) : 'Salary not listed';
        setOpenBadge(meta.querySelector('[data-live]'), job.url);
      }

      // AI fit-analysis on job-detail: real /100 score, colored verdict pill, why,
      // and the real strengths/gaps (replacing the demo "How you match" lists).
      var fit = fitFor(job.url) || (job.fitScored ? { score: job.fit, verdict: job.verdict, why: job.why, strengths: job.strengths, gaps: job.gaps } : null);
      // Canonical score: fit-analysis score when present, else the row's derived fit.
      var canonScore = (fit && typeof fit.score === 'number') ? fit.score
        : (typeof job.fit === 'number' ? job.fit : null);
      if (canonScore != null) {
        if (ring) ring.textContent = canonScore;
        if (railR) railR.textContent = canonScore;
      }
      // Keep the rail verdict label consistent with the fit verdict.
      if (railTxt && fit && fit.verdict) {
        railTxt.innerHTML = esc(fit.verdict) + '<small>for your background</small>';
      }
      if (fit && typeof fit.score === 'number') {
        var mh = document.querySelector('.match-head .t');
        if (mh) mh.innerHTML = (fit.verdict ? verdictPill(fit.verdict) + ' ' : '') + esc(fit.why || mh.textContent);
        var mlists = document.querySelectorAll('.mlist');
        if (mlists.length && ((fit.strengths && fit.strengths.length) || (fit.gaps && fit.gaps.length))) {
          if (mlists[0]) mlists[0].innerHTML = (fit.strengths || []).map(function (s) { return '<li><span class="ic ic-yes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span><span>' + esc(s) + '</span></li>'; }).join('') || '<li><span>—</span></li>';
          if (mlists[1]) mlists[1].innerHTML = (fit.gaps || []).map(function (s) { return '<li><span class="ic ic-gap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 8v5M12 17h.01"/></svg></span><span>' + esc(s) + '</span></li>'; }).join('') || '<li><span>—</span></li>';
        }
      }

      // Apply now → open the real posting in a new tab, then offer to mark applied
      var applyBtn = document.querySelector('.btn.apply');
      if (applyBtn) {
        applyBtn.setAttribute('href', job.url || '#');
        if (job.url) { applyBtn.setAttribute('target', '_blank'); applyBtn.setAttribute('rel', 'noopener'); }
        applyBtn.addEventListener('click', function (e) {
          if (!job.url) { e.preventDefault(); toastMsg('No posting URL on this row', 'info'); return; }
          // let the browser open the tab (anchor target=_blank), then prompt
          setTimeout(function () {
            if (window.confirm('Opened the posting in a new tab.\n\nMark “' + job.title + ' — ' + job.company + '” as Applied in your tracker?')) {
              jPost('/api/compass/tracker/status', { num: job.num, url: job.url, status: 'Applied' }).then(function (r) {
                if (r.body && r.body.ok) {
                  toastMsg('Marked Applied in the tracker ✓', 'success');
                  job.status = 'Applied'; setCurrentJob(job);
                  var badge = document.querySelector('.head .badges'); if (badge) { var s = document.createElement('span'); s.className = 'badge badge--live'; s.style.marginLeft = '8px'; s.innerHTML = '<span class="tk"></span>Applied'; badge.appendChild(s); }
                } else { toastMsg('Status update failed: ' + ((r.body && r.body.error) || r.status), 'info'); }
              }).catch(function (er) { toastMsg('Status update error: ' + er, 'info'); });
            }
          }, 300);
        });
      }

      var jd = document.querySelector('.jd');
      if (jd && job.url) {
        jd.innerHTML = '<p style="color:#8a8172">Fetching the live posting…</p>';
        jGet('/api/pipeline/preview?url=' + encodeURIComponent(job.url)).then(function (prev) {
          var txt = (prev && prev.text) || '';
          if (txt && txt.length > 20 && !/^\(/.test(txt)) {
            jd.innerHTML = '<p style="white-space:pre-wrap">' + esc(txt.slice(0, 6000)) + '</p>' +
              '<p style="margin-top:10px"><a class="btn btn--outline btn--sm" href="' + esc(job.url) + '" target="_blank" rel="noopener">Open original posting ↗</a></p>';
          } else {
            jd.innerHTML = '<p>' + esc(job.why) + '</p><p style="color:#8a8172;margin-top:8px">Live preview was thin (JS-rendered board: ' + esc(txt || 'no text') + '). <a href="' + esc(job.url) + '" target="_blank" rel="noopener">Open original ↗</a></p>';
          }
        }).catch(function (e) { jd.innerHTML = '<p>' + esc(job.why) + '</p><p style="color:#8a8172">Could not fetch live posting: ' + esc(String(e)) + '</p>'; });
      }
      banner('Job detail LIVE — fields from the tracker row; posting body via /api/pipeline/preview. For AI-scored jobs the fit score /100, verdict pill, why, and strengths/gaps are REAL (from fit-analysis); "Apply now" opens the real URL + marks the tracker row Applied.');
    });
  }

  // ======================= SAVED (My Jobs) =================================
  var SAVED_APP_STAGE = /appl|respond|interview|offer|hired|reject/i; // real application stages
  function savedStagePill(s) { var c = /offer|hired/i.test(s) ? ['#2f6f5b', '#e3efe9'] : (/interview|respond/i.test(s) ? ['#8a6a3b', '#f6ecd6'] : (/reject/i.test(s) ? ['#9c5231', '#f4e3db'] : ['#2e5c8a', '#e4edf6'])); return '<span style="padding:2px 10px;border-radius:999px;background:' + c[1] + ';color:' + c[0] + ';font:700 11px system-ui;white-space:nowrap">' + esc(s) + '</span>'; }
  function wireSaved() {
    Promise.all([jGet('/api/tracker'), jGet('/api/tracker/stages')]).then(function (arr) {
      var rows = ((arr[0] && arr[0].rows) || []).filter(function (r) { return !isDead(r.url); });
      var stageList = (arr[1] && arr[1].stages) || ['Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Hired', 'Scanned', 'Evaluated'];
      // ONLY real application-stage rows — NO "newest scanned" fallback.
      var mine = rows.filter(function (r) { return SAVED_APP_STAGE.test(r.status || ''); });
      var main = document.querySelector('main .wrap') || document.querySelector('main') || document.body;
      // Hide EVERY hardcoded mockup element: demo rows (.row), column heads,
      // the summary stat cards, and any legacy row classes.
      main.querySelectorAll('.summary, .col-head, .row, .cols, .srow, .job-row, .saved-row, .card, .rows').forEach(function (n) { n.style.display = 'none'; });
      var wrap = document.getElementById('compassSavedList'); if (wrap) wrap.remove();
      wrap = document.createElement('section'); wrap.id = 'compassSavedList'; main.appendChild(wrap);

      function optsFor(cur) {
        var set = []; stageList.forEach(function (s) { if (set.indexOf(s) < 0) set.push(s); });
        if (cur && set.indexOf(cur) < 0) set.unshift(cur);
        if (set.indexOf('Scanned') < 0) set.push('Scanned');
        return set.map(function (s) { return '<option' + (cur === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
      }
      function rowHtml(r, i) {
        var f = fitFor(r.url);
        var fitHtml = (f && typeof f.score === 'number')
          ? '<span style="font-family:var(--serif,Georgia);font-weight:600;font-size:16px;color:#16324F">' + f.score + '<span style="font-size:10px;color:#8a8172">/100</span></span>' + (f.verdict ? ' ' + verdictPill(f.verdict) : '')
          : '<span style="font:12px system-ui;color:#8a8172">fit ' + scoreToFit(r) + '</span>';
        var sal = salaryFor(r.url);
        var salHtml = '<span style="font:12px system-ui;color:' + (sal ? '#16324F' : '#b0a790') + '">' + (sal ? fmtSalary(sal) : 'not listed') + '</span>';
        return '<div class="c-srow" data-i="' + i + '" style="display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #ece5d6;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.04);padding:14px 16px;margin-bottom:10px;cursor:pointer">' +
          '<span class="logo" style="--mc:' + colorFor(r.company) + ';flex:none" data-mono="' + esc(initials(r.company)) + '"><img src="https://logo.clearbit.com/' + esc(hostFrom(r.url)) + '" onerror="this.parentNode.classList.add(\'failed\');this.remove()"></span>' +
          '<div style="flex:1;min-width:0"><div style="font-weight:600;color:#16324F">' + esc(r.role) + '</div><div style="font-size:13px;color:#8a8172;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px"><span>' + esc(r.company) + (r.location ? ' · ' + esc(r.location) : '') + '</span>' + salHtml + fitHtml + '</div></div>' +
          openPillHtml(r.url) +
          savedStagePill(r.status || '') +
          (r.url ? '<a class="btn btn--outline btn--sm compass-ext" href="' + esc(r.url) + '" target="_blank" rel="noopener" style="flex:none;white-space:nowrap">View posting ↗</a>' : '') +
          '<select class="stage-select" aria-label="Status" style="flex:none;padding:7px 10px;border:1px solid #d8cdb8;border-radius:9px;font:13px system-ui">' + optsFor(r.status || '') + '</select>' +
          '<button class="c-srow-remove btn btn--outline btn--sm" type="button" title="Remove from My Jobs (resets status to Scanned)" style="flex:none;color:#9c5231">Remove</button>' +
          '</div>';
      }
      function render() {
        if (!mine.length) {
          wrap.innerHTML = '<div style="' + CARD + ';padding:36px 24px;text-align:center;margin-top:6px">' +
            '<div style="font-family:var(--serif,\'Iowan Old Style\',Georgia,serif);font-weight:600;font-size:20px;color:#16324F;margin-bottom:7px">No applications yet</div>' +
            '<div style="font:14px/1.6 system-ui;color:#8a8172;max-width:54ch;margin:0 auto">Mark a job as <b>Applied</b> from the Jobs page or the Apply flow, and it will show up here. My Jobs tracks only the roles you have applied to or are interviewing for.</div></div>';
          banner('My Jobs — no application-stage jobs yet (empty state). Mark a job Applied from Jobs/Apply and it appears here.');
          return;
        }
        wrap.innerHTML = mine.map(rowHtml).join('');
        bindRows();
        banner('My Jobs LIVE — ' + mine.length + ' real application(s). Status dropdown + Remove persist via POST /api/compass/tracker/status. Demo rows removed.');
      }
      function persist(r, status, okMsg, onDone) {
        jPost('/api/compass/tracker/status', { num: r.num, url: r.url, status: status }).then(function (rr) {
          if (rr.body && rr.body.ok) { onDone(); toastMsg(okMsg, 'success'); }
          else toastMsg('Update failed: ' + ((rr.body && rr.body.error) || rr.status), 'info');
        }).catch(function (er) { toastMsg('Update error: ' + er, 'info'); });
      }
      function bindRows() {
        wrap.querySelectorAll('.c-srow').forEach(function (el) {
          var i = +el.getAttribute('data-i'); var r = mine[i];
          el.addEventListener('click', function (e) { if (e.target.tagName === 'SELECT' || (e.target.closest && (e.target.closest('.compass-ext') || e.target.closest('.c-srow-remove')))) return; setCurrentJob(mapRow(r)); location.href = 'job-detail.html'; });
          var sel = el.querySelector('select');
          if (sel) sel.addEventListener('change', function () {
            var v = sel.value;
            persist(r, v, (SAVED_APP_STAGE.test(v) ? 'Status → ' + v + ' ✓' : 'Moved out of My Jobs (' + v + ')'), function () {
              r.status = v; if (!SAVED_APP_STAGE.test(v)) mine.splice(mine.indexOf(r), 1); render();
            });
          });
          var rm = el.querySelector('.c-srow-remove');
          if (rm) rm.addEventListener('click', function (e) {
            e.stopPropagation(); rm.disabled = true;
            persist(r, 'Scanned', 'Removed from My Jobs', function () { mine.splice(mine.indexOf(r), 1); render(); });
          });
        });
      }
      render();
    }).catch(function (e) { banner('Could not load saved/tracker: ' + e); });
  }

  // ======================= DOCUMENTS =======================================
  function docSpinner(text) { return '<div style="padding:26px 16px;text-align:center;color:#B08D57;font:14px system-ui"><div style="width:24px;height:24px;border:3px solid #eadfca;border-top-color:#B08D57;border-radius:50%;margin:0 auto 12px;animation:libspin .9s linear infinite"></div>' + esc(text) + '<div style="font:12px system-ui;color:#b0a790;margin-top:6px">Runs in the background — saved as a new version in the Library too.</div></div>'; }
  function docMatch(j, company, role) {
    if (!company) return true;
    var c = (j.company || '').toLowerCase().trim(), rc = company.toLowerCase().trim();
    if (c !== rc) return false;
    if (role) { var jr = (j.role || '').toLowerCase().trim(); if (jr && jr !== role.toLowerCase().trim()) return false; }
    return true;
  }
  // Versioned document viewer — each generation of (company·role·type) is a
  // VERSION (v1,v2,…). Switcher on top, only the selected version shown,
  // rich-rendered via the SAME workspace renderer as the Library (per-section
  // Copy → "Copied ✓", downloads, checklist naturally last in the doc).
  function renderVersioned(out, type, versions, selectId) {
    ensureLibStyles();
    var kind = type === 'cover' ? 'cover letters' : 'tailored résumés';
    if (!versions.length) { out.innerHTML = '<div style="padding:22px;color:#8a8172;font:14px system-ui;border:1px dashed #ddd3bf;border-radius:12px;text-align:center">No ' + kind + ' yet — click the button above. Each run is saved as a new version.</div>'; return; }
    var selIdx = selectId ? versions.findIndex(function (v) { return v.id === selectId; }) : versions.length - 1;
    if (selIdx < 0) selIdx = versions.length - 1;
    out.innerHTML = '<div role="tablist" aria-label="Versions" class="doc-vers" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:14px">' +
      '<span style="font:700 10.5px system-ui;letter-spacing:.05em;text-transform:uppercase;color:#b0a790;margin-right:4px">Versions</span>' +
      versions.map(function (v, i) {
        var cur = i === versions.length - 1;
        var when = v.created ? new Date(v.created).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
        return '<button role="tab" class="doc-ver" data-i="' + i + '" tabindex="' + (i === selIdx ? '0' : '-1') + '" aria-selected="' + (i === selIdx) + '" title="' + esc(when) + '" style="border:1px solid #e6ddc9;border-radius:999px;padding:6px 13px;font:600 12px system-ui;cursor:pointer">v' + (i + 1) + (cur ? ' · newest' : '') + '</button>';
      }).join('') + '</div><div class="doc-render"></div>';
    var render = out.querySelector('.doc-render');
    var btns = out.querySelectorAll('.doc-ver');
    function show(i) {
      btns.forEach(function (b) { var on = +b.getAttribute('data-i') === i; b.setAttribute('aria-selected', on); b.setAttribute('tabindex', on ? '0' : '-1'); b.style.background = on ? '#16324F' : '#fff'; b.style.color = on ? '#fff' : '#2a3b4d'; b.style.borderColor = on ? '#16324F' : '#e6ddc9'; });
      render.innerHTML = '<div style="color:#8a8172;padding:12px;font:13px system-ui">Loading…</div>';
      jGet('/api/compass/jobs/' + versions[i].id).then(function (j) { renderWorkspace(render, j.markdown || '', type); });
    }
    btns.forEach(function (b) {
      b.onclick = function () { show(+b.getAttribute('data-i')); };
      b.addEventListener('keydown', function (e) { var i = +b.getAttribute('data-i'); if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && i < versions.length - 1) { e.preventDefault(); btns[i + 1].focus(); show(i + 1); } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && i > 0) { e.preventDefault(); btns[i - 1].focus(); show(i - 1); } });
    });
    show(selIdx);
  }
  function setupDocPanel(panelSel, type, genLabel) {
    var panel = document.querySelector(panelSel); if (!panel) return;
    var job = getCurrentJob();
    var company = job ? (job.company || '') : '', role = job ? (job.role || job.title || '') : '', url = job ? (job.url || '') : '';
    panel.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px">' +
      '<div style="flex:1;min-width:0"><div style="font-family:var(--serif,Georgia);font-weight:600;font-size:18px;color:#16324F">' + (type === 'cover' ? 'Cover letter' : 'Tailored résumé') + '</div>' +
      '<div style="font:12.5px system-ui;color:#8a8172">' + (company ? esc(company) + (role ? ' · ' + esc(role) : '') : 'for your current job') + ' · running on ' + esc(llmDesc()) + '</div></div>' +
      '<button class="btn btn--primary btn--sm doc-gen" type="button">' + esc(genLabel) + '</button></div>' +
      '<div class="compass-doc-out" style="margin-top:10px"></div>';
    var out = panel.querySelector('.compass-doc-out');
    function loadVersions(selectId) {
      jGet('/api/compass/jobs').then(function (d) {
        var vs = ((d && d.jobs) || []).filter(function (j) { return j.type === type && j.status === 'done' && docMatch(j, company, role); }).sort(function (a, b) { return String(a.created).localeCompare(String(b.created)); });
        renderVersioned(out, type, vs, selectId);
      });
    }
    panel.querySelector('.doc-gen').onclick = function () {
      out.innerHTML = docSpinner(llmProgress(type === 'cover' ? 'Writing the cover letter' : 'Tailoring'));
      startJob({ type: type, company: company, role: role, url: url }, null,
        function (j) { toastMsg((type === 'cover' ? 'Cover letter' : 'Résumé') + ' ready', 'success'); loadVersions(j.id); },
        function (err) { out.innerHTML = '<div style="padding:16px;background:#f7ece7;border:1px solid #e6c9bb;border-radius:10px;color:#9c5231;font:13.5px system-ui">Generation failed: ' + esc(err) + '</div>'; });
    };
    loadVersions();
  }
  function wireDocs() {
    setupDocPanel('#panelTailor', 'tailor', 'Redo the tailoring');
    setupDocPanel('#panelCover', 'cover', 'Generate cover letter');
    banner('Documents LIVE — cover letter (real letter, NOT a résumé) + tailored résumé. Each run = a new version (switcher on top); output is rich-rendered with per-section Copy and downloads; checklist reports sit at the bottom. Running on ' + llmDesc() + '.');
  }

  // ======================= SETUP (full native migration) ===================
  // Rebuilds the original app's ENTIRE Setup nav-group natively in Compass,
  // hitting the same endpoints: #/config, #/portals, #/profile, #/cv, #/memory,
  // #/health, #/usage, #/docs-assistant, #/orientation, #/help, #/cv-studio.
  var PROVIDERS = ['auto', 'hermes', 'anthropic', 'gemini', 'openai', 'qwen', 'openrouter', 'github'];
  function el(tag, css, html) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
  var CARD = 'background:#fff;border:1px solid #ece5d6;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.05);padding:0;margin-bottom:14px;overflow:hidden';
  var SUM = 'cursor:pointer;list-style:none;padding:16px 20px;font:600 16px system-ui;color:#16324F;display:flex;justify-content:space-between;align-items:center';
  var BODY = 'padding:4px 20px 20px';
  var INP = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border:1px solid #d8cdb8;border-radius:8px;font:13px system-ui;box-sizing:border-box';
  var LBL = 'font:600 12px system-ui;color:#6b6255;display:block;margin-top:10px';
  function details(title, open) { var d = el('details', CARD); if (open) d.setAttribute('open', ''); d.innerHTML = '<summary style="' + SUM + '">' + esc(title) + '<span style="font:400 12px system-ui;color:#b0a790">▾</span></summary>'; var b = el('div', BODY); d.appendChild(b); return { d: d, body: b }; }
  function msgLine() { return el('div', 'font:12px system-ui;color:#6b6255;margin-top:10px;min-height:16px'); }
  function say(node, t, ok) { node.textContent = t; node.style.color = ok === false ? '#9c5231' : (ok ? '#2f6f5b' : '#6b6255'); }
  function chips(val) { return (Array.isArray(val) ? val : []).join('\n'); }
  function fromLines(s) { return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }

  // ---- FULL CONFIG (all KNOWN_KEYS, grouped) ----
  function sectionConfig(host) {
    var s = details('AI & app settings — full config (#/config)', true); host.appendChild(s.d);
    var prov = el('div', 'font:12.5px system-ui;color:#2f6f5b;margin:6px 0 12px', 'Loading…'); s.body.appendChild(prov);
    var form = el('div'); s.body.appendChild(form);
    var m = msgLine(); s.body.appendChild(m);
    var actions = el('div', 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px');
    actions.innerHTML = '<button class="btn btn--primary btn--sm" id="cfgSaveAll" type="button">Save all settings</button>';
    s.body.appendChild(actions);
    jGet('/api/config').then(function (cfg) {
      var secret = new Set(cfg.secretKeys || []); var groups = cfg.groups || {}; var vals = cfg.values || {};
      var byGroup = {}; (cfg.keys || []).forEach(function (k) { var g = groups[k] || 'other'; (byGroup[g] = byGroup[g] || []).push(k); });
      var html = '';
      Object.keys(byGroup).forEach(function (g) {
        html += '<div style="font:700 11px system-ui;letter-spacing:.05em;text-transform:uppercase;color:#b0a790;margin:14px 0 2px">' + esc(g) + '</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
        byGroup[g].forEach(function (k) {
          if (k === 'LLM_PROVIDER') { html += '<label style="' + LBL + '">' + k + '<select data-k="' + k + '" style="' + INP + '">' + PROVIDERS.map(function (x) { return '<option' + (vals[k] === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label>'; }
          else if (secret.has(k)) { html += '<label style="' + LBL + '">' + k + ' <span style="color:#b0a790;font-weight:400">' + (vals[k] ? '(' + esc(vals[k]) + ')' : '(not set)') + '</span><input data-k="' + k + '" data-secret="1" type="password" placeholder="' + (vals[k] ? 'leave blank to keep' : 'not set') + '" style="' + INP + '"><label style="font:400 11px system-ui;color:#b0a790"><input type="checkbox" data-clear="' + k + '"> remove</label></label>'; }
          else { html += '<label style="' + LBL + '">' + k + '<input data-k="' + k + '" type="text" value="' + esc(vals[k] || '') + '" style="' + INP + '"></label>'; }
        });
        html += '</div>';
      });
      form.innerHTML = html;
    });
    function refreshProv() { jGet('/api/status/providers').then(function (st) { prov.textContent = 'Active provider: ' + (st.activeProvider || 'none') + (st.activeModel ? ' · ' + st.activeModel : ''); }); }
    refreshProv();
    actions.querySelector('#cfgSaveAll').onclick = function () {
      var payload = {};
      form.querySelectorAll('[data-k]').forEach(function (inp) {
        var k = inp.getAttribute('data-k');
        if (inp.getAttribute('data-secret')) { var v = inp.value.trim(); if (v) payload[k] = v; }
        else payload[k] = (inp.value || '').trim();
      });
      form.querySelectorAll('[data-clear]').forEach(function (cb) { if (cb.checked) payload[cb.getAttribute('data-clear')] = ''; });
      jPost('/api/config', payload).then(function (r) {
        if (r.status === 200 && r.body.ok) { say(m, 'Saved to .env (' + (r.body.written || []).length + ' keys written) ✓', true); refreshProv(); }
        else { say(m, 'Rejected: ' + ((r.body && r.body.details && r.body.details.join('; ')) || (r.body && r.body.error) || r.status), false); }
      });
    };
  }

  // ---- PORTALS (full editor incl. companies WITH source keys) ----
  function sectionPortals(host) {
    var s = details('Portals — companies, filters, discovery (#/portals)', false); host.appendChild(s.d);
    var box = el('div'); s.body.appendChild(box); var m = msgLine(); s.body.appendChild(m);
    jGet('/api/portals').then(function (r) {
      var p = (r && r.portals) || {};
      var companies = Array.isArray(p.tracked_companies) ? p.tracked_companies : [];
      var tf = p.title_filter || {}, lf = p.location_filter || {}, disc = p.discovery || {};
      var allow = Array.isArray(lf.allow) ? lf.allow : [];
      var cityList = allow.filter(function (x) { return !/^(remote|united states|usa)$/i.test(x); });
      var remoteUS = allow.some(function (x) { return /remote/i.test(x); });
      box.innerHTML =
        '<div style="font:700 12px system-ui;color:#16324F;margin:6px 0 6px">Tracked companies (each needs a source: careers_url / api / provider)</div>' +
        '<div id="coRows"></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><input id="coName" placeholder="Company name" style="' + INP + ';flex:1;margin:0"><input id="coSrc" placeholder="careers_url (https://…) or provider (greenhouse/lever/ashby)" style="' + INP + ';flex:2;margin:0"><button class="btn btn--outline btn--sm" id="coAdd" type="button">Add</button></div>' +
        '<label style="' + LBL + '">Include titles (title_filter.positive — one per line)<textarea id="pTitles" rows="4" style="' + INP + '">' + esc(chips(tf.positive)) + '</textarea></label>' +
        '<label style="' + LBL + '">Exclude titles (title_filter.negative — one per line)<textarea id="pNeg" rows="3" style="' + INP + '">' + esc(chips(tf.negative)) + '</textarea></label>' +
        '<label style="' + LBL + '">Cities (location_filter.allow — one per line)<textarea id="pCities" rows="3" style="' + INP + '">' + esc(chips(cityList)) + '</textarea></label>' +
        '<label style="font:400 12px system-ui;color:#6b6255;display:block;margin-top:6px"><input type="checkbox" id="pRemote"' + (remoteUS ? ' checked' : '') + '> Include Remote / United States</label>' +
        '<label style="' + LBL + '">Search terms (discovery.linkedin_keywords — one per line)<textarea id="pTerms" rows="3" style="' + INP + '">' + esc(chips(disc.linkedin_keywords)) + '</textarea></label>' +
        '<div style="font:11px system-ui;color:#b0a790;margin-top:8px">location_filter.block (' + esc((lf.block || []).join(', ') || 'none') + ') and other discovery fields survive untouched (not replaced by this save).</div>' +
        '<button class="btn btn--primary btn--sm" id="pSave" type="button" style="margin-top:12px">Save portals.yml</button>';
      var model = companies.map(function (c) { return { name: c.name || '', src: c.careers_url || c.api || c.provider || '', careers_url: c.careers_url, api: c.api, provider: c.provider, enabled: c.enabled !== false }; });
      function renderCos() {
        var host2 = box.querySelector('#coRows'); host2.innerHTML = model.map(function (c, i) {
          return '<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #f0ead9"><span style="flex:1;font:13px system-ui;color:#16324F">' + esc(c.name) + '</span><span style="flex:2;font:11px system-ui;color:#8a8172;overflow:hidden;text-overflow:ellipsis">' + esc(c.src || '(no source!)') + '</span><label style="font:11px system-ui"><input type="checkbox" data-en="' + i + '"' + (c.enabled ? ' checked' : '') + '>on</label><button class="btn btn--ghost btn--sm" data-rm="' + i + '" type="button">✕</button></div>';
        }).join('') || '<div style="font:12px system-ui;color:#b0a790">none</div>';
        host2.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { model.splice(+b.getAttribute('data-rm'), 1); renderCos(); }; });
        host2.querySelectorAll('[data-en]').forEach(function (cb) { cb.onchange = function () { model[+cb.getAttribute('data-en')].enabled = cb.checked; }; });
      }
      renderCos();
      box.querySelector('#coAdd').onclick = function () {
        var name = box.querySelector('#coName').value.trim(), src = box.querySelector('#coSrc').value.trim();
        if (!name || !src) { say(m, 'Company needs a name AND a source (careers_url or provider).', false); return; }
        var entry = { name: name, src: src, enabled: true };
        if (/^https?:\/\//i.test(src)) entry.careers_url = src; else entry.provider = src;
        model.push(entry); box.querySelector('#coName').value = ''; box.querySelector('#coSrc').value = ''; renderCos();
      };
      box.querySelector('#pSave').onclick = function () {
        var settings = {
          companies: model.map(function (c) { var o = { name: c.name, enabled: c.enabled }; if (c.careers_url) o.careers_url = c.careers_url; else if (c.api) o.api = c.api; else if (c.provider) o.provider = c.provider; else if (/^https?:/i.test(c.src)) o.careers_url = c.src; else o.provider = c.src; return o; }),
          includeTitles: fromLines(box.querySelector('#pTitles').value),
          excludeTitles: fromLines(box.querySelector('#pNeg').value),
          cities: fromLines(box.querySelector('#pCities').value),
          remoteUS: box.querySelector('#pRemote').checked,
          searchTerms: fromLines(box.querySelector('#pTerms').value)
        };
        jPost('/api/compass/setup', { settings: settings }).then(function (r) {
          if (r.body && r.body.ok) say(m, 'portals.yml saved (' + settings.companies.length + ' companies kept with source keys) ✓', true);
          else say(m, 'Save failed: ' + ((r.body && r.body.error) || r.status) + ' ' + ((r.body && r.body.details) || ''), false);
        });
      };
    });
  }

  // ---- PROFILE ----
  function sectionProfile(host) {
    var s = details('Profile (#/profile)', false); host.appendChild(s.d);
    var box = el('div'); s.body.appendChild(box); var m = msgLine(); s.body.appendChild(m);
    jGet('/api/profile').then(function (r) {
      var p = (r && r.profile) || {}; var c = p.candidate || {}; var n = p.narrative || {}; var comp = p.compensation || {};
      var f = [['candidate.full_name', 'Full name', c.full_name], ['candidate.email', 'Email', c.email], ['candidate.phone', 'Phone', c.phone], ['candidate.location', 'Location', c.location], ['narrative.headline', 'Headline', n.headline], ['compensation.target_range', 'Target comp', comp.target_range]];
      box.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + f.map(function (x) { return '<label style="' + LBL + '">' + x[1] + '<input data-p="' + x[0] + '" type="text" value="' + esc(x[2] || '') + '" style="' + INP + '"></label>'; }).join('') + '</div><button class="btn btn--primary btn--sm" id="profSave" type="button" style="margin-top:12px">Save profile</button>';
      box.querySelector('#profSave').onclick = function () {
        var fields = {}; box.querySelectorAll('[data-p]').forEach(function (i) { fields[i.getAttribute('data-p')] = i.value; });
        fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: fields }) }).then(function (rr) { return rr.json().then(function (j) { return { s: rr.status, j: j }; }); }).then(function (o) { say(m, o.s === 200 && o.j.ok ? 'profile.yml saved ✓' : ('Save failed: ' + (o.j.error || o.s)), o.s === 200 && o.j.ok); });
      };
    });
  }

  // ---- markdown doc editor (CV / Memory) ----
  function sectionDoc(host, title, getUrl, putUrl) {
    var s = details(title, false); host.appendChild(s.d);
    var ta = el('textarea', INP + ';min-height:220px;font-family:ui-monospace,monospace'); s.body.appendChild(ta);
    var m = msgLine(); s.body.appendChild(m);
    var save = el('button', 'margin-top:10px', 'Save'); save.className = 'btn btn--primary btn--sm'; save.type = 'button'; s.body.appendChild(save);
    jGet(getUrl).then(function (j) { ta.value = (j && j.markdown) || ''; });
    save.onclick = function () { fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown: ta.value }) }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); }).then(function (o) { say(m, o.s === 200 && o.j.ok ? 'saved ✓ (' + (o.j.bytes || (o.j.markdown || '').length) + ' bytes)' : ('save failed: ' + (o.j.error || o.s)), o.s === 200 && o.j.ok); }); };
  }

  // ---- read-only status views (health / usage) ----
  function sectionReadonly(host, title, url, render) {
    var s = details(title, false); host.appendChild(s.d);
    var box = el('div', 'font:12.5px/1.6 system-ui;color:#3a3428'); box.textContent = 'Loading…'; s.body.appendChild(box);
    jGet(url).then(function (j) { box.innerHTML = render(j); }).catch(function (e) { box.textContent = 'error: ' + e; });
  }

  // ---- LLM action views (docs-assistant / orientation) ----
  function sectionDocsAssistant(host) {
    var s = details('Docs assistant (#/docs-assistant)', false); host.appendChild(s.d);
    var ta = el('input', INP); ta.placeholder = 'Ask about how career-ops works…'; s.body.appendChild(ta);
    var btn = el('button', 'margin-top:10px', 'Ask'); btn.className = 'btn btn--primary btn--sm'; btn.type = 'button'; s.body.appendChild(btn);
    var out = el('div', 'margin-top:12px;white-space:pre-wrap;font:13px/1.6 system-ui;color:#3a3428'); s.body.appendChild(out);
    btn.onclick = function () { var q = ta.value.trim(); if (!q) return; out.textContent = llmProgress('Thinking'); jPost('/api/docs-assistant/ask', { question: q, q: q, message: q }).then(function (r) { out.textContent = (r.body && (r.body.answer || r.body.markdown || r.body.text)) || ('(' + JSON.stringify(r.body).slice(0, 400) + ')'); }).catch(function (e) { out.textContent = 'error: ' + e; }); };
  }
  function sectionOrientation(host) {
    var s = details('Career orientation (#/orientation)', false); host.appendChild(s.d);
    var btn = el('button', null, 'Generate orientation profile'); btn.className = 'btn btn--primary btn--sm'; btn.type = 'button'; s.body.appendChild(btn);
    var out = el('div', 'margin-top:12px;white-space:pre-wrap;font:13px/1.6 system-ui;color:#3a3428'); s.body.appendChild(out);
    btn.onclick = function () { out.textContent = llmProgress('Generating'); jPost('/api/orientation/generate', {}).then(function (r) { out.textContent = (r.body && (r.body.markdown || r.body.text || r.body.profile)) || ('(' + JSON.stringify(r.body).slice(0, 400) + ')'); }).catch(function (e) { out.textContent = 'error: ' + e; }); };
  }
  function sectionHelp(host) {
    sectionReadonly(host, 'Help & guides (#/help)', '/api/help/en', function (j) {
      var items = j.sections || j.guides || j.topics || (Array.isArray(j) ? j : null);
      if (items) return '<ul style="margin:0;padding-left:18px">' + items.slice(0, 30).map(function (x) { return '<li>' + esc(x.title || x.name || x.slug || x) + '</li>'; }).join('') + '</ul>';
      return '<pre style="white-space:pre-wrap">' + esc(JSON.stringify(j).slice(0, 800)) + '</pre>';
    });
  }
  function sectionCvStudioNote(host) {
    var s = details('CV Studio (#/cv-studio)', false); host.appendChild(s.d);
    s.body.innerHTML = '<div style="font:13px/1.6 system-ui;color:#3a3428">CV tailoring, humanize, and cover-letter drafting are wired live on the <a href="documents.html" style="color:#2f6f5b">Documents</a> page (POST /api/cv-studio/tailor + /api/export/docx). Your source CV is editable in the “CV (cv.md)” section above.</div>';
  }

  function buildNativeSetup() {
    if (document.getElementById('compassNativeSetup')) return;
    var main = document.querySelector('main .wrap') || document.querySelector('main') || document.body;
    var wrap = el('section', 'margin:0 0 24px', '<div style="font:700 13px system-ui;letter-spacing:.04em;text-transform:uppercase;color:#B08D57;margin:8px 0 12px">⚙︎ Full app settings (migrated from the original Setup — same backends)</div>');
    wrap.id = 'compassNativeSetup';
    main.insertBefore(wrap, main.firstChild);
    sectionConfig(wrap);
    sectionPortals(wrap);
    sectionProfile(wrap);
    sectionDoc(wrap, 'CV (cv.md) (#/cv)', '/api/cv', '/api/cv');
    sectionDoc(wrap, 'Memory note (#/memory)', '/api/memory', '/api/memory');
    sectionCvStudioNote(wrap);
    sectionReadonly(wrap, 'Health (#/health)', '/api/health', function (j) {
      return 'Status: <b>' + (j.ok ? 'OK' : 'issues') + '</b> · version ' + esc(j.version || '?') + (j.parentVersion ? ' / parent ' + esc(j.parentVersion) : '') +
        '<br>Warnings: ' + esc((j.warnings || []).join('; ') || 'none') +
        '<br>Checks: ' + esc(Object.keys(j.checks || {}).map(function (k) { var c = j.checks[k]; return k + '=' + (c && c.ok !== undefined ? (c.ok ? 'ok' : 'FAIL') : JSON.stringify(c)); }).join(', ').slice(0, 400));
    });
    sectionReadonly(wrap, 'LLM usage (#/usage)', '/api/usage', function (j) {
      return 'Total LLM calls: <b>' + (j.totalCalls || 0) + '</b><br>Windows: ' + esc(Object.keys(j.windows || {}).map(function (w) { var x = j.windows[w]; return w + '=' + (x && (x.calls != null ? x.calls : JSON.stringify(x).slice(0, 40))); }).join(', ').slice(0, 400) || 'none');
    });
    sectionDocsAssistant(wrap);
    sectionOrientation(wrap);
    sectionHelp(wrap);
  }

  function wireSetup() {
    buildNativeSetup();
    var btn = document.getElementById('saveBtn');
    if (btn) btn.addEventListener('click', function () {
      var settings = { includeTitles: (window.includeTitles || []).slice(), excludeTitles: (window.excludeTitles || []).slice(), searchTerms: (window.searchTerms || []).slice(), cities: (window.cities || []).map(function (c) { return c && c.name ? c.name : c; }), remoteUS: !!window.remoteUS };
      jPost('/api/compass/setup', { settings: settings }).then(function (r) { toastMsg(r.body && r.body.ok ? 'Search filters written to the REAL portals.yml ✓' : ('portals write failed: ' + (r.body && r.body.error)), r.body && r.body.ok ? 'success' : 'info'); }).catch(function (e) { toastMsg('portals write error: ' + e, 'info'); });
    });
    banner('Setup MIGRATED — full config, portals (companies w/ source keys), profile, CV, memory, health, usage, docs-assistant, orientation, help all native here via their real endpoints. Comp floor stays demo.');
  }

  // ======================= OUTREACH (AI networking plan) ===================
  function mdInline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code>$1</code>'); }
  function mdBody(text) {
    var out = '', inList = false;
    String(text || '').split('\n').forEach(function (ln) {
      var t = ln.trim();
      if (/^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) { if (!inList) { out += '<ul style="margin:6px 0;padding-left:20px">'; inList = true; } out += '<li>' + mdInline(t.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '')) + '</li>'; }
      else { if (inList) { out += '</ul>'; inList = false; } if (t) out += '<p style="margin:6px 0">' + mdInline(t) + '</p>'; }
    });
    if (inList) out += '</ul>';
    return out;
  }
  function linkedinUrl(kw) { return 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(kw); }
  function cleanSearch(s) { return String(s || '').replace(/`/g, '').replace(/site:linkedin\.com\/in/ig, '').replace(/\s+/g, ' ').trim(); }
  function contactCard(persona, titles, searchRaw) {
    var kw = cleanSearch(searchRaw);
    if (!kw) { var q = (String(persona).match(/"([^"]+)"/g) || []).map(function (x) { return x.replace(/"/g, ''); }); kw = q.length ? q.join(' ') : String(persona).replace(/[—:–].*$/, '').replace(/\*/g, '').trim().slice(0, 90); }
    return '<div style="padding:11px 12px;border:1px solid #f0ead9;border-radius:10px;margin:8px 0">' +
      '<div style="font-weight:600;color:#16324F">' + mdInline(persona) + '</div>' +
      (titles ? '<div style="font-size:12.5px;color:#8a8172;margin:2px 0 6px">' + mdInline(titles) + '</div>' : '') +
      (searchRaw ? '<div style="font:11.5px/1.5 ui-monospace,monospace;color:#6b6255;background:#faf7f0;border-radius:6px;padding:6px 8px;margin-bottom:7px;word-break:break-word">' + esc(String(searchRaw).replace(/`/g, '')) + '</div>' : '') +
      '<a href="' + linkedinUrl(kw) + '" target="_blank" rel="noopener" class="btn btn--outline btn--sm">🔎 Search on LinkedIn</a></div>';
  }
  function renderContacts(body) {
    var lines = String(body || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    var rows = lines.filter(function (l) { return /^\|/.test(l); });
    if (rows.length >= 2) { // markdown table: | Persona | Titles | LinkedIn search string |
      var header = rows[0].split('|').map(function (c) { return c.trim(); });
      var sc = header.findIndex(function (c) { return /search|linkedin/i.test(c); });
      var out = '';
      for (var i = 1; i < rows.length; i++) {
        var cells = rows[i].split('|').map(function (c) { return c.trim(); });
        if (cells.join('').replace(/[:\-|]/g, '') === '') continue; // separator
        var searchRaw = (sc >= 0 && cells[sc]) ? cells[sc] : cells[cells.length - 1] || cells[cells.length - 2] || '';
        out += contactCard(cells[1] || '', cells[2] || '', searchRaw);
      }
      if (out) return out;
    }
    // bullet / paragraph fallback
    var html = '<ul style="list-style:none;padding:0;margin:0">';
    lines.forEach(function (ln) {
      if (!/^[-*]\s+/.test(ln) && !/^\d+\.\s+/.test(ln)) { html += '<p style="margin:6px 0">' + mdInline(ln) + '</p>'; return; }
      var text = ln.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
      var code = (text.match(/`([^`]+)`/) || [])[1];
      var quoted = (text.match(/"([^"]+)"/g) || []).map(function (q) { return q.replace(/"/g, ''); });
      var kw = code ? cleanSearch(code) : (quoted.length ? quoted.join(' ') : text.replace(/[—:–].*$/, '').replace(/\([^)]*\)/g, '').trim().slice(0, 90));
      html += '<li style="padding:9px 0;border-bottom:1px solid #f0ead9;display:flex;gap:10px;align-items:baseline;justify-content:space-between">' +
        '<span>' + mdInline(text) + '</span>' +
        '<a href="' + linkedinUrl(kw) + '" target="_blank" rel="noopener" class="btn btn--outline btn--sm" style="white-space:nowrap;flex:none">🔎 LinkedIn</a></li>';
    });
    return html + '</ul>';
  }
  function renderDrafts(body) {
    return String(body || '').split(/\n\s*\n/).map(function (b) { return b.trim(); }).filter(Boolean).map(function (b) {
      return '<div style="background:#faf7f0;border:1px solid #e6ddc9;border-radius:10px;padding:12px;margin:10px 0">' +
        '<div style="font:13.5px/1.6 system-ui;color:#3a3428">' + mdInline(b).replace(/\n/g, '<br>') + '</div>' +
        '<button class="btn btn--outline btn--sm compass-copy" type="button" data-copy="' + encodeURIComponent(b) + '" style="margin-top:8px">Copy message</button></div>';
    }).join('');
  }
  function splitSections(md) {
    var idx = [], re = /^#{1,4}\s+(.+)$/gm, m;
    while ((m = re.exec(md))) idx.push({ title: m[1].trim(), start: m.index, end: m.index + m[0].length });
    if (!idx.length) return [{ title: '', body: md }];
    var out = [];
    for (var i = 0; i < idx.length; i++) out.push({ title: idx[i].title, body: md.slice(idx[i].end, (i + 1 < idx.length) ? idx[i + 1].start : md.length).trim() });
    return out;
  }
  function renderPlan(container, md) {
    var secs = splitSections(md);
    container.innerHTML = secs.map(function (s) {
      var inner;
      if (/who to contact|people to|personas?|contacts?/i.test(s.title)) inner = renderContacts(s.body);
      else if (/draft|outreach|message|template|email/i.test(s.title)) inner = renderDrafts(s.body);
      else inner = mdBody(s.body);
      return '<div style="' + CARD + ';padding:18px 20px">' + (s.title ? '<h3 style="font:600 15px system-ui;color:#16324F;margin:0 0 8px">' + esc(s.title) + '</h3>' : '') + inner + '</div>';
    }).join('');
    container.querySelectorAll('.compass-copy').forEach(function (b) {
      b.onclick = function () { var t = decodeURIComponent(b.getAttribute('data-copy')); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = 'Copy message'; }, 1500); }, function () { toastMsg('Copy failed — select the text manually', 'info'); }); };
    });
  }
  function wireOutreach() {
    var main = document.querySelector('main .wrap') || document.querySelector('main') || document.body;
    Array.prototype.slice.call(main.children).forEach(function (c) { c.style.display = 'none'; });
    var root = el('div'); main.appendChild(root);
    root.innerHTML =
      '<h1 style="font:700 26px/1.2 var(--serif,Georgia);color:#16324F;margin:6px 0 4px">Find people to reach out to</h1>' +
      '<div style="' + CARD + ';padding:18px 20px;margin-bottom:14px">' +
      '<label style="' + LBL + '">Pick from your jobs<select id="oJob" style="' + INP + '"><option value="">— manual entry —</option></select></label>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<label style="' + LBL + '">Company<input id="oCompany" type="text" style="' + INP + '"></label>' +
      '<label style="' + LBL + '">Role (optional)<input id="oRole" type="text" style="' + INP + '"></label></div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:12px"><button class="btn btn--primary btn--sm" id="oGen" type="button">Build networking plan</button><span id="oStatus" style="font:12.5px system-ui;color:#6b6255"></span></div>' +
      '</div>' +
      '<div id="oSaveBar" style="display:none;margin-bottom:12px"><button class="btn btn--primary btn--sm" id="oSave" type="button">Save this plan</button> <span id="oSaveMsg" style="font:12px system-ui;color:#2f6f5b"></span></div>' +
      '<div id="oOut"></div>' +
      '<div style="' + CARD + ';padding:16px 20px;margin-top:14px"><h3 style="font:600 15px system-ui;color:#16324F;margin:0 0 8px">Saved plans</h3><div id="oSaved" style="font:13px system-ui;color:#6b6255">Loading…</div></div>';
    var jobsRef = [];
    jGet('/api/tracker').then(function (d) {
      jobsRef = ((d && d.rows) || []).filter(function (r) { return !isDead(r.url); }).slice(0, 300);
      var sel = document.getElementById('oJob');
      jobsRef.forEach(function (r, i) { var o = document.createElement('option'); o.value = String(i); o.textContent = r.company + ' — ' + r.role; sel.appendChild(o); });
    });
    document.getElementById('oJob').onchange = function () {
      var v = this.value; if (v === '') return;
      var r = jobsRef[+v]; if (!r) return;
      document.getElementById('oCompany').value = r.company || '';
      document.getElementById('oRole').value = r.role || '';
      this.setAttribute('data-url', r.url || '');
    };
    var lastPlan = null;
    document.getElementById('oGen').onclick = function () {
      var company = document.getElementById('oCompany').value.trim();
      var role = document.getElementById('oRole').value.trim();
      if (!company) { toastMsg('Enter or pick a company first', 'info'); return; }
      var status = document.getElementById('oStatus');
      var url = document.getElementById('oJob').getAttribute('data-url') || '';
      status.textContent = 'Started in the background (survives navigation; see the Library). ' + llmProgress('Building your plan');
      startJob({ type: 'networking', company: company, role: role, url: url },
        null,
        function (j) { status.textContent = 'Done ✓ (' + (j.provider || 'AI') + ')'; lastPlan = { company: company, role: role, plan: j.markdown }; renderPlan(document.getElementById('oOut'), j.markdown || ''); document.getElementById('oSaveBar').style.display = 'block'; },
        function (err) { status.textContent = 'Failed: ' + err; });
    };
    document.getElementById('oSave').onclick = function () {
      if (!lastPlan) return;
      jPost('/api/networking/save', lastPlan).then(function (r) {
        var m = document.getElementById('oSaveMsg');
        if (r.body && r.body.ok) { m.textContent = 'Saved as ' + r.body.name + ' ✓'; loadSaved(); }
        else m.textContent = 'Save failed: ' + ((r.body && r.body.error) || r.status);
      });
    };
    function loadSaved() {
      jGet('/api/networking/plans').then(function (d) {
        var plans = (d && d.plans) || [];
        var box = document.getElementById('oSaved');
        if (!plans.length) { box.textContent = 'No saved plans yet.'; return; }
        box.innerHTML = plans.map(function (p) { return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ead9"><span>' + esc(p.name) + '</span><button class="btn btn--outline btn--sm" data-open="' + esc(p.name) + '" type="button">Open</button></div>'; }).join('');
        box.querySelectorAll('[data-open]').forEach(function (btn) { btn.onclick = function () { jGet('/api/networking/plans/' + encodeURIComponent(btn.getAttribute('data-open'))).then(function (j) { renderPlan(document.getElementById('oOut'), (j && j.markdown) || ''); document.getElementById('oStatus').textContent = 'Opened ' + btn.getAttribute('data-open'); window.scrollTo(0, 0); }); }; });
      });
    }
    loadSaved();
    banner('AI networking plan — who to contact + clickable LinkedIn people-search links + drafted messages, grounded in your CV/profile. It finds the RIGHT PEOPLE TO SEARCH FOR; it does NOT scrape names or emails. Running on ' + llmDesc() + '.');
  }

  // ======================= LIBRARY (generated-content workspace) ===========
  var DOC_LABEL = { tailor: 'Tailored CV', cover: 'Cover letter', evaluate: 'Evaluation', networking: 'Networking plan' };
  function libDownloadDocx(md, type) {
    fetch('/api/export/docx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown: md, title: DOC_LABEL[type] || 'document' }) })
      .then(function (r) { return r.blob(); }).then(function (blob) { downloadBlob(blob, (DOC_LABEL[type] || 'document').replace(/\s+/g, '-').toLowerCase() + '.docx'); toastMsg('Downloaded .docx', 'success'); })
      .catch(function (e) { toastMsg('Export failed: ' + e, 'info'); });
  }
  function downloadBlob(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  function downloadText(text, name, mime) { downloadBlob(new Blob([text], { type: mime || 'text/plain' }), name); }
  function copyText(text, btn) {
    function ok() { if (btn) { var o = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = o; }, 1400); } toastMsg('Copied to clipboard', 'success'); }
    function fb() { try { var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); ok(); } catch (e) { toastMsg('Copy failed — select the text manually', 'info'); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fb); else fb();
  }

  // ---- CSP-safe markdown → rich HTML (escape-first; no external libs) ----
  function mdInlineRich(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }
  function libRenderTable(rows) {
    var clean = rows.map(function (r) { return r.trim().replace(/^\|/, '').replace(/\|$/, ''); });
    var header = clean[0].split('|').map(function (c) { return c.trim(); });
    var body = clean.slice(2).map(function (r) { return r.split('|').map(function (c) { return c.trim(); }); });
    function cellHtml(c) {
      var h = mdInlineRich(c);
      if (/site:linkedin|linkedin\.com\/in|"[^"]+"\s+AND/i.test(c) && typeof linkedinUrl === 'function') h += ' <a href="' + linkedinUrl(cleanSearch(c)) + '" target="_blank" rel="noopener" title="Search on LinkedIn" style="white-space:nowrap;color:#2f6f5b;font-weight:700;text-decoration:none">🔎</a>';
      return h;
    }
    return '<div class="tbl-wrap"><table><thead><tr>' + header.map(function (c) { return '<th>' + mdInlineRich(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      body.map(function (cells) { return '<tr>' + cells.map(function (c) { return '<td>' + cellHtml(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function mdToHtml(md) {
    var lines = String(md || '').replace(/\r/g, '').split('\n'), html = '', i = 0, listType = null, buf = [];
    function closeList() { if (listType) { html += '<' + listType + '>' + buf.join('') + '</' + listType + '>'; listType = null; buf = []; } }
    while (i < lines.length) {
      var t = lines[i].replace(/\s+$/, '');
      if (/^\s*\|.*\|?\s*$/.test(t) && i + 1 < lines.length && /^[\s|:\-]+$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        closeList(); var rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; } html += libRenderTable(rows); continue;
      }
      if (/^\s*#{1,6}\s+/.test(t)) { closeList(); var lvl = t.match(/^\s*#+/)[0].trim().length; var tag = lvl <= 1 ? 'h2' : (lvl === 2 ? 'h3' : 'h4'); html += '<' + tag + '>' + mdInlineRich(t.replace(/^\s*#{1,6}\s+/, '')) + '</' + tag + '>'; i++; continue; }
      if (/^\s*[-*+]\s+/.test(t)) { if (listType !== 'ul') { closeList(); listType = 'ul'; } buf.push('<li>' + mdInlineRich(t.replace(/^\s*[-*+]\s+/, '')) + '</li>'); i++; continue; }
      if (/^\s*\d+\.\s+/.test(t)) { if (listType !== 'ol') { closeList(); listType = 'ol'; } buf.push('<li>' + mdInlineRich(t.replace(/^\s*\d+\.\s+/, '')) + '</li>'); i++; continue; }
      if (/^\s*>\s?/.test(t)) { closeList(); html += '<blockquote>' + mdInlineRich(t.replace(/^\s*>\s?/, '')) + '</blockquote>'; i++; continue; }
      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(t)) { closeList(); html += '<hr>'; i++; continue; }
      if (t.trim() === '') { closeList(); i++; continue; }
      closeList(); var para = [t]; i++;
      while (i < lines.length && lines[i].trim() !== '' && !/^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>|\|)/.test(lines[i]) && !/^\s*(---+|\*\*\*+|___+)\s*$/.test(lines[i])) { para.push(lines[i].replace(/\s+$/, '')); i++; }
      html += '<p>' + mdInlineRich(para.join(' ')) + '</p>';
    }
    closeList(); return html;
  }
  function textInline(s) { return String(s).replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*\n]+)\*/g, '$1').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)'); }
  function mdToText(md) {
    var lines = String(md || '').replace(/\r/g, '').split('\n'), out = [], i = 0;
    while (i < lines.length) {
      var t = lines[i];
      if (/^\s*\|/.test(t) && i + 1 < lines.length && /^[\s|:\-]+$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        var rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        rows.forEach(function (r, idx) { if (idx === 1) return; var cells = r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return textInline(c.trim()); }).filter(function (x) { return x !== ''; }); if (cells.length) out.push(cells.join('  ·  ')); });
        continue;
      }
      if (/^\s*#{1,6}\s+/.test(t)) { out.push(textInline(t.replace(/^\s*#{1,6}\s+/, ''))); i++; continue; }
      if (/^\s*[-*+]\s+/.test(t)) { out.push('• ' + textInline(t.replace(/^\s*[-*+]\s+/, ''))); i++; continue; }
      if (/^\s*\d+\.\s+/.test(t)) { out.push(textInline(t.trim())); i++; continue; }
      if (/^\s*>\s?/.test(t)) { out.push(textInline(t.replace(/^\s*>\s?/, ''))); i++; continue; }
      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(t)) { out.push(''); i++; continue; }
      out.push(textInline(t)); i++;
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function splitSectionsFull(md) {
    md = String(md || '').replace(/\r/g, '');
    var all = [], re = /^(#{1,6})\s+(.+)$/gm, m;
    while ((m = re.exec(md))) all.push({ level: m[1].length, title: m[2].trim(), start: m.index, end: m.index + m[0].length });
    var levels = all.map(function (h) { return h.level; });
    var secLevel = levels.indexOf(2) >= 0 ? 2 : (levels.indexOf(3) >= 0 ? 3 : (all.length ? Math.min.apply(null, levels) : 0));
    var heads = all.filter(function (h) { return h.level === secLevel; });
    if (!heads.length) {
      // Evaluation reports (modes/oferta) use A–G letter blocks, not # headings.
      var ag = [], re2 = /^([A-G])\s*[—\-–]\s+(.+)$/gm, m2;
      while ((m2 = re2.exec(md))) ag.push({ title: m2[1] + ' — ' + m2[2].trim(), start: m2.index, end: m2.index + m2[0].length });
      if (ag.length >= 2) {
        var asecs = [];
        if (ag[0].start > 0) { var apre = md.slice(0, ag[0].start).trim(); if (apre) asecs.push({ title: 'Overview', body: apre }); }
        for (var ai = 0; ai < ag.length; ai++) asecs.push({ title: ag[ai].title, body: md.slice(ag[ai].end, ai + 1 < ag.length ? ag[ai + 1].start : md.length).trim() });
        return asecs;
      }
      return [{ title: 'Content', body: md.trim() }];
    }
    var secs = [];
    if (heads[0].start > 0) { var pre = md.slice(0, heads[0].start).trim(); if (pre) secs.push({ title: 'Overview', body: pre }); }
    for (var k = 0; k < heads.length; k++) secs.push({ title: heads[k].title, body: md.slice(heads[k].end, k + 1 < heads.length ? heads[k + 1].start : md.length).trim() });
    return secs;
  }
  function ensureLibStyles() {
    if (document.getElementById('compassLibStyles')) return;
    var st = document.createElement('style'); st.id = 'compassLibStyles';
    st.textContent = '@keyframes libspin{to{transform:rotate(360deg)}}' +
      '.lib-md{font:15px/1.72 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#2a3b4d;word-wrap:break-word}' +
      '.lib-md h2{font-family:var(--serif,"Iowan Old Style",Georgia,serif);font-weight:600;font-size:20px;color:#16324F;margin:18px 0 8px;line-height:1.25}' +
      '.lib-md h3,.lib-md h4{font-family:var(--serif,"Iowan Old Style",Georgia,serif);font-weight:600;color:#16324F;margin:14px 0 6px;font-size:16px}' +
      '.lib-md p{margin:9px 0}.lib-md ul,.lib-md ol{margin:9px 0;padding-left:22px}.lib-md li{margin:4px 0}' +
      '.lib-md strong{color:#16324F;font-weight:650}.lib-md a{color:#2f6f5b}' +
      '.lib-md blockquote{border-left:3px solid #d8cdb8;margin:10px 0;padding:2px 14px;color:#6b6255}' +
      '.lib-md code{background:#f6f1e6;padding:1px 5px;border-radius:5px;font-size:13px}' +
      '.lib-md hr{border:none;border-top:1px solid #ece5d6;margin:16px 0}' +
      '.lib-md .tbl-wrap{overflow-x:auto;margin:11px 0}.lib-md table{border-collapse:collapse;font-size:13.5px;width:100%}' +
      '.lib-md th,.lib-md td{border:1px solid #e6ddc9;padding:6px 10px;text-align:left;vertical-align:top}.lib-md th{background:#faf7f0;color:#16324F}' +
      '.lib-h{font-family:var(--serif,"Iowan Old Style",Georgia,serif);font-weight:600;font-size:17px;color:#16324F}' +
      '.lib-toc:hover{color:#16324F;border-left-color:#B08D57 !important}';
    document.head.appendChild(st);
  }
  // Parse an evaluation report's score (/5→/100), verdict label+tone, and a
  // 1–2 sentence why. Returns null if there's nothing scorable (tailor/cover).
  function parseEvalSummary(md) {
    md = String(md || '');
    var m = md.match(/(?:overall|global)\s+score\s*[:|]?\s*\*{0,2}\s*([0-5](?:\.\d)?)/i)
      || md.match(/\bscore\s*[:|]?\s*\*{0,2}\s*([0-5](?:\.\d)?)\s*\/\s*5/i)
      || md.match(/\b([0-5](?:\.\d)?)\s*\/\s*5\b/);
    var score = m ? parseFloat(m[1]) : null;
    var score100 = (score != null && !isNaN(score)) ? Math.round(score / 5 * 100) : null;
    var vm = md.match(/^\s*(?:F\s*[—\-–]\s*)?Verdict\s*[:\-]\s*(.+)$/mi) || md.match(/\bVerdict\s*[:\-]\s*(.+)/i);
    var verdictText = vm ? vm[1].trim() : '';
    var low = (verdictText + ' ' + md.slice(0, 1400)).toLowerCase();
    var label = '', tone = '';
    if (/strong match|excellent fit|strong fit/.test(low)) { label = 'Strong match'; tone = 'good'; }
    else if (/do not apply|don.?t apply|\bpass\b|skip this|not a fit|hard mismatch|do not tailor|fundamental .*mismatch/.test(low)) { label = 'Pass'; tone = 'weak'; }
    else if (/good fit|good match|solid fit|worth applying/.test(low)) { label = 'Good fit'; tone = 'good'; }
    if (!label && score100 != null) {
      if (score100 >= 80) { label = 'Strong match'; tone = 'good'; }
      else if (score100 >= 60) { label = 'Good fit'; tone = 'good'; }
      else if (score100 >= 40) { label = 'Fair'; tone = 'medium'; }
      else { label = 'Weak — pass'; tone = 'weak'; }
    }
    if (!label && verdictText) { label = verdictText.slice(0, 40); tone = 'medium'; }
    var why = '';
    var bl = md.match(/Bottom line\s*[:\-]\s*(.+)/i); if (bl) why = bl[1].trim();
    if (!why) { var sm = md.match(/(?:Snapshot|Why it fits|Summary)\s*[:\-]?\s*\n?\s*[-•]?\s*(.+)/i); if (sm) why = sm[1].trim(); }
    if (!why && verdictText) why = verdictText;
    why = why.replace(/\s+/g, ' ').replace(/^[-•*\s]+/, '').slice(0, 260);
    if (score100 == null && !verdictText) return null;
    return { score100: score100, label: label, tone: tone, why: why };
  }
  function evalSummaryCard(s) {
    var TC = { good: ['#2f6f5b', '#e3efe9'], medium: ['#8a6a3b', '#f6ecd6'], weak: ['#9c5231', '#f4e3db'] };
    var c = TC[s.tone] || ['#6b6255', '#eee9de'];
    var scoreHtml = s.score100 != null ? '<div style="text-align:center;flex:0 0 auto"><div style="font-family:var(--serif,Georgia);font-weight:600;font-size:42px;line-height:1;color:#16324F">' + s.score100 + '<span style="font-size:18px;color:#8a8172">/100</span></div><div style="font:11px system-ui;color:#b0a790;margin-top:3px">fit score</div></div>' : '';
    return '<div style="background:#fff;border:1px solid #ece5d6;border-left:4px solid ' + c[0] + ';border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.05);padding:18px 22px;margin-bottom:18px;display:flex;gap:22px;align-items:center;flex-wrap:wrap">' +
      scoreHtml +
      '<div style="flex:1;min-width:220px">' +
      (s.label ? '<span style="display:inline-block;padding:3px 13px;border-radius:999px;background:' + c[1] + ';color:' + c[0] + ';font:700 12px system-ui;margin-bottom:9px">' + esc(s.label) + '</span>' : '') +
      (s.why ? '<div style="font:14px/1.55 system-ui;color:#3a3428">' + esc(s.why) + '</div>' : '') +
      '</div></div>';
  }
  function renderWorkspace(container, md, type) {
    md = String(md || '');
    if (!md.trim()) { container.innerHTML = '<div style="padding:16px;color:#8a8172;font:14px system-ui">(empty result)</div>'; return; }
    ensureLibStyles();
    container.innerHTML = '';
    // Evaluations get a prominent summary box at the TOP (score/100 + verdict pill + why).
    if (type === 'evaluate') { var summ = parseEvalSummary(md); if (summ) { var sc = document.createElement('div'); sc.innerHTML = evalSummaryCard(summ); if (sc.firstChild) container.appendChild(sc.firstChild); } }
    var secs = splitSectionsFull(md);
    // ── TOP TOOLBAR ROW: horizontal "On this page" (left) + downloads (right) ──
    var bar = el('div', 'display:flex;align-items:center;gap:18px;flex-wrap:wrap;border-bottom:1px solid #ece5d6;padding-bottom:12px;margin-bottom:16px');
    var toc = el('div', 'flex:1 1 auto;min-width:0;font:13.5px/1.7 system-ui;color:#2a3b4d');
    toc.innerHTML = '<span style="font:700 10.5px system-ui;letter-spacing:.06em;text-transform:uppercase;color:#b0a790;margin-right:9px">On this page:</span>' +
      secs.map(function (s, idx) { return '<a href="#" data-sec="' + idx + '" class="lib-toc" style="color:#2f6f5b;text-decoration:none;font-weight:600;white-space:nowrap">' + esc(s.title || ('Section ' + (idx + 1))) + '</a>'; }).join('<span style="color:#c9bfa8;margin:0 9px">·</span>');
    var dls = el('div', 'flex:0 0 auto;display:flex;gap:8px;align-items:center');
    dls.innerHTML = '<button class="btn btn--outline btn--sm" data-a="docx" type="button" style="font-size:12px">Download .docx</button><button class="btn btn--outline btn--sm" data-a="md" type="button" style="font-size:12px">Download markdown</button>';
    bar.appendChild(toc); bar.appendChild(dls);
    container.appendChild(bar);
    // ── FULL-WIDTH CONTENT below: Copy all, then the sections ──
    var copyRow = el('div', 'margin-bottom:14px');
    copyRow.innerHTML = '<button class="btn btn--primary btn--sm" data-a="copyall" type="button">Copy all</button>';
    container.appendChild(copyRow);
    var col = el('div', 'max-width:100%');
    var api = [];
    secs.forEach(function (s, idx) {
      var card = el('section', 'background:#fff;border:1px solid #ece5d6;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.04);padding:18px 24px;margin-bottom:14px'); card.id = 'libsec-' + idx;
      var head = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:8px');
      head.innerHTML = '<h3 class="lib-h" style="flex:1;margin:0">' + esc(s.title || ('Section ' + (idx + 1))) + '</h3><button class="btn btn--outline btn--sm sc-copy" type="button" style="font-size:11.5px;padding:5px 10px">Copy</button><button class="btn btn--outline btn--sm sc-edit" type="button" style="font-size:11.5px;padding:5px 10px">Edit</button>';
      // comfortable reading measure inside the now-full-width card
      var rich = el('div', 'max-width:74ch', '<div class="lib-md">' + mdToHtml(s.body) + '</div>');
      var ta = el('textarea'); ta.value = mdToText(s.body); ta.style.cssText = 'display:none;width:100%;min-height:150px;border:1px solid #d8cdb8;border-radius:10px;padding:12px;font:14px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;box-sizing:border-box;color:#2a3b4d;background:#fffdf8';
      card.appendChild(head); card.appendChild(rich); card.appendChild(ta);
      var editing = false;
      head.querySelector('.sc-edit').onclick = function () { editing = !editing; rich.style.display = editing ? 'none' : ''; ta.style.display = editing ? 'block' : 'none'; this.textContent = editing ? 'Done' : 'Edit'; if (editing) ta.focus(); };
      head.querySelector('.sc-copy').onclick = function () { copyText(ta.value, this); };
      col.appendChild(card);
      api.push({ title: s.title, get: function () { return ta.value; } });
    });
    container.appendChild(col);
    toc.querySelectorAll('[data-sec]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); var t = document.getElementById('libsec-' + a.getAttribute('data-sec')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
    copyRow.querySelector('[data-a=copyall]').onclick = function () { var all = api.map(function (s) { return (s.title ? s.title + '\n' + '-'.repeat(Math.min(44, (s.title || '').length || 3)) + '\n' : '') + s.get(); }).join('\n\n'); copyText(all, this); };
    dls.querySelector('[data-a=docx]').onclick = function () { libDownloadDocx(md, type); };
    dls.querySelector('[data-a=md]').onclick = function () { downloadText(md, (DOC_LABEL[type] || 'document').replace(/\s+/g, '-').toLowerCase() + '.md', 'text/markdown'); };
  }
  function libPoll(id, container, type, token) {
    var t = setInterval(function () {
      if (container.__t !== token) { clearInterval(t); return; } // a newer tab render took over
      jGet('/api/compass/jobs/' + id).then(function (j) {
        if (container.__t !== token) { clearInterval(t); return; }
        if (j.status === 'done') { clearInterval(t); renderWorkspace(container, j.markdown || '', type); }
        else if (j.status === 'error') { clearInterval(t); container.innerHTML = '<div style="padding:16px;background:#f7ece7;border:1px solid #e6c9bb;border-radius:10px;color:#9c5231;font:13.5px system-ui">Generation failed: ' + esc(j.error || '') + '</div>'; }
        else if (j.status === 'cancelled') { clearInterval(t); container.innerHTML = '<div style="padding:16px;background:#efeade;border:1px solid #ddd3bf;border-radius:10px;color:#6b6255;font:13.5px system-ui">Task cancelled.</div>'; }
      }).catch(function () { });
    }, 3000);
  }
  function renderItemInto(it, container) {
    // Freshness token: switching tabs invalidates any in-flight async render for
    // the previous tab so a slow fetch can't clobber the newly-selected content.
    var token = (container.__t = (container.__t || 0) + 1);
    function fresh() { return container.__t === token; }
    container.innerHTML = '<div style="padding:18px 0;color:#8a8172;font:13px system-ui">Loading…</div>';
    if (it.kind === 'job') {
      if (it.status === 'done') jGet('/api/compass/jobs/' + it.id).then(function (j) { if (fresh()) renderWorkspace(container, j.markdown || '', it.type); });
      else if (it.status === 'error') {
        if (!fresh()) return;
        container.innerHTML = '<div style="padding:16px;background:#f7ece7;border:1px solid #e6c9bb;border-radius:10px;color:#9c5231;font:13.5px system-ui">This generation failed: ' + esc(it.error || 'unknown') + '.</div>';
        var retry = el('button', 'margin-top:12px', 'Retry generation'); retry.className = 'btn btn--primary btn--sm'; retry.type = 'button';
        container.appendChild(retry);
        retry.onclick = function () {
          retry.disabled = true; retry.textContent = 'Restarting…';
          jGet('/api/compass/jobs/' + it.id).then(function (j) {
            return jPost('/api/compass/generate', { type: j.type, company: j.company, role: j.role, url: j.url, jd: j.jd });
          }).then(function (r) {
            var nid = r.body && r.body.jobId;
            if (!nid) { retry.disabled = false; retry.textContent = 'Retry generation'; toastMsg('Could not restart: ' + ((r.body && r.body.error) || r.status), 'info'); return; }
            it.id = nid; it.status = 'running'; it.error = null;   // re-run in place; poll the new job
            renderItemInto(it, container);
          }).catch(function (e) { retry.disabled = false; retry.textContent = 'Retry generation'; toastMsg('Retry error: ' + e, 'info'); });
        };
      }
      else {
        container.innerHTML = '<div style="padding:30px 16px;text-align:center;color:#B08D57;font:14px system-ui"><div style="width:26px;height:26px;border:3px solid #eadfca;border-top-color:#B08D57;border-radius:50%;margin:0 auto 12px;animation:libspin .9s linear infinite"></div>' + esc(llmProgress('Generating')) + '<div style="font:12px system-ui;color:#b0a790;margin:6px 0 14px">This keeps running even if you leave the page.</div></div>';
        var cancelBtn = el('div', 'text-align:center', '<button class="btn btn--outline btn--sm" type="button">Cancel task</button>');
        container.appendChild(cancelBtn);
        cancelBtn.querySelector('button').onclick = function () { var bb = this; bb.disabled = true; bb.textContent = 'Cancelling…'; cancelJob(it.id); };
        libPoll(it.id, container, it.type, token);
      }
    } else if (it.kind === 'net') { jGet('/api/networking/plans/' + encodeURIComponent(it.name)).then(function (j) { if (fresh()) renderWorkspace(container, j.markdown || '', 'networking'); }); }
    else if (it.kind === 'report') { jGet('/api/reports/' + encodeURIComponent(it.name)).then(function (j) { if (fresh()) renderWorkspace(container, j.markdown || j.content || '', 'evaluate'); }).catch(function () { if (fresh()) container.innerHTML = '<div style="padding:16px;color:#8a8172">(could not load report)</div>'; }); }
  }
  // Every job's generations grouped together; evaluations are their own labeled sub-group.
  var SUBGROUPS = [{ key: 'application', label: 'Application materials' }, { key: 'evaluation', label: 'Evaluation' }];
  function subGroupOf(type) { return type === 'evaluate' ? 'evaluation' : 'application'; }
  function statusDot(st) { return st === 'done' ? '#2f6f5b' : (st === 'error' ? '#9c5231' : '#B08D57'); }
  function libOpenRole(g, focusItem) {
    var det = document.getElementById('libDetail'); if (!det) return;
    ensureLibStyles();
    var dates = g.items.map(function (i) { return i.created; }).filter(Boolean).sort();
    var when = dates.length ? new Date(dates[dates.length - 1]).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    det.innerHTML =
      '<div style="font:13px system-ui;color:#8a8172;margin:2px 0 12px"><a href="#" id="libCrumbHome" style="color:#2f6f5b;text-decoration:none;font-weight:600">Library</a> <span style="color:#c9bfa8;margin:0 6px">›</span> <span style="color:#16324F;font-weight:600">' + esc(g.company) + '</span>' + (g.role ? ' <span style="color:#8a8172">· ' + esc(g.role) + '</span>' : '') + '</div>' +
      '<div style="' + CARD + ';padding:22px 26px">' +
      '<h2 style="font-family:var(--serif,\'Iowan Old Style\',Georgia,serif);font-weight:600;font-size:24px;color:#16324F;margin:0 0 3px;line-height:1.15">' + esc(g.company) + (g.role ? ' <span style="color:#8a8172;font-weight:500">— ' + esc(g.role) + '</span>' : '') + '</h2>' +
      '<div style="font:12.5px system-ui;color:#8a8172;margin-bottom:16px">' + (when ? esc(when) : '') + '</div>' +
      '<div id="libTabs" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid #ece5d6;padding-bottom:14px;margin-bottom:16px"></div>' +
      '<div id="libArt"></div></div>';
    var home = det.querySelector('#libCrumbHome'); if (home) home.onclick = function (e) { e.preventDefault(); var root = document.getElementById('libRoot'); window.scrollTo({ top: root ? root.offsetTop - 20 : 0, behavior: 'smooth' }); };
    var tabsEl = det.querySelector('#libTabs'), artEl = det.querySelector('#libArt');
    var tabButtons = [];
    function setActive(btn) { tabsEl.querySelectorAll('.lib-tab').forEach(function (x) { x.style.background = '#fff'; x.style.color = '#2a3b4d'; x.style.borderColor = '#e6ddc9'; }); btn.style.background = '#16324F'; btn.style.color = '#fff'; btn.style.borderColor = '#16324F'; }
    // tabs grouped by sub-group, with a small label before each cluster (consistent with the list)
    SUBGROUPS.forEach(function (sg) {
      var arts = g.items.filter(function (it) { return subGroupOf(it.type) === sg.key; });
      if (!arts.length) return;
      var lbl = el('span', 'font:700 10px system-ui;letter-spacing:.05em;text-transform:uppercase;color:#b0a790;margin:0 4px 0 2px'); lbl.textContent = sg.label;
      tabsEl.appendChild(lbl);
      arts.forEach(function (it) {
        var b = el('button'); b.type = 'button'; b.className = 'lib-tab';
        b.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + statusDot(it.status) + ';margin-right:7px;vertical-align:middle"></span>' + esc(DOC_LABEL[it.type] || it.type);
        b.style.cssText = 'border:1px solid #e6ddc9;background:#fff;color:#2a3b4d;border-radius:999px;padding:7px 14px;font:600 12.5px system-ui;cursor:pointer';
        b.onclick = function () { setActive(b); renderItemInto(it, artEl); };
        tabsEl.appendChild(b);
        tabButtons.push({ item: it, btn: b });
      });
    });
    var target = (focusItem && tabButtons.find(function (t) { return t.item === focusItem; }))
      || tabButtons.find(function (t) { return t.item.status === 'done'; })
      || tabButtons.find(function (t) { return t.item.status === 'running' || t.item.status === 'queued'; })
      || tabButtons[0];
    if (target) target.btn.click();
    try { window.scrollTo({ top: det.offsetTop - 20, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, det.offsetTop - 20); }
  }
  // Inline accordion content for one artifact TYPE: a version switcher (v1..vN)
  // + the selected version's rich workspace (renderItemInto handles done →
  // renderWorkspace incl. the evaluation summary box, running → spinner+cancel,
  // error → retry, net/report → workspace).
  function renderAccordionContent(body, type, items) {
    ensureLibStyles();
    items = items.slice().sort(function (a, b) { return String(a.created || '').localeCompare(String(b.created || '')); });
    var selIdx = items.length - 1;
    for (var q = items.length - 1; q >= 0; q--) { if (items[q].status === 'done') { selIdx = q; break; } }
    var sw = items.length > 1 ? ('<div role="tablist" aria-label="Versions" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0 12px">' +
      '<span style="font:700 10px system-ui;letter-spacing:.05em;text-transform:uppercase;color:#b0a790;margin-right:4px">Versions</span>' +
      items.map(function (v, i) { var cur = i === items.length - 1; return '<button class="acc-ver" data-i="' + i + '" type="button" style="border:1px solid #e6ddc9;border-radius:999px;padding:5px 11px;font:600 11.5px system-ui;cursor:pointer;background:#fff;color:#2a3b4d">v' + (i + 1) + (cur ? ' · newest' : '') + '</button>'; }).join('') +
      '</div>') : '';
    body.innerHTML = sw + '<div class="acc-render"></div>';
    var render = body.querySelector('.acc-render');
    var vbtns = body.querySelectorAll('.acc-ver');
    function show(i) {
      vbtns.forEach(function (b) { var on = +b.getAttribute('data-i') === i; b.style.background = on ? '#16324F' : '#fff'; b.style.color = on ? '#fff' : '#2a3b4d'; b.style.borderColor = on ? '#16324F' : '#e6ddc9'; });
      renderItemInto(items[i], render);
    }
    vbtns.forEach(function (b) { b.onclick = function () { show(+b.getAttribute('data-i')); }; });
    show(selIdx);
    return { show: show, versionOf: function (id) { return items.findIndex(function (x) { return x.id === id; }); } };
  }
  // Open the internal AI job-detail page for a Library job — same mechanism as
  // the Jobs feed (sessionStorage 'compass_current_job' → job-detail.html).
  function libViewJobDetail(g) {
    var url = g.items.map(function (i) { return i.url; }).find(Boolean) || '';
    setCurrentJob({ id: 'lib-' + g.key, title: g.role || g.company, role: g.role || '', company: g.company || '', url: url, mono: initials(g.company), color: colorFor(g.company), domain: hostFrom(url), loc: '', work: '', fit: '', why: '', open: true });
    location.href = 'job-detail.html';
  }
  function wireLibrary() {
    var root = document.getElementById('libRoot');
    if (!root) { var m = document.querySelector('main .wrap') || document.querySelector('main') || document.body; root = el('div'); root.id = 'libRoot'; m.appendChild(root); }
    root.innerHTML = 'Loading…';
    Promise.all([
      jGet('/api/compass/jobs').catch(function () { return { jobs: [] }; }),
      jGet('/api/networking/plans').catch(function () { return { plans: [] }; }),
      jGet('/api/reports').catch(function () { return { reports: [] }; })
    ]).then(function (a) {
      var jobsL = (a[0] && a[0].jobs) || [], plans = (a[1] && a[1].plans) || [], reports = (a[2] && (a[2].reports || a[2])) || [];
      var groups = {}, order = [];
      function grp(company, role) { var k = (company || '').toLowerCase().trim() + '|' + (role || '').toLowerCase().trim(); if (!groups[k]) { groups[k] = { key: k, company: company || '(unknown)', role: role || '', items: [] }; order.push(k); } return groups[k]; }
      jobsL.forEach(function (j) { grp(j.company, j.role).items.push({ kind: 'job', type: j.type, status: j.status, id: j.id, provider: j.provider, model: j.model, error: j.error, created: j.created, url: j.url }); });
      plans.forEach(function (p) { grp('Saved networking plans', '').items.push({ kind: 'net', type: 'networking', status: 'done', name: p.name }); });
      (Array.isArray(reports) ? reports : []).slice(0, 40).forEach(function (r) { var name = r.slug || r.name || r; grp('Saved evaluations', '').items.push({ kind: 'report', type: 'evaluate', status: 'done', name: name }); });
      if (!order.length) { root.innerHTML = '<div style="font:14px system-ui;color:#8a8172;padding:20px 0">No generated content yet. Generate a tailored CV, cover letter, evaluation, or networking plan (from Documents, a job, or Outreach) and it appears here — even while still running.</div>'; return; }
      // ── per-JOB card: header (+ View job detail) + labeled sub-groups of ACCORDIONS ──
      root.innerHTML = order.map(function (k) {
        var g = groups[k];
        var jdates = g.items.map(function (i) { return i.created; }).filter(Boolean).sort();
        var when = jdates.length ? new Date(jdates[jdates.length - 1]).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
        var note = g.items.some(function (i) { return i.status === 'running' || i.status === 'queued'; }) ? '· generating…' : (g.items.some(function (i) { return i.status === 'error'; }) ? '· needs attention' : '');
        var hasUrl = g.items.some(function (i) { return i.url; });
        var libFit = null; g.items.forEach(function (i) { if (!libFit && i.url) { var f = fitFor(i.url); if (f && typeof f.score === 'number') libFit = f; } });
        var subs = SUBGROUPS.map(function (sg) {
          var arts = g.items.filter(function (it) { return subGroupOf(it.type) === sg.key; });
          if (!arts.length) return '';
          var byType = {}, torder = [];
          arts.forEach(function (it) { if (!byType[it.type]) { byType[it.type] = []; torder.push(it.type); } byType[it.type].push(it); });
          return '<div style="padding:2px 20px 12px">' +
            '<div style="font:700 10.5px system-ui;letter-spacing:.05em;text-transform:uppercase;color:#b0a790;margin:8px 0 8px">' + esc(sg.label) + '</div>' +
            torder.map(function (t) {
              var items = byType[t];
              var anyRun = items.some(function (i) { return i.status === 'running' || i.status === 'queued'; });
              var anyDone = items.some(function (i) { return i.status === 'done'; });
              var st = anyRun ? 'running' : (anyDone ? 'done' : 'error');
              var meta = items.length > 1 ? ' <span style="font-weight:500;color:#8a8172">· ' + items.length + ' versions</span>' : (st !== 'done' ? ' <span style="font-weight:500;color:#8a8172">· ' + esc(st) + '</span>' : '');
              return '<div class="lib-acc" data-key="' + esc(k) + '" data-type="' + esc(t) + '" style="border:1px solid #e6ddc9;border-radius:12px;margin-bottom:9px;overflow:hidden;background:#fff">' +
                '<button class="lib-acc-btn" type="button" aria-expanded="false" style="width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;background:none;border:none;cursor:pointer;font:600 13.5px system-ui;color:#16324F;text-align:left">' +
                '<span class="chev" style="display:inline-block;transition:transform .18s;color:#b0a790;font-size:11px">▶</span>' +
                '<span style="width:8px;height:8px;border-radius:50%;background:' + statusDot(st) + ';flex:none"></span>' +
                '<span style="flex:1">' + esc(DOC_LABEL[t] || t) + meta + '</span></button>' +
                '<div class="lib-acc-body" hidden style="padding:4px 16px 16px;border-top:1px solid #f3eee1"></div></div>';
            }).join('') + '</div>';
        }).join('');
        return '<div class="lib-job" style="' + CARD + ';padding:0;margin-bottom:14px;overflow:hidden">' +
          '<div style="padding:16px 20px 12px;border-bottom:1px solid #f3eee1;display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">' +
          '<div style="flex:1;min-width:0"><div style="font-family:var(--serif,\'Iowan Old Style\',Georgia,serif);font-weight:600;font-size:17px;color:#16324F">' + esc(g.company) + (g.role ? ' <span style="color:#8a8172;font-weight:500">— ' + esc(g.role) + '</span>' : '') + '</div>' +
          '<div style="font:12px system-ui;color:#8a8172;margin-top:3px">' + (when ? esc(when) + ' ' : '') + esc(note) + '</div></div>' +
          (libFit ? '<div style="flex:none;display:flex;align-items:center;gap:8px;padding-top:1px" title="AI fit">' + '<span style="font-family:var(--serif,Georgia);font-weight:600;font-size:19px;color:#16324F">' + libFit.score + '<span style="font-size:11px;color:#8a8172">/100</span></span>' + (libFit.verdict ? verdictPill(libFit.verdict) : '') + '</div>' : '') +
          '<a class="lib-detail-link" data-key="' + esc(k) + '" href="job-detail.html" title="' + (hasUrl ? 'Open the AI job-detail view for this posting' : 'Open the job-detail view (from the role info)') + '" style="flex:none;font:600 12.5px system-ui;color:#2f6f5b;text-decoration:none;white-space:nowrap;padding-top:2px">View job detail →</a>' +
          '</div>' + subs + '</div>';
      }).join('');

      // View job detail links
      root.querySelectorAll('.lib-detail-link').forEach(function (a2) { a2.onclick = function (e) { e.preventDefault(); libViewJobDetail(groups[a2.getAttribute('data-key')]); }; });

      // Accordion toggles — expand INLINE under the button, collapse in place.
      var accIndex = {};
      root.querySelectorAll('.lib-acc').forEach(function (acc) {
        var btn = acc.querySelector('.lib-acc-btn'), body = acc.querySelector('.lib-acc-body'), chev = acc.querySelector('.chev');
        var key = acc.getAttribute('data-key'), type = acc.getAttribute('data-type');
        var loaded = false, ctrl = null;
        function expand() { if (!body.hasAttribute('hidden')) return ctrl; body.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); chev.style.transform = 'rotate(90deg)'; if (!loaded) { loaded = true; ctrl = renderAccordionContent(body, type, groups[key].items.filter(function (i) { return i.type === type; })); } return ctrl; }
        function collapse() { body.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); chev.style.transform = 'rotate(0deg)'; }
        btn.onclick = function () { if (body.hasAttribute('hidden')) expand(); else collapse(); };  // independent multi-open
        accIndex[key + '||' + type] = { expand: expand, el: acc };
      });

      // Deep-link: library.html?job=<id> → expand that artifact's accordion + select the version.
      var qJob = (location.search.match(/[?&]job=([^&]+)/) || [])[1];
      if (qJob) {
        qJob = decodeURIComponent(qJob);
        order.some(function (k) {
          return groups[k].items.some(function (it) {
            if (it.kind === 'job' && it.id === qJob) {
              var entry = accIndex[k + '||' + it.type];
              if (entry) { var c = entry.expand(); if (c && c.versionOf) { var vi = c.versionOf(qJob); if (vi >= 0) c.show(vi); } setTimeout(function () { entry.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60); }
              return true;
            }
            return false;
          });
        });
        return;
      }
      // else auto-expand the first running/queued artifact
      order.some(function (k) {
        return groups[k].items.some(function (it) {
          if (it.status === 'running' || it.status === 'queued') { var entry = accIndex[k + '||' + it.type]; if (entry) entry.expand(); return true; }
          return false;
        });
      });
    });
    banner('Generated-content Library — grouped by job. Each artifact is an accordion: click to expand its rich workspace INLINE under the button (versions v1/v2, per-section Copy, Edit, downloads, evaluation summary); click again to collapse. “View job detail →” opens the AI job-detail page for that job.');
  }

  // ======================= AI-TASK ACTIVITY SYSTEM =========================
  // Dismissable rich toast (reuses the page's toast region if present).
  function toastRegion() {
    var r = document.getElementById('toastLive') || document.querySelector('.toast-wrap');
    if (!r) { r = document.createElement('div'); r.id = 'toastLive'; r.className = 'toast-wrap'; r.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9998;display:flex;flex-direction:column;gap:8px;max-width:370px'; document.body.appendChild(r); }
    return r;
  }
  function compassToast(o) {
    var t = document.createElement('div');
    t.style.cssText = 'background:#16324F;color:#fff;padding:11px 12px 11px 15px;border-radius:11px;font:13px/1.4 system-ui;box-shadow:0 8px 26px rgba(0,0,0,.24);display:flex;align-items:center;gap:10px';
    if (o.tone === 'error') t.style.background = '#7a3423';
    if (o.tone === 'muted') t.style.background = '#4a4436';
    var msg = document.createElement('div'); msg.style.cssText = 'flex:1'; msg.innerHTML = (o.icon ? '<b style="margin-right:6px">' + o.icon + '</b>' : '') + esc(o.text);
    t.appendChild(msg);
    if (o.actionLabel) {
      var a = document.createElement(o.actionHref ? 'a' : 'button'); a.textContent = o.actionLabel;
      a.style.cssText = 'background:rgba(255,255,255,.18);color:#fff;border:none;border-radius:8px;padding:5px 11px;font:600 12px system-ui;cursor:pointer;text-decoration:none;white-space:nowrap';
      if (o.actionHref) a.href = o.actionHref;
      if (o.onAction) a.onclick = function (e) { o.onAction(e); if (o.closeOnAction !== false) t.remove(); };
      t.appendChild(a);
    }
    var x = document.createElement('button'); x.innerHTML = '&times;'; x.setAttribute('aria-label', 'Dismiss');
    x.style.cssText = 'background:none;border:none;color:rgba(255,255,255,.72);font-size:19px;line-height:1;cursor:pointer;padding:0 2px'; x.onclick = function () { t.remove(); };
    t.appendChild(x);
    toastRegion().appendChild(t);
    if (o.autofade !== false) setTimeout(function () { if (t.parentNode) { t.style.transition = 'opacity .5s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 500); } }, o.autofadeMs || 10000);
    return t;
  }

  // Header activity indicator (bell + running-count badge) — on every page.
  function injectActivity() {
    var host = document.querySelector('.topbar-in');
    if (!host || document.getElementById('compassActivity')) return;
    var a = document.createElement('a'); a.id = 'compassActivity'; a.href = 'tasks.html'; a.title = 'AI tasks'; a.setAttribute('aria-label', 'AI tasks');
    a.style.cssText = 'margin-left:auto;position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:999px;color:#2a3b4d;text-decoration:none';
    a.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>' +
      '<span id="compassActivityBadge" style="display:none;position:absolute;top:1px;right:1px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#B5623B;color:#fff;font:700 10px/16px system-ui;text-align:center;box-sizing:border-box"></span>';
    if (page === 'tasks.html') { a.style.background = '#16324F'; a.style.color = '#fff'; }
    else { a.onmouseenter = function () { a.style.background = '#f0ead9'; }; a.onmouseleave = function () { a.style.background = 'none'; }; }
    host.appendChild(a);
  }
  function updateBadge(list) {
    var n = list.filter(function (j) { return j.status === 'running' || j.status === 'queued'; }).length;
    var b = document.getElementById('compassActivityBadge'); if (!b) return;
    if (n > 0) { b.textContent = n; b.style.display = ''; } else b.style.display = 'none';
  }

  // Global job watcher — runs on EVERY page (wire.js loads everywhere). Polls
  // GET /api/compass/jobs; updates the badge; fires a dismissable completion
  // toast when a job first reaches done/error/cancelled. localStorage dedupes
  // so navigating never double-notifies and a completion that happened on
  // another page still surfaces on the next tick. NOTE: this is IN-PAGE (any
  // open Compass tab); true OS push with the tab closed would need a service
  // worker (out of scope).
  var NKEY = 'compass_notified';
  function retryJob(id) {
    jGet('/api/compass/jobs/' + id).then(function (j) { return jPost('/api/compass/generate', { type: j.type, company: j.company, role: j.role, url: j.url, jd: j.jd }); })
      .then(function (r) { toastMsg(r.body && r.body.jobId ? 'Retrying…' : ('Retry failed: ' + ((r.body && r.body.error) || r.status)), 'info'); });
  }
  function cancelJob(id, cb) {
    jPost('/api/compass/jobs/' + id + '/cancel', {}).then(function (r) { toastMsg(r.body && r.body.ok ? 'Task cancelled' : 'Cancel failed', r.body && r.body.ok ? 'success' : 'info'); if (cb) cb(r); });
  }
  function completionToast(j) {
    var label = DOC_LABEL[j.type] || j.type; var suffix = j.company ? ' for ' + j.company : '';
    if (j.status === 'done') compassToast({ icon: '✓', text: label + suffix + ' is ready', actionLabel: 'View', actionHref: 'library.html?job=' + encodeURIComponent(j.id) });
    else if (j.status === 'error') compassToast({ tone: 'error', icon: '✕', text: label + suffix + ' failed', actionLabel: 'Retry', onAction: function () { retryJob(j.id); } });
    else if (j.status === 'cancelled') compassToast({ tone: 'muted', icon: '⊘', text: label + suffix + ' — cancelled' });
  }
  function watchJobs() {
    return jGet('/api/compass/jobs').then(function (d) {
      var list = (d && d.jobs) || [];
      updateBadge(list);
      if (typeof window.__compassOnJobs === 'function') window.__compassOnJobs(list); // tasks page live hook
      var notified; try { notified = JSON.parse(localStorage.getItem(NKEY) || 'null'); } catch (e) { notified = null; }
      var firstRun = (notified === null); if (firstRun) notified = {};
      var TERM = { done: 1, error: 1, cancelled: 1 };
      list.forEach(function (j) {
        if (!TERM[j.status]) return;
        if (firstRun) { notified[j.id] = 1; return; }   // seed silently on the first-ever tick
        if (notified[j.id]) return;
        notified[j.id] = 1; completionToast(j);
      });
      try { localStorage.setItem(NKEY, JSON.stringify(notified)); } catch (e) { }
      return list;
    }).catch(function () { return []; });
  }

  // ======================= TASKS PAGE ======================================
  var STATUS_STYLE = { queued: ['#8a8172', '#f0ead9'], running: ['#8a6a3b', '#f6ecd6'], done: ['#2f6f5b', '#e3efe9'], error: ['#9c5231', '#f4e3db'], cancelled: ['#6b6255', '#eee9de'] };
  function fmtElapsed(ms) { if (ms < 0) ms = 0; var s = Math.round(ms / 1000); if (s < 60) return s + 's'; var m = Math.floor(s / 60); var r = s % 60; if (m < 60) return m + 'm ' + r + 's'; var h = Math.floor(m / 60); return h + 'h ' + (m % 60) + 'm'; }
  function renderTasks(list) {
    var root = document.getElementById('tasksRoot'); if (!root) return;
    var active = list.filter(function (j) { return j.status === 'running' || j.status === 'queued'; });
    var doneish = list.filter(function (j) { return j.status === 'done' || j.status === 'error' || j.status === 'cancelled'; });
    active.sort(function (a, b) { return String(a.created).localeCompare(String(b.created)); });
    doneish.sort(function (a, b) { return String(b.finished || b.created).localeCompare(String(a.finished || a.created)); });
    var rows = active.concat(doneish);
    if (!rows.length) { root.innerHTML = '<div style="padding:40px 0;text-align:center;color:#8a8172;font:15px system-ui">No AI tasks running. Start a tailored CV, cover letter, evaluation, or networking plan and it will appear here.</div>'; return; }
    var now = Date.now();
    function rowHtml(j) {
      var st = STATUS_STYLE[j.status] || ['#6b6255', '#eee9de'];
      var pill = '<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:' + st[1] + ';color:' + st[0] + ';font:700 11px system-ui;text-transform:capitalize">' + esc(j.status) + '</span>';
      var pm = j.provider ? (esc(j.provider) + (j.model ? ' · ' + esc(j.model) : '')) : '—';
      var startTs = j.started || j.created;
      var elapsed = j.status === 'running' ? fmtElapsed(now - new Date(startTs).getTime()) : ((j.finished && j.started) ? fmtElapsed(new Date(j.finished).getTime() - new Date(j.started).getTime()) : '—');
      var startedStr = startTs ? new Date(startTs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
      var acts = '';
      if (j.status === 'running' || j.status === 'queued') acts = '<button class="btn btn--outline btn--sm task-cancel" data-id="' + j.id + '" type="button" style="font-size:12px">Cancel</button>';
      else if (j.status === 'done') acts = '<a class="btn btn--outline btn--sm" href="library.html?job=' + encodeURIComponent(j.id) + '" style="font-size:12px">View</a>';
      else if (j.status === 'error') acts = '<button class="btn btn--primary btn--sm task-retry" data-id="' + j.id + '" type="button" style="font-size:12px">Retry</button>';
      else if (j.status === 'cancelled') acts = '<button class="btn btn--outline btn--sm task-retry" data-id="' + j.id + '" type="button" style="font-size:12px">Re-run</button>';
      return '<div style="display:flex;align-items:center;gap:14px;padding:13px 4px;border-bottom:1px solid #f0ead9">' +
        '<div style="flex:1.4;min-width:0"><div style="font-weight:600;color:#16324F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(j.company || '(unknown)') + (j.role ? ' <span style="color:#8a8172;font-weight:500">· ' + esc(j.role) + '</span>' : '') + '</div><div style="font:12px system-ui;color:#8a8172">' + esc(DOC_LABEL[j.type] || j.type) + '</div></div>' +
        '<div style="flex:0 0 92px">' + pill + '</div>' +
        '<div style="flex:1;font:12px system-ui;color:#8a8172;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + pm + '</div>' +
        '<div style="flex:0 0 130px;font:12px system-ui;color:#8a8172">' + startedStr + ' · ' + elapsed + '</div>' +
        '<div style="flex:0 0 92px;text-align:right">' + acts + '</div></div>';
    }
    var html = '';
    if (active.length) html += '<div style="font:700 11px system-ui;letter-spacing:.05em;text-transform:uppercase;color:#B08D57;margin:6px 0 4px">In progress (' + active.length + ')</div>' + active.map(rowHtml).join('');
    if (doneish.length) html += '<div style="font:700 11px system-ui;letter-spacing:.05em;text-transform:uppercase;color:#b0a790;margin:' + (active.length ? '20px' : '6px') + ' 0 4px">Recent</div>' + doneish.slice(0, 40).map(rowHtml).join('');
    root.innerHTML = html;
    root.querySelectorAll('.task-cancel').forEach(function (b) { b.onclick = function () { b.disabled = true; b.textContent = 'Cancelling…'; cancelJob(b.getAttribute('data-id'), function () { watchJobs(); }); }; });
    root.querySelectorAll('.task-retry').forEach(function (b) { b.onclick = function () { retryJob(b.getAttribute('data-id')); setTimeout(watchJobs, 400); }; });
  }
  function wireTasks() {
    var root = document.getElementById('tasksRoot');
    if (!root) { var m = document.querySelector('main .wrap') || document.querySelector('main') || document.body; root = el('div'); root.id = 'tasksRoot'; m.appendChild(root); }
    window.__compassOnJobs = renderTasks;      // watchJobs (6s) refreshes it too
    watchJobs();                                // immediate
    setInterval(function () { watchJobs(); }, 5000);
  }

  // ======================= dispatch ========================================
  Promise.all([loadDead(), loadProvider(), loadFit(), loadSalary()]).then(function () {
    renderNav();
    injectActivity();
    watchJobs(); setInterval(watchJobs, 6000);   // global watcher on every page
    if (page === 'jobs.html') wireJobs();
    else if (page === 'library.html') wireLibrary();
    else if (page === 'tasks.html') wireTasks();
    else if (page === 'dashboard.html' || page === '' || page === 'compass') wireDash();
    else if (page === 'job-detail.html') wireDetail();
    else if (page === 'saved.html') wireSaved();
    else if (page === 'documents.html') wireDocs();
    else if (page === 'setup.html') wireSetup();
    else if (page === 'outreach.html') wireOutreach();
    else banner('Static preview page (not wired).');
  });
})();
