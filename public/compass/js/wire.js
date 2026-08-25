/* ============================================================================
 * COMPASS FORK — real-backend wiring (served only by the :8100 instance).
 * Loaded AFTER each mockup's inline <script>, so it can override the demo
 * globals (JOBS / TOP / render / saveReview / setup arrays) with live data
 * from this instance's /api/* endpoints. Nothing here touches the original
 * :8099 instance or its files.
 * ==========================================================================*/
(function () {
  'use strict';

  // ---- tiny helpers ----
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
  function levelFor(t) { t = String(t || ''); if (/director/i.test(t)) return 'Director'; if (/(sr\.?|senior)\s*(manager|mgr)/i.test(t)) return 'Sr Manager'; if (/manager|mgr/i.test(t)) return 'Manager'; return ''; }
  function funcFor(t) { t = String(t || ''); if (/fp&?\s?a/i.test(t)) return 'FP&A'; if (/strateg/i.test(t)) return 'Strategic Finance'; if (/corporate/i.test(t)) return 'Corporate Finance'; if (/account|controll/i.test(t)) return 'Accounting'; return 'Finance'; }

  function banner(msg) {
    if (document.getElementById('compassWireBanner')) return;
    var b = document.createElement('div');
    b.id = 'compassWireBanner';
    b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#16324F;color:#fff;font:600 12.5px/1.4 system-ui,sans-serif;padding:8px 16px;text-align:center;box-shadow:0 -2px 12px rgba(0,0,0,.18)';
    b.innerHTML = '🧭 COMPASS FORK (:8100) — ' + esc(msg);
    document.body.appendChild(b);
  }
  function toastMsg(msg, type) { if (window.toast) { try { window.toast(msg, type || 'info'); return; } catch (e) {} } }

  var page = (location.pathname.split('/').pop() || '').toLowerCase();

  // ======================= JOBS ============================================
  function mapRow(row) {
    var title = row.role || '';
    return {
      id: 'c' + (row.num || Math.random().toString(36).slice(2)),
      title: title, company: row.company || '', domain: hostFrom(row.url),
      mono: initials(row.company || ''), color: colorFor(row.company || ''),
      loc: row.location || '', locKey: locKeyFor(row.location), work: /remote/i.test(row.location || '') ? 'Remote' : 'On-site',
      salMin: null, salMax: null, fit: scoreToFit(row), age: 0, isNew: false, saved: false,
      cat: row.status || '', func: funcFor(title), level: levelFor(title),
      why: row.notes || (row.status ? ('Status: ' + row.status) : 'Imported from tracker.'),
      url: row.url || ''
    };
  }
  function wireJobs() {
    fetch('/api/tracker?pageSize=60&page=1').then(function (r) { return r.json(); }).then(function (data) {
      var rows = (data && data.rows) || [];
      window.JOBS = rows.map(mapRow);
      window.JOBS.forEach(function (j) { j.open = true; });
      if (typeof window.saveReview === 'function' && !window.__compassFbWrapped) {
        var orig = window.saveReview;
        window.saveReview = function (id, verdict, reason, note) {
          orig(id, verdict, reason, note);
          if (verdict !== 'good' && verdict !== 'bad') return;
          var job = (window.JOBS || []).find(function (x) { return x.id === id; });
          if (!job || !job.url) return;
          fetch('/api/compass/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: job.url, verdict: verdict, reason: reason || '' }) })
            .then(function (r) { return r.json(); })
            .then(function (j) { toastMsg(j && j.ok ? 'Recorded to feedback.jsonl (' + verdict + ')' : 'Saved locally — server write failed', j && j.ok ? 'success' : 'info'); })
            .catch(function () { toastMsg('Saved locally — server unreachable', 'info'); });
        };
        window.__compassFbWrapped = true;
      }
      if (typeof window.render === 'function') window.render();
      banner('Jobs are LIVE from /api/tracker (' + rows.length + ' shown). ✓/✗ write to feedback.jsonl. Filters/salary are demo-only.');
    }).catch(function (e) { banner('Could not load live jobs: ' + e); });
  }

  // ======================= DASHBOARD =======================================
  function matchHTML(row) {
    var fit = scoreToFit(row); var cls = fit >= 86 ? 'fm-strong' : 'fm-good';
    var loc = (row.location || '') + (row.location && !/remote/i.test(row.location) ? ' · On-site' : '');
    return '<div class="match">' +
      '<div class="fitmini ' + cls + '">' + fit + '</div>' +
      '<span class="logo" style="--mc:' + colorFor(row.company) + '" data-mono="' + esc(initials(row.company)) + '"><img src="https://logo.clearbit.com/' + esc(hostFrom(row.url)) + '" alt="' + esc(row.company) + ' logo" onerror="this.parentNode.classList.add(\'failed\');this.remove()"></span>' +
      '<div class="minfo"><div class="t"><a href="job-detail.html">' + esc(row.role) + '</a></div><div class="m"><span>' + esc(row.company) + '</span><span>' + esc(loc) + '</span></div></div>' +
      '<a class="btn btn--outline btn--sm go" href="job-detail.html">View<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>' +
      '</div>';
  }
  function wireDash() {
    Promise.all([
      fetch('/api/dashboard').then(function (r) { return r.json(); }),
      fetch('/api/tracker?pageSize=4&page=1').then(function (r) { return r.json(); })
    ]).then(function (arr) {
      var d = arr[0] || {}, t = arr[1] || {};
      var apps = (d.counts && d.counts.applications) || 0;
      var by = d.byStatus || {};
      var applied = Object.keys(by).filter(function (k) { return /appl|interview|offer|hired|screen|phone/i.test(k); }).reduce(function (s, k) { return s + by[k]; }, 0);
      var avgFit = (d.avgScore != null) ? Math.round((d.avgScore / 5) * 100) : null;
      var reviewed = 0; try { reviewed = Object.keys(JSON.parse(localStorage.getItem('compass_reviews') || '{}')).length; } catch (e) {}
      var ns = document.querySelectorAll('.stat .n');
      if (ns[0]) ns[0].textContent = apps;                       // Jobs found (real)
      if (ns[2]) ns[2].textContent = applied;                    // Applied (real)
      if (ns[3]) ns[3].textContent = Math.max(0, apps - reviewed); // To review (real - reviewed)
      if (ns[4] && avgFit != null) ns[4].textContent = avgFit;   // Avg fit (real)
      var m = document.getElementById('matches');
      if (m && t.rows) m.innerHTML = t.rows.map(matchHTML).join('');
      banner('Stats + top matches are LIVE from /api/dashboard & /api/tracker (' + apps + ' apps). "Saved" tile + schedules are demo-only.');
    }).catch(function (e) { banner('Could not load live dashboard: ' + e); });
  }

  // ======================= SETUP ===========================================
  function injectKeyControl() {
    var conn = document.querySelector('.conn');
    if (!conn) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin:14px 0 4px;padding:14px;border:1px dashed #B08D57;border-radius:12px;background:#FBF7EF';
    wrap.innerHTML =
      '<div style="font:600 13px system-ui;color:#16324F;margin-bottom:6px">Anthropic API key (real — writes this instance’s .env via /api/config)</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<input id="compassAnthropicKey" type="password" placeholder="sk-ant-…" style="flex:1;min-width:220px;padding:9px 11px;border:1px solid #d8cdb8;border-radius:9px;font:14px system-ui">' +
      '<button id="compassKeySave" type="button" class="btn btn--primary btn--sm">Add key</button>' +
      '<button id="compassKeyRemove" type="button" class="btn btn--outline btn--sm">Remove key</button>' +
      '</div><div id="compassKeyState" style="font:12px system-ui;color:#6b6255;margin-top:7px"></div>';
    conn.parentNode.insertBefore(wrap, conn.nextSibling);

    function refreshState() {
      fetch('/api/config').then(function (r) { return r.json(); }).then(function (j) {
        var set = j && j.values && j.values.ANTHROPIC_API_KEY;
        fetch('/api/status/providers').then(function (r) { return r.json(); }).then(function (p) {
          document.getElementById('compassKeyState').textContent =
            (set ? 'Key set (' + set + ').' : 'No Anthropic key set.') + ' Active provider: ' + (p.activeProvider || 'none') + (p.activeModel ? ' · ' + p.activeModel : '');
        });
      });
    }
    document.getElementById('compassKeySave').onclick = function () {
      var v = document.getElementById('compassAnthropicKey').value.trim();
      if (!v) { toastMsg('Enter a key first', 'info'); return; }
      fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ANTHROPIC_API_KEY: v, LLM_PROVIDER: 'claude' }) })
        .then(function (r) { return r.json(); }).then(function () { toastMsg('Anthropic key added — provider switched to Claude', 'success'); document.getElementById('compassAnthropicKey').value = ''; refreshState(); });
    };
    document.getElementById('compassKeyRemove').onclick = function () {
      fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ANTHROPIC_API_KEY: '', LLM_PROVIDER: '' }) })
        .then(function (r) { return r.json(); }).then(function () { toastMsg('Anthropic key removed — back to local Hermes/Ollama', 'success'); refreshState(); });
    };
    refreshState();
  }
  function wireSetup() {
    injectKeyControl();
    var btn = document.getElementById('saveBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        var settings = {
          includeTitles: (window.includeTitles || []).slice(),
          excludeTitles: (window.excludeTitles || []).slice(),
          searchTerms: (window.searchTerms || []).slice(),
          cities: (window.cities || []).map(function (c) { return c && c.name ? c.name : c; }),
          remoteUS: !!window.remoteUS
        };
        fetch('/api/compass/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: settings }) })
          .then(function (r) { return r.json(); })
          .then(function (j) { toastMsg(j && j.ok ? 'Search filters written to portals.yml ✓' : ('portals write failed: ' + (j && j.error)), j && j.ok ? 'success' : 'info'); })
          .catch(function (e) { toastMsg('portals write error: ' + e, 'info'); });
      });
    }
    banner('Setup Save writes titles/locations/terms → portals.yml; Anthropic key → .env via /api/config. Companies-to-watch + comp floor are demo-only.');
  }

  // ======================= dispatch ========================================
  if (page === 'jobs.html') wireJobs();
  else if (page === 'dashboard.html' || page === '' || page === 'compass') wireDash();
  else if (page === 'setup.html') wireSetup();
  else banner('Static preview page (not yet wired to the backend).');
})();
