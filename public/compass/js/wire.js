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
    return {
      id: 'c' + (row.num || Math.random().toString(36).slice(2)),
      num: row.num, title: title, company: row.company || '', domain: hostFrom(row.url),
      mono: initials(row.company || ''), color: colorFor(row.company || ''),
      loc: row.location || '', locKey: locKeyFor(row.location), work: /remote/i.test(row.location || '') ? 'Remote' : 'On-site',
      salMin: null, salMax: null, fit: scoreToFit(row), age: 0, isNew: false, saved: false,
      cat: row.status || 'Evaluated', func: funcFor(title), level: levelFor(title),
      why: row.notes || (row.status ? ('Status: ' + row.status) : 'Imported from tracker.'),
      url: row.url || '', status: row.status || '', score: row.score || ''
    };
  }
  function setCurrentJob(job) { try { sessionStorage.setItem('compass_current_job', JSON.stringify(job)); } catch (e) {} }
  function getCurrentJob() { try { return JSON.parse(sessionStorage.getItem('compass_current_job') || 'null'); } catch (e) { return null; } }

  // Liveness store (annotate-only): url → live|dead|unknown. Dead rows are hidden.
  function loadDead() {
    return jGet('/api/compass/liveness').then(function (j) {
      window.__deadSet = new Set(Object.keys((j && j.map) || {}).filter(function (u) { return j.map[u] === 'dead'; }).map(normUrl));
      window.__liveCounts = (j && j.counts) || {};
      return window.__deadSet;
    }).catch(function () { window.__deadSet = new Set(); return window.__deadSet; });
  }
  function isDead(url) { return window.__deadSet && window.__deadSet.has(normUrl(url)); }

  var page = (location.pathname.split('/').pop() || '').toLowerCase();

  // ======================= JOBS ============================================
  var PAGE_SIZE = 50;
  function compassRender() {
    if (!window.JOBS || typeof window.matches !== 'function' || typeof window.cardHTML !== 'function') return;
    var all = window.JOBS.filter(window.matches);
    var st = window.state ? window.state.sort : 'best';
    if (st === 'best') all.sort(function (a, b) { return b.fit - a.fit; });
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
    if (window.saveFilters) window.saveFilters();
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
      window.render = compassRender;   // paginated render over the full set
      compassRender();
      banner('Jobs LIVE from /api/tracker — ' + window.JOBS.length + ' shown of ' + loaded + ' rows (' + hidden + ' dead hidden). Search/sort/Status/Function/Level/Location/Work filter the FULL set; display paginates 50 at a time. ✓/✗ → feedback.jsonl. Salary not in tracker (preview).');
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
      '<li id="qsEval">Scoring your fit — local AI model, can take a few minutes…</li></ul>' +
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
      return jPost('/api/evaluate', { jd: jd, save: false });
    }).then(function (r) {
      done('qsEval'); var ev = r.body; var md = (ev && (ev.markdown || ev.report)) || '';
      var m = md.match(/(\d(?:\.\d)?)\s*\/\s*5/) || md.match(/score[^\d]*(\d(?:\.\d)?)/i);
      var score = m ? Math.round(parseFloat(m[1]) / 5 * 100) : null;
      set('<div class="qa-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>Added &amp; scored on the real model</div>' +
        (score != null ? '<div class="qa-result"><div class="r-ring">' + score + '</div><div><div class="r-t">Fit scored by ' + esc(ev.mode || 'AI') + '</div><div class="r-m">Live evaluation of the posting you added.</div></div></div>' : '') +
        '<div style="max-height:240px;overflow:auto;background:#faf7f0;border:1px solid #e6ddc9;border-radius:10px;padding:12px;margin-top:12px;font:13px/1.5 system-ui;white-space:pre-wrap">' + esc(md.slice(0, 4000) || '(no evaluation text)') + '</div>' +
        '<div class="qa-actions" style="margin-top:12px"><button class="btn btn--primary" id="qaDone2" type="button">Done</button></div>');
      var d = document.getElementById('qaDone2'); if (d) d.onclick = function () { if (window.closeModal) window.closeModal(); };
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
      var ring = document.querySelector('.match-ring'); if (ring) ring.textContent = job.fit;

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
      banner('Job detail LIVE — fields from the tracker row; posting body via /api/pipeline/preview. "Apply now" opens the real URL + marks the tracker row Applied. Match strengths/gaps are demo copy.');
    });
  }

  // ======================= SAVED (My Jobs) =================================
  function wireSaved() {
    Promise.all([jGet('/api/tracker'), jGet('/api/tracker/stages')]).then(function (arr) {
      var rows = ((arr[0] && arr[0].rows) || []).filter(function (r) { return !isDead(r.url); });
      var stages = (arr[1] && arr[1].stages) || ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected'];
      var mine = rows.filter(function (r) { return /appl|respond|interview|offer|hired|reject/i.test(r.status || ''); });
      if (mine.length < 3) mine = rows.slice(0, 25);
      var host = document.createElement('div');
      host.innerHTML = mine.map(function (r) {
        var opts = stages.map(function (s) { return '<option' + ((r.status || '') === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
        return '<div class="srow" data-num="' + esc(r.num) + '" data-url="' + esc(r.url) + '" style="display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #ece5d6;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.04);padding:14px 16px;margin-bottom:10px;cursor:pointer">' +
          '<span class="logo" style="--mc:' + colorFor(r.company) + ';flex:none" data-mono="' + esc(initials(r.company)) + '"><img src="https://logo.clearbit.com/' + esc(hostFrom(r.url)) + '" onerror="this.parentNode.classList.add(\'failed\');this.remove()"></span>' +
          '<div style="flex:1;min-width:0"><div style="font-weight:600;color:#16324F">' + esc(r.role) + '</div><div style="font-size:13px;color:#8a8172">' + esc(r.company) + ' · ' + esc(r.location || '') + ' · fit ' + scoreToFit(r) + '</div></div>' +
          '<select class="stage-select" aria-label="Status" style="flex:none;padding:7px 10px;border:1px solid #d8cdb8;border-radius:9px;font:13px system-ui">' + opts + '</select>' +
          '</div>';
      }).join('');
      var main = document.querySelector('main .wrap') || document.querySelector('main') || document.body;
      document.querySelectorAll('main .srow, main .job-row, main .saved-row, main .card').forEach(function (n) { n.style.display = 'none'; });
      var wrap = document.createElement('section'); wrap.appendChild(host); main.appendChild(wrap);
      host.querySelectorAll('.srow').forEach(function (el, i) {
        el.addEventListener('click', function (e) { if (e.target.tagName === 'SELECT') return; setCurrentJob(mapRow(mine[i])); location.href = 'job-detail.html'; });
        var sel = el.querySelector('select');
        if (sel) sel.addEventListener('change', function () {
          jPost('/api/compass/tracker/status', { num: mine[i].num, url: mine[i].url, status: sel.value }).then(function (r) {
            toastMsg(r.body && r.body.ok ? ('Status → ' + sel.value + ' saved to tracker ✓') : ('Status update failed: ' + ((r.body && r.body.error) || r.status)), r.body && r.body.ok ? 'success' : 'info');
          }).catch(function (er) { toastMsg('Status update error: ' + er, 'info'); });
        });
      });
      var n0 = document.querySelector('.stat .n'); if (n0) n0.textContent = mine.length;
      banner('My Jobs LIVE — ' + mine.length + ' real tracker rows (dead hidden). The Status dropdown PERSISTS via POST /api/compass/tracker/status (rewrites applications.md).');
    }).catch(function (e) { banner('Could not load saved/tracker: ' + e); });
  }

  // ======================= DOCUMENTS =======================================
  function wireDocs() {
    var job = getCurrentJob();
    function getJd() {
      var url = job && job.url;
      var p = url ? jGet('/api/pipeline/preview?url=' + encodeURIComponent(url)).then(function (r) { return (r && r.text) || ''; }).catch(function () { return ''; }) : Promise.resolve('');
      return p.then(function (t) { if (t && t.length >= 40) return t; return (job ? (job.title + ' at ' + job.company + '. ' + (job.why || '')) : 'Finance leadership role.') + ' Responsibilities include FP&A, budgeting, forecasting, and business partnering.'; });
    }
    var lastMarkdown = '';
    function runTailor(panelSel, headline) {
      var panel = document.querySelector(panelSel) || document.body;
      var out = panel.querySelector('.compass-tailor-out');
      if (!out) { out = document.createElement('div'); out.className = 'compass-tailor-out'; out.style.cssText = 'margin-top:14px;background:#faf7f0;border:1px solid #e6ddc9;border-radius:12px;padding:16px;font:13.5px/1.6 system-ui;white-space:pre-wrap;max-height:420px;overflow:auto'; panel.appendChild(out); }
      out.textContent = 'Tailoring on the real model (local AI, can take a few minutes)…';
      getJd().then(function (jd) { return jPost('/api/cv-studio/tailor', { jd: jd, headline: headline || (job ? job.title : ''), run: true }); })
        .then(function (r) { var b = r.body; if (b && b.markdown) { lastMarkdown = b.markdown; out.textContent = b.markdown; toastMsg('Tailored by ' + (b.mode || 'AI'), 'success'); } else if (b && b.prompt && b.mode === 'manual') { out.textContent = 'No live provider — copy this prompt into any LLM:\n\n' + b.prompt; } else { out.textContent = 'Tailoring failed: ' + ((b && b.error) || 'unknown'); } })
        .catch(function (e) { out.textContent = 'Tailoring error: ' + e; });
    }
    var tr = document.getElementById('tailorRewrite'); if (tr) tr.addEventListener('click', function (e) { e.preventDefault(); runTailor('#panelTailor', job ? job.title : ''); });
    var pdf = document.getElementById('tailorPdf');
    if (pdf) pdf.addEventListener('click', function (e) {
      e.preventDefault();
      var md = lastMarkdown || ((document.querySelector('#panelTailor .compass-tailor-out') || {}).textContent) || '';
      if (!md || md.length < 40) { toastMsg('Run "Redo the tailoring" first to generate real content.', 'info'); return; }
      fetch('/api/export/docx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown: md, title: (job ? job.company + ' — tailored CV' : 'tailored CV') }) })
        .then(function (r) { return r.blob(); }).then(function (blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tailored-cv.docx'; document.body.appendChild(a); a.click(); a.remove(); toastMsg('Downloaded real .docx (/api/export/docx)', 'success'); })
        .catch(function (er) { toastMsg('Export failed: ' + er, 'info'); });
    });
    var coverPanel = document.querySelector('#panelCover');
    if (coverPanel && !coverPanel.querySelector('.compass-cover-btn')) {
      var cb = document.createElement('button'); cb.className = 'btn btn--primary btn--sm compass-cover-btn'; cb.type = 'button'; cb.textContent = 'Generate with AI (real)'; cb.style.marginBottom = '10px';
      coverPanel.insertBefore(cb, coverPanel.firstChild);
      cb.addEventListener('click', function () { runTailor('#panelCover', (job ? job.title : '') + ' — cover letter'); });
    }
    banner('Documents LIVE — "Redo the tailoring" → /api/cv-studio/tailor (real local model, slow); "Download" → real .docx. Pre-filled sample text is demo until you generate.');
  }

  // ======================= SETUP (native AI panel) =========================
  var PROVIDERS = ['auto', 'hermes', 'anthropic', 'gemini', 'openai', 'qwen', 'openrouter', 'github'];
  function injectAiPanel() {
    var conn = document.querySelector('.conn');
    if (!conn || document.getElementById('compassAiPanel')) return;
    var p = document.createElement('div');
    p.id = 'compassAiPanel';
    p.style.cssText = 'margin:14px 0 4px;padding:16px;border:1px solid #e6ddc9;border-radius:14px;background:#FBF7EF';
    p.innerHTML =
      '<div style="font:600 14px system-ui;color:#16324F;margin-bottom:2px">AI provider &amp; keys</div>' +
      '<div id="compassProv" style="font:12.5px system-ui;color:#2f6f5b;margin-bottom:12px">Loading…</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<label style="font:600 12px system-ui;color:#6b6255">Provider<select id="cfgProvider" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #d8cdb8;border-radius:8px;font:13px system-ui">' + PROVIDERS.map(function (x) { return '<option value="' + x + '">' + x + '</option>'; }).join('') + '</select></label>' +
      '<label style="font:600 12px system-ui;color:#6b6255">Anthropic model<input id="cfgModel" type="text" placeholder="claude-opus-4-5" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #d8cdb8;border-radius:8px;font:13px system-ui;box-sizing:border-box"></label>' +
      '<label style="font:600 12px system-ui;color:#6b6255">LLM timeout (ms)<input id="cfgTimeout" type="text" placeholder="600000" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #d8cdb8;border-radius:8px;font:13px system-ui;box-sizing:border-box"></label>' +
      '<label style="font:600 12px system-ui;color:#6b6255">Anthropic API key<input id="cfgKey" type="password" placeholder="sk-ant-…" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #d8cdb8;border-radius:8px;font:13px system-ui;box-sizing:border-box"></label>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
      '<button id="cfgSave" type="button" class="btn btn--primary btn--sm">Save provider / model / timeout</button>' +
      '<button id="cfgKeyAdd" type="button" class="btn btn--outline btn--sm">Add / update key</button>' +
      '<button id="cfgKeyRemove" type="button" class="btn btn--outline btn--sm">Remove key</button>' +
      '</div>' +
      '<div id="cfgMsg" style="font:12px system-ui;color:#6b6255;margin-top:9px"></div>';
    conn.parentNode.insertBefore(p, conn.nextSibling);

    function msg(t, ok) { var el = document.getElementById('cfgMsg'); if (el) { el.textContent = t; el.style.color = ok === false ? '#9c5231' : (ok ? '#2f6f5b' : '#6b6255'); } }
    function refresh() {
      Promise.all([jGet('/api/config'), jGet('/api/status/providers')]).then(function (a) {
        var v = (a[0] && a[0].values) || {}, st = a[1] || {};
        var sel = document.getElementById('cfgProvider'); if (sel) sel.value = (v.LLM_PROVIDER || 'auto');
        var mdl = document.getElementById('cfgModel'); if (mdl && !mdl.value) mdl.value = v.ANTHROPIC_MODEL || '';
        var to = document.getElementById('cfgTimeout'); if (to && !to.value) to.value = v.LLM_TIMEOUT_MS || '';
        var key = v.ANTHROPIC_API_KEY;
        document.getElementById('compassProv').textContent = 'Active provider: ' + (st.activeProvider || 'none') + (st.activeModel ? ' · ' + st.activeModel : '') + ' · Anthropic key: ' + (key ? key + ' (set)' : 'not set');
      });
    }
    document.getElementById('cfgSave').onclick = function () {
      var payload = { LLM_PROVIDER: document.getElementById('cfgProvider').value, ANTHROPIC_MODEL: document.getElementById('cfgModel').value.trim(), LLM_TIMEOUT_MS: document.getElementById('cfgTimeout').value.trim() };
      jPost('/api/config', payload).then(function (r) { if (r.status === 200 && r.body.ok) { msg('Saved provider/model/timeout to .env ✓', true); refresh(); } else { msg('Save rejected: ' + ((r.body && r.body.details && r.body.details.join('; ')) || r.body.error || r.status), false); } });
    };
    document.getElementById('cfgKeyAdd').onclick = function () {
      var k = document.getElementById('cfgKey').value.trim();
      if (!k) { msg('Enter a key first.', false); return; }
      if (!/^sk-ant-\S{20,}$/.test(k)) { msg('That does not look like an Anthropic key (expected sk-ant-… + 20+ chars). It will be rejected by the server.', false); }
      jPost('/api/config', { ANTHROPIC_API_KEY: k, LLM_PROVIDER: 'anthropic' }).then(function (r) {
        if (r.status === 200 && r.body.ok) { document.getElementById('cfgKey').value = ''; msg('Key saved to .env; provider set to Anthropic.', true); refresh(); }
        else { msg('Rejected: ' + ((r.body && r.body.details && r.body.details.join('; ')) || (r.body && r.body.error) || r.status), false); }
      });
    };
    document.getElementById('cfgKeyRemove').onclick = function () {
      jPost('/api/config', { ANTHROPIC_API_KEY: '', LLM_PROVIDER: '' }).then(function (r) { if (r.status === 200 && r.body.ok) { msg('Key removed; back to auto/local Hermes.', true); refresh(); } else { msg('Remove failed: ' + ((r.body && r.body.error) || r.status), false); } });
    };
    refresh();
  }
  function wireSetup() {
    injectAiPanel();
    var btn = document.getElementById('saveBtn');
    if (btn) btn.addEventListener('click', function () {
      var settings = { includeTitles: (window.includeTitles || []).slice(), excludeTitles: (window.excludeTitles || []).slice(), searchTerms: (window.searchTerms || []).slice(), cities: (window.cities || []).map(function (c) { return c && c.name ? c.name : c; }), remoteUS: !!window.remoteUS };
      jPost('/api/compass/setup', { settings: settings }).then(function (r) { toastMsg(r.body && r.body.ok ? 'Search filters written to the REAL portals.yml ✓' : ('portals write failed: ' + (r.body && r.body.error)), r.body && r.body.ok ? 'success' : 'info'); }).catch(function (e) { toastMsg('portals write error: ' + e, 'info'); });
    });
    banner('Setup Save → REAL portals.yml. AI provider/model/key/timeout managed natively here via /api/config (writes .env). Companies-to-watch + comp floor are demo (protected).');
  }

  // ======================= dispatch ========================================
  loadDead().then(function () {
    if (page === 'jobs.html') wireJobs();
    else if (page === 'dashboard.html' || page === '' || page === 'compass') wireDash();
    else if (page === 'job-detail.html') wireDetail();
    else if (page === 'saved.html') wireSaved();
    else if (page === 'documents.html') wireDocs();
    else if (page === 'setup.html') wireSetup();
    else banner('Static preview page (not wired).');
  });
})();
