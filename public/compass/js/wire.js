/* ============================================================================
 * COMPASS FORK — real-backend wiring (served only by the :8100 instance).
 * Loaded AFTER each mockup's inline <script>, so it can override the demo
 * globals (JOBS / TOP / render / saveReview / buildMenu / runQA …) with LIVE
 * data from this instance's /api/* endpoints. The :8100 instance is pointed
 * (via CAREER_OPS_ROOT in its plist) at the REAL /Users/nick/apps/career-ops
 * data, so /api/tracker, /api/dashboard, /api/portals, /api/config all read
 * and write the SAME stores as the original :8099 instance.
 * ==========================================================================*/
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function hostFrom(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
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
  function jPost(u, b) { return fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(function (r) { return r.json(); }); }

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

  var page = (location.pathname.split('/').pop() || '').toLowerCase();

  // ======================= JOBS ============================================
  function wireJobs() {
    jGet('/api/tracker?pageSize=80&page=1').then(function (data) {
      var rows = (data && data.rows) || [];
      window.JOBS = rows.map(mapRow);
      window.JOBS.forEach(function (j) { j.open = true; });

      // capture-phase: remember which real job a card click is opening
      document.addEventListener('click', function (e) {
        var card = e.target.closest ? e.target.closest('.card[data-id]') : null;
        if (!card) return;
        var id = card.getAttribute('data-id');
        var job = (window.JOBS || []).find(function (x) { return x.id === id; });
        if (job) setCurrentJob(job);
      }, true);

      // good/bad → persist to the REAL feedback.jsonl
      if (typeof window.saveReview === 'function' && !window.__compassFbWrapped) {
        var orig = window.saveReview;
        window.saveReview = function (id, verdict, reason, note) {
          orig(id, verdict, reason, note);
          if (verdict !== 'good' && verdict !== 'bad') return;
          var job = (window.JOBS || []).find(function (x) { return x.id === id; });
          if (!job || !job.url) return;
          jPost('/api/compass/feedback', { url: job.url, verdict: verdict, reason: reason || '' })
            .then(function (j) { toastMsg(j && j.ok ? 'Recorded to feedback.jsonl (' + verdict + ')' : 'Saved locally — server write failed', j && j.ok ? 'success' : 'info'); })
            .catch(function () { toastMsg('Saved locally — server unreachable', 'info'); });
        };
        window.__compassFbWrapped = true;
      }

      // rebuild the category/function/level filter menus from REAL distinct values
      try {
        var cats = distinct(window.JOBS.map(function (j) { return j.cat; }));
        var funcs = distinct(window.JOBS.map(function (j) { return j.func; }));
        var levels = distinct(window.JOBS.map(function (j) { return j.level; }));
        window.CATS = cats; window.FUNCS = funcs; window.LEVELS = levels;
        if (typeof window.buildMenu === 'function') {
          window.buildMenu('catMenu', 'cat-cb', cats);
          window.buildMenu('funcMenu', 'func-cb', funcs);
          window.buildMenu('lvlMenu', 'lvl-cb', levels);
        }
        if (typeof window.wireCb === 'function' && window.state) {
          window.wireCb('.cat-cb', window.state.cats, 'catLabel', '', 'Status');
          window.wireCb('.func-cb', window.state.funcs, 'funcLabel', '', 'Function');
          window.wireCb('.lvl-cb', window.state.levels, 'lvlLabel', '', 'Level');
        }
        var cl = document.getElementById('catLabel'); if (cl) cl.textContent = 'Status';
      } catch (e) { /* menus stay as-is */ }

      if (typeof window.runQA === 'function') window.runQA = compassRunQA;
      if (typeof window.render === 'function') window.render();
      banner('Jobs LIVE from /api/tracker (' + rows.length + ' shown). Search, sort, Status/Function/Level/Location/Work filters operate on REAL rows. ✓/✗ → feedback.jsonl. Salary not in tracker → salary filter is a labeled preview.');
    }).catch(function (e) { banner('Could not load live jobs: ' + e); });
  }

  // "Add a job by URL" — real: POST /api/pipeline → preview → evaluate
  function compassRunQA() {
    var inp = document.getElementById('qaUrl'); if (!inp) return;
    var url = inp.value.trim(); if (!url) { inp.focus(); return; }
    var body = document.querySelector('.qa-modal .qa-body, #qaBody, .modal .qa-body') || (window.qaBody || null);
    var host = body || document.querySelector('.qa-body');
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
    jPost('/api/pipeline', { url: url }).then(function (p) {
      done('qsPipe'); doing('qsPrev');
      var el = document.getElementById('qsPipe'); if (el) el.textContent = p && p.ok ? (p.deduped ? 'Already in your pipeline ✓' : 'Saved to pipeline ✓') : ('Pipeline: ' + (p && p.error || 'error'));
      return jGet('/api/pipeline/preview?url=' + encodeURIComponent(url));
    }).then(function (prev) {
      done('qsPrev'); doing('qsEval');
      jd = (prev && prev.text) || '';
      var el = document.getElementById('qsPrev'); if (el) el.textContent = jd ? ('Read the posting ✓ (' + jd.length + ' chars)') : 'Posting fetched (thin — JS-rendered board)';
      if (!jd || jd.length < 40) { throw new Error('no readable JD text to score (JS-rendered board)'); }
      return jPost('/api/evaluate', { jd: jd, save: false });
    }).then(function (ev) {
      done('qsEval');
      var md = (ev && (ev.markdown || ev.report)) || '';
      var m = md.match(/(\d(?:\.\d)?)\s*\/\s*5/) || md.match(/score[^\d]*(\d(?:\.\d)?)/i);
      var score = m ? Math.round(parseFloat(m[1]) / 5 * 100) : null;
      set('<div class="qa-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>Added &amp; scored on the real model</div>' +
        (score != null ? '<div class="qa-result"><div class="r-ring">' + score + '</div><div><div class="r-t">Fit scored by ' + esc(ev.mode || 'AI') + '</div><div class="r-m">Live evaluation of the posting you added.</div></div></div>' : '') +
        '<div style="max-height:240px;overflow:auto;background:#faf7f0;border:1px solid #e6ddc9;border-radius:10px;padding:12px;margin-top:12px;font:13px/1.5 system-ui;white-space:pre-wrap">' + esc(md.slice(0, 4000) || '(no evaluation text returned)') + '</div>' +
        '<div class="qa-actions" style="margin-top:12px"><button class="btn btn--primary" id="qaDone2" type="button">Done</button></div>');
      var d = document.getElementById('qaDone2'); if (d) d.onclick = function () { if (window.closeModal) window.closeModal(); };
    }).catch(function (e) {
      done('qsPipe');
      set('<div class="qa-ok" style="background:#f3e2da;color:#9c5231"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6 6 18M6 6l12 12"/></svg>Saved to pipeline; live scoring unavailable</div>' +
        '<p style="font:13.5px system-ui;color:#6b6255;margin-top:10px">' + esc(String(e.message || e)) + '. The link is in your pipeline; you can score it from the Evaluate view.</p>' +
        (jd ? '<div style="max-height:200px;overflow:auto;background:#faf7f0;border:1px solid #e6ddc9;border-radius:10px;padding:12px;margin-top:10px;font:12.5px/1.5 system-ui;white-space:pre-wrap">' + esc(jd.slice(0, 2500)) + '</div>' : '') +
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
    Promise.all([jGet('/api/dashboard'), jGet('/api/tracker?pageSize=6&page=1')]).then(function (arr) {
      var d = arr[0] || {}, t = arr[1] || {};
      var apps = (d.counts && d.counts.applications) || 0;
      var by = d.byStatus || {};
      var applied = Object.keys(by).filter(function (k) { return /appl|interview|offer|hired|respond|screen|phone/i.test(k); }).reduce(function (s, k) { return s + by[k]; }, 0);
      var avgFit = (d.avgScore != null) ? Math.round((d.avgScore / 5) * 100) : null;
      var reviewed = 0; try { reviewed = Object.keys(JSON.parse(localStorage.getItem('compass_reviews') || '{}')).length; } catch (e) {}
      var ns = document.querySelectorAll('.stat .n');
      if (ns[0]) ns[0].textContent = apps;
      if (ns[2]) ns[2].textContent = applied;
      if (ns[3]) ns[3].textContent = Math.max(0, apps - reviewed);
      if (ns[4] && avgFit != null) ns[4].textContent = avgFit;
      var m = document.getElementById('matches');
      if (m && t.rows) {
        m.innerHTML = t.rows.map(matchHTML).join('');
        m.querySelectorAll('.match').forEach(function (el, i) {
          el.addEventListener('click', function () { setCurrentJob(mapRow(t.rows[i])); }, true);
        });
      }
      banner('Dashboard counts + top matches LIVE from /api/dashboard & /api/tracker (' + apps + ' real applications). "Saved" tile + scan schedules are demo-only.');
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
      // real posting text
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
      banner('Job detail LIVE — title/company/location/score from the tracker row; posting body fetched live via /api/pipeline/preview. Match strengths/gaps below are demo copy.');
    });
  }

  // ======================= SAVED (My Jobs) =================================
  function wireSaved() {
    Promise.all([jGet('/api/tracker?pageSize=500&page=1'), jGet('/api/tracker/stages')]).then(function (arr) {
      var rows = (arr[0] && arr[0].rows) || [];
      var stages = (arr[1] && arr[1].stages) || ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected'];
      // "My Jobs" = rows that have progressed past raw scan (a real, meaningful status)
      var mine = rows.filter(function (r) { return /appl|respond|interview|offer|hired|reject/i.test(r.status || ''); });
      if (mine.length < 3) mine = rows.slice(0, 20); // fall back to newest so the page is populated
      var list = document.querySelector('.rows, .saved-list, main') ;
      var container = document.querySelector('.saved-rows') || document.querySelector('.rows');
      // Build fresh rows into the first plausible list container; else append a section.
      var host = document.createElement('div');
      host.innerHTML = mine.map(function (r) {
        var opts = stages.map(function (s) { return '<option' + ((r.status || '') === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
        return '<div class="srow" data-num="' + esc(r.num) + '" style="display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #ece5d6;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.04);padding:14px 16px;margin-bottom:10px;cursor:pointer">' +
          '<span class="logo" style="--mc:' + colorFor(r.company) + ';flex:none" data-mono="' + esc(initials(r.company)) + '"><img src="https://logo.clearbit.com/' + esc(hostFrom(r.url)) + '" onerror="this.parentNode.classList.add(\'failed\');this.remove()"></span>' +
          '<div style="flex:1;min-width:0"><div style="font-weight:600;color:#16324F">' + esc(r.role) + '</div><div style="font-size:13px;color:#8a8172">' + esc(r.company) + ' · ' + esc(r.location || '') + ' · fit ' + scoreToFit(r) + '</div></div>' +
          '<select class="stage-select" aria-label="Status" style="flex:none;padding:7px 10px;border:1px solid #d8cdb8;border-radius:9px;font:13px system-ui">' + opts + '</select>' +
          '</div>';
      }).join('');
      var main = document.querySelector('main .wrap') || document.querySelector('main') || document.body;
      // Replace the static demo rows region: hide any existing static rows, insert live ones
      var demo = document.querySelectorAll('main .srow, main .job-row, main .saved-row');
      demo.forEach(function (n) { n.style.display = 'none'; });
      var wrap = document.createElement('section'); wrap.appendChild(host); main.appendChild(wrap);
      host.querySelectorAll('.srow').forEach(function (el, i) {
        el.addEventListener('click', function (e) { if (e.target.tagName === 'SELECT') return; setCurrentJob(mapRow(mine[i])); location.href = 'job-detail.html'; });
        var sel = el.querySelector('select'); if (sel) sel.addEventListener('change', function () { toastMsg('Status change is a preview — no server status-update endpoint exists yet (tracker POST only appends).', 'info'); });
      });
      // update the "Saved to review" style stat if present
      var n0 = document.querySelector('.stat .n'); if (n0) n0.textContent = mine.length;
      banner('My Jobs LIVE — ' + mine.length + ' real tracker rows (status Applied/Responded/Interview/Offer/…). Status dropdown is a labeled preview (no status-update endpoint yet).');
    }).catch(function (e) { banner('Could not load saved/tracker: ' + e); });
  }

  // ======================= DOCUMENTS =======================================
  function wireDocs() {
    var job = getCurrentJob();
    // Give the Tailor + Cover actions a real backend. JD comes from the current
    // job's live preview (or the newest tracker row if none was opened).
    function getJd() {
      var url = job && job.url;
      var p = url ? jGet('/api/pipeline/preview?url=' + encodeURIComponent(url)).then(function (r) { return (r && r.text) || ''; }).catch(function () { return ''; }) : Promise.resolve('');
      return p.then(function (t) {
        if (t && t.length >= 40) return t;
        // fallback: synthesize a JD from tracker fields so /tailor has 40+ chars
        return (job ? (job.title + ' at ' + job.company + '. ' + (job.why || '')) : 'Finance leadership role.') + ' Responsibilities include FP&A, budgeting, forecasting, and business partnering.';
      });
    }
    var lastMarkdown = '';
    function runTailor(panelSel, headline) {
      var panel = document.querySelector(panelSel) || document.body;
      var out = panel.querySelector('.compass-tailor-out');
      if (!out) { out = document.createElement('div'); out.className = 'compass-tailor-out'; out.style.cssText = 'margin-top:14px;background:#faf7f0;border:1px solid #e6ddc9;border-radius:12px;padding:16px;font:13.5px/1.6 system-ui;white-space:pre-wrap;max-height:420px;overflow:auto'; panel.appendChild(out); }
      out.textContent = 'Tailoring on the real model (local AI, can take a few minutes)…';
      getJd().then(function (jd) {
        return jPost('/api/cv-studio/tailor', { jd: jd, headline: headline || (job ? job.title : ''), run: true });
      }).then(function (r) {
        if (r && r.markdown) { lastMarkdown = r.markdown; out.textContent = r.markdown; toastMsg('Tailored by ' + (r.mode || 'AI'), 'success'); }
        else if (r && r.prompt && r.mode === 'manual') { out.textContent = 'No live provider — copy this prompt into any LLM:\n\n' + r.prompt; }
        else { out.textContent = 'Tailoring failed: ' + ((r && r.error) || 'unknown'); }
      }).catch(function (e) { out.textContent = 'Tailoring error: ' + e; });
    }
    function wireBtn(id, panelSel, headline) { var b = document.getElementById(id); if (b) b.addEventListener('click', function (e) { e.preventDefault(); runTailor(panelSel, headline); }); }
    wireBtn('tailorRewrite', '#panelTailor', job ? job.title : '');
    // PDF/download → real .docx from the tailored markdown
    var pdf = document.getElementById('tailorPdf');
    if (pdf) pdf.addEventListener('click', function (e) {
      e.preventDefault();
      var md = lastMarkdown || (document.querySelector('#panelTailor .compass-tailor-out') || {}).textContent || '';
      if (!md || md.length < 40) { toastMsg('Run "Redo the tailoring" first to generate real content.', 'info'); return; }
      fetch('/api/export/docx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown: md, title: (job ? job.company + ' — tailored CV' : 'tailored CV') }) })
        .then(function (r) { return r.blob(); }).then(function (blob) {
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tailored-cv.docx'; document.body.appendChild(a); a.click(); a.remove(); toastMsg('Downloaded real .docx (via /api/export/docx)', 'success');
        }).catch(function (er) { toastMsg('Export failed: ' + er, 'info'); });
    });
    // Cover-letter tab: add a real "Generate with AI" trigger into the cover panel
    var coverPanel = document.querySelector('#panelCover');
    if (coverPanel && !coverPanel.querySelector('.compass-cover-btn')) {
      var cb = document.createElement('button'); cb.className = 'btn btn--primary btn--sm compass-cover-btn'; cb.type = 'button'; cb.textContent = 'Generate with AI (real)'; cb.style.marginBottom = '10px';
      coverPanel.insertBefore(cb, coverPanel.firstChild);
      cb.addEventListener('click', function () { runTailor('#panelCover', (job ? job.title : '') + ' — cover letter'); });
    }
    banner('Documents LIVE — "Redo the tailoring" → /api/cv-studio/tailor (real local model, slow), "Download" → real .docx via /api/export/docx. The pre-filled sample text is demo until you generate.');
  }

  // ======================= SETUP ===========================================
  function injectAdvancedLink() {
    var conn = document.querySelector('.conn');
    if (!conn || document.getElementById('compassAdvLink')) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin:14px 0 4px;padding:14px;border:1px dashed #B08D57;border-radius:12px;background:#FBF7EF';
    wrap.innerHTML =
      '<div style="font:600 13px system-ui;color:#16324F;margin-bottom:4px">AI / Advanced settings</div>' +
      '<div style="font:12.5px/1.5 system-ui;color:#6b6255;margin-bottom:10px">Provider, model and API keys (Anthropic, etc.) live in the full settings view — the same page the original UI uses. It writes this instance’s .env.</div>' +
      '<a id="compassAdvLink" class="btn btn--outline btn--sm" href="/spa#/config" target="_blank" rel="noopener">Open AI / Advanced settings ↗</a>' +
      '<span id="compassProv" style="font:12px system-ui;color:#6b6255;margin-left:12px"></span>';
    conn.parentNode.insertBefore(wrap, conn.nextSibling);
    jGet('/api/status/providers').then(function (p) { var el = document.getElementById('compassProv'); if (el) el.textContent = 'Active provider: ' + (p.activeProvider || 'none') + (p.activeModel ? ' · ' + p.activeModel : ''); });
  }
  function wireSetup() {
    injectAdvancedLink();
    var btn = document.getElementById('saveBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        var settings = {
          includeTitles: (window.includeTitles || []).slice(),
          excludeTitles: (window.excludeTitles || []).slice(),
          searchTerms: (window.searchTerms || []).slice(),
          cities: (window.cities || []).map(function (c) { return c && c.name ? c.name : c; }),
          remoteUS: !!window.remoteUS
          // NOTE: companies-to-watch intentionally NOT sent — mockup entries lack a
          // careers_url/api/provider source key and would wipe tracked_companies.
        };
        jPost('/api/compass/setup', { settings: settings })
          .then(function (j) { toastMsg(j && j.ok ? 'Search filters written to the REAL portals.yml ✓' : ('portals write failed: ' + (j && j.error)), j && j.ok ? 'success' : 'info'); })
          .catch(function (e) { toastMsg('portals write error: ' + e, 'info'); });
      });
    }
    banner('Setup Save writes titles/locations/search-terms → the REAL portals.yml. AI/keys → the full settings view (writes .env). Companies-to-watch + comp floor are demo-only (protected).');
  }

  // ======================= dispatch ========================================
  if (page === 'jobs.html') wireJobs();
  else if (page === 'dashboard.html' || page === '' || page === 'compass') wireDash();
  else if (page === 'job-detail.html') wireDetail();
  else if (page === 'saved.html') wireSaved();
  else if (page === 'documents.html') wireDocs();
  else if (page === 'setup.html') wireSetup();
  else banner('Static preview page (not wired).');
})();
