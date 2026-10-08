// VibeyCursor Phase-1 evidence extractors (Section Intelligence V2).
// Read-only, metadata-oriented, fail-safe. Every extractor degrades to
// UNKNOWN rather than inventing values, and never aborts the capture.
// Budgets: ~1500 nodes / ~800ms per dossier; callers abort on overrun.
//
// Confidence vocabulary (per property):
//   DETECTED — observed directly (loaded face, rendered style, loaded image)
//   MEASURED — computed from layout/style APIs (rects, z-index, shadows)
//   INFERRED — derived heuristically (provider from hostname, fallback stack)
//   UNKNOWN  — could not be established (fail-safe default)
(function () {
  var DC_NODE_BUDGET = 1500;
  var DC_TIME_BUDGET_MS = 800;
  var DC_MAX_ASSET_ELS = 80;
  var DC_MAX_PROBES = 20;

  function dcTimer() {
    return { t0: Date.now(), nodes: 0 };
  }

  function dcWithin(timer, n) {
    timer.nodes += (n || 1);
    if (timer.nodes > DC_NODE_BUDGET) return false;
    if (Date.now() - timer.t0 > DC_TIME_BUDGET_MS) return false;
    return true;
  }

  function dcEsc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function shortStr(s, max) {
    s = String(s === null || s === undefined ? '' : s);
    return s.length > max ? s.slice(0, max) : s;
  }

  // ---- 1. Pseudo-elements (::before / ::after) ----
  // Only records observable decorations. A pseudo box exists only when
  // `content` is meaningful (including empty-string decorative shapes);
  // `content:none/normal` generates no box, so box size alone is NEVER
  // treated as evidence (resolved styles can mirror the host element).
  function dcPseudo(el) {
    var out = [];
    try {
      if (!el || typeof getComputedStyle !== 'function') return out;
      var pseudos = ['::before', '::after'];
      for (var i = 0; i < pseudos.length; i++) {
        try {
          var cs = getComputedStyle(el, pseudos[i]);
          if (!cs) continue;
          var content = cs.content;
          if (!content || content === 'none' || content === 'normal') continue;
          out.push({
            pseudo: pseudos[i],
            confidence: 'MEASURED',
            content: shortStr(content, 120),
            width: cs.width, height: cs.height,
            backgroundColor: cs.backgroundColor,
            border: cs.border, borderRadius: cs.borderRadius,
            color: cs.color, fontSize: cs.fontSize,
          });
        } catch (e) { /* one pseudo failing never blocks the other */ }
      }
    } catch (e) { /* fail-safe: no pseudo evidence */ }
    return out;
  }

  // ---- 2. Stacking information ----
  function dcStacking(el) {
    try {
      if (!el || typeof getComputedStyle !== 'function') return { confidence: 'UNKNOWN' };
      var cs = getComputedStyle(el);
      var out = { position: cs.position, confidence: 'MEASURED' };
      if (cs.zIndex && cs.zIndex !== 'auto') {
        out.zIndex = cs.zIndex;
        var zi = parseInt(cs.zIndex, 10);
        if (!isNaN(zi) && zi < 0) out.negativeZ = true;
      }
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        out.pinned = cs.position;
        out.confidence = 'DETECTED';
      }
      return out;
    } catch (e) {
      return { confidence: 'UNKNOWN' };
    }
  }

  function absolutize(u) {
    try {
      var s = String(u || '').trim();
      if (!s || s.indexOf('data:') === 0) return { url: s, sameOrigin: true, inline: s.indexOf('data:') === 0 };
      var abs = new URL(s, location.href).href;
      var same = false;
      try { same = new URL(abs).host === location.host; } catch (e) { same = false; }
      return { url: abs, sameOrigin: same, inline: false };
    } catch (e) {
      return { url: shortStr(u, 300), sameOrigin: false, inline: false, confidence: 'UNKNOWN' };
    }
  }

  function firstSrcset(srcset) {
    try {
      var s = String(srcset || '').split(',')[0] || '';
      return s.trim().split(/\s+/)[0] || '';
    } catch (e) { return ''; }
  }

  // ---- 3. Asset inventory (references only — never downloads blobs) ----
  function dcAssets(root) {
    var res = { items: [], truncated: false, confidence: 'MEASURED' };
    var timer = dcTimer();
    try {
      if (!root) return res;
      var all = [];
      try {
        all = root.querySelectorAll ? Array.from(root.querySelectorAll('img,video,source,svg,use')) : [];
      } catch (e) { all = []; }
      if (all.length > DC_MAX_ASSET_ELS - 1) res.truncated = true;
      var els = [root].concat(all.slice(0, DC_MAX_ASSET_ELS - 1));
      for (var i = 0; i < els.length; i++) {
        if (!dcWithin(timer, 1)) { res.truncated = true; break; }
        var n = els[i];
        try {
          var t = (n.tagName || '').toLowerCase();
          if (t === 'input' && n.type !== 'image') continue; // never touch form values
          if (t === 'img') {
            var u = n.currentSrc || n.src || firstSrcset(n.srcset) || '';
            if (!u && !(n.alt || n.getAttribute)) continue;
            var r = absolutize(u || '');
            res.items.push({
              kind: 'image', url: r.url || null, alt: shortStr(n.alt || '', 120),
              width: n.naturalWidth || null, height: n.naturalHeight || null,
              sameOrigin: !!r.sameOrigin, accessible: r.inline ? true : 'UNKNOWN',
              confidence: r.inline ? 'DETECTED' : 'MEASURED',
            });
          } else if (t === 'video') {
            var src = n.currentSrc || n.src || '';
            var rr = absolutize(src);
            res.items.push({
              kind: 'video', url: rr.url || null, poster: shortStr(n.poster || '', 300),
              sameOrigin: !!rr.sameOrigin, accessible: 'UNKNOWN', confidence: 'MEASURED',
            });
          } else if (t === 'source') {
            var ptag = '';
            try { ptag = (n.parentNode && n.parentNode.tagName ? n.parentNode.tagName : '').toLowerCase(); } catch (e) {}
            var su = n.src || firstSrcset(n.srcset) || '';
            if (!su) continue;
            var sr = absolutize(su);
            res.items.push({
              kind: ptag === 'video' ? 'video-source' : 'source',
              url: sr.url || null, sameOrigin: !!sr.sameOrigin,
              accessible: 'UNKNOWN', confidence: 'MEASURED',
            });
          } else if (t === 'svg') {
            var kids = 0;
            try { kids = n.querySelectorAll ? n.querySelectorAll('*').length : 0; } catch (e) {}
            res.items.push({
              kind: 'svg-inline', url: null, childCount: kids,
              sameOrigin: true, accessible: true, confidence: 'DETECTED',
            });
          } else if (t === 'use') {
            var href = '';
            try { href = n.getAttribute('href') || n.getAttribute('xlink:href') || ''; } catch (e) {}
            res.items.push({
              kind: 'svg-use', url: shortStr(href, 300), sameOrigin: false,
              accessible: 'UNKNOWN', confidence: 'INFERRED',
            });
          }
          // Computed background images (any element, incl. root).
          try {
            var bg = getComputedStyle(n).backgroundImage;
            if (bg && bg !== 'none') {
              var m, re = /url\(["']?([^"')]+)["']?\)/g, found = 0;
              while ((m = re.exec(bg)) && found < 3) {
                found++;
                var br = absolutize(m[1]);
                res.items.push({
                  kind: 'background-image', url: br.url || null,
                  sameOrigin: !!br.sameOrigin, accessible: br.inline ? true : 'UNKNOWN',
                  confidence: br.inline ? 'DETECTED' : 'MEASURED',
                });
              }
            }
          } catch (e) { /* background probing is best-effort */ }
        } catch (e) { /* one node never sinks the inventory */ }
      }
      if (res.items.length === 0) res.confidence = 'MEASURED';
    } catch (e) {
      res.confidence = 'UNKNOWN';
    }
    return res;
  }

  // Resolvability probes: can the URL actually load here? Parallel, capped,
  // time-boxed. Unresolvable -> PLACEHOLDER REQUIRED (set by consumer).
  function dcResolveAssets(items, timeoutMs) {
    var list = Array.isArray(items) ? items.slice(0, DC_MAX_PROBES) : [];
    var budget = typeof timeoutMs === 'number' ? timeoutMs : 1500;
    function probe(item) {
      return new Promise(function (done) {
        try {
          if (!item.url || item.url.indexOf('http') !== 0) return done();
          var finished = false;
          var finish = function (ok) {
            if (finished) return;
            finished = true;
            try { clearTimeout(timer); } catch (e) {}
            item.accessible = !!ok;
            item.confidence = 'DETECTED';
            done();
          };
          var timer = setTimeout(function () { finish(false); }, Math.max(200, budget));
          var im = new Image();
          im.onload = function () { finish(true); };
          im.onerror = function () { finish(false); };
          im.src = item.url;
        } catch (e) {
          try { item.accessible = 'UNKNOWN'; } catch (e2) {}
          done();
        }
      });
    }
    return Promise.all(list.map(probe)).then(function () { return items; });
  }

  // ---- 4. Typography evidence ----
  function dcFonts(root) {
    var out = { stacks: [], faces: [], sources: [], confidence: 'MEASURED' };
    try {
      if (!root || typeof getComputedStyle !== 'function') {
        out.confidence = 'UNKNOWN';
        return out;
      }
      // (a) Computed stacks actually used in the subtree (sampled, capped).
      try {
        var seen = {};
        var scope = [root];
        try {
          scope = scope.concat(Array.from(root.querySelectorAll('h1,h2,h3,h4,p,button,a,span,li,label')).slice(0, 80));
        } catch (e) { /* root only */ }
        for (var i = 0; i < scope.length; i++) {
          try {
            var cs = getComputedStyle(scope[i]);
            var fam = cs.fontFamily || '';
            var w = cs.fontWeight || '';
            var st = cs.fontStyle || '';
            if (!fam) continue;
            var key = fam + '|' + w + '|' + st;
            if (seen[key]) continue;
            var verified = 'UNKNOWN';
            try {
              if (document.fonts && typeof document.fonts.check === 'function') {
                var probeFam = fam.split(',')[0].trim();
                verified = document.fonts.check(st + ' ' + w + ' 16px ' + probeFam) ? 'DETECTED' : 'INFERRED';
              }
            } catch (e) { verified = 'UNKNOWN'; }
            seen[key] = {
              stack: shortStr(fam, 200), weight: shortStr(w, 12), style: shortStr(st, 12),
              rendered: verified, confidence: verified === 'UNKNOWN' ? 'UNKNOWN' : 'MEASURED',
            };
          } catch (e) { /* one node never sinks the survey */ }
        }
        out.stacks = Object.keys(seen).map(function (k) { return seen[k]; }).slice(0, 20);
      } catch (e) { out.stacks = []; }
      // (b) Loaded faces (FontFaceSet): family/weight/style/status as observed.
      try {
        var faces = Array.from(document.fonts || []).slice(0, 40);
        out.faces = faces.map(function (f) {
          return {
            family: shortStr(f.family || '', 80),
            weight: shortStr(f.weight || '', 24),
            style: shortStr(f.style || '', 24),
            status: shortStr(f.status || 'unknown', 16),
            confidence: 'DETECTED',
          };
        });
      } catch (e) { out.faces = []; }
      // (c) @font-face sources, same-origin stylesheets only. Cross-origin
      // sheets throw on cssRules access — skipped safely (UNKNOWN by omission).
      try {
        var rules = [];
        var sheets = Array.from(document.styleSheets || []);
        for (var s = 0; s < sheets.length; s++) {
          var cssRules = null;
          try { cssRules = sheets[s].cssRules; } catch (e) { continue; }
          if (!cssRules) continue;
          for (var r = 0; r < cssRules.length; r++) {
            try {
              var rule = cssRules[r];
              if (!rule || rule.type !== 5) continue; // 5 === FONT_FACE_RULE
              var fam2 = String(rule.style.getPropertyValue('font-family') || '').replace(/["']/g, '').slice(0, 80);
              var src = String(rule.style.getPropertyValue('src') || '').slice(0, 300);
              var kind = 'unknown', source = 'UNKNOWN', conf = 'UNKNOWN';
              var urlM = src.match(/url\(["']?([^"')]+)["']?\)/);
              if (urlM) {
                kind = 'url';
                try {
                  var abs2 = new URL(urlM[1], location.href);
                  if (abs2.host === location.host) { source = 'self-hosted'; conf = 'DETECTED'; }
                  else { source = 'INFERRED:' + abs2.host; conf = 'INFERRED'; }
                } catch (e) { /* unresolvable URL stays UNKNOWN */ }
              } else if (/local\(/.test(src)) {
                kind = 'local'; source = 'system'; conf = 'DETECTED';
              }
              rules.push({
                family: fam2 || 'UNKNOWN',
                weight: shortStr(rule.style.getPropertyValue('font-weight') || '', 24),
                style: shortStr(rule.style.getPropertyValue('font-style') || '', 24),
                srcKind: kind, source: source, confidence: conf,
              });
              if (rules.length >= 30) break;
            } catch (e) { /* one rule never sinks the survey */ }
          }
          if (rules.length >= 30) break;
        }
        out.sources = rules;
      } catch (e) { out.sources = []; }
    } catch (e) {
      out.confidence = 'UNKNOWN';
    }
    return out;
  }

  // ---- Evidence appendix (compact text + HTML for the dossier) ----
  function dcAssetLine(a) {
    var access = a.accessible === true ? 'ACCESSIBLE'
      : (a.accessible === false ? 'PLACEHOLDER REQUIRED' : 'UNKNOWN');
    var base = '  [' + a.kind + '] ' + (a.url || '(inline)') + ' :: ' + access + ' [' + (a.confidence || 'UNKNOWN') + ']';
    if (a.alt) base += ' alt="' + a.alt + '"';
    return base;
  }

  function dcAppendixText(ev) {
    var L = ['9. EVIDENCE APPENDIX (Phase-1 extractors; confidence-tagged, never invented):'];
    try {
      var st = (ev && ev.stacking) || {};
      L.push('stacking: position=' + (st.position || 'UNKNOWN')
        + (st.zIndex ? ' z=' + st.zIndex : '')
        + (st.negativeZ ? ' (negative)' : '')
        + (st.pinned ? ' pinned=' + st.pinned : '')
        + ' [' + (st.confidence || 'UNKNOWN') + ']');
      var ps = (ev && ev.pseudo) || [];
      L.push('pseudo-elements (' + ps.length + ' observed):');
      ps.forEach(function (p) {
        L.push('  ' + p.pseudo + ' content=' + p.content + ' ' + p.width + 'x' + p.height
          + ' bg=' + p.backgroundColor + ' [' + p.confidence + ']');
      });
      var items = (ev && ev.assets && ev.assets.items) || [];
      L.push('assets (' + items.length + ((ev.assets && ev.assets.truncated) ? ', inventory capped' : '') + '):');
      items.forEach(function (a) { L.push(dcAssetLine(a)); });
      var f = (ev && ev.fonts) || {};
      L.push('typography stacks (' + (f.stacks || []).length + '):');
      (f.stacks || []).forEach(function (s) {
        L.push('  "' + s.stack + '" ' + s.weight + '/' + s.style + ' rendered=' + s.rendered + ' [' + s.confidence + ']');
      });
      L.push('loaded faces (' + (f.faces || []).length + '):');
      (f.faces || []).forEach(function (x) {
        L.push('  ' + x.family + ' ' + x.weight + '/' + x.style + ' status=' + x.status + ' [' + x.confidence + ']');
      });
      L.push('font sources (' + (f.sources || []).length + ', same-origin sheets only):');
      (f.sources || []).forEach(function (x) {
        L.push('  ' + x.family + ' ' + x.weight + '/' + x.style + ' ' + x.srcKind + ' -> ' + x.source + ' [' + x.confidence + ']');
      });
    } catch (e) { L.push('(appendix render failed — see JSON)'); }
    return L.join('\n');
  }

  function dcAppendixHtml(ev) {
    var text = dcAppendixText(ev);
    return '<h2>9. Evidence appendix (confidence-tagged)</h2>'
      + '<pre style="font:12px monospace;white-space:pre-wrap;">' + dcEsc(text) + '</pre>';
  }

  globalThis.VIBEY_DC = {
    dcPseudo: dcPseudo,
    dcStacking: dcStacking,
    dcAssets: dcAssets,
    dcResolveAssets: dcResolveAssets,
    dcFonts: dcFonts,
    dcAppendixText: dcAppendixText,
    dcAppendixHtml: dcAppendixHtml,
    DC_NODE_BUDGET: DC_NODE_BUDGET,
    DC_TIME_BUDGET_MS: DC_TIME_BUDGET_MS,
  };
})();
