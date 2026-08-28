/* ============================================================================
 * COMPASS FORK — real-backend wiring (served only by the :8100 instance, which
 * is repointed at the REAL /Users/nick/apps/career-ops data via CAREER_OPS_ROOT).
 * Loaded AFTER each mockup's inline <script> so it can override the demo globals
 * (JOBS / render / saveReview / buildMenu / runQA …) with LIVE data.
 * ==========================================================================*/
(function () {
  'use strict';

  // ===================== COMPASS_TIPS =======================================
  // THE ONE PLACE TO EDIT TOOLTIP COPY. Every tooltip in the app — the feed's
  // TIP_* constants (jobs.html), the archive + low-fit tips below, and the
  // Save tips (feed card + job-detail) — reads its text from here. Nothing
  // else in the codebase should have a hardcoded tooltip sentence; if you're
  // about to type one, add/edit an entry here instead and point the call
  // site at it.
  //
  // Optional `retireAfter: N` opts a tip into CompassTip's "stop pestering"
  // behavior: once it's been shown on HOVER N times (tracked globally in
  // localStorage, not per-card), it stops auto-appearing on hover — but it
  // still shows on tap and on keyboard focus, so it's never truly hidden,
  // just no longer volunteered to someone who's already seen it a few times.
  // Requires the trigger element to also carry `data-tip-key="<this key>"`.
  var COMPASS_TIPS = {
    fit: { text: "How closely this matches your résumé and preferences. Strong (85+) is a near-perfect match, Good (75–84) is worth a look, Fair is a stretch." },
    source: { text: "Where this listing came from, so you know where to apply." },
    new: { text: "Landed in your feed in the last day or two." },
    found: { text: "This board doesn't publish a posting date, so this is the day we found it listed." },
    vote: { text: "Tap to teach Compass what you want — a few taps a day sharpens tomorrow's matches.", retireAfter: 3 },
    save: { text: "Tuck this away in My Jobs for later — separate from ✓/✗, and it won't remove the role from your feed.", retireAfter: 3 },
    // Job-detail's Save button spells out the ✓/✗ icons as words ("Good fit/Pass") since
    // that page shows labeled buttons rather than bare icons — different copy, same idea
    // as `save` above, kept as its own entry so each surface's exact wording stays intact.
    // It has NO retireAfter of its own: both Save buttons carry
    // data-tip-key="save" so they share ONE retire counter under the `save`
    // key above — "save" is one concept learned once, everywhere, even
    // though the two surfaces word the tooltip differently.
    saveDetail: { text: "Tuck this away in My Jobs for later — separate from Good fit/Pass, and it won't remove the role from your feed." },
    unreview: { text: "Clears your ✓/✗, reason, and note for this role — it goes back to your main feed." },
    reviewedTab: { text: "Shows what you've reviewed this week only — older reviews live in the archive under My Jobs." },
    lowfit: { text: "Reveal roles Compass scored as a stretch, in case you want a second opinion." },
    archiveVerdict: { text: "Switch between roles you liked, passed, or both." },
    archiveTimeframe: { text: "Narrow the archive to a time window — defaults to showing everything." }
    // NOTE: the archive search box intentionally has NO tooltip — its
    // placeholder ("Search by job title or company…") already says what it
    // does; a tooltip there would just restate the visible label.
  };
  window.COMPASS_TIPS = COMPASS_TIPS;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function hostFrom(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function normUrl(u) { return String(u || '').split('#')[0].replace(/\/+$/, ''); }
  // Host → human "posted on" label, purely derived from the canonical job URL
  // (where the posting lives) — display-only, not verified/scraped metadata.
  // First match wins; unmatched hosts fall back to the company's own domain.
  var SOURCE_HOST_RULES = [
    [/(^|\.)linkedin\.com$/, 'LinkedIn'],
    [/(^|\.)indeed\.com$/, 'Indeed'],
    [/(^|\.)greenhouse\.io$/, 'Greenhouse'],
    [/(^|\.)lever\.co$/, 'Lever'],
    [/myworkdayjobs\.com$/, 'Workday'],
    [/(^|\.)welcometothejungle\.com$/, 'WTTJ'],
    [/(^|\.)ashbyhq\.com$/, 'Ashby'],
    [/(^|\.)smartrecruiters\.com$/, 'SmartRecruiters'],
    [/(^|\.)icims\.com$/, 'iCIMS'],
    [/(^|\.)jobvite\.com$/, 'Jobvite'],
    [/(^|\.)bamboohr\.com$/, 'BambooHR'],
    [/(^|\.)rippling\.com$/, 'Rippling'],
    [/^job-boards\./, 'Job board']
  ];
  function sourceFromHost(host) {
    host = String(host || '').toLowerCase();
    if (!host) return 'Company careers';
    for (var i = 0; i < SOURCE_HOST_RULES.length; i++) {
      if (SOURCE_HOST_RULES[i][0].test(host)) return SOURCE_HOST_RULES[i][1];
    }
    return 'Company careers'; // unrecognized host — most likely the company's own site
  }
  // ---- company logo domain (for /api/logo?domain=) --------------------------
  // The job URL host is frequently an ATS/aggregator (Greenhouse, Lever,
  // Workday, WTTJ, LinkedIn, …), not the employer's own domain — fetching a
  // favicon for that host would show the ATS's icon, not the company's. When
  // the URL host looks like the company's own site, use its registrable
  // domain; otherwise derive a best-guess domain from the company NAME, and
  // only fall back to an ATS-embedded company slug when the name doesn't
  // yield anything. Imperfect for multi-word/branded names by design — a bad
  // guess just 404s the proxy and the existing monogram onerror takes over.
  var ATS_HOSTS = [
    'greenhouse.io', 'lever.co', 'ashbyhq.com', 'myworkdayjobs.com',
    'welcometothejungle.com', 'rippling.com', 'linkedin.com', 'indeed.com',
    'builtin.com', 'dailyremote.com', 'speedrun-talent-network.com',
  ];
  function isAtsHost(host) {
    host = String(host || '').toLowerCase();
    return ATS_HOSTS.some(function (h) { return host === h || host.slice(-(h.length + 1)) === ('.' + h); });
  }
  // Last two labels — good enough for .com/.io/.co/etc, not a full public-
  // suffix-list implementation (co.uk-style TLDs aren't specially handled).
  function registrableDomain(host) {
    var parts = String(host || '').split('.').filter(Boolean);
    return parts.length <= 2 ? host : parts.slice(-2).join('.');
  }
  var CORP_SUFFIX_RE = /\b(inc|llc|corp|corporation|ltd|limited|co|the)\b/g;
  function domainFromCompanyName(name) {
    var s = String(name || '').toLowerCase()
      .replace(/[.,&'’()]/g, ' ')
      .replace(CORP_SUFFIX_RE, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, '');
    return s.length >= 2 ? s + '.com' : '';
  }
  // ATS-hosted posting → the company slug baked into the URL path/subdomain,
  // as a last-resort fallback when the company name doesn't yield a domain.
  function atsSlugDomain(host, url) {
    try {
      var path = new URL(url).pathname || '';
      var m = null;
      if (/(^|\.)welcometothejungle\.com$/.test(host)) {
        m = path.match(/\/companies\/([^\/]+)/);
      } else if (/myworkdayjobs\.com$/.test(host)) {
        m = [null, host.split('.')[0]]; // {tenant}.wdN.myworkdayjobs.com
      } else if (/(^|\.)greenhouse\.io$/.test(host) || /(^|\.)lever\.co$/.test(host) || /(^|\.)ashbyhq\.com$/.test(host)) {
        m = path.match(/^\/([^\/]+)/);
      }
      var slug = m && m[1] && m[1].replace(/[^a-z0-9]/gi, '').toLowerCase();
      return slug ? slug + '.com' : '';
    } catch (e) { return ''; }
  }
  function logoDomainFor(company, url) {
    var host = hostFrom(url);
    if (!host) return domainFromCompanyName(company);
    if (!isAtsHost(host)) return registrableDomain(host);
    return domainFromCompanyName(company) || atsSlugDomain(host, url) || '';
  }
  // ============================================================================
  // Heuristic flat-JD reflow (pure regex, no AI) — v1 (2026-08-27).
  // A handful of cached JDs (plain-text sources the pipeline's markdown sweep
  // couldn't restructure — near-zero newlines, no bullets) render as an
  // unreadable wall of text. This recovers headings + bullet structure FOR
  // DISPLAY ONLY (the cache itself is untouched) so jdToHtml() below can
  // render them like any other structured JD. Gated to run ONLY on text that
  // already looks flat (looksFlatJd) — a well-structured markdown JD is
  // returned unchanged. Conservative by design: prefers to under-split prose
  // rather than mangle it. This is a heuristic, not NLP — expect it to miss
  // section headers outside the curated list and to leave some dense
  // requirement/paragraph text unsplit.
  // ---- gate: does this JD look "flat" (a wall of text)? ----------------------
  function looksFlatJd(text) {
    var t = String(text || '');
    if (t.length < 300) return false;
    var nl = (t.match(/\n/g) || []).length;
    var density = nl / t.length;
    if (/(^|\n)[ \t]*[-•*–▪·◦][ \t]+\S/.test(t)) return false;   // already bulleted
    if (/(^|\n)[ \t]*\d{1,2}[.)][ \t]+\S/.test(t)) return false;  // already numbered
    if (/(^|\n)[ \t]*#{1,6}[ \t]+\S/.test(t)) return false;       // already ATX heading
    return nl <= 1 || density < 0.0008;
  }
  // ---- section headings -------------------------------------------------------
  // Conservative, curated JD section-header phrases. Matched case-insensitively
  // on word boundaries. A couple of entries carry small, common filler-word
  // tolerances (e.g. "Key job responsibilities", bare "Role") beyond the
  // literal spec because they showed up verbatim in real flat JDs in testing.
  var JD_HEADING_PATTERNS = [
    /\babout (?:the role|us|the team|the company|you)\b/gi,
    /\b(?:key\s+)?(?:job\s+)?responsibilities\b/gi,
    /\bwhat you'?ll do\b/gi,
    /\brequirements\b/gi,
    /\b(?:minimum |preferred |basic )?qualifications\b/gi,
    /\bwhat we'?re looking for\b/gi,
    /\bwho you are\b/gi,
    /\bnice[\s-]?to[\s-]?have\b/gi,
    /\bbenefits(?: (?:&|and) perks)?\b/gi,
    /\bcompensation\b/gi,
    /\bthe role\b/gi,
    /\byour impact\b/gi,
    /\bday to day\b/gi,
  ];
  function titleCaseJdHeading(s) {
    return s.replace(/\w\S*/g, function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).replace(/\bYou'?ll\b/gi, "You'll").replace(/\bWe'?re\b/gi, "We're");
  }
  // A heading candidate is only trusted at a genuine clause boundary: text
  // start, or right after a sentence-ending '.'/'!'/'?'. Flat blobs have no
  // layout signal left, so a bare word like "Compensation" or "Benefits"
  // appearing mid-sentence ("Amazon also offers comprehensive Benefits
  // including...") is common — accepting it would mangle prose with a bogus
  // heading. Requiring a preceding sentence boundary filters those out while
  // still catching genuine "<prev section>. <Next Heading> <content>" joins.
  function jdHeadingAtClauseBoundary(text, idx) {
    if (idx <= 0) return true;
    var before = text.slice(Math.max(0, idx - 3), idx);
    return /[.!?]\s*$/.test(before);
  }
  // A genuine heading is followed by real content — either the end of text or
  // a capitalized/numeric clause start, never a lowercase word (which means we
  // landed mid-sentence, e.g. "...experience with requirements gathering").
  function jdHeadingFollowedByContent(text, idx) {
    var rest = text.slice(idx).replace(/^[:\s]+/, '').replace(/^-\s+/, '');
    if (!rest) return true;
    return /^[A-Z0-9]/.test(rest);
  }
  // Insert a paragraph break + ATX heading marker before each recognized
  // section-header phrase found mid-text.
  function insertJdHeadingBreaks(text) {
    var matches = [];
    JD_HEADING_PATTERNS.forEach(function (re) {
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(text))) {
        if (jdHeadingAtClauseBoundary(text, m.index) && jdHeadingFollowedByContent(text, m.index + m[0].length)) {
          matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
        }
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });
    if (!matches.length) return text;
    matches.sort(function (a, b) { return a.start - b.start; });
    // De-overlap: drop any match nested inside a previously-kept one.
    var kept = [];
    matches.forEach(function (m) {
      var prev = kept[kept.length - 1];
      if (prev && m.start < prev.end) return;
      kept.push(m);
    });
    var out = '';
    var cursor = 0;
    kept.forEach(function (m) {
      out += text.slice(cursor, m.start);
      if (!/\n\n$/.test(out) && out.trim().length) out += '\n\n';
      out += '## ' + titleCaseJdHeading(m.text) + '\n\n';
      cursor = m.end;
      // Consume a following ':' (and a stray flattened "- " bullet marker
      // immediately after the heading, e.g. "Responsibilities - Lead the...")
      // so neither leaks into the body as an orphan artifact.
      while (cursor < text.length && /[:\s]/.test(text[cursor]) && text[cursor] !== '\n') cursor++;
      if (text[cursor] === '-' && /\s/.test(text[cursor + 1] || '')) {
        cursor += 2;
        while (cursor < text.length && /[ \t]/.test(text[cursor])) cursor++;
      }
    });
    out += text.slice(cursor);
    return out;
  }
  // ---- bullet-run detection ---------------------------------------------------
  var JD_VERB_WORDS = ('Support|Build|Develop|Manage|Lead|Own|Drive|Create|Design|Analyze|Partner|' +
    'Collaborate|Help|Deliver|Maintain|Prepare|Ensure|Provide|Establish|Identify|Coordinate|' +
    'Oversee|Contribute|Execute|Monitor|Report|Define|Implement|Optimize');
  // Case-SENSITIVE (capitalized only) — a lowercase mid-sentence verb use isn't
  // a bullet-run signal; a capitalized one that isn't a true sentence start is
  // usually the flattened first word of what used to be a separate <li>.
  var JD_VERB_RE_SRC = '\\b(?:' + JD_VERB_WORDS + ')\\b';
  var JD_REQ_RE_SRCS = [
    "\\b\\d{1,2}\\+?\\s+years?\\b",
    "\\bBachelor'?s\\b",
    "\\bMaster'?s\\b",
    "\\bExperience (?:with|in)\\b",
    "\\bProficiency (?:with|in)\\b",
    "\\bStrong\\b[^.]{0,40}?\\bskills\\b",
    "\\bAbility to\\b",
  ];
  // A flattened "- " list separator: the original markup had real <li> bullets,
  // but the scrape lost the newlines while leaving the "- " glyph behind mid-
  // string (e.g. "...topline growth - Conduct comprehensive..."). This is a
  // stronger, more literal signal than the verb/requirement wordlists below —
  // when present it IS the original bullet marker, not an inference. The
  // lookahead deliberately excludes a bare digit run (so "$135,000 - $200,000"
  // / "95,400.00 - 163,200.00" salary ranges aren't mistaken for list items —
  // a real digit-led bullet in a JD is almost always "N+ years").
  var JD_DASH_SEP_RE_SRC = '\\s-\\s(?=[A-Z]|\\d+\\+)';
  function findJdMarkerRuns(text) {
    var hits = [];
    var re = new RegExp(JD_VERB_RE_SRC, 'g'), m;
    while ((m = re.exec(text))) hits.push({ start: m.index, end: re.lastIndex });
    JD_REQ_RE_SRCS.forEach(function (src) {
      var rr = new RegExp(src, 'g'), mm;
      while ((mm = rr.exec(text))) hits.push({ start: mm.index, end: rr.lastIndex });
    });
    var dre = new RegExp(JD_DASH_SEP_RE_SRC, 'g'), dm;
    while ((dm = dre.exec(text))) {
      var boundary = dm.index + dm[0].length; // right at the capital/digit, dash consumed
      hits.push({ start: boundary, end: boundary, dash: true });
    }
    hits.sort(function (a, b) { return a.start - b.start; });
    // De-dupe near-identical overlapping hits (e.g. two patterns matching the
    // same word) by dropping any hit that starts inside the previous one.
    var out = [];
    hits.forEach(function (h) {
      var prev = out[out.length - 1];
      if (prev && h.start < prev.end) return;
      out.push(h);
    });
    return out;
  }
  // Split a prose block into `- ` bullets wherever it contains a tight run of
  // clause-start markers (>= 3, each within ~400 chars of the previous one —
  // consistent with short-to-medium JD bullet items, generous enough for a
  // verbose one). Isolated markers are left alone (that's normal prose, not a
  // flattened list).
  var JD_RUN_GAP_MAX = 400;
  function splitJdBulletRuns(block) {
    var hits = findJdMarkerRuns(block);
    if (hits.length < 3) return block;
    var runs = [], cur = [hits[0]];
    for (var i = 1; i < hits.length; i++) {
      var gap = hits[i].start - cur[cur.length - 1].start;
      if (gap <= JD_RUN_GAP_MAX) { cur.push(hits[i]); }
      else { if (cur.length >= 3) runs.push(cur); cur = [hits[i]]; }
    }
    if (cur.length >= 3) runs.push(cur);
    if (!runs.length) return block;
    var out = '';
    var cursor = 0;
    runs.forEach(function (run, ri) {
      var runStart = run[0].start;
      var lead = block.slice(cursor, runStart).trim();
      if (lead) out += lead + '\n\n';
      var nextRunStart = (ri + 1 < runs.length) ? runs[ri + 1][0].start : block.length;
      for (var j = 0; j < run.length; j++) {
        var itemStart = run[j].start;
        var isLast = (j === run.length - 1);
        var itemEnd = isLast ? nextRunStart : run[j + 1].start;
        var raw = block.slice(itemStart, itemEnd);
        // Cap a runaway last item (no further marker in sight, so it would
        // otherwise swallow the rest of the document as one "bullet"). Prefer
        // cutting at a sentence end within budget; some flat blobs run on
        // without any punctuation for a long stretch, so fall back to the
        // nearest word boundary rather than not cutting at all.
        if (isLast && raw.length > 600) {
          var budget = raw.slice(0, 600);
          var cut = budget.lastIndexOf('. ');
          var cutLen = (cut > 40) ? cut + 1 : -1;
          if (cutLen < 0) {
            var wb = budget.lastIndexOf(' ');
            if (wb > 40) cutLen = wb;
          }
          if (cutLen > 0) { raw = raw.slice(0, cutLen); itemEnd = itemStart + cutLen; }
        }
        // Strip a trailing flattened "- " separator that belongs to the *next*
        // item's boundary, not this one's content (see JD_DASH_SEP above).
        var item = raw.trim().replace(/\s+-\s*$/, '').trim();
        if (item) out += '- ' + item + '\n';
        cursor = itemEnd;
      }
      out += '\n';
    });
    out += block.slice(cursor);
    return out;
  }
  // ---- sentence-boundary paragraph breaks for whatever's still a wall -------
  // Applied last, only to spans that are still one big undifferentiated block
  // (no blank-line paragraph break already introduced by the steps above).
  // Conservative: groups ~3 sentences per paragraph, never splits inside
  // obvious abbreviations (Inc., U.S., e.g., etc.) or decimals.
  var JD_ABBR_RE = /\b(?:Inc|Corp|Co|Ltd|LLC|St|Ave|Dr|Mr|Mrs|Ms|Jr|Sr|vs|etc|e\.g|i\.e|U\.S|U\.K|approx|no|Fig|Dept)\.$/;
  function splitJdSentences(text) {
    var out = [], start = 0;
    for (var i = 0; i < text.length - 1; i++) {
      if ((text[i] === '.' || text[i] === '!' || text[i] === '?') && /\s/.test(text[i + 1])) {
        var lead = text.slice(Math.max(0, i - 12), i + 1);
        if (JD_ABBR_RE.test(lead)) continue;
        // Don't split mid-decimal or mid-abbreviation-initial ("U.S. based").
        var nextNonSpace = text.slice(i + 1).match(/\S/);
        if (nextNonSpace && /[a-z]/.test(nextNonSpace[0])) continue; // lowercase after '.' → not a sentence end
        out.push(text.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
    var rest = text.slice(start).trim();
    if (rest) out.push(rest);
    return out.filter(Boolean);
  }
  function paragraphizeJdBlock(block) {
    var t = block.trim();
    if (!t) return t;
    if (t.length < 500) return t; // short enough as one paragraph
    var sentences = splitJdSentences(t);
    if (sentences.length < 4) return t;
    var paras = [], cur = [], curLen = 0;
    sentences.forEach(function (s) {
      cur.push(s); curLen += s.length;
      if (cur.length >= 3 || curLen > 420) { paras.push(cur.join(' ')); cur = []; curLen = 0; }
    });
    if (cur.length) paras.push(cur.join(' '));
    return paras.join('\n\n');
  }
  // Apply paragraphization only to the plain-prose spans of a heading+bullet
  // -reflowed doc — i.e. blocks of text between blank lines that are NOT
  // already `- `/`##` structured.
  function paragraphizeJdProse(text) {
    var blocks = text.split(/\n{2,}/);
    return blocks.map(function (b) {
      if (/^#{1,6}\s/.test(b.trim())) return b;
      if (/^[-•*–▪·◦]\s/.test(b.trim())) return b; // a single bullet line (rare)
      if (b.split('\n').every(function (l) { return /^[-•*–▪·◦]\s/.test(l.trim()) || !l.trim(); })) return b; // bullet block
      return paragraphizeJdBlock(b);
    }).join('\n\n');
  }
  // ---- entry point -------------------------------------------------------------
  function reflowFlatJd(raw) {
    var text = String(raw || '');
    if (!looksFlatJd(text)) return text;
    var withHeadings = insertJdHeadingBreaks(text);
    var blocks = withHeadings.split(/\n{2,}/);
    var withBullets = blocks.map(function (b) {
      if (/^#{1,6}\s/.test(b.trim())) return b;
      return splitJdBulletRuns(b);
    }).join('\n\n');
    return paragraphizeJdProse(withBullets);
  }

  // Formatter for the JD body -> readable paragraphs + bullet (-•*–) /
  // numbered lists + headings. Handles two inputs gracefully:
  //   1) clean markdown from the pipeline (jd-cache): "# "/"## " ATX
  //      headings, "- " bullets on their own lines, blank-line paragraphs.
  //   2) legacy scraped plain-text blobs: falls back to blank-line
  //      paragraph splitting + heuristic ALL-CAPS / "Label:" headings +
  //      run-on bullet-char detection.
  // Inline text goes through mdInlineRich() (escape-first, then safely
  // re-introduce **bold**/*italic*/`code`/[link](url) as real tags) so
  // there is no raw-HTML injection path from JD content either way.
  function jdToHtml(raw) {
    var text = String(raw || '').replace(/\r\n?/g, '\n');
    // Flat plain-text JDs (near-zero newlines, no bullets/headings) get a
    // heuristic pre-pass to recover structure before the normal markdown-ish
    // parse below. No-op (returns text unchanged) for anything that already
    // has real structure — see looksFlatJd().
    text = reflowFlatJd(text);
    text = text.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n');
    var lines = text.split('\n');
    function isBullet(l) { return /^\s*[-•*–▪·◦]\s+/.test(l); }
    function isNum(l) { return /^\s*\d{1,2}[.)]\s+/.test(l); }
    function stripBullet(l) { return l.replace(/^\s*[-•*–▪·◦]\s+/, ''); }
    function stripNum(l) { return l.replace(/^\s*\d{1,2}[.)]\s+/, ''); }
    function isAtx(l) { return /^\s*#{1,6}\s+/.test(l); }
    function stripAtx(l) { return l.replace(/^\s*#{1,6}\s+/, '').trim(); }
    function isHeading(l) {
      var t = l.trim();
      if (!t || t.length > 64) return false;
      if (/[.,;]$/.test(t)) return false;
      if (/:$/.test(t)) return true;
      var letters = t.replace(/[^A-Za-z]/g, '');
      return letters.length >= 3 && letters === letters.toUpperCase();
    }
    var out = [], para = [], i = 0;
    function flushPara() { if (para.length) { out.push('<p>' + mdInlineRich(para.join(' ').trim()) + '</p>'); para = []; } }
    while (i < lines.length) {
      var line = lines[i], t = line.trim();
      if (!t) { flushPara(); i++; continue; }
      if (isAtx(line)) { flushPara(); out.push('<h3>' + mdInlineRich(stripAtx(line)) + '</h3>'); i++; continue; }
      if (isBullet(line) || isNum(line)) {
        flushPara();
        var ordered = isNum(line), typ = ordered ? isNum : isBullet, items = [];
        while (i < lines.length && lines[i].trim() && typ(lines[i])) {
          items.push((ordered ? stripNum(lines[i]) : stripBullet(lines[i])).trim());
          i++;
        }
        out.push('<' + (ordered ? 'ol' : 'ul') + '>' + items.map(function (it) { return '<li>' + mdInlineRich(it) + '</li>'; }).join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
        continue;
      }
      if (isHeading(line) && !para.length) { flushPara(); out.push('<h3>' + mdInlineRich(t.replace(/:$/, '')) + '</h3>'); i++; continue; }
      para.push(t); i++;
    }
    flushPara();
    return out.join('') || '<p>' + mdInlineRich(text.trim()) + '</p>';
  }
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

  // Dev-scaffolding narrator bar — retired. No-op so every existing banner(...) call
  // site is safe; also removes any stray element if one was ever created.
  function banner(msg) {
    var b = document.getElementById('compassWireBanner');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }
  function toastMsg(msg, type) { if (window.toast) { try { window.toast(msg, type || 'info'); return; } catch (e) {} } }

  // ===================== Tooltip (Batch B) ==================================
  // ONE reusable hover/focus/tap tooltip, built from the app's existing ink/gold
  // tokens — same visual family as the toast, just box-shaped so it can hold a
  // sentence or two (docs/ux-confirmations-audit.md §3, "canonical patterns").
  // Declarative: any element with a `data-tip="…"` attribute gets the full
  // trigger contract below for free — nothing else to wire per control.
  // Dismiss reuses the app's existing popover pattern (Escape + outside-tap),
  // the same as jobs.html's `.rpop`/`Pop` onDocDown/onKey.
  //
  // "Retire after N hovers" (opt-in via COMPASS_TIPS[key].retireAfter): a tip
  // whose trigger element carries `data-tip-key="<key>"` stops auto-showing
  // on HOVER once it's been hover-shown N times — tracked GLOBALLY (one
  // counter per key, shared across every card AND every trigger element that
  // carries that key — e.g. the feed's Save heart and job-detail's Save
  // button both use key "save" and share one counter). Tap and keyboard
  // focus are a DIFFERENT trigger path (see bind()) and are never gated by
  // this, so the tip stays reachable for anyone who explicitly asks.
  //
  // Server-backed (GET/POST /api/compass/tips — same pattern as the reviews
  // store) so "seen enough times" persists across devices/cache-clears,
  // instead of resetting every time someone opens the app in a fresh
  // browser. __tipsMap is seeded by loadTips() as part of the app's boot
  // Promise.all (see the dispatch call near the bottom of this file) —
  // BEFORE initTooltips()/CompassTip.scan() ever run, so by the time a hover
  // is even possible, retire state already reflects the server. localStorage
  // is kept only as a same-device fast cache for the (normally unreachable)
  // window before that boot fetch settles; the server always wins once it
  // responds. If the server is unreachable, this fails OPEN — never treat a
  // failed fetch as "must be retired", since that would silently hide a tip
  // forever for no good reason.
  var __tipsMap = null;      // null until loadTips() settles; then the authoritative {key: count} map (possibly {} on fetch failure)
  var __tipsPostTimers = {};
  function tipStorageKey(key) { return 'compassTipHovers:' + key; }  // localStorage: same-device fast cache ONLY, not the source of truth
  function localTipCount(key) {
    try { return parseInt(localStorage.getItem(tipStorageKey(key)) || '0', 10) || 0; } catch (e) { return 0; }
  }
  function loadTips() {
    return jGet('/api/compass/tips').then(function (j) {
      __tipsMap = (j && j.map) || {};
      // Server wins: refresh the local mirror to match it so a stale/absent
      // local count never out-lives what the server actually has recorded.
      try { Object.keys(__tipsMap).forEach(function (k) { localStorage.setItem(tipStorageKey(k), String(__tipsMap[k])); }); } catch (e) {}
      return __tipsMap;
    }).catch(function () {
      // Fail-open: an unreachable server must never block or hide a
      // tooltip. Leave the local mirror as-is (it may still be right next
      // load) but treat THIS session as "nothing retired yet" rather than
      // guessing from a cache we can't currently verify.
      __tipsMap = {};
      return __tipsMap;
    });
  }
  function tipHoverCount(key) {
    if (__tipsMap) return typeof __tipsMap[key] === 'number' ? __tipsMap[key] : 0;
    return localTipCount(key);   // loadTips() hasn't settled yet (shouldn't normally be reachable — see comment above)
  }
  function bumpTipHoverCount(key) {
    var next = tipHoverCount(key) + 1;
    if (!__tipsMap) __tipsMap = {};
    __tipsMap[key] = next;                                            // optimistic local update — instant, no round-trip needed to keep counting
    try { localStorage.setItem(tipStorageKey(key), String(next)); } catch (e) {}
    // Debounced write-through, same pattern/window as postReviewDebounced
    // below. In practice a single key is never hover-shown twice inside
    // 400ms (a fresh "shown" impression requires mouseleave + HIDE_DELAY +
    // a new mouseenter + SHOW_DELAY first), so this coalesces to exactly
    // one POST per real impression rather than risking a request burst.
    clearTimeout(__tipsPostTimers[key]);
    __tipsPostTimers[key] = setTimeout(function () {
      delete __tipsPostTimers[key];
      jPost('/api/compass/tips', { key: key }).then(function (r) {
        if (r && r.body && r.body.ok && typeof r.body.count === 'number' && __tipsMap) {
          __tipsMap[key] = r.body.count;
          try { localStorage.setItem(tipStorageKey(key), String(r.body.count)); } catch (e) {}
        }
      }).catch(function () { /* local mirror already bumped optimistically; best-effort sync */ });
    }, 400);
  }
  function tipRetiredForHover(key) {
    if (!key) return false;
    var entry = COMPASS_TIPS[key];
    if (!entry || !entry.retireAfter) return false;
    return tipHoverCount(key) >= entry.retireAfter;
  }
  var CompassTip = (function () {
    var bubble = null, activeEl = null, showTimer = null, hideTimer = null;
    var SHOW_DELAY = 200, HIDE_DELAY = 120;
    function injectStyles() {
      if (document.getElementById('compassTipCss')) return;
      var s = document.createElement('style'); s.id = 'compassTipCss';
      s.textContent =
        '.c-tip{position:fixed;z-index:200;max-width:250px;background:var(--ink,#16324F);color:#fff;' +
        'font:500 12.5px/1.5 var(--sans,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);' +
        'padding:9px 12px;border-radius:var(--radius-sm,10px);box-shadow:0 10px 30px rgba(22,50,79,.28);' +
        'pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .12s ease,transform .12s ease}' +
        '.c-tip.show{opacity:1;transform:none}' +
        '[data-tip].c-tip-target{cursor:help}' +
        '@media(prefers-reduced-motion:reduce){.c-tip{transition:none}}';
      document.head.appendChild(s);
    }
    function ensureBubble() {
      if (bubble) return bubble;
      injectStyles();
      bubble = document.createElement('div');
      bubble.id = 'compassTipBubble'; bubble.className = 'c-tip'; bubble.setAttribute('role', 'tooltip'); bubble.hidden = true;
      document.body.appendChild(bubble);
      return bubble;
    }
    function position(el) {
      var r = el.getBoundingClientRect();
      bubble.style.left = '-9999px'; bubble.style.top = '0px'; bubble.hidden = false;
      var bw = bubble.offsetWidth, bh = bubble.offsetHeight;
      var top = r.top - bh - 9, left = r.left + r.width / 2 - bw / 2;
      if (top < 8) top = r.bottom + 9;                                    // flip below if it would clip the viewport top
      if (top + bh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - bh);
      if (left < 8) left = 8;
      if (left + bw > window.innerWidth - 8) left = window.innerWidth - 8 - bw;
      bubble.style.left = left + 'px'; bubble.style.top = top + 'px';
    }
    function hideNow() {
      // Deliberately does NOT clear showTimer: when the pointer moves quickly
      // from one tooltip target straight onto another (e.g. a vote button
      // into the un-review icon right next to it), the outgoing element's
      // scheduleHide(HIDE_DELAY=120ms) can fire before the incoming element's
      // scheduleShow(SHOW_DELAY=200ms) — clearing showTimer here would cancel
      // that already-scheduled, unrelated show and silently swallow the next
      // tooltip. scheduleShow()/scheduleHide() already clear showTimer
      // themselves whenever a *new* show is requested, which is the only
      // case that should ever cancel a pending show.
      clearTimeout(hideTimer);
      if (bubble) { bubble.classList.remove('show'); bubble.hidden = true; }
      if (activeEl) activeEl.removeAttribute('aria-describedby');
      activeEl = null;
    }
    function show(el, opts) {
      clearTimeout(hideTimer);
      var txt = el.getAttribute('data-tip'); if (!txt) return;
      var hover = !!(opts && opts.hover);
      var key = el.getAttribute('data-tip-key');
      if (hover && tipRetiredForHover(key)) return;   // retired: stay silent on hover only — tap/focus (hover:false) bypass this
      var wasAlreadyShowingThis = (activeEl === el && bubble && !bubble.hidden);
      ensureBubble();
      if (activeEl && activeEl !== el) hideNow();
      bubble.textContent = txt;
      activeEl = el;
      el.setAttribute('aria-describedby', 'compassTipBubble');
      position(el);
      requestAnimationFrame(function () {
        if (activeEl !== el) return;
        bubble.classList.add('show');
        // Count one impression per actual shown hover — not per mouseenter/
        // rAF tick — so hovering the same still-visible tip again doesn't
        // multi-count, and only hover-triggered shows count toward retiring.
        if (hover && key && !wasAlreadyShowingThis) bumpTipHoverCount(key);
      });
    }
    function scheduleShow(el, delay, hover) {
      clearTimeout(showTimer);
      showTimer = setTimeout(function () { show(el, { hover: !!hover }); }, delay == null ? SHOW_DELAY : delay);
    }
    function scheduleHide(el) {
      clearTimeout(showTimer);
      if (activeEl !== el) return;
      hideTimer = setTimeout(hideNow, HIDE_DELAY);
    }
    function bind(el) {
      if (el.__ctBound) return; el.__ctBound = true;
      if (!el.hasAttribute('tabindex') && !/^(button|a|input|select|textarea)$/i.test(el.tagName)) {
        el.setAttribute('tabindex', '0');
        el.classList.add('c-tip-target');           // hover affordance (cursor:help) for non-native-focusable targets only
      }
      el.addEventListener('mouseenter', function () { scheduleShow(el, null, true); });
      el.addEventListener('mouseleave', function () { scheduleHide(el); });
      el.addEventListener('focus', function () { scheduleShow(el, 0); });
      el.addEventListener('blur', function () { scheduleHide(el); });
      // Non-actionable badges/chips (data-tip-tap="toggle") also open on tap,
      // since they have no other click behavior and touch has no hover.
      // Actionable controls (vote/save buttons, filters) deliberately skip
      // this — tapping them should perform the real action, not swallow the
      // first tap on a tooltip; focus (which a tap also triggers on iOS/
      // Android) already covers the keyboard-parity requirement there.
      if (el.getAttribute('data-tip-tap') === 'toggle') {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          if (activeEl === el && bubble && !bubble.hidden) hideNow(); else show(el);
        });
      }
    }
    function scan(root) {
      (root || document).querySelectorAll('[data-tip]').forEach(bind);
    }
    // App-wide dismiss contract — same as jobs.html's `.rpop` popover
    // (onDocDown/onKey): Escape, or a tap/click outside the open tooltip.
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && activeEl) { var el = activeEl; hideNow(); el.blur(); } }, true);
    document.addEventListener('mousedown', function (e) { if (activeEl && e.target !== activeEl && !activeEl.contains(e.target)) hideNow(); }, true);
    document.addEventListener('touchstart', function (e) { if (activeEl && e.target !== activeEl && !activeEl.contains(e.target)) hideNow(); }, { passive: true, capture: true });
    window.addEventListener('scroll', function () { if (activeEl) hideNow(); }, true);
    window.addEventListener('resize', function () { if (activeEl) hideNow(); });
    return { scan: scan };
  })();
  window.CompassTip = CompassTip;
  function initTooltips() {
    CompassTip.scan(document);
    // Every re-render below (jobs feed cards, the reviewed rail, the review
    // archive rows, filter pills…) works by replacing .innerHTML — one
    // MutationObserver here covers all of them instead of hand-wiring a
    // scan() call into each individual render function.
    var mo = new MutationObserver(function () { CompassTip.scan(document); });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // Whole days between an ISO 'YYYY-MM-DD' date and today (UTC midnight), or
  // null if unparseable. Shared by the found/posted age computations below.
  function daysAgo(isoDate) {
    if (!isoDate) return null;
    var t = new Date(isoDate + 'T00:00:00Z').getTime();
    if (isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }

  // "New" badge = the most-recently-found BATCH, not a fixed day window. Finds
  // the smallest j.foundAge across all jobs (that's today's/most-recent scrape
  // batch) and flags every job that shares it. Auto-moves forward: once a
  // newer batch lands with a smaller foundAge, this recomputes and the badge
  // follows it — no fixed "last N days" cutoff to go stale. No-op (nothing
  // flagged) if no job has a known foundAge. Call this any time window.JOBS is
  // (re)built.
  function markNewestBatch(jobs) {
    var minFoundAge = null;
    jobs.forEach(function (j) {
      if (j.foundAge != null && (minFoundAge === null || j.foundAge < minFoundAge)) minFoundAge = j.foundAge;
    });
    jobs.forEach(function (j) { j.isNew = (minFoundAge != null && j.foundAge != null && j.foundAge === minFoundAge); });
  }

  function mapRow(row) {
    var title = row.role || '';
    var j = {
      id: 'c' + (row.num || Math.random().toString(36).slice(2)),
      num: row.num, title: title, company: row.company || '', domain: logoDomainFor(row.company, row.url),
      source: sourceFromHost(hostFrom(row.url)),
      mono: initials(row.company || ''), color: colorFor(row.company || ''),
      loc: row.location || '', locKey: locKeyFor(row.location), work: /remote/i.test(row.location || '') ? 'Remote' : 'On-site',
      salMin: null, salMax: null, fit: scoreToFit(row), age: 0, isNew: false, saved: bookmarkFor(row.url),
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
    // Real "found" age, from the tracker row's Date column (when we added it to
    // applications.md) — used ONLY as an honest display/tiebreak signal for the
    // "Newest (posted)" sort below; the existing "Newest (found)" sort (j.age)
    // is untouched.
    j.foundAge = daysAgo(row.date);
    // Real POSTED date (GET /api/compass/posted), partial/growing. Known → real
    // days-since-posted; unknown → fall back to the found age so unposted rows
    // still sort/tiebreak sensibly (never fabricated as "posted").
    var posted = postedFor(row.url);
    j.postedKnown = !!posted;
    j.postedDate = posted || null;
    j.postedAge = posted ? daysAgo(posted) : (j.foundAge != null ? j.foundAge : j.age);
    return j;
  }
  function setCurrentJob(job) { try { sessionStorage.setItem('compass_current_job', JSON.stringify(job)); } catch (e) {} }
  function getCurrentJob() { try { return JSON.parse(sessionStorage.getItem('compass_current_job') || 'null'); } catch (e) { return null; } }
  // ── Bookmarkable per-job slugs: kebab(company)-kebab(title)-<trackerNum> ──
  // The trailing number makes it uniquely resolvable; the words make it readable.
  function kebab(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); }
  function jobSlug(job) {
    if (!job) return '';
    var parts = [kebab(job.company || ''), kebab(job.title || job.role || '')].filter(Boolean);
    var num = (job.num != null && job.num !== '') ? String(job.num) : '';
    var base = parts.join('-');
    return (base ? base + (num ? '-' + num : '') : (num ? 'job-' + num : '')) || '';
  }
  function slugTrailingNum(slug) { var m = String(slug || '').match(/-(\d+)$/); return m ? m[1] : null; }
  function jobParam() { var m = location.search.match(/[?&]job=([^&]+)/); return m ? decodeURIComponent(m[1]) : ''; }
  // Resolve a slug back to a mapped job via the tracker (trailing num first, then
  // company+title fallback). Returns Promise<job|null>.
  function resolveJobSlug(slug) {
    if (!slug) return Promise.resolve(null);
    return jGet('/api/tracker').then(function (d) {
      var rows = (d && d.rows) || [];
      var num = slugTrailingNum(slug);
      var row = null;
      if (num != null) row = rows.filter(function (r) { return String(r.num) === String(num); })[0];
      if (!row) {
        var base = String(slug).replace(/-\d+$/, '');
        row = rows.filter(function (r) { return (kebab(r.company || '') + '-' + kebab(r.role || '')) === base; })[0];
      }
      return row ? mapRow(row) : null;
    }).catch(function () { return null; });
  }
  // Rewrite the address bar to the shareable slug URL for `page` (no reload).
  function setJobUrl(page, job) { try { if (job) history.replaceState(null, '', page + '?job=' + encodeURIComponent(jobSlug(job))); } catch (e) {} }
  function jobHref(page, job) { return page + '?job=' + encodeURIComponent(jobSlug(job)); }
  // Exposed so jobs.html's inline renderRail() can build the exact same
  // job-detail.html?job=<slug> link the card's own View/title link uses —
  // one slug derivation, not a second copy of the scheme.
  window.jobHref = jobHref;

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
  // Real POSTED dates (url → 'YYYY-MM-DD'), partial + growing. A url absent
  // here just means "posted date unknown" — mapRow falls back to the found
  // date for that row rather than fabricating one.
  function loadPosted() {
    return jGet('/api/compass/posted').then(function (j) { window.__postedMap = (j && j.map) || {}; return window.__postedMap; }).catch(function () { window.__postedMap = {}; return {}; });
  }
  function postedFor(url) { return (window.__postedMap && window.__postedMap[normUrl(url)]) || null; }
  // Pre-application bookmarks (real "Save" state), keyed by normalized url.
  function loadBookmarks() {
    return jGet('/api/compass/saved').then(function (j) { window.__savedSet = {}; ((j && j.urls) || []).forEach(function (u) { window.__savedSet[normUrl(u)] = true; }); return window.__savedSet; }).catch(function () { window.__savedSet = {}; return {}; });
  }
  function bookmarkFor(url) { return !!(window.__savedSet && window.__savedSet[normUrl(url)]); }
  function setBookmark(url, saved) {
    if (!window.__savedSet) window.__savedSet = {};
    if (saved) window.__savedSet[normUrl(url)] = true; else delete window.__savedSet[normUrl(url)];
    return jPost('/api/compass/saved', { url: url, saved: !!saved });
  }
  // ── Reviews (✓/✗ + reason + note): server is the source of truth so the feed's
  // "reviewed" state survives a cache-clear or a different device. jobs.html and
  // job-detail.html each keep their OWN localStorage-backed getReviews/setReviews
  // (keyed by job id, shared key "compass_reviews") — this just seeds/merges the
  // server's url-keyed map into whichever one is present on the current page, and
  // write-throughs every save/clear back to the server (debounced for notes).
  function loadReviews() {
    return jGet('/api/compass/reviews').then(function (j) { window.__reviewsMap = (j && j.map) || {}; return window.__reviewsMap; }).catch(function () { window.__reviewsMap = {}; return {}; });
  }
  // Merge the server's review for `url` into the local (id-keyed) review map,
  // newest ts wins — so a stale local cache (e.g. right after a cache-clear,
  // where there IS no local cache) never shadows a review made elsewhere.
  function mergeServerReview(id, url) {
    if (!id || !url || typeof window.getReviews !== 'function' || typeof window.setReviews !== 'function') return;
    var sv = window.__reviewsMap && window.__reviewsMap[normUrl(url)];
    if (!sv) return;
    var m = window.getReviews();
    var cur = m[id];
    if (!cur || (sv.ts || 0) > (cur.ts || 0)) {
      m[id] = { verdict: sv.verdict, reason: sv.reason || '', note: sv.note || '', ts: sv.ts || Date.now() };
      window.setReviews(m);
    }
  }
  var __reviewPostTimers = {};
  // Write-through a review to the server. Debounced per-url so a note typed
  // character-by-character doesn't fire a request (and a full-file rewrite
  // server-side) on every keystroke; the local write (already done by the
  // caller) stays instant. `meta` ({title, company, source}) is an optional
  // job snapshot — the caller already has the job object on hand at the vote
  // moment — persisted alongside the verdict so the review archive is fully
  // self-contained even after a job ages out of the live tracker (see
  // docs/review-archive-design.md §4.2).
  function postReviewDebounced(url, rv, meta) {
    if (!url || !rv || (rv.verdict !== 'good' && rv.verdict !== 'bad')) return;
    var key = normUrl(url);
    meta = meta || {};
    clearTimeout(__reviewPostTimers[key]);
    __reviewPostTimers[key] = setTimeout(function () {
      delete __reviewPostTimers[key];
      var body = {
        url: url, verdict: rv.verdict, reason: rv.reason || '', note: rv.note || '', ts: rv.ts || Date.now(),
        title: meta.title || '', company: meta.company || '', source: meta.source || '',
      };
      jPost('/api/compass/reviews', body)
        .then(function (r) { if (r && r.body && r.body.ok && window.__reviewsMap) window.__reviewsMap[key] = { verdict: rv.verdict, reason: rv.reason || '', note: rv.note || '', ts: rv.ts || Date.now(), title: body.title, company: body.company, source: body.source }; })
        .catch(function () { /* localStorage already has it; best-effort sync */ });
    }, 400);
  }
  function postReviewClear(url) {
    if (!url) return;
    var key = normUrl(url);
    clearTimeout(__reviewPostTimers[key]);
    if (window.__reviewsMap) delete window.__reviewsMap[key];
    jPost('/api/compass/reviews', { url: url, clear: true }).catch(function () { /* best-effort */ });
  }
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
  // Low-fit = an AI "Pass"/weak verdict. Unscored jobs are NOT low-fit (they pass through).
  function isLowFit(j) { return /pass|weak|poor/i.test(String(j && j.verdict || '')); }
  window.__compassShowLowFit = (function () { try { return localStorage.getItem('compass_showlowfit') === '1'; } catch (e) { return false; } })();
  window.__scoreBand = (function () { try { var v = localStorage.getItem('compass_scoreband'); return v ? JSON.parse(v) : null; } catch (e) { return null; } })();
  window.__compassSavedOnly = (function () { try { return localStorage.getItem('compass_savedonly') === '1'; } catch (e) { return false; } })();

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
    { href: 'documents.html', label: 'Tailoring' },
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
    st.textContent = '.topbar-in{max-width:1320px !important;margin-left:auto !important;margin-right:auto !important;padding-left:22px !important;padding-right:22px !important}'
      // ---- Light Mango accent nods (mango-orange #ffb300 + leaf-green #7bbf6a) ----
      + '.brand img{width:26px;height:26px;display:block}'
      + '.nav a.active{background:#ffb300 !important;color:#3a2600 !important}'
      + '.btn--primary,.btn.apply{background:#ffb300 !important;border-color:#ffb300 !important;color:#3a2600 !important;box-shadow:0 1px 2px rgba(0,0,0,.06)}'
      + '.btn--primary:hover,.btn.apply:hover{background:#f0a500 !important;border-color:#f0a500 !important}'
      // leaf-green nod on the still-open / live badge
      + '.badge--live{background:#eaf5e6 !important;color:#3f7a2e !important}'
      + '.badge--live .tk{background:#7bbf6a !important}'
      // subtle Mango footer on every page
      + '#mangoFooter{text-align:center;padding:26px 16px 40px;color:#b0a790;font:13px/1.5 system-ui;-webkit-user-select:none;user-select:none}'
      + '#mangoFooter .h{color:#e0645a}'
      // avatar → "Need support?" popover (mirrors the .ms/.ms-menu trigger-pill
      // pattern used by the jobs-page filter dropdowns, self-contained so it
      // works on every page even where that page-local controller isn't loaded)
      + '.avatar-menu-wrap{position:relative;display:inline-flex}'
      + '.avatar-menu-wrap .avatar{cursor:pointer}'
      + '.avatar-menu{position:absolute;z-index:30;top:calc(100% + 8px);right:0;min-width:200px;background:#fff;border:1px solid #ece5d6;border-radius:11px;box-shadow:0 1px 3px rgba(0,0,0,.05);padding:11px 14px;font:13.5px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#2a3b4d}'
      + '.avatar-menu[hidden]{display:none}';
    document.head.appendChild(st);
  }
  // Rebrand chrome shared by every compass page: mascot wordmark, favicon, footer.
  function injectMangoChrome() {
    document.title = 'Mango Jobs';
    if (!document.querySelector('link[rel="icon"]')) {
      var ic = document.createElement('link'); ic.rel = 'icon'; ic.href = '/compass/img/mascot.svg';
      document.head.appendChild(ic);
    }
    // Header wordmark: mascot + "Mango Jobs" (keep .brand layout/position).
    var brand = document.querySelector('.brand');
    if (brand && !brand.querySelector('img')) {
      var svg = brand.querySelector('svg'); if (svg) svg.remove();
      var span = brand.querySelector('span'); if (span) span.textContent = 'Mango Jobs';
      var img = document.createElement('img');
      img.src = '/compass/img/mascot.svg'; img.alt = 'Mango Jobs'; img.width = 26; img.height = 26;
      brand.insertBefore(img, brand.firstChild);
    }
    // Footer on every page.
    if (!document.getElementById('mangoFooter')) {
      var f = document.createElement('footer'); f.id = 'mangoFooter';
      f.innerHTML = 'Made with <span class="h">♥</span> for Nicole';
      document.body.appendChild(f);
    }
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

  // Top-right name/avatar → "Need support? Contact Nick" popover. Wired once
  // in wire.js so it's universal across every Compass page; no-ops cleanly on
  // any page without a .avatar element (e.g. tasks.html). Follows the same
  // click-to-toggle / Esc-closes / outside-click-closes / focus-return pattern
  // as the jobs-page .ms/.ms-menu (Pop) and .rpop popovers, reimplemented
  // locally since that page-scoped controller isn't loaded everywhere.
  var avatarMenuOpen = false;
  function closeAvatarMenu(returnFocus) {
    var menu = document.getElementById('compassAvatarMenu');
    var avatar = document.querySelector('.avatar');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    if (avatar) avatar.setAttribute('aria-expanded', 'false');
    avatarMenuOpen = false;
    document.removeEventListener('mousedown', onAvatarMenuDocDown, true);
    document.removeEventListener('keydown', onAvatarMenuKey, true);
    if (returnFocus && avatar) avatar.focus();
  }
  function onAvatarMenuDocDown(e) {
    var wrap = document.querySelector('.avatar-menu-wrap');
    if (wrap && !wrap.contains(e.target)) closeAvatarMenu(false);
  }
  function onAvatarMenuKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeAvatarMenu(true); }
  }
  function openAvatarMenu() {
    var menu = document.getElementById('compassAvatarMenu');
    var avatar = document.querySelector('.avatar');
    if (!menu) return;
    menu.hidden = false;
    if (avatar) avatar.setAttribute('aria-expanded', 'true');
    avatarMenuOpen = true;
    document.addEventListener('mousedown', onAvatarMenuDocDown, true);
    document.addEventListener('keydown', onAvatarMenuKey, true);
  }
  function toggleAvatarMenu() { if (avatarMenuOpen) closeAvatarMenu(true); else openAvatarMenu(); }
  function wireAvatarMenu() {
    ensureHeaderStyles();
    var avatar = document.querySelector('.avatar');
    if (!avatar || avatar.getAttribute('data-menu-wired')) return; // no avatar on this page, or already wired
    avatar.setAttribute('data-menu-wired', '1');
    var wrap = document.createElement('div'); wrap.className = 'avatar-menu-wrap';
    avatar.parentNode.insertBefore(wrap, avatar);
    wrap.appendChild(avatar);
    avatar.setAttribute('role', 'button');
    avatar.setAttribute('tabindex', '0');
    avatar.setAttribute('aria-haspopup', 'true');
    avatar.setAttribute('aria-expanded', 'false');
    var menu = document.createElement('div');
    menu.id = 'compassAvatarMenu'; menu.className = 'avatar-menu'; menu.hidden = true;
    menu.textContent = 'Need support? Contact Nick';
    wrap.appendChild(menu);
    avatar.addEventListener('click', function (e) { e.stopPropagation(); toggleAvatarMenu(); });
    avatar.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAvatarMenu(); }
    });
  }

  // ======================= JOBS ============================================
  var PAGE_SIZE = 50;
  // Fit-score filter as a DROPDOWN (.ms popover) sitting next to the salary
  // adjuster — mirrors the salary control's trigger-pill + .ms-menu pattern and
  // reuses the same dual-range .range slider. Plus a "Saved only" toggle.
  var FIT_GAP = 5;
  function ensureScoreBar() {
    ensureFitDropdown();
    ensureSavedToggle();
  }
  function ensureFitDropdown() {
    var salMs = document.getElementById('salMs');
    var fitMs = document.getElementById('fitMs');
    if (!fitMs) {
      if (!salMs || !salMs.parentNode || typeof window.Pop === 'undefined') return; // filter bar not ready
      fitMs = document.createElement('div'); fitMs.className = 'ms'; fitMs.id = 'fitMs';
      fitMs.innerHTML =
        '<button class="ms-trigger" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="fitPanel">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><circle cx="12" cy="12" r="9"/><path d="M12 12l4-2.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>' +
        '<span id="fitPill">Any fit</span>' +
        '<svg class="cv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>' +
        '<div class="ms-menu sal-menu" id="fitPanel" role="group" aria-label="Filter by fit score" hidden>' +
        '<span class="sv-lab">Fit score /100</span>' +
        '<div class="range" aria-label="Fit score range">' +
        '<div class="range-track"></div><div class="range-fill" id="fitFill"></div>' +
        '<input type="range" id="fitLow" min="0" max="100" step="5" value="0" aria-label="Minimum fit score">' +
        '<input type="range" id="fitHigh" min="0" max="100" step="5" value="100" aria-label="Maximum fit score"></div>' +
        '<span class="sal-vals" id="fitVals">0 – 100</span>' +
        '<div class="sal-done-row"><button type="button" class="btn btn--primary btn--sm" id="fitDone">Done</button></div></div>';
      salMs.parentNode.insertBefore(fitMs, salMs.nextSibling); // sit right after salary
      var fitLow = fitMs.querySelector('#fitLow'), fitHigh = fitMs.querySelector('#fitHigh'), fill = fitMs.querySelector('#fitFill'), vals = fitMs.querySelector('#fitVals'), pill = fitMs.querySelector('#fitPill');
      function paint() {
        var a = +fitLow.value, b = +fitHigh.value;
        fill.style.left = a + '%'; fill.style.right = (100 - b) + '%';
        vals.textContent = a + ' – ' + b;
        pill.textContent = (a <= 0 && b >= 100) ? 'Any fit' : (a + '–' + b);
        if (b <= FIT_GAP * 2) { fitHigh.style.zIndex = 6; fitLow.style.zIndex = 5; }
        else if (a >= 100 - FIT_GAP * 2) { fitLow.style.zIndex = 6; fitHigh.style.zIndex = 5; }
        fitLow.setAttribute('aria-valuetext', a + ' out of 100'); fitHigh.setAttribute('aria-valuetext', b + ' out of 100');
      }
      function commit() {
        var a = +fitLow.value, b = +fitHigh.value;
        // Full range 0–100 = no fit filter; any narrowing = explicit band.
        window.__scoreBand = (a <= 0 && b >= 100) ? null : { min: a, max: b };
        try { localStorage.setItem('compass_scoreband', window.__scoreBand ? JSON.stringify(window.__scoreBand) : ''); } catch (e) {}
        window.__compassShown = PAGE_SIZE; compassRender();
      }
      function onSlide() {
        var a = +fitLow.value, b = +fitHigh.value;
        if (this === fitLow) { if (a > b - FIT_GAP) { a = b - FIT_GAP; fitLow.value = a; } fitLow.style.zIndex = 6; fitHigh.style.zIndex = 5; }
        else { if (b < a + FIT_GAP) { b = a + FIT_GAP; fitHigh.value = b; } fitHigh.style.zIndex = 6; fitLow.style.zIndex = 5; }
        paint(); commit();
      }
      fitLow.addEventListener('input', onSlide);
      fitHigh.addEventListener('input', onSlide);
      fitMs.querySelector('#fitDone').onclick = function () { try { window.Pop.close(fitMs, true); } catch (e) {} };
      fitMs.__paint = paint;
      try { window.Pop.init(fitMs); } catch (e) {}
    }
    // Sync handles + pill to the persisted band each render (idempotent).
    var fl = fitMs.querySelector('#fitLow'), fh = fitMs.querySelector('#fitHigh');
    if (fl && fh) { var bnd = window.__scoreBand; fl.value = bnd ? bnd.min : 0; fh.value = bnd ? bnd.max : 100; if (fitMs.__paint) fitMs.__paint(); }
  }
  function ensureSavedToggle() {
    var cnt = document.getElementById('count'); if (!cnt) return;
    var sv = document.getElementById('compassSavedOnly');
    if (!sv) {
      sv = document.createElement('label'); sv.id = 'compassSavedOnly';
      sv.style.cssText = 'display:inline-flex;align-items:center;gap:7px;margin-left:14px;font:13px system-ui;color:#6b6255;cursor:pointer;vertical-align:middle';
      sv.innerHTML = '<input type="checkbox"' + (window.__compassSavedOnly ? ' checked' : '') + ' style="accent-color:#B5623B;width:15px;height:15px"><span><span style="color:#B5623B">♥</span> Saved only</span>';
      (cnt.parentNode || cnt).insertBefore(sv, cnt.nextSibling);
      sv.querySelector('input').addEventListener('change', function () {
        window.__compassSavedOnly = this.checked;
        try { localStorage.setItem('compass_savedonly', this.checked ? '1' : '0'); } catch (e) {}
        window.__compassShown = PAGE_SIZE; compassRender();
      });
    }
    var cb = sv.querySelector('input'); if (cb) cb.checked = !!window.__compassSavedOnly;
  }
  // "Show low-fit" toggle on the Jobs feed — hidden by default, reveals Pass-scored jobs.
  function ensureLowFitToggle(lowHidden) {
    var cnt = document.getElementById('count'); if (!cnt) return;
    var wrap = document.getElementById('compassLowFit');
    if (!wrap) {
      wrap = document.createElement('label'); wrap.id = 'compassLowFit';
      wrap.style.cssText = 'display:inline-flex;align-items:center;gap:7px;margin-left:14px;font:13px system-ui;color:#6b6255;cursor:pointer;vertical-align:middle';
      wrap.innerHTML = '<input type="checkbox" data-tip="' + esc(COMPASS_TIPS.lowfit.text) + '"' + (window.__compassShowLowFit ? ' checked' : '') + ' style="accent-color:#ffb300;width:15px;height:15px"><span class="lff-lbl"></span>';
      (cnt.parentNode || cnt).insertBefore(wrap, cnt.nextSibling);
      wrap.querySelector('input').addEventListener('change', function () {
        window.__compassShowLowFit = this.checked;
        try { localStorage.setItem('compass_showlowfit', this.checked ? '1' : '0'); } catch (e) {}
        window.__compassShown = PAGE_SIZE;
        compassRender();
      });
    }
    var lbl = wrap.querySelector('.lff-lbl');
    if (lbl) lbl.textContent = window.__compassShowLowFit ? 'Showing low-fit' : ('Show low-fit' + (lowHidden ? ' (' + lowHidden + ')' : ''));
  }
  // Two distinct empty states for the jobs feed: a brand-new account with
  // NOTHING scraped yet ("no jobs loaded at all") reads very differently from
  // an existing account whose filters happen to exclude everything. Branches
  // on window.JOBS.length rather than the filtered/rendered count. The
  // filtered-empty copy is captured from the page's own static markup on
  // first render so it stays in sync with jobs.html if that text ever changes.
  var EMPTY_NO_JOBS_YET =
    '<img src="/compass/img/mascot.svg" alt="" width="30" height="30" style="display:block;margin:0 auto 10px;opacity:.85">' +
    '<div style="font-weight:600;color:var(--ink-soft, #2a3b4d)">Our robots are out searching the web for the best jobs for you</div>' +
    '<div style="margin-top:4px">They&rsquo;ll report back soon — check back in a little while.</div>';
  function fillEmptyState(empty, matchedCount) {
    if (!empty.dataset.filteredHtml) empty.dataset.filteredHtml = empty.innerHTML; // capture original "no matches" copy once
    if (matchedCount) { empty.style.display = 'none'; return; }
    empty.innerHTML = (window.JOBS && window.JOBS.length) ? empty.dataset.filteredHtml : EMPTY_NO_JOBS_YET;
    empty.style.display = 'block';
  }
  function compassRender() {
    if (!window.JOBS || typeof window.matches !== 'function' || typeof window.cardHTML !== 'function') return;
    var all = window.JOBS.filter(window.matches);
    var st = window.state ? window.state.sort : 'best';
    // "best" = AI-scored jobs first (by fit score desc), then the rest.
    if (st === 'best') all.sort(function (a, b) { var as = a.fitScored ? 1 : 0, bs = b.fitScored ? 1 : 0; if (as !== bs) return bs - as; return (b.fit || 0) - (a.fit || 0); });
    else if (st === 'found' || st === 'new') all.sort(function (a, b) { var af = a.foundAge == null ? Infinity : a.foundAge, bf = b.foundAge == null ? Infinity : b.foundAge; return af - bf; });  // Newest (found): smallest foundAge (0 = found today) first
    // "Newest (posted)" — real posted-date rows sort first (soonest→oldest by
    // real days-since-posted); rows with no real posted date sort after them,
    // using the found date as a tiebreak. "Newest (found)" (st === 'found',
    // handled above by the fallthrough — unchanged) never touches this branch.
    else if (st === 'posted') all.sort(function (a, b) {
      if (!!a.postedKnown !== !!b.postedKnown) return a.postedKnown ? -1 : 1;
      return (a.postedAge != null ? a.postedAge : 0) - (b.postedAge != null ? b.postedAge : 0);
    });
    else if (st === 'salary') all.sort(function (a, b) { return (b.salMax || 0) - (a.salMax || 0); });
    window.__compassMatched = all;
    var shown = Math.min(window.__compassShown || PAGE_SIZE, all.length);
    var list = document.getElementById('list');
    if (list) list.innerHTML = all.slice(0, shown).map(window.cardHTML).join('');
    var empty = document.getElementById('empty'); if (empty) fillEmptyState(empty, all.length);
    var cnt = document.getElementById('count');
    // How many low-fit (Pass) jobs are currently hidden by the toggle (they pass all
    // OTHER filters). Count by momentarily enabling the flag so matches() includes them.
    var lowHidden = 0;
    if (!window.__compassShowLowFit && typeof window.matches === 'function') {
      window.__compassShowLowFit = true;
      lowHidden = window.JOBS.filter(function (j) { return isLowFit(j) && window.matches(j); }).length;
      window.__compassShowLowFit = false;
    }
    // On the "Reviewed" tab (now week-scoped — see jobs.html matches()), say so
    // in the same pagination-line style, so the count doesn't silently look
    // smaller once older reviews move to the archive (My Jobs).
    var revNote = (window.state && window.state.rev === 'reviewed') ? ' · your reviews from this week' : '';
    if (cnt) cnt.innerHTML = 'Showing <b>' + shown + '</b> of <b>' + all.length + '</b> matching · ' + window.JOBS.length + ' live jobs loaded' + revNote;
    ensureLowFitToggle(lowHidden);
    ensureScoreBar();
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
      // Point the card's internal "View" link at the bookmarkable slug URL.
      var viewBtn = side.querySelector('.view');
      card.querySelectorAll('a[href="job-detail.html"], a[href^="job-detail.html"]').forEach(function (v) { v.setAttribute('href', jobHref('job-detail.html', job)); });
      var a = document.createElement('a');
      a.className = 'btn btn--outline btn--sm compass-ext';
      a.href = job.url; a.target = '_blank'; a.rel = 'noopener';
      a.style.cssText = 'margin-top:8px;white-space:nowrap';
      a.innerHTML = 'View job posting <span style="font-size:12px">↗</span>';
      a.addEventListener('click', function (e) { e.stopPropagation(); }); // don't trigger the card→internal nav
      if (viewBtn && viewBtn.parentNode) viewBtn.parentNode.insertBefore(a, viewBtn.nextSibling);
      else side.appendChild(a);
      // "Open in Tailoring" — bookmarkable slug URL to the Tailoring page focused on this job.
      var t = document.createElement('a');
      t.className = 'btn btn--outline btn--sm compass-tailor';
      t.href = jobHref('documents.html', job);
      t.style.cssText = 'margin-top:8px;white-space:nowrap';
      t.innerHTML = 'Open in Tailoring';
      t.addEventListener('click', function (e) { e.stopPropagation(); setCurrentJob(job); });
      a.parentNode.insertBefore(t, a.nextSibling);
      // Real bookmark: override the mockup's dead .save toggle to persist server-side.
      var saveBtn = card.querySelector('.save');
      if (saveBtn) {
        saveBtn.classList.toggle('on', !!job.saved);
        saveBtn.setAttribute('aria-pressed', String(!!job.saved));
        saveBtn.onclick = function (e) {
          e.stopPropagation();
          var now = !job.saved; job.saved = now;
          saveBtn.classList.toggle('on', now);
          saveBtn.setAttribute('aria-pressed', String(now));
          saveBtn.setAttribute('aria-label', now ? 'Saved' : 'Save this job');
          setBookmark(job.url, now).then(function (r) { if (!(r.body && r.body.ok)) toastMsg('Could not save the bookmark', 'error'); }).catch(function () { toastMsg('Save failed — server unreachable', 'error'); });
          if (window.__compassSavedOnly && !now) compassRender(); // drop it from the Saved-only view
        };
      }
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
    // Populate this page's TIP_* constants (declared in jobs.html) from the
    // single COMPASS_TIPS registry above, before any card renders — same for
    // the static "Reviewed" tab, which gets its data-tip here (it's present
    // in the HTML before COMPASS_TIPS exists, so it can't carry it inline).
    window.TIP_FIT = COMPASS_TIPS.fit.text;
    window.TIP_SOURCE = COMPASS_TIPS.source.text;
    window.TIP_NEW = COMPASS_TIPS.new.text;
    window.TIP_FOUND = COMPASS_TIPS.found.text;
    window.TIP_VOTE = COMPASS_TIPS.vote.text;
    window.TIP_SAVE = COMPASS_TIPS.save.text;
    window.TIP_UNREVIEW = COMPASS_TIPS.unreview.text;
    var reviewedTab = document.querySelector('[data-rev="reviewed"]');
    if (reviewedTab) { reviewedTab.setAttribute('data-tip', COMPASS_TIPS.reviewedTab.text); CompassTip.scan(document); }
    // GET /api/tracker with NO paging params → { rows: <ALL rows> }
    jGet('/api/tracker').then(function (data) {
      var rows = (data && data.rows) || [];
      var loaded = rows.length;
      window.JOBS = rows.map(mapRow).filter(function (j) { return !isDead(j.url); });
      window.JOBS.forEach(function (j) { j.open = !isDead(j.url); });
      // Seed the localStorage review map from the server (source of truth) BEFORE
      // the first render, so a job reviewed on another device/before a
      // cache-clear still shows as reviewed here — newest ts wins per job.
      window.JOBS.forEach(function (j) { mergeServerReview(j.id, j.url); });
      markNewestBatch(window.JOBS);
      // "Newest (posted)" is only a meaningful, non-duplicate choice once at
      // least one job has a REAL posted date — hide it (never fabricate one)
      // until the posted-date store has coverage.
      (function () {
        var anyPosted = window.JOBS.some(function (j) { return j.postedKnown; });
        var opt = document.querySelector('#sort option[value="posted"]');
        if (opt) { opt.hidden = !anyPosted; opt.disabled = !anyPosted; }
        if (!anyPosted && window.state && window.state.sort === 'posted') {
          window.state.sort = 'best';
          var sel = document.getElementById('sort'); if (sel) sel.value = 'best';
        }
      })();
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
          // Only the FIRST tap (one-tap commit: saveReview(id, v) with no
          // reason/note args) gets a bottom toast — that's the one meaningful
          // state change (verdict recorded). Reason-chip toggles and note
          // keystrokes already get the inline "Saved" fade in the popover
          // (jobs.html's flashPopSaved()); stacking a second toast on every
          // one of those would be redundant (audit P0 4.6).
          var isFirstTap = (reason === undefined && note === undefined);
          jPost('/api/compass/feedback', { url: job.url, verdict: verdict, reason: reason || '' })
            .then(function (r) {
              if (!isFirstTap) return;
              var ok = r.body && r.body.ok;
              var nice = verdict === 'good' ? 'Saved — we\'ll find you more like this' : 'Saved — you won\'t see this one again';
              toastMsg(ok ? nice : 'Saved on this device — couldn\'t reach the server', ok ? 'success' : 'error');
            })
            .catch(function () { if (isFirstTap) toastMsg('Saved on this device — server unreachable', 'error'); });
          // Server-backed review store (verdict+reason+note+ts) — the feed's
          // actual "reviewed" source of truth; distinct from feedback.jsonl above.
          var rv = (typeof window.getReview === 'function') ? window.getReview(id) : null;
          postReviewDebounced(job.url, rv || { verdict: verdict, reason: reason || '', note: note || '', ts: Date.now() },
            { title: job.title || '', company: job.company || '', source: job.source || '' });
        };
        window.__compassFbWrapped = true;
      }
      if (typeof window.clearReview === 'function' && !window.__compassClearWrapped) {
        var origClear = window.clearReview;
        window.clearReview = function (id) {
          origClear(id);
          var job = (window.JOBS || []).find(function (x) { return x.id === id; });
          if (job && job.url) postReviewClear(job.url);
        };
        window.__compassClearWrapped = true;
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
        window.matches = function (j) {
          if (!baseMatches(j)) return false;
          if (COMP_FLOOR && j.salMax != null && j.salMax < COMP_FLOOR) return false;
          if (window.__compassSavedOnly && !j.saved) return false;
          var band = window.__scoreBand;
          if (band) {
            // Explicit numeric band is the authority: needs a real score in range,
            // and it overrides the low-fit auto-hide (so e.g. <40 actually shows).
            if (!j.fitScored || typeof j.fit !== 'number') return false;
            if (j.fit < band.min || j.fit > band.max) return false;
          } else if (!window.__compassShowLowFit && isLowFit(j)) {
            return false;
          }
          return true;
        };
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
      '<span class="logo" style="--mc:' + colorFor(row.company) + '" data-mono="' + esc(initials(row.company)) + '"><img src="/api/logo?domain=' + encodeURIComponent(logoDomainFor(row.company, row.url)) + '" alt="' + esc(row.company) + ' logo" onerror="this.parentNode.classList.add(\'failed\');this.remove()"></span>' +
      '<div class="minfo"><div class="t"><a href="' + esc(jobHref('job-detail.html', { company: row.company, role: row.role, num: row.num })) + '">' + esc(row.role) + '</a></div><div class="m"><span>' + esc(row.company) + '</span><span>' + esc(loc) + '</span></div></div>' +
      '<a class="btn btn--outline btn--sm go" href="' + esc(jobHref('job-detail.html', { company: row.company, role: row.role, num: row.num })) + '">View<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>' +
      '</div>';
  }
  function wireDash() {
    // Time-of-day greeting from the current LOCAL hour.
    var h = new Date().getHours();
    var greet = h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
    var hi = Array.prototype.filter.call(document.querySelectorAll('h1'), function (n) { return /good\s+(morning|afternoon|evening)/i.test(n.textContent); })[0];
    if (hi) hi.textContent = greet + ', Nicole';
    wireRunsPanel(); // real per-loop last-run times on the dashboard
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
    // ?job=<slug> is the SOURCE OF TRUTH for deep links (works with no sessionStorage);
    // sessionStorage is only a fast path; tracker[0] is the last-ditch fallback.
    var slug = jobParam();
    var sessionJob = getCurrentJob();
    var boot;
    if (slug) {
      boot = resolveJobSlug(slug).then(function (j) {
        return j || sessionJob || jGet('/api/tracker?pageSize=1&page=1').then(function (d) { return d.rows && d.rows[0] ? mapRow(d.rows[0]) : null; });
      });
    } else {
      boot = sessionJob ? Promise.resolve(sessionJob) : jGet('/api/tracker?pageSize=1&page=1').then(function (d) { return d.rows && d.rows[0] ? mapRow(d.rows[0]) : null; });
    }
    boot.then(function (job) {
      if (!job) {
        banner('No tracker row to show.');
        var h1x = document.querySelector('.head h1'); if (h1x) h1x.textContent = 'Role not found';
        var cox = document.querySelector('.head .company'); if (cox) cox.textContent = '';
        var jdx = document.querySelector('.jd'); if (jdx) jdx.innerHTML = '<p style="color:#8a8172">We couldn\'t find this role in your tracker. It may have been removed. <a href="jobs.html">Back to your jobs →</a></p>';
        var mhx = document.querySelector('.match-head .t'); if (mhx) mhx.textContent = '—';
        return;
      }
      window.JOB_ID = job.id || window.JOB_ID;
      setCurrentJob(job); // so "Open in Tailoring" carries this job's identity
      setJobUrl('job-detail.html', job); // shareable slug URL in the address bar
      // Seed this job's review from the server (source of truth) — newest ts
      // wins — then re-paint: the inline script's own paint() ran already, with
      // JOB_ID still "" (this resolves async), so the good/bad state wasn't
      // showing yet even from localStorage alone.
      mergeServerReview(window.JOB_ID, job.url);
      if (typeof window.saveReview === 'function' && !window.__compassDetailFbWrapped) {
        var origDetailSave = window.saveReview;
        window.saveReview = function (verdict, reason, note) {
          origDetailSave(verdict, reason, note);
          // Parity with the Jobs feed (wireJobs() above): a good/bad verdict
          // cast from Job Detail must ALSO reach the shared AI-learning store
          // (feedback.py → feedback.jsonl), not just this fork's own
          // cross-device "reviewed" store below. This was previously missing
          // here — voting inside a job detail page taught the AI nothing,
          // despite the walkthrough's promise that it would (see the fixed
          // note on /api/compass/reviews in compass.mjs). Same first-tap-only
          // toast rule as the feed (P0 4.6): reason/note edits only get the
          // inline "Saved" fade already shown by this page's own script.
          if (verdict === 'good' || verdict === 'bad') {
            var isFirstTap = (reason === undefined && note === undefined);
            jPost('/api/compass/feedback', { url: job.url, verdict: verdict, reason: reason || '' })
              .then(function (r) {
                if (!isFirstTap) return;
                var ok = r.body && r.body.ok;
                var nice = verdict === 'good' ? 'Saved — we\'ll find you more like this' : 'Saved — you won\'t see this one again';
                toastMsg(ok ? nice : 'Saved on this device — couldn\'t reach the server', ok ? 'success' : 'error');
              })
              .catch(function () { if (isFirstTap) toastMsg('Saved on this device — server unreachable', 'error'); });
          }
          var rv = (typeof window.getReview === 'function') ? window.getReview() : null;
          postReviewDebounced(job.url, rv || { verdict: verdict, reason: reason || '', note: note || '', ts: Date.now() },
            { title: job.title || '', company: job.company || '', source: job.source || '' });
        };
        if (typeof window.clearReview === 'function') {
          var origDetailClear = window.clearReview;
          window.clearReview = function () { origDetailClear(); postReviewClear(job.url); };
        }
        window.__compassDetailFbWrapped = true;
      }
      if (typeof window.paint === 'function') window.paint();
      var h1 = document.querySelector('.head h1'); if (h1) h1.textContent = job.title;
      var co = document.querySelector('.head .company'); if (co) co.textContent = job.company;
      var logo = document.querySelector('.head .logo'); if (logo) { logo.setAttribute('data-mono', job.mono); logo.style.setProperty('--mc', job.color); var img = logo.querySelector('img'); if (img) { img.src = '/api/logo?domain=' + encodeURIComponent(job.domain); img.alt = job.company + ' logo'; } }
      var pin = document.querySelector('.meta .pin'); if (pin && pin.lastChild && pin.lastChild.nodeType === 3) pin.lastChild.textContent = (job.loc || 'Location n/a') + ' · ' + job.work;
      // Real cat/func/level tag chips (derived per-job by mapRow) + their filter links.
      (function () {
        var chips = [['.tc-cat .cat-v', '.tc-cat', 'cat', job.cat], ['.tc-func .func-v', '.tc-func', 'func', job.func], ['.tc-lvl .lvl-v', '.tc-lvl', 'level', job.level]];
        chips.forEach(function (c) {
          var v = document.querySelector(c[0]); if (v && c[3]) v.textContent = c[3];
          var a = document.querySelector(c[1]); if (a && c[3]) a.setAttribute('href', 'jobs.html?' + c[2] + '=' + encodeURIComponent(c[3]));
        });
      })();
      // Real Save bookmark: reflect current state + toggle via /api/compass/saved.
      (function () {
        var sb = document.querySelector('.save-btn'); if (!sb) return;
        // Tooltip copy for this button lives in COMPASS_TIPS.saveDetail (see the
        // registry up top) — set here, not as a static HTML attribute, since
        // this button only exists statically before COMPASS_TIPS is defined.
        // CompassTip.scan() re-runs its idempotent bind() so this newly-tipped
        // element still gets the full hover/focus/tap contract. data-tip-key
        // is "save" (not "saveDetail") on purpose — it shares ONE retire
        // counter with the feed's Save heart, see COMPASS_TIPS comment.
        sb.setAttribute('data-tip', COMPASS_TIPS.saveDetail.text);
        sb.setAttribute('data-tip-key', 'save');
        CompassTip.scan(document);
        function paintSave() { var on = bookmarkFor(job.url); sb.classList.toggle('on', on); sb.setAttribute('aria-pressed', on ? 'true' : 'false'); var svg = sb.querySelector('svg'); sb.textContent = ''; if (svg) sb.appendChild(svg); sb.appendChild(document.createTextNode(on ? 'Saved' : 'Save')); }
        paintSave();
        sb.addEventListener('click', function () {
          if (!job.url) { toastMsg('No posting URL on this row', 'info'); return; }
          var next = !bookmarkFor(job.url); sb.disabled = true;
          setBookmark(job.url, next).then(function () { paintSave(); toastMsg(next ? 'Saved to My Jobs' : 'Removed bookmark', 'success'); }).catch(function () { toastMsg('Could not update bookmark', 'error'); }).finally(function () { sb.disabled = false; });
        });
      })();
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
        // Source chip: "via {board}" — host-derived from the job URL (display only).
        if (job.source) {
          var srcChip = meta.querySelector('.src-chip');
          if (!srcChip) { srcChip = document.createElement('span'); srcChip.className = 'src-chip'; meta.appendChild(srcChip); }
          srcChip.textContent = 'via ' + job.source;
        }
        // Honest per-row date chip: "posted Xd ago" when we have a real posted
        // date, else "found Xd ago" (never fabricated when both are unknown).
        var dateTxt = job.postedKnown ? ('posted ' + job.postedAge + 'd ago')
          : (job.foundAge != null ? ('found ' + job.foundAge + 'd ago') : '');
        if (dateTxt) {
          var chip = meta.querySelector('.date-chip');
          if (!chip) { chip = document.createElement('span'); chip.className = 'date-chip'; meta.appendChild(chip); }
          chip.textContent = dateTxt;
        }
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
      } else {
        // No AI fit-analysis for this role yet — clear the loading placeholders
        // so nothing reads as "stuck loading" (the numeric ring still shows the
        // row's derived fit above).
        var mh0 = document.querySelector('.match-head .t');
        if (mh0) mh0.textContent = 'No detailed match analysis for this role yet.';
        var mh0d = document.querySelector('.match-head .d');
        if (mh0d) mh0d.textContent = 'The score above is your quick fit; run this role through Tailoring for a deeper read.';
        var ml0 = document.querySelectorAll('.mlist');
        if (ml0[0]) ml0[0].innerHTML = '<li><span style="color:#8a8172">Not analysed yet.</span></li>';
        if (ml0[1]) ml0[1].innerHTML = '<li><span style="color:#8a8172">—</span></li>';
      }

      // Apply now → open the real posting in a new tab, then offer to mark applied
      var applyBtn = document.querySelector('.btn.apply');
      if (applyBtn) {
        applyBtn.setAttribute('href', job.url || '#');
        if (job.url) { applyBtn.setAttribute('target', '_blank'); applyBtn.setAttribute('rel', 'noopener'); }
        applyBtn.addEventListener('click', function (e) {
          if (!job.url) { e.preventDefault(); toastMsg('No posting URL on this row', 'info'); return; }
          // let the browser open the tab (anchor target=_blank), then prompt —
          // in-app confirm dialog (job-detail.html's window.compassConfirm),
          // not the native window.confirm(), to stay in the app's visual language.
          setTimeout(function () {
            var askApplied = window.compassConfirm ? window.compassConfirm({
              title: 'Mark this job as applied?',
              sub: 'We opened the posting in a new tab. We’ll add “' + job.title + ' — ' + job.company + '” to your tracker as Applied.',
              confirmLabel: 'Yes, mark it applied',
              cancelLabel: 'Not yet'
            }) : Promise.resolve(window.confirm('Opened the posting in a new tab.\n\nMark “' + job.title + ' — ' + job.company + '” as Applied in your tracker?'));
            askApplied.then(function (ok) {
              if (!ok) return;
              jPost('/api/compass/tracker/status', { num: job.num, url: job.url, status: 'Applied' }).then(function (r) {
                if (r.body && r.body.ok) {
                  toastMsg('Marked Applied in the tracker ✓', 'success');
                  job.status = 'Applied'; setCurrentJob(job);
                  var badge = document.querySelector('.head .badges'); if (badge) { var s = document.createElement('span'); s.className = 'badge badge--live'; s.style.marginLeft = '8px'; s.innerHTML = '<span class="tk"></span>Applied'; badge.appendChild(s); }
                } else { toastMsg('That didn\'t save — check your connection and try again.', 'error'); }
              }).catch(function (er) { toastMsg('That didn\'t save — check your connection and try again.', 'error'); });
            });
          }, 300);
        });
      }

      var jd = document.querySelector('.jd');
      if (jd && job.url) {
        jd.innerHTML = '<p style="color:#8a8172">Fetching the live posting…</p>';
        jGet('/api/pipeline/preview?url=' + encodeURIComponent(job.url)).then(function (prev) {
          var txt = (prev && prev.text) || '';
          if (txt && txt.length > 20 && !/^\(/.test(txt)) {
            jd.innerHTML = jdToHtml(txt.slice(0, 8000)) +
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
      // ── SAVED (bookmarked) jobs — a pre-application bucket, distinct from status ──
      var savedRows = rows.filter(function (r) { return bookmarkFor(r.url); });
      var savedWrap = document.getElementById('compassBookmarks'); if (savedWrap) savedWrap.remove();
      savedWrap = document.createElement('section'); savedWrap.id = 'compassBookmarks'; savedWrap.style.cssText = 'margin-bottom:26px'; main.appendChild(savedWrap);
      wrap = document.createElement('section'); wrap.id = 'compassSavedList'; main.appendChild(wrap);
      function bookmarkRowHtml(r, i) {
        var f = fitFor(r.url);
        var fitHtml = (f && typeof f.score === 'number')
          ? '<span style="font-family:var(--serif,Georgia);font-weight:600;font-size:16px;color:#16324F">' + f.score + '<span style="font-size:10px;color:#8a8172">/100</span></span>' + (f.verdict ? ' ' + verdictPill(f.verdict) : '')
          : '<span style="font:12px system-ui;color:#8a8172">fit ' + scoreToFit(r) + '</span>';
        var sal = salaryFor(r.url);
        var salHtml = '<span style="font:12px system-ui;color:' + (sal ? '#16324F' : '#b0a790') + '">' + (sal ? fmtSalary(sal) : 'not listed') + '</span>';
        return '<div class="c-brow" data-bi="' + i + '" style="display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #ece5d6;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.04);padding:14px 16px;margin-bottom:10px;cursor:pointer">' +
          '<span class="logo" style="--mc:' + colorFor(r.company) + ';flex:none" data-mono="' + esc(initials(r.company)) + '"><img src="/api/logo?domain=' + encodeURIComponent(logoDomainFor(r.company, r.url)) + '" onerror="this.parentNode.classList.add(\'failed\');this.remove()"></span>' +
          '<div style="flex:1;min-width:0"><div style="font-weight:600;color:#16324F">' + esc(r.role) + '</div><div style="font-size:13px;color:#8a8172;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px"><span>' + esc(r.company) + (r.location ? ' · ' + esc(r.location) : '') + '</span>' + salHtml + fitHtml + '</div></div>' +
          openPillHtml(r.url) +
          (SAVED_APP_STAGE.test(r.status || '') ? savedStagePill(r.status) : '') +
          (r.url ? '<a class="btn btn--outline btn--sm compass-ext" href="' + esc(r.url) + '" target="_blank" rel="noopener" style="flex:none;white-space:nowrap">View posting ↗</a>' : '') +
          '<button class="c-brow-remove btn btn--outline btn--sm" type="button" title="Remove bookmark" style="flex:none;color:#B5623B"><span style="color:#B5623B">♥</span> Saved</button>' +
          '</div>';
      }
      function renderBookmarks() {
        var head = '<div style="display:flex;align-items:baseline;gap:10px;margin:6px 0 12px"><h2 style="font:600 20px var(--serif,\'Iowan Old Style\',Georgia,serif);color:#16324F;margin:0">Saved jobs</h2><span style="font:12px system-ui;color:#8a8172">' + savedRows.length + ' bookmarked</span></div>';
        if (!savedRows.length) { savedWrap.innerHTML = head + '<div style="' + CARD + ';padding:22px 24px;text-align:center;color:#8a8172;font:14px system-ui">No saved jobs yet — tap the ♥ on any job in the feed to bookmark it here.</div>'; return; }
        savedWrap.innerHTML = head + savedRows.map(bookmarkRowHtml).join('');
        savedWrap.querySelectorAll('.c-brow').forEach(function (el) {
          var i = +el.getAttribute('data-bi'); var r = savedRows[i];
          el.addEventListener('click', function (e) { if (e.target.closest && (e.target.closest('.compass-ext') || e.target.closest('.c-brow-remove'))) return; var mj = mapRow(r); setCurrentJob(mj); location.href = jobHref('job-detail.html', mj); });
          var rm = el.querySelector('.c-brow-remove');
          if (rm) rm.onclick = function (e) { e.stopPropagation(); rm.disabled = true; setBookmark(r.url, false).then(function () { savedRows.splice(savedRows.indexOf(r), 1); renderBookmarks(); toastMsg('Removed bookmark', 'success'); }).catch(function () { rm.disabled = false; toastMsg('Could not remove bookmark', 'error'); }); };
        });
      }

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
          '<span class="logo" style="--mc:' + colorFor(r.company) + ';flex:none" data-mono="' + esc(initials(r.company)) + '"><img src="/api/logo?domain=' + encodeURIComponent(logoDomainFor(r.company, r.url)) + '" onerror="this.parentNode.classList.add(\'failed\');this.remove()"></span>' +
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
        wrap.innerHTML = '<div style="display:flex;align-items:baseline;gap:10px;margin:6px 0 12px"><h2 style="font:600 20px var(--serif,\'Iowan Old Style\',Georgia,serif);color:#16324F;margin:0">Applications</h2><span style="font:12px system-ui;color:#8a8172">' + mine.length + ' in progress</span></div>' + mine.map(rowHtml).join('');
        bindRows();
        banner('My Jobs LIVE — ' + savedRows.length + ' saved (bookmarked) + ' + mine.length + ' application(s). Bookmarks persist via /api/compass/saved; status/Remove via /api/compass/tracker/status.');
      }
      function persist(r, status, okMsg, onDone) {
        jPost('/api/compass/tracker/status', { num: r.num, url: r.url, status: status }).then(function (rr) {
          if (rr.body && rr.body.ok) { onDone(); toastMsg(okMsg, 'success'); }
          else toastMsg('That didn\'t save — check your connection and try again.', 'error');
        }).catch(function () { toastMsg('That didn\'t save — check your connection and try again.', 'error'); });
      }
      function bindRows() {
        wrap.querySelectorAll('.c-srow').forEach(function (el) {
          var i = +el.getAttribute('data-i'); var r = mine[i];
          el.addEventListener('click', function (e) { if (e.target.tagName === 'SELECT' || (e.target.closest && (e.target.closest('.compass-ext') || e.target.closest('.c-srow-remove')))) return; var mj = mapRow(r); setCurrentJob(mj); location.href = jobHref('job-detail.html', mj); });
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
      renderBookmarks();
      render();
      // Review archive is independent of tracker/bookmark data (own store,
      // own failure domain) — wire it after the two sections above so it
      // lands third in DOM order, per docs/review-archive-design.md §2.
      wireReviewArchive(main);
    }).catch(function (e) { banner('Could not load saved/tracker: ' + e); });
  }

  // ── Review archive: past-week ✓/✗ reviews (search + verdict + timeframe),
  // appended as a third section on My Jobs after Saved jobs/Applications.
  // Read-mostly (filter/search/view — no writes), so no toast/confirmation
  // machinery is needed here; see docs/review-archive-design.md §3-§6.
  function wireReviewArchive(main) {
    var old = document.getElementById('compassReviewArchive'); if (old) old.remove();
    var sec = document.createElement('section');
    sec.id = 'compassReviewArchive';
    sec.style.cssText = 'margin-top:26px';
    sec.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:10px;margin:6px 0 4px">' +
        '<h2 style="font:600 20px var(--serif,\'Iowan Old Style\',Georgia,serif);color:#16324F;margin:0">Review archive</h2>' +
        '<span id="archCount" style="font:12px system-ui;color:#8a8172">— jobs you reviewed in past weeks</span>' +
      '</div>' +
      '<div style="font:13px system-ui;color:#8a8172;margin-bottom:14px">' +
        'Your current week’s ✓/✗ still live on the Jobs feed. Once a week ends, reviews move here — nothing is deleted.' +
      '</div>' +
      '<div class="arch-controls" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">' +
        '<label class="search" style="flex:1;min-width:220px">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input id="archQ" type="text" placeholder="Search by job title or company…" />' +
        '</label>' +
        '<select id="archVerdict" class="stage-select" aria-label="Show" data-tip="' + esc(COMPASS_TIPS.archiveVerdict.text) + '">' +
          '<option value="good" selected>Liked</option>' +
          '<option value="bad">Passed</option>' +
          '<option value="all">Liked + Passed</option>' +
        '</select>' +
        '<div class="ms" id="archTfMs">' +
          '<button class="ms-trigger" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="archTfPanel" data-tip="' + esc(COMPASS_TIPS.archiveTimeframe.text) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
            '<span id="archTfLabel">All time</span>' +
            '<svg class="cv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>' +
          '</button>' +
          '<div class="ms-menu" id="archTfPanel" role="radiogroup" aria-label="Reviewed timeframe" hidden>' +
            '<label><input type="radio" name="archTf" value="2w">Last 2 weeks</label>' +
            '<label><input type="radio" name="archTf" value="1m">Last month</label>' +
            '<label><input type="radio" name="archTf" value="3m">Last 3 months</label>' +
            '<label><input type="radio" name="archTf" value="all" checked>All time</label>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div id="archList"><div style="color:#8a8172;font:14px system-ui;padding:16px 0">Loading your review archive…</div></div>';
    main.appendChild(sec);

    // Monday 00:00:00.000 local — byte-identical logic to jobs.html's own
    // copy and the server's (compass.mjs), just ported to this file. Only
    // used here to compute the timeframe presets' since/until bounds.
    function startOfThisWeekLocal(d) {
      d = d ? new Date(d) : new Date();
      var day = d.getDay();
      var diffToMonday = (day === 0) ? 6 : day - 1;
      var mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diffToMonday);
      mon.setHours(0, 0, 0, 0);
      return mon.getTime();
    }
    var TF_LABEL = { '2w': 'Last 2 weeks', '1m': 'Last month', '3m': 'Last 3 months', all: 'All time' };
    var TF_DAYS = { '2w': 14, '1m': 30, '3m': 90 };
    function tfBounds(tf) {
      if (!TF_DAYS[tf]) return { since: null, until: null };
      var until = startOfThisWeekLocal();
      return { since: until - TF_DAYS[tf] * 86400000, until: until };
    }

    var listEl = sec.querySelector('#archList');
    var qEl = sec.querySelector('#archQ');
    var verdictEl = sec.querySelector('#archVerdict');
    var tfMs = sec.querySelector('#archTfMs');
    var tfTrigger = tfMs.querySelector('.ms-trigger');
    var tfPanel = sec.querySelector('#archTfPanel');
    var tfLabelEl = sec.querySelector('#archTfLabel');

    var archState = { verdict: 'good', q: '', tf: 'all' };
    var archRows = [];   // last server response for the current verdict+timeframe (pre-search)
    var qTimer = null;
    var archIsEmpty = null; // null = not yet probed; true/false once we know

    function verdictBadge(v) {
      return v === 'bad'
        ? '<span style="flex:none;display:inline-flex;align-items:center;padding:3px 11px;border-radius:999px;background:var(--terra-soft);color:var(--terra);font:700 11px system-ui">Passed</span>'
        : '<span style="flex:none;display:inline-flex;align-items:center;padding:3px 11px;border-radius:999px;background:var(--sage-soft);color:var(--sage);font:700 11px system-ui">Liked</span>';
    }
    function rowHtml(r) {
      var when = r.ts ? new Date(r.ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      var reason = r.reason ? '<span>' + esc(r.reason) + '</span>' : '';
      return '<div class="c-arow" data-url="' + esc(r.url) + '" style="display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #ece5d6;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.04);padding:14px 16px;margin-bottom:10px;cursor:pointer">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;color:#16324F">' + esc(r.title || 'Untitled role') + '</div>' +
          '<div style="font-size:13px;color:#8a8172;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px">' +
            '<span>' + esc(r.company || 'Company not on file') + (r.source ? ' · via ' + esc(r.source) : '') + '</span>' + reason +
          '</div>' +
        '</div>' +
        verdictBadge(r.verdict) +
        '<span style="flex:none;color:#8a8172;font:12px system-ui">' + esc(when) + '</span>' +
      '</div>';
    }
    function matchesQ(r, q) {
      if (!q) return true;
      var hay = ((r.title || '') + ' ' + (r.company || '')).toLowerCase();
      return hay.indexOf(q.toLowerCase()) !== -1;
    }
    function probeArchiveEmpty() {
      if (archIsEmpty !== null) return Promise.resolve(archIsEmpty);
      return jGet('/api/compass/reviews/archive?verdict=all').then(function (r) {
        archIsEmpty = !((r && r.rows && r.rows.length) > 0);
        return archIsEmpty;
      }).catch(function () { return false; }); // best-effort; default to the safer "no results" copy on failure
    }
    function renderList() {
      var q = archState.q.trim();
      var filtered = archRows.filter(function (r) { return matchesQ(r, q); });
      if (!filtered.length) {
        probeArchiveEmpty().then(function (empty) {
          if (empty) {
            listEl.innerHTML = '<div style="padding:26px 20px;text-align:center;color:#8a8172;font:14px/1.6 system-ui">Nothing archived yet — once this week ends, anything you’ve liked or passed moves here. Your current week’s reviews are still on the Jobs feed.</div>';
          } else {
            listEl.innerHTML = '<div style="padding:26px 20px;text-align:center;color:#8a8172;font:14px/1.6 system-ui">No reviews match — try a different search, or widen the timeframe.' +
              (q ? ' <button id="archClearQ" class="btn btn--outline btn--sm" type="button" style="margin-left:6px">Clear search</button>' : '') + '</div>';
            var cb = document.getElementById('archClearQ');
            if (cb) cb.onclick = function () { qEl.value = ''; archState.q = ''; renderList(); qEl.focus(); };
          }
        });
        return;
      }
      listEl.innerHTML = filtered.map(rowHtml).join('');
      listEl.querySelectorAll('.c-arow').forEach(function (el) {
        el.addEventListener('click', function () {
          var url = el.getAttribute('data-url');
          var r = filtered.filter(function (x) { return x.url === url; })[0] || {};
          // Same slug-resolution path every other My Jobs row uses — if the
          // job aged out of the live tracker, job-detail.html's own existing
          // not-found fallback handles it (already shipped, honest copy).
          location.href = jobHref('job-detail.html', { title: r.title || '', company: r.company || '' });
        });
      });
    }
    function fetchArchive() {
      listEl.innerHTML = '<div style="color:#8a8172;font:14px system-ui;padding:16px 0">Loading your review archive…</div>';
      var params = ['verdict=' + encodeURIComponent(archState.verdict)];
      var b = tfBounds(archState.tf);
      if (b.since != null) params.push('since=' + b.since);
      if (b.until != null) params.push('until=' + b.until);
      jGet('/api/compass/reviews/archive?' + params.join('&')).then(function (r) {
        archRows = (r && r.rows) || [];
        renderList();
      }).catch(function () {
        listEl.innerHTML = '<div style="padding:26px 20px;text-align:center;color:#8a8172;font:14px/1.6 system-ui">Couldn’t load your review archive — check your connection and try again.</div>';
      });
    }

    verdictEl.addEventListener('change', function () { archState.verdict = verdictEl.value; fetchArchive(); });
    qEl.addEventListener('input', function () {
      clearTimeout(qTimer);
      var v = qEl.value;
      qTimer = setTimeout(function () { archState.q = v; renderList(); }, 300);
    });

    function closeTfMenu() {
      tfPanel.hidden = true; tfMs.classList.remove('open'); tfTrigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onTfDocDown, true);
      document.removeEventListener('keydown', onTfKey, true);
    }
    function openTfMenu() {
      tfPanel.hidden = false; tfMs.classList.add('open'); tfTrigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('mousedown', onTfDocDown, true);
      document.addEventListener('keydown', onTfKey, true);
    }
    function onTfDocDown(e) { if (!tfMs.contains(e.target)) closeTfMenu(); }
    function onTfKey(e) { if (e.key === 'Escape') { closeTfMenu(); tfTrigger.focus(); } }
    tfTrigger.addEventListener('click', function () { if (tfPanel.hidden) openTfMenu(); else closeTfMenu(); });
    Array.prototype.slice.call(tfPanel.querySelectorAll('input[name="archTf"]')).forEach(function (r) {
      r.addEventListener('change', function () {
        archState.tf = r.value;
        tfLabelEl.textContent = TF_LABEL[r.value];
        closeTfMenu();
        fetchArchive();
      });
    });

    fetchArchive();
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
  // --- Tailor panel: editable/copyable assembled prompt + Generate here ---
  function setupTailorPanel(panelSel) {
    var panel = document.querySelector(panelSel); if (!panel) return;
    var job = getCurrentJob();
    var company = job ? (job.company || '') : '', role = job ? (job.role || job.title || '') : '', url = job ? (job.url || '') : '';
    panel.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px">' +
      '<div style="flex:1;min-width:0"><div style="font-family:var(--serif,Georgia);font-weight:600;font-size:18px;color:#16324F">Tailored résumé</div>' +
      '<div style="font:12.5px system-ui;color:#8a8172">' + (company ? esc(company) + (role ? ' · ' + esc(role) : '') : 'Pick a job above') + ' · running on ' + esc(llmDesc()) + '</div></div></div>' +
      '<div class="tailor-prompt-wrap" style="' + CARD + ';margin:8px 0 12px"><div id="tailorPromptBody" style="padding:14px 16px">Reading the posting…</div></div>' +
      '<div class="compass-doc-out" style="margin-top:10px"></div>';
    var body = panel.querySelector('#tailorPromptBody');
    var out = panel.querySelector('.compass-doc-out');
    var ta = null;
    function loadVersions(selectId) {
      jGet('/api/compass/jobs').then(function (d) {
        var vs = ((d && d.jobs) || []).filter(function (j) { return j.type === 'tailor' && j.status === 'done' && docMatch(j, company, role); }).sort(function (a, b) { return String(a.created).localeCompare(String(b.created)); });
        renderVersioned(out, 'tailor', vs, selectId);
      });
    }
    function generate() {
      var prompt = (ta && ta.value || '').trim();
      if (prompt.length < 40) { toastMsg('The prompt is empty — reset it first', 'info'); return; }
      out.innerHTML = docSpinner(llmProgress('Tailoring'));
      startJob({ type: 'tailor', company: company, role: role, url: url, prompt: prompt }, null,
        function (j) { toastMsg('Résumé ready', 'success'); loadVersions(j.id); },
        function (err) { out.innerHTML = '<div style="padding:16px;background:#f7ece7;border:1px solid #e6c9bb;border-radius:10px;color:#9c5231;font:13.5px system-ui">Generation failed: ' + esc(err) + '</div>'; });
    }
    // Render the normal editable-prompt UI once we have a real JD.
    function renderPromptUI(assembled) {
      body.innerHTML =
        '<div style="font:600 13.5px system-ui;color:#16324F;margin-bottom:4px">The tailoring prompt</div>' +
        '<div style="font:12px system-ui;color:#8a8172;margin-bottom:6px">This is the exact prompt — your résumé + this job + the surgical instructions. Edit it, copy it, or generate right here. What you see is what runs.</div>' +
        '<textarea id="tailorPromptTa" spellcheck="false" style="width:100%;min-height:200px;box-sizing:border-box;padding:11px 12px;border:1px solid #d8cdb8;border-radius:10px;font:12.5px/1.5 ui-monospace,Menlo,monospace;resize:vertical"></textarea>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
          '<button class="btn btn--outline btn--sm" id="tailorCopyBtn" type="button">Copy prompt</button>' +
          '<button class="btn btn--outline btn--sm" id="tailorReassemble" type="button">Reset prompt</button>' +
          '<button class="btn btn--primary btn--sm" id="tailorGenBtn" type="button">Generate here</button>' +
        '</div>';
      ta = body.querySelector('#tailorPromptTa'); ta.value = assembled || '';
      body.querySelector('#tailorCopyBtn').onclick = function () { var b = this; navigator.clipboard.writeText(ta.value || '').then(function () { var o = b.textContent; b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = o; }, 1400); }); };
      body.querySelector('#tailorReassemble').onclick = function () { assemble(); };
      body.querySelector('#tailorGenBtn').onclick = generate;
    }
    function assembleWithJd(jd) {
      body.innerHTML = '<div style="color:#8a8172;font:13px system-ui">Assembling the prompt…</div>';
      jPost('/api/cv-studio/tailor', { jd: jd, headline: role, run: false }).then(function (r) {
        if (r.body && r.body.prompt) renderPromptUI(r.body.prompt);
        else body.innerHTML = '<div style="color:#9c5231;font:13px system-ui">Could not assemble the prompt (' + esc((r.body && r.body.error) || r.status) + ')</div>';
      });
    }
    // Guided paste flow — shown when the posting can't be read automatically.
    function renderGuidedPaste() {
      body.innerHTML =
        '<div style="font:600 14px system-ui;color:#16324F;margin-bottom:4px">We couldn’t read this posting automatically</div>' +
        '<div style="font:12.5px/1.6 system-ui;color:#8a8172;margin-bottom:12px">Some sites hide the job description behind scripts or bot-protection. It takes 20 seconds to paste it in — then tailoring is grounded in the real posting.</div>' +
        '<ol style="margin:0 0 12px;padding-left:20px;font:13px/1.7 system-ui;color:#2a3b4d">' +
          '<li style="margin-bottom:8px"><b>Open the original posting</b><div style="margin-top:5px">' + (url ? '<a class="btn btn--primary btn--sm" href="' + esc(url) + '" target="_blank" rel="noopener">Open the original posting ↗</a>' : '<span style="color:#b0a790">no link on this job</span>') + '</div></li>' +
          '<li style="margin-bottom:8px"><b>Copy the full job description</b> from that page (the responsibilities, requirements, etc.).</li>' +
          '<li style="margin-bottom:8px"><b>Paste it in the box below 👇</b></li>' +
          '<li><b>Then click Use this description</b> — we’ll tailor from it (and remember it for next time).</li>' +
        '</ol>' +
        '<textarea id="tailorPasteTa" spellcheck="false" placeholder="Paste the full job description here…" style="width:100%;min-height:160px;box-sizing:border-box;padding:11px 12px;border:2px solid #ffb300;border-radius:10px;font:13px/1.55 system-ui;resize:vertical;background:#fffdf5"></textarea>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">' +
          '<button class="btn btn--primary btn--sm" id="tailorPasteUse" type="button">Use this description</button>' +
          '<span id="tailorPasteMsg" style="font:12px system-ui;color:#b0a790"></span>' +
        '</div>';
      var pasteTa = body.querySelector('#tailorPasteTa');
      body.querySelector('#tailorPasteUse').onclick = function () {
        var jd = (pasteTa.value || '').trim();
        var msg = body.querySelector('#tailorPasteMsg');
        if (jd.length < 40) { msg.style.color = '#9c5231'; msg.textContent = 'Paste a bit more of the description (40+ characters).'; return; }
        msg.style.color = '#2f6f5b'; msg.textContent = 'Saved ✓ — assembling…';
        // Cache the pasted JD by url so future tailor/evaluate reuse it.
        if (url) jPost('/api/compass/jd-cache', { url: url, jd: jd });
        assembleWithJd(jd);
      };
    }
    function assemble() {
      body.innerHTML = '<div style="color:#8a8172;font:13px system-ui">Reading the posting…</div>';
      // 1) a previously pasted JD for this url wins (no re-prompting).
      var cacheP = url ? jGet('/api/compass/jd-cache?url=' + encodeURIComponent(url)).then(function (r) { return (r && r.jd) || ''; }).catch(function () { return ''; }) : Promise.resolve('');
      cacheP.then(function (cached) {
        if (cached && cached.length >= 40) { assembleWithJd(cached); return; }
        // 2) live preview
        var prevP = url ? jGet('/api/pipeline/preview?url=' + encodeURIComponent(url)).catch(function () { return null; }) : Promise.resolve(null);
        prevP.then(function (pv) {
          var jd = (pv && pv.text) || '';
          var thin = !pv || pv.thin || jd.length < 40;
          if (!thin) { assembleWithJd(jd); return; }
          // 3) thin + has a url → guided paste; no url → floor synth.
          if (url) renderGuidedPaste();
          else assembleWithJd((role || 'Finance role') + ' at ' + (company || 'the company') + '. Responsibilities include FP&A, budgeting, forecasting, and business partnering.');
        });
      });
    }
    loadVersions();
    assemble();
  }

  // --- Tailoring job picker: search her tracker jobs by title/company ---
  var __trackerRows = null;
  function loadTrackerRows() {
    if (__trackerRows) return Promise.resolve(__trackerRows);
    return jGet('/api/tracker').then(function (d) { __trackerRows = ((d && d.rows) || []).filter(function (r) { return !isDead(r.url); }); return __trackerRows; });
  }
  function buildTailoringHeader(onPick) {
    var ctx = document.querySelector('.context');
    if (!ctx) return;
    var cur = getCurrentJob();
    ctx.innerHTML =
      '<div class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h9M4 12h6"/><path d="M15 5l4 4-7 7-4 1 1-4z"/></svg></div>' +
      '<div style="flex:1;min-width:0">' +
      '<div class="t" id="tailorJobT">' + (cur ? esc(cur.title || cur.role || 'Selected job') + ' — ' + esc(cur.company || '') : 'Pick a job to tailor for') + '</div>' +
      '<div class="d">Working from your résumé. Search your tracker to choose which job to tailor for.</div></div>' +
      '<div style="position:relative"><button class="btn btn--outline btn--sm" id="tailorPickBtn" type="button">' + (cur ? 'Change job' : 'Choose a job') + '</button>' +
      '<div id="tailorPicker" style="display:none;position:absolute;right:0;top:calc(100% + 8px);z-index:40;width:min(420px,86vw);background:#fff;border:1px solid #e6ddc9;border-radius:12px;box-shadow:0 8px 28px rgba(22,50,79,.14);padding:12px">' +
      '<input id="tailorSearch" type="search" placeholder="Search by title or company…" autocomplete="off" style="width:100%;padding:9px 11px;border:1px solid #d8cdb8;border-radius:9px;font:13.5px system-ui;box-sizing:border-box">' +
      '<div id="tailorResults" style="margin-top:8px;max-height:300px;overflow:auto"></div></div></div>';
    var pickBtn = ctx.querySelector('#tailorPickBtn');
    var picker = ctx.querySelector('#tailorPicker');
    var search = ctx.querySelector('#tailorSearch');
    var results = ctx.querySelector('#tailorResults');
    function renderResults(q) {
      loadTrackerRows().then(function (rows) {
        var qq = (q || '').trim().toLowerCase();
        var list = rows.filter(function (r) { return !qq || (String(r.role || '') + ' ' + String(r.company || '')).toLowerCase().indexOf(qq) >= 0; }).slice(0, 12);
        if (!list.length) { results.innerHTML = '<div style="padding:12px;color:#8a8172;font:13px system-ui">No matching tracker jobs.</div>'; return; }
        results.innerHTML = list.map(function (r, i) {
          var f = fitFor(r.url);
          return '<button type="button" class="tailor-pick-row" data-num="' + esc(String(r.num)) + '" style="display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:#fff;border:1px solid #f0ece2;border-radius:9px;padding:8px 10px;margin-bottom:6px;cursor:pointer">' +
            '<span style="flex:1;min-width:0"><span style="display:block;font:600 13px system-ui;color:#16324F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.role || '(untitled)') + '</span>' +
            '<span style="display:block;font:12px system-ui;color:#8a8172;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.company || '') + (r.location ? ' · ' + esc(r.location) : '') + '</span></span>' +
            (f && typeof f.score === 'number' ? '<span style="flex:none;font:600 12px system-ui;color:#16324F">' + f.score + '<span style="font-size:9px;color:#b0a790">/100</span></span>' : '') + '</button>';
        }).join('');
        results.querySelectorAll('.tailor-pick-row').forEach(function (b) {
          b.onclick = function () {
            var num = b.getAttribute('data-num');
            var row = rows.filter(function (r) { return String(r.num) === num; })[0];
            if (!row) return;
            var job = mapRow(row); setCurrentJob(job);
            var t = ctx.querySelector('#tailorJobT'); if (t) t.textContent = (job.title || 'Selected job') + ' — ' + (job.company || '');
            pickBtn.textContent = 'Change job';
            picker.style.display = 'none';
            if (typeof onPick === 'function') onPick(job);
          };
        });
      });
    }
    pickBtn.onclick = function () {
      var open = picker.style.display === 'none';
      picker.style.display = open ? 'block' : 'none';
      if (open) { renderResults(''); search.value = ''; search.focus(); }
    };
    search.oninput = function () { renderResults(search.value); };
    document.addEventListener('click', function (e) { if (picker.style.display !== 'none' && !ctx.contains(e.target)) picker.style.display = 'none'; }, true);
  }
  // Compact "Already tailored" list on the Tailoring page — jump back to roles
  // you've already tailored. One row per job (latest artifact), newest first,
  // capped; click reopens that job's Tailoring via its slug deep-link.
  function buildTailoredList() {
    var ctx = document.querySelector('.context');
    var anchor = ctx || document.querySelector('.tabs');
    if (!anchor || !anchor.parentNode) return;
    var wrap = document.getElementById('compassTailoredList');
    if (!wrap) { wrap = document.createElement('section'); wrap.id = 'compassTailoredList'; wrap.style.cssText = 'margin:0 0 16px'; anchor.parentNode.insertBefore(wrap, anchor.nextSibling); }
    wrap.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin:0 0 8px"><div style="flex:1;font:700 11px system-ui;letter-spacing:.05em;text-transform:uppercase;color:#b0a790">Your tailored roles</div>' +
      '<a href="library.html?type=tailor" style="font:600 11.5px system-ui;color:#2f6f5b;text-decoration:none">See all in Library →</a></div>' +
      '<div id="compassTailoredBody" style="font:13px system-ui;color:#8a8172">Loading…</div>';
    Promise.all([jGet('/api/compass/jobs'), jGet('/api/tracker')]).then(function (arr) {
      var jobs = ((arr[0] && arr[0].jobs) || []).filter(function (j) { return j.type === 'tailor' && j.status === 'done'; });
      var rows = (arr[1] && arr[1].rows) || [];
      var rowByUrl = {}; rows.forEach(function (r) { if (r.url) rowByUrl[normUrl(r.url)] = r; });
      // Join each artifact to its tracker row by url so the slug (with tracker #)
      // resolves reliably — the artifact's own company/role may differ slightly.
      var byKey = {};
      jobs.forEach(function (j) {
        var row = j.url ? rowByUrl[normUrl(j.url)] : null;
        var company = (row && row.company) || j.company || '';
        var role = (row && row.role) || j.role || '';
        var num = row && row.num != null ? row.num : null;
        var url = j.url || (row && row.url) || '';
        var key = (kebab(company) + '|' + kebab(role)) || j.id;
        var ent = { company: company, role: role, num: num, url: url, created: j.finished || j.created };
        var prev = byKey[key]; if (!prev || String(ent.created) > String(prev.created)) byKey[key] = ent;
      });
      var list = Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, b) { return String(b.created).localeCompare(String(a.created)); });
      var bodyEl = document.getElementById('compassTailoredBody');
      if (!bodyEl) return;
      if (!list.length) { bodyEl.innerHTML = '<div style="padding:12px 14px;background:#fff;border:1px dashed #e6ddc9;border-radius:10px;color:#8a8172">No tailored résumés yet — pick a job above to start.</div>'; return; }
      function slugFor(e) { return jobSlug({ company: e.company, role: e.role, num: e.num }); }
      // Recent (3–5) as one-click chips + a compact search-select for the rest.
      var recent = list.slice(0, 5);
      var chips = recent.map(function (e) {
        var f = fitFor(e.url);
        return '<a href="documents.html?job=' + encodeURIComponent(slugFor(e)) + '" title="' + esc((e.company || '') + ' · ' + (e.role || '')) + '" style="display:inline-flex;align-items:center;gap:7px;max-width:280px;text-decoration:none;background:#fff;border:1px solid #ece5d6;border-radius:999px;padding:6px 12px;font:600 12.5px system-ui;color:#16324F">' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.company || '—') + ' · ' + esc(e.role || '') + '</span>' +
          (f && typeof f.score === 'number' ? '<span style="flex:none;color:#8a8172;font:600 10.5px system-ui">' + f.score + '</span>' : '') + '</a>';
      }).join('');
      bodyEl.innerHTML =
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' + chips + '</div>' +
        '<div style="position:relative;max-width:460px">' +
        '<input id="tailoredJump" type="search" autocomplete="off" placeholder="Jump to a tailored role…" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #d8cdb8;border-radius:9px;font:13.5px system-ui">' +
        '<div id="tailoredJumpResults" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:40;background:#fff;border:1px solid #e6ddc9;border-radius:11px;box-shadow:0 8px 28px rgba(22,50,79,.14);padding:8px;max-height:320px;overflow:auto"></div></div>';
      var jump = bodyEl.querySelector('#tailoredJump');
      var jres = bodyEl.querySelector('#tailoredJumpResults');
      function renderJump(q) {
        var qq = (q || '').trim().toLowerCase();
        var m = list.filter(function (e) { return !qq || ((e.company || '') + ' ' + (e.role || '')).toLowerCase().indexOf(qq) >= 0; }).slice(0, 12);
        if (!m.length) { jres.innerHTML = '<div style="padding:10px 12px;color:#8a8172;font:13px system-ui">No matching tailored role.</div>'; return; }
        jres.innerHTML = m.map(function (e) {
          var f = fitFor(e.url); var dt = e.created ? new Date(e.created).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
          return '<a href="documents.html?job=' + encodeURIComponent(slugFor(e)) + '" style="display:flex;gap:10px;align-items:center;text-decoration:none;border-radius:8px;padding:8px 10px">' +
            '<span style="flex:1;min-width:0"><span style="display:block;font:600 13px system-ui;color:#16324F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(e.company || '—') + ' · ' + esc(e.role || '') + '</span>' +
            '<span style="font:11.5px system-ui;color:#8a8172">tailored ' + esc(dt) + '</span></span>' +
            (f && typeof f.score === 'number' ? '<span style="flex:none;font:600 12px system-ui;color:#16324F">' + f.score + '<span style="font-size:9px;color:#b0a790">/100</span></span>' : '') + '</a>';
        }).join('');
      }
      jump.addEventListener('focus', function () { renderJump(jump.value); jres.style.display = 'block'; });
      jump.addEventListener('input', function () { renderJump(jump.value); jres.style.display = 'block'; });
      document.addEventListener('click', function (e) { if (jres.style.display !== 'none' && !wrap.contains(e.target)) jres.style.display = 'none'; }, true);
    }).catch(function () { });
  }
  function wireDocs() {
    // ?job=<slug> is the source of truth for a deep-linked/bookmarked Tailoring page.
    var slug = jobParam();
    var prep = slug ? resolveJobSlug(slug).then(function (j) { if (j) { setCurrentJob(j); setJobUrl('documents.html', j); } }) : Promise.resolve();
    prep.then(function () {
      buildTailoringHeader(function (job) {
        setJobUrl('documents.html', job); // shareable slug URL on pick
        setupTailorPanel('#panelTailor');
        setupDocPanel('#panelCover', 'cover', 'Generate cover letter');
      });
      buildTailoredList();
      setupTailorPanel('#panelTailor');
      setupDocPanel('#panelCover', 'cover', 'Generate cover letter');
      // Focused workspace: land on the Tailor tab (unless a specific hash targets another).
      if (!location.hash || location.hash === '#tailor') { var tt = document.getElementById('tabTailor'); if (tt) tt.click(); }
      banner('Tailoring LIVE — search your tracker to pick a job, then tailor your résumé (+ cover letter, a separate real letter). Each run = a new version; output is rich-rendered with per-section Copy and downloads. Running on ' + llmDesc() + '.');
    });
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

  // ---- TWO-PAGER (your fit preferences — loves/must-haves/hates/deal-breakers/non-negotiables) ----
  var TP_LISTS = [
    ['loves', 'What you love (one per line)'],
    ['must_haves', 'Must-haves (one per line)'],
    ['hates', 'What you hate (one per line)'],
    ['deal_breakers', 'Deal-breakers (one per line)'],
    ['non_negotiables', 'Non-negotiables (one per line)']
  ];
  function sectionTwoPager(host) {
    var s = details('Your two-pager (#/two-pager)', true); host.appendChild(s.d);
    s.body.insertAdjacentHTML('beforeend', '<div style="font:13px/1.6 system-ui;color:#6b6255;margin:0 0 12px">What YOU actually want from your next role — feeds every fit score on your matches.</div>');
    var box = el('div'); s.body.appendChild(box);
    var m = msgLine(); s.body.appendChild(m);
    var actions = el('div', 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px');
    actions.innerHTML = '<button class="btn btn--primary btn--sm" id="tpSave" type="button">Save</button><button class="btn btn--outline btn--sm" id="tpDraft" type="button">✨ Re-draft from your résumé</button>';
    s.body.appendChild(actions);

    var TP_INP = INP + ';overflow:hidden';
    function tpGrow(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
    function tpGrowAll() {
      var tas = box.querySelectorAll('textarea');
      for (var i = 0; i < tas.length; i++) {
        (function (t) { tpGrow(t); t.addEventListener('input', function () { tpGrow(t); }); })(tas[i]);
      }
    }

    function render(d) {
      d = d || {};
      box.innerHTML =
        '<label style="' + LBL + '">Who you are<textarea id="tpWho" rows="5" style="' + TP_INP + '">' + esc(d.who_i_am || '') + '</textarea></label>' +
        TP_LISTS.map(function (x) { return '<label style="' + LBL + '">' + x[1] + '<textarea id="tp_' + x[0] + '" rows="3" style="' + TP_INP + '">' + esc(chips(d[x[0]])) + '</textarea></label>'; }).join('') +
        '<label style="' + LBL + '">Target environment<textarea id="tpEnv" rows="3" style="' + TP_INP + '">' + esc(d.target_environment || '') + '</textarea></label>';
      tpGrowAll();
    }
    function collect() {
      var out = { who_i_am: box.querySelector('#tpWho').value, target_environment: box.querySelector('#tpEnv').value };
      TP_LISTS.forEach(function (x) { out[x[0]] = fromLines(box.querySelector('#tp_' + x[0]).value); });
      return out;
    }

    jGet('/api/two-pager').then(function (r) { render((r && r.twoPager) || {}); }).catch(function () { render({}); });

    actions.querySelector('#tpSave').onclick = function () {
      fetch('/api/two-pager', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collect()) })
        .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
        .then(function (o) { say(m, o.s === 200 && o.j.ok ? 'Two-pager saved ✓' : ('Save failed: ' + (o.j.error || o.s)), o.s === 200 && o.j.ok); if (o.s === 200 && o.j.twoPager) render(o.j.twoPager); })
        .catch(function (e) { say(m, 'Save error: ' + e, false); });
    };
    actions.querySelector('#tpDraft').onclick = function () {
      say(m, llmProgress('Drafting'));
      jPost('/api/two-pager/draft', { run: true }).then(function (r) {
        if (r.body && r.body.fields) { render(r.body.fields); say(m, 'Drafted from your résumé — review, then Save ✓', true); }
        else if (r.body && r.body.error) { say(m, 'Draft failed: ' + r.body.error, false); }
        else { say(m, 'Could not draft — no fields returned.', false); }
      }).catch(function (e) { say(m, 'Draft error: ' + e, false); });
    };
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
    sectionTwoPager(wrap);
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

  // Compact the mockup's "Where your search runs" panel + replace the fake
  // "Ran today ✓" badges with REAL last-run times (cron log mtimes) and a real
  // "last new jobs added" line, from GET /api/compass/runs.
  function fmtRan(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date(), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return 'today ' + t;
    if (d.toDateString() === new Date(now.getTime() - 864e5).toDateString()) return 'yesterday ' + t;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + t;
  }
  function wireRunsPanel() {
    var runs = document.querySelector('.runs'); if (!runs) return;
    var card = runs.closest('.card') || runs.parentNode;
    if (!document.getElementById('compassRunsCompact')) {
      var st = document.createElement('style'); st.id = 'compassRunsCompact';
      st.textContent =
        '.runs{border:1px solid #ece5d6;border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}' +
        '.runs .run-row{display:flex;align-items:center;gap:14px;padding:12px 16px !important;border-top:1px solid #f3eee1;margin:0 !important}' +
        '.runs .run-row:first-child{border-top:0 !important}' +
        '.runs .run-ic{flex:none}' +
        '.runs .run-main{flex:1 1 auto;min-width:0}' +
        '.runs .run-t{font-size:13.5px !important;font-weight:600;line-height:1.25}' +
        '.runs .run-d{font-size:11.5px !important;color:#8a8172;line-height:1.3}' +
        '.runs .run-sched{flex:none;font-size:11.5px !important;color:#8a8172;white-space:nowrap;text-align:right;margin:0 !important}' +
        '.runs .run-status{flex:none;min-width:190px;display:flex;justify-content:flex-end;align-items:center;text-align:right;margin:0 !important}' +
        '.runs .run-status .badge{font-size:10.5px !important;padding:3px 9px !important;white-space:nowrap}' +
        '@media(max-width:640px){.runs .run-row{flex-wrap:wrap}.runs .run-sched,.runs .run-status{margin-left:48px !important;text-align:left;justify-content:flex-start;min-width:0}}' +
        '#compassRunsMeta{font:12px system-ui;color:#6b6255;margin:2px 0 10px}';
      document.head.appendChild(st);
    }
    jGet('/api/compass/runs').then(function (r) {
      if (r && r.lastNew) {
        var h = document.getElementById('compassRunsMeta');
        if (!h) { h = document.createElement('div'); h.id = 'compassRunsMeta'; var hint = card.querySelector('.hint'); if (hint) hint.parentNode.insertBefore(h, hint.nextSibling); else runs.parentNode.insertBefore(h, runs); }
        h.innerHTML = 'Last new jobs added: <b>' + esc(r.lastNew.date) + '</b> · ' + (+r.lastNew.count || 0) + ' total new';
      }
      // Map each row to its pipeline by MATCHING THE ROW LABEL (robust to row
      // count/order) rather than by a fixed positional index.
      var logs = (r && r.logs) || {};
      function logKeyForLabel(txt) {
        var t = String(txt || '').toLowerCase();
        if (/job-?site|company|career page|career-page/.test(t)) return 'scan';
        if (/deep|board|scrape/.test(t)) return 'scrape';
        if (/web discovery|discover/.test(t)) return 'discover';
        if (/linkedin/.test(t)) return 'linkedin';
        if (/liveness|still open|still-open|open\?/.test(t)) return 'liveness';
        if (/\bfit\b|score/.test(t)) return 'fitscore';
        return null;
      }
      var perLoop = (r && r.perLoopNew) || {};
      runs.querySelectorAll('.run-row').forEach(function (row) {
        var stt = row.querySelector('.run-status'); if (!stt) return;
        var label = (row.querySelector('.run-t') || {}).textContent || row.textContent;
        var key = logKeyForLabel(label);
        var iso = key && logs[key];
        var n = key && perLoop[key] ? +perLoop[key] : 0;
        var newTxt = n > 0 ? ' · ' + n + ' new' : '';
        if (iso) stt.innerHTML = '<span class="badge badge--live"><span class="tk"></span>Last ran ' + esc(fmtRan(iso)) + esc(newTxt) + '</span>';
        else stt.innerHTML = '<span style="font:11px system-ui;color:#b0a790">on schedule' + esc(newTxt) + '</span>';
      });
    }).catch(function () { });
  }
  function wireSetup() {
    buildNativeSetup();
    wireRunsPanel();
    var btn = document.getElementById('saveBtn');
    if (btn) btn.addEventListener('click', function () {
      var settings = { includeTitles: (window.includeTitles || []).slice(), excludeTitles: (window.excludeTitles || []).slice(), searchTerms: (window.searchTerms || []).slice(), cities: (window.cities || []).map(function (c) { return c && c.name ? c.name : c; }), remoteUS: !!window.remoteUS };
      // Single real confirmation, tied to this actual network write (P0 4.3 —
      // collapse the old triple-fire: optimistic inline note + optimistic
      // toast + this real toast, down to just this one, on completion).
      var origHtml = btn.innerHTML;
      btn.disabled = true; btn.textContent = 'Saving…';
      jPost('/api/compass/setup', { settings: settings }).then(function (r) {
        var ok = r.body && r.body.ok;
        toastMsg(ok ? 'Your search settings are saved.' : 'Couldn\'t update your search settings — try again in a moment.', ok ? 'success' : 'error');
      }).catch(function () {
        toastMsg('Couldn\'t update your search settings — try again in a moment.', 'error');
      }).finally(function () {
        btn.disabled = false; btn.innerHTML = origHtml;
      });
    });
    banner('Setup MIGRATED — full config, portals (companies w/ source keys), profile, two-pager, CV, memory, health, usage, docs-assistant, orientation, help all native here via their real endpoints. Comp floor stays demo.');
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
      b.onclick = function () { var t = decodeURIComponent(b.getAttribute('data-copy')); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = 'Copy message'; }, 1500); }, function () { toastMsg('Copy failed — select the text manually', 'error'); }); };
    });
  }
  function wireOutreach() {
    var main = document.querySelector('main .wrap') || document.querySelector('main') || document.body;
    Array.prototype.slice.call(main.children).forEach(function (c) { c.style.display = 'none'; });
    var root = el('div'); main.appendChild(root);
    root.innerHTML =
      '<h1 style="font:700 26px/1.2 var(--serif,Georgia);color:#16324F;margin:6px 0 4px">Find people to reach out to</h1>' +
      '<div style="' + CARD + ';padding:18px 20px;margin-bottom:14px">' +
      '<div style="position:relative;margin-bottom:2px"><label style="' + LBL + '">Pick a job — search your tracker</label>' +
      '<input id="oJobSearch" type="search" autocomplete="off" placeholder="Search by title or company…" style="' + INP + '">' +
      '<div id="oJobResults" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:40;background:#fff;border:1px solid #e6ddc9;border-radius:11px;box-shadow:0 8px 28px rgba(22,50,79,.14);padding:8px;max-height:300px;overflow:auto"></div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<label style="' + LBL + '">Company<input id="oCompany" type="text" style="' + INP + '"></label>' +
      '<label style="' + LBL + '">Role (optional)<input id="oRole" type="text" style="' + INP + '"></label></div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:12px"><button class="btn btn--primary btn--sm" id="oGen" type="button">Build networking plan</button><span id="oStatus" style="font:12.5px system-ui;color:#6b6255"></span></div>' +
      '</div>' +
      '<div id="oSaveBar" style="display:none;margin-bottom:12px"><button class="btn btn--primary btn--sm" id="oSave" type="button">Save this plan</button> <span id="oSaveMsg" style="font:12px system-ui;color:#2f6f5b"></span></div>' +
      '<div id="oOut"></div>' +
      '<div style="' + CARD + ';padding:16px 20px;margin-top:14px"><h3 style="font:600 15px system-ui;color:#16324F;margin:0 0 8px">Saved plans</h3><div id="oSaved" style="font:13px system-ui;color:#6b6255">Loading…</div></div>';
    // Job picker — same search-with-dropdown UX as the Tailoring page.
    var pickedUrl = '';
    var oSearch = document.getElementById('oJobSearch');
    var oResults = document.getElementById('oJobResults');
    function renderOResults(q) {
      loadTrackerRows().then(function (rows) {
        var qq = (q || '').trim().toLowerCase();
        var list = rows.filter(function (r) { return !qq || (String(r.role || '') + ' ' + String(r.company || '')).toLowerCase().indexOf(qq) >= 0; }).slice(0, 12);
        if (!list.length) { oResults.innerHTML = '<div style="padding:10px 12px;color:#8a8172;font:13px system-ui">No matching tracker jobs.</div>'; return; }
        oResults.innerHTML = list.map(function (r) {
          var f = fitFor(r.url);
          return '<button type="button" class="o-pick-row" data-num="' + esc(String(r.num)) + '" style="display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:#fff;border:1px solid #f0ece2;border-radius:9px;padding:8px 10px;margin-bottom:6px;cursor:pointer">' +
            '<span style="flex:1;min-width:0"><span style="display:block;font:600 13px system-ui;color:#16324F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.role || '(untitled)') + '</span>' +
            '<span style="display:block;font:12px system-ui;color:#8a8172;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.company || '') + (r.location ? ' · ' + esc(r.location) : '') + '</span></span>' +
            (f && typeof f.score === 'number' ? '<span style="flex:none;font:600 12px system-ui;color:#16324F">' + f.score + '<span style="font-size:9px;color:#b0a790">/100</span></span>' : '') + '</button>';
        }).join('');
        oResults.querySelectorAll('.o-pick-row').forEach(function (b) {
          b.onclick = function () {
            var r = rows.filter(function (x) { return String(x.num) === b.getAttribute('data-num'); })[0];
            if (!r) return;
            document.getElementById('oCompany').value = r.company || '';
            document.getElementById('oRole').value = r.role || '';
            pickedUrl = r.url || '';
            oSearch.value = r.company + (r.role ? ' — ' + r.role : '');
            oResults.style.display = 'none';
          };
        });
      });
    }
    oSearch.addEventListener('focus', function () { renderOResults(oSearch.value); oResults.style.display = 'block'; });
    oSearch.addEventListener('input', function () { pickedUrl = ''; renderOResults(oSearch.value); oResults.style.display = 'block'; });
    document.addEventListener('click', function (e) { if (oResults.style.display !== 'none' && e.target !== oSearch && !oResults.contains(e.target)) oResults.style.display = 'none'; }, true);
    var lastPlan = null;
    document.getElementById('oGen').onclick = function () {
      var company = document.getElementById('oCompany').value.trim();
      var role = document.getElementById('oRole').value.trim();
      if (!company) { toastMsg('Enter or pick a company first', 'info'); return; }
      var status = document.getElementById('oStatus');
      var url = pickedUrl || '';
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
      .catch(function () { toastMsg('Couldn\'t export the document — try again in a moment.', 'error'); });
  }
  function downloadBlob(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  function downloadText(text, name, mime) { downloadBlob(new Blob([text], { type: mime || 'text/plain' }), name); }
  function copyText(text, btn) {
    function ok() { if (btn) { var o = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = o; }, 1400); } toastMsg('Copied to clipboard', 'success'); }
    function fb() { try { var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); ok(); } catch (e) { toastMsg('Copy failed — select the text manually', 'error'); } }
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
  // ---- View-only diff highlight (tailored résumé vs baseline cv.md) ----
  // Highlights live ONLY in the on-screen DOM; Copy/Download always use the clean
  // section text (hidden textarea) / raw markdown, never the highlighted markup.
  var __cvBaseline = null;
  function loadCvBaseline() {
    if (__cvBaseline) return Promise.resolve(__cvBaseline);
    return jGet('/api/cv').then(function (d) {
      var md = (d && d.markdown) || '';
      var lines = md.split('\n').map(diffNormLine).filter(Boolean);
      var set = {}; lines.forEach(function (l) { set[l] = 1; });
      __cvBaseline = { set: set, lineTokens: lines.map(diffTokens) };
      return __cvBaseline;
    }).catch(function () { __cvBaseline = { set: {}, lineTokens: [] }; return __cvBaseline; });
  }
  function diffNormLine(s) { return String(s || '').toLowerCase().replace(/^[\s>*+\-•–—\d.)]+/, '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim(); }
  function diffTokens(s) { return diffNormLine(s).split(' ').filter(Boolean); }
  function diffNormWord(w) { return String(w || '').toLowerCase().replace(/[^a-z0-9%$.]/g, ''); }
  // Apply / remove highlights on the rendered blocks inside `root` (a container).
  function applyDiffHighlight(root, on, base) {
    var blocks = root.querySelectorAll('.lib-md li, .lib-md p, .lib-md h3');
    blocks.forEach(function (el) {
      // Never highlight the "What changed & why" changelog section — it describes
      // the edits (so nothing there matches the résumé baseline). Leave it untouched.
      var card = el.closest ? el.closest('section') : null;
      if (card) { var ch = card.querySelector('.lib-h'); if (ch && /what changed|changed\s*&\s*why|changes?\b.*\bwhy/i.test(ch.textContent || '')) return; }
      if (el.__diffOrig == null) el.__diffOrig = el.innerHTML; // stash the clean render once
      // always start from the clean render + clear any prior box styling
      el.innerHTML = el.__diffOrig;
      el.style.borderLeft = ''; el.style.padding = ''; el.style.paddingLeft = ''; el.style.background = ''; el.style.borderRadius = ''; el.style.margin = '';
      if (!on) return;
      var n = diffNormLine(el.textContent);
      if (!n || base.set[n]) return; // empty or unchanged (verbatim in baseline)
      // find the closest baseline line by token overlap for a word-level diff
      var elTok = diffTokens(el.textContent), best = null, bestScore = 0;
      for (var i = 0; i < base.lineTokens.length; i++) {
        var bt = base.lineTokens[i]; if (!bt.length) continue;
        var bset = {}; bt.forEach(function (t) { bset[t] = 1; });
        var hit = 0; elTok.forEach(function (t) { if (bset[t]) hit++; });
        var score = hit / Math.max(elTok.length, 1);
        if (score > bestScore) { bestScore = score; best = bset; }
      }
      // Box the WHOLE changed bullet/line in a highlighter-yellow box.
      el.style.background = '#fff3b0'; el.style.borderLeft = '3px solid #f4b400';
      el.style.padding = '4px 9px'; el.style.borderRadius = '5px'; el.style.margin = '4px 0';
      el.classList.add('diff-box');
      // Within the box, bold-emphasize the specific words that changed.
      if (best && bestScore >= 0.4) {
        var parts = el.textContent.split(/(\s+)/);
        el.innerHTML = parts.map(function (w) {
          if (!w || /^\s+$/.test(w)) return esc(w);
          return best[diffNormWord(w)] ? esc(w) : '<span style="background:#ffdd57;font-weight:600;border-radius:2px;padding:0 1px">' + esc(w) + '</span>';
        }).join('');
      }
      // else: a brand-new / heavily-changed line — the yellow box alone marks it.
    });
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
    var copyRow = el('div', 'margin-bottom:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap');
    copyRow.innerHTML = '<button class="btn btn--primary btn--sm" data-a="copyall" type="button">Copy all</button>' +
      (type === 'tailor' ? '<button class="btn btn--outline btn--sm" data-a="showdiff" type="button" aria-pressed="false">Show changes</button><span data-diffhint style="font:12px system-ui;color:#b0a790"></span>' : '');
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
    // View-only diff highlight vs baseline cv.md (tailor only). Copy/Download above
    // stay clean — they read ta.value / md, never this highlighted DOM.
    var diffBtn = copyRow.querySelector('[data-a=showdiff]');
    if (diffBtn) {
      var hint = copyRow.querySelector('[data-diffhint]');
      function setDiff(on) {
        diffBtn.textContent = on ? 'Hide changes' : 'Show changes';
        diffBtn.setAttribute('aria-pressed', String(on));
        if (!on) { applyDiffHighlight(col, false, { set: {}, lineTokens: [] }); hint.textContent = ''; return; }
        hint.textContent = 'comparing to your résumé…';
        loadCvBaseline().then(function (base) {
          applyDiffHighlight(col, true, base);
          var n = col.querySelectorAll('.lib-md .diff-box').length;
          hint.textContent = n ? n + ' change' + (n === 1 ? '' : 's') + ' highlighted vs your résumé' : 'no line-level changes detected';
        });
      }
      var diffOn = true;                       // ON by default so changes are obvious
      diffBtn.onclick = function () { diffOn = !diffOn; setDiff(diffOn); };
      setDiff(true);
    }
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
            if (!nid) { retry.disabled = false; retry.textContent = 'Retry generation'; toastMsg('Couldn\'t restart — try again in a moment.', 'error'); return; }
            it.id = nid; it.status = 'running'; it.error = null;   // re-run in place; poll the new job
            renderItemInto(it, container);
          }).catch(function () { retry.disabled = false; retry.textContent = 'Retry generation'; toastMsg('Couldn\'t restart — try again in a moment.', 'error'); });
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
    var lj = { id: 'lib-' + g.key, title: g.role || g.company, role: g.role || '', company: g.company || '', url: url, mono: initials(g.company), color: colorFor(g.company), domain: logoDomainFor(g.company, url), loc: '', work: '', fit: '', why: '', open: true };
    setCurrentJob(lj);
    location.href = jobHref('job-detail.html', lj);
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
      if (!order.length) { root.innerHTML = '<div style="font:14px system-ui;color:#8a8172;padding:20px 0">No generated content yet. Generate a tailored CV, cover letter, evaluation, or networking plan (from Tailoring, a job, or Outreach) and it appears here — even while still running.</div>'; return; }
      // ── TYPE-FIRST sections: Tailored → Networking → the rest → Evaluations ──
      var SECTIONS = [
        { key: 'tailored', label: 'Tailored content', match: function (t) { return t === 'tailor'; } },
        { key: 'networking', label: 'Networking plans', match: function (t) { return t === 'networking'; } },
        { key: 'rest', label: 'Cover letters & more', match: function (t) { return t !== 'tailor' && t !== 'networking' && t !== 'evaluate'; } },
        { key: 'evaluations', label: 'Saved evaluations', match: function (t) { return t === 'evaluate'; } }
      ];
      function typeAccordions(g, k, matchFn) {
        var arts = g.items.filter(function (it) { return matchFn(it.type); });
        if (!arts.length) return '';
        var byType = {}, torder = [];
        arts.forEach(function (it) { if (!byType[it.type]) { byType[it.type] = []; torder.push(it.type); } byType[it.type].push(it); });
        return torder.map(function (t) {
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
        }).join('');
      }
      function jobCard(k, matchFn) {
        var g = groups[k];
        var accs = typeAccordions(g, k, matchFn);
        if (!accs) return '';
        var jdates = g.items.map(function (i) { return i.created; }).filter(Boolean).sort();
        var when = jdates.length ? new Date(jdates[jdates.length - 1]).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
        var hasUrl = g.items.some(function (i) { return i.url; });
        var libFit = null; g.items.forEach(function (i) { if (!libFit && i.url) { var f = fitFor(i.url); if (f && typeof f.score === 'number') libFit = f; } });
        return '<div class="lib-job" data-search="' + esc(((g.company || '') + ' ' + (g.role || '')).toLowerCase()) + '" style="' + CARD + ';padding:0;margin-bottom:12px;overflow:hidden">' +
          '<div style="padding:14px 18px 10px;border-bottom:1px solid #f3eee1;display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">' +
          '<div style="flex:1;min-width:0"><div style="font-family:var(--serif,\'Iowan Old Style\',Georgia,serif);font-weight:600;font-size:16px;color:#16324F">' + esc(g.company) + (g.role ? ' <span style="color:#8a8172;font-weight:500">— ' + esc(g.role) + '</span>' : '') + '</div>' +
          '<div style="font:12px system-ui;color:#8a8172;margin-top:2px">' + (when ? esc(when) : '') + '</div></div>' +
          (libFit ? '<div style="flex:none;display:flex;align-items:center;gap:8px;padding-top:1px" title="AI fit"><span style="font-family:var(--serif,Georgia);font-weight:600;font-size:18px;color:#16324F">' + libFit.score + '<span style="font-size:11px;color:#8a8172">/100</span></span>' + (libFit.verdict ? verdictPill(libFit.verdict) : '') + '</div>' : '') +
          '<a class="lib-detail-link" data-key="' + esc(k) + '" href="job-detail.html" style="flex:none;font:600 12.5px system-ui;color:#2f6f5b;text-decoration:none;white-space:nowrap;padding-top:2px">View job detail →</a>' +
          '</div><div style="padding:8px 18px 12px">' + accs + '</div></div>';
      }
      var jump = '<div id="libJump" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px"><span style="font:700 10.5px system-ui;letter-spacing:.05em;text-transform:uppercase;color:#b0a790;margin-right:2px">Jump to:</span>' +
        SECTIONS.map(function (s) { return '<a href="#libsec-' + s.key + '" class="lib-jump" data-sec="' + s.key + '" style="font:600 12.5px system-ui;color:#2f6f5b;text-decoration:none;padding:4px 10px;border:1px solid #e6ddc9;border-radius:999px;background:#fff">' + esc(s.label) + '</a>'; }).join('') + '</div>';
      var search = '<div style="margin:0 0 14px"><input id="libSearch" type="search" autocomplete="off" placeholder="Search your generated content by company, role, or type…" style="width:100%;max-width:520px;box-sizing:border-box;padding:9px 12px;border:1px solid #d8cdb8;border-radius:10px;font:13.5px system-ui"></div>';
      var sectionsHtml = SECTIONS.map(function (sec) {
        var cards = order.map(function (k) { return jobCard(k, sec.match); }).filter(Boolean).join('');
        var n = (cards.match(/class="lib-job"/g) || []).length;
        var bodyHtml = cards || '<div class="lib-empty" style="font:13px system-ui;color:#b0a790;padding:6px 2px 10px">Nothing here yet.</div>';
        return '<section class="lib-section" id="libsec-' + sec.key + '" data-sec="' + sec.key + '" style="margin-bottom:18px;scroll-margin-top:14px">' +
          '<button class="lib-sec-head" type="button" aria-expanded="true" style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 4px;background:none;border:none;border-bottom:2px solid #ece5d6;cursor:pointer;text-align:left">' +
          '<span class="lib-sec-chev" style="display:inline-block;transition:transform .18s;color:#b0a790;font-size:12px;transform:rotate(90deg)">▶</span>' +
          '<span style="flex:1;font-family:var(--serif,\'Iowan Old Style\',Georgia,serif);font-weight:600;font-size:18px;color:#16324F">' + esc(sec.label) + '</span>' +
          '<span class="lib-sec-count" style="font:600 12px system-ui;color:#b0a790">' + n + '</span></button>' +
          '<div class="lib-sec-body" style="padding-top:12px">' + bodyHtml + '</div></section>';
      }).join('');
      root.innerHTML = search + jump + sectionsHtml;

      // Section collapse/expand
      root.querySelectorAll('.lib-sec-head').forEach(function (h) {
        var body = h.nextElementSibling, chev = h.querySelector('.lib-sec-chev');
        h.onclick = function () { var open = body.style.display !== 'none'; body.style.display = open ? 'none' : ''; h.setAttribute('aria-expanded', String(!open)); chev.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)'; };
      });
      // Jump-nav smooth scroll
      root.querySelectorAll('.lib-jump').forEach(function (a2) { a2.onclick = function (e) { e.preventDefault(); var t = document.getElementById('libsec-' + a2.getAttribute('data-sec')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
      // Live search filter — hide non-matching job cards, keep section headers.
      var searchEl = root.querySelector('#libSearch');
      if (searchEl) searchEl.addEventListener('input', function () {
        var q = this.value.trim().toLowerCase();
        root.querySelectorAll('.lib-section').forEach(function (sec) {
          var secLabel = (sec.getAttribute('data-sec') || '');
          var shown = 0;
          sec.querySelectorAll('.lib-job').forEach(function (card) {
            var hay = (card.getAttribute('data-search') || '') + ' ' + secLabel;
            var hit = !q || hay.indexOf(q) >= 0;
            card.style.display = hit ? '' : 'none'; if (hit) shown++;
          });
          var empty = sec.querySelector('.lib-empty'); if (empty) empty.style.display = q ? 'none' : '';
        });
      });

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

      // Deep-link: library.html?type=<tailor|networking|cover|evaluate> → jump to that section.
      var qType = (location.search.match(/[?&]type=([^&]+)/) || [])[1];
      if (qType) {
        qType = decodeURIComponent(qType);
        var secKey = qType === 'tailor' ? 'tailored' : (qType === 'networking' ? 'networking' : (qType === 'evaluate' ? 'evaluations' : 'rest'));
        var secEl = document.getElementById('libsec-' + secKey);
        if (secEl) setTimeout(function () { secEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
      }
      // Deep-link: library.html?job=<artifact-id OR job slug> → expand + select.
      var qJob = (location.search.match(/[?&]job=([^&]+)/) || [])[1];
      if (qJob) {
        qJob = decodeURIComponent(qJob);
        var matched = order.some(function (k) {
          return groups[k].items.some(function (it) {
            if (it.kind === 'job' && it.id === qJob) {
              var entry = accIndex[k + '||' + it.type];
              if (entry) { var c = entry.expand(); if (c && c.versionOf) { var vi = c.versionOf(qJob); if (vi >= 0) c.show(vi); } setTimeout(function () { entry.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60); }
              return true;
            }
            return false;
          });
        });
        // Fallback: treat qJob as a company-role slug → expand that job's first artifact.
        if (!matched) {
          var base = String(qJob).replace(/-\d+$/, '');
          order.some(function (k) {
            var g = groups[k];
            if ((kebab(g.company || '') + '-' + kebab(g.role || '')) === base) {
              var it0 = g.items[0]; var entry = it0 && accIndex[k + '||' + it0.type];
              if (entry) { entry.expand(); setTimeout(function () { entry.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60); }
              return true;
            }
            return false;
          });
        }
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
    banner('Library — organized into typed sections (Tailored content · Networking plans · Cover letters & more · Saved evaluations) with a jump-nav, collapsible headers, and a live search filter. Within each section, jobs list their artifacts as accordions (versions, per-section Copy/Edit/downloads); slug deep-links + View job detail still work.');
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
      .then(function (r) { var ok = r.body && r.body.jobId; toastMsg(ok ? 'Retrying…' : 'Couldn\'t retry — try again in a moment.', ok ? 'info' : 'error'); });
  }
  function cancelJob(id, cb) {
    jPost('/api/compass/jobs/' + id + '/cancel', {}).then(function (r) { toastMsg(r.body && r.body.ok ? 'Task cancelled' : 'Cancel failed', r.body && r.body.ok ? 'success' : 'error'); if (cb) cb(r); });
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
  // Compact "Aug 27, 8:04 AM" stamp — date + time together, since task rows can
  // span multiple days (queued overnight, recently-finished from yesterday).
  function fmtTaskStamp(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
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
      var startedStr = fmtTaskStamp(startTs);
      var acts = '';
      if (j.status === 'running' || j.status === 'queued') acts = '<button class="btn btn--outline btn--sm task-cancel" data-id="' + j.id + '" type="button" style="font-size:12px">Cancel</button>';
      else if (j.status === 'done') acts = '<a class="btn btn--outline btn--sm" href="library.html?job=' + encodeURIComponent(j.id) + '" style="font-size:12px">View</a>';
      else if (j.status === 'error') acts = '<button class="btn btn--primary btn--sm task-retry" data-id="' + j.id + '" type="button" style="font-size:12px">Retry</button>';
      else if (j.status === 'cancelled') acts = '<button class="btn btn--outline btn--sm task-retry" data-id="' + j.id + '" type="button" style="font-size:12px">Re-run</button>';
      return '<div style="display:flex;align-items:center;gap:14px;padding:13px 4px;border-bottom:1px solid #f0ead9">' +
        '<div style="flex:1.4;min-width:0"><div style="font-weight:600;color:#16324F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(j.company || '(unknown)') + (j.role ? ' <span style="color:#8a8172;font-weight:500">· ' + esc(j.role) + '</span>' : '') + '</div><div style="font:12px system-ui;color:#8a8172">' + esc(DOC_LABEL[j.type] || j.type) + '</div></div>' +
        '<div style="flex:0 0 92px">' + pill + '</div>' +
        '<div style="flex:1;font:12px system-ui;color:#8a8172;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + pm + '</div>' +
        '<div style="flex:0 0 172px;font:12px system-ui;color:#8a8172;white-space:nowrap">' + startedStr + ' · ' + elapsed + '</div>' +
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
  Promise.all([loadDead(), loadProvider(), loadFit(), loadSalary(), loadPosted(), loadBookmarks(), loadReviews(), loadTips()]).then(function () {
    renderNav();
    injectMangoChrome();
    injectActivity();
    wireAvatarMenu();
    initTooltips();
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
