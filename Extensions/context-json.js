// VibeyCursor Design Context JSON v1 (Section Intelligence, Phase 3).
// Canonical INTERMEDIATE representation: normalizes Phase-1 evidence and
// Phase-2 reference-frame data into one structured object. Normalization
// only — no new extraction, no DOM access, no network, no guessing.
//
// Rules:
// - Every interpreted value is wrapped {value, confidence} with confidence
//   in DETECTED | MEASURED | INFERRED | UNKNOWN.
// - UNKNOWN stays UNKNOWN (null value). Nothing is ever invented.
// - Use null, never undefined (JSON-serializable by construction).
// - Bounded output: tree node budget, array caps, hard char ceiling.
(function () {
  var DCJSON_VERSION = '1.0';
  var DCJSON_TREE_NODE_BUDGET = 1500;
  var DCJSON_MAX_CHARS = 400000;

  function cv(value, confidence) {
    var conf = (confidence === 'DETECTED' || confidence === 'MEASURED' || confidence === 'INFERRED')
      ? confidence : 'UNKNOWN';
    return { value: (value === undefined ? null : value), confidence: conf };
  }

  function str(v, max) {
    if (v === null || v === undefined) return null;
    var s = String(v);
    return s.length > (max || 300) ? s.slice(0, max || 300) : s;
  }

  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return Math.round(v);
    var n = parseFloat(v);
    return isFinite(n) ? Math.round(n) : null;
  }

  function rectOf(r) {
    r = r || {};
    return {
      x: num(r.x), y: num(r.y),
      width: num(r.width), height: num(r.height),
    };
  }

  // Deep-clone the section tree capped at a node budget. Returns
  // {tree, truncated, nodeCount}. styles shallow-copied as-is (already
  // bounded strings from the extractor).
  function pruneTree(node, maxNodes) {
    var budget = (typeof maxNodes === 'number' && maxNodes > 0) ? maxNodes : DCJSON_TREE_NODE_BUDGET;
    var state = { count: 0, truncated: false };
    function walk(n) {
      if (!n || typeof n !== 'object') return null;
      state.count++;
      if (state.count > budget) { state.truncated = true; return null; }
      var kids = Array.isArray(n.children) ? n.children : [];
      var out = {
        tag: str(n.tag, 32) || 'unknown',
        classes: Array.isArray(n.classes) ? n.classes.slice(0, 10) : [],
        text: str(n.text, 200),
        styles: (n.styles && typeof n.styles === 'object') ? n.styles : {},
        truncated: n.truncated ? str(n.truncated, 64) : null,
        children: [],
      };
      if (n.truncated) state.truncated = true;
      for (var i = 0; i < kids.length; i++) {
        if (state.count >= budget) { state.truncated = true; break; }
        var c = walk(kids[i]);
        if (c) out.children.push(c);
        else if (state.truncated) break;
      }
      return out;
    }
    var tree = walk(node);
    return { tree: tree, truncated: state.truncated, nodeCount: state.count };
  }

  function mapAsset(a, index) {
    a = a || {};
    var accessible = a.accessible;
    var status = accessible === true ? 'ACCESSIBLE'
      : (accessible === false ? 'PLACEHOLDER REQUIRED' : 'UNKNOWN');
    return {
      id: 'a-' + index,
      kind: str(a.kind, 32) || 'unknown',
      url: str(a.url, 500),
      alt: str(a.alt, 120),
      width: num(a.width), height: num(a.height),
      childCount: num(a.childCount),
      sameOrigin: (a.sameOrigin === true),
      accessible: accessible === true,
      status: status,
      confidence: (a.confidence === 'DETECTED' || a.confidence === 'MEASURED' || a.confidence === 'INFERRED')
        ? a.confidence : 'UNKNOWN',
    };
  }

  // input: plain data assembled by the caller (content.js) from Phase-1/2
  // structures. Missing sections degrade to null/[] — never throw.
  function buildDesignContext(input) {
    try {
      input = input || {};
      var vp = input.viewport || {};
      var rf = input.referenceFrame || {};
      var clicked = input.clicked || {};
      var cstyles = clicked.styles || {};
      var ev = input.evidence || {};
      var fonts = ev.fonts || {};
      var limitations = [];

      var pruned = pruneTree(input.tree || null, DCJSON_TREE_NODE_BUDGET);
      if (pruned.truncated) limitations.push('section-tree capped (depth/children/node budget reached)');
      if (ev.assets && ev.assets.truncated) limitations.push('asset inventory capped');
      if ((rf.method || 'unknown') !== 'native') {
        limitations.push(rf.method === 'unknown'
          ? 'no reference pixels captured'
          : 'reference pixels are DOM reconstruction, not native');
      }
      limitations.push('filter/backdrop-filter/gradient decomposition not extracted in v1');
      limitations.push('element children not expanded in v1');

      var sx = num(clicked.rectX);
      var sy = num(clicked.rectY);
      var scrollX = num(vp.scrollX);
      var scrollY = num(vp.scrollY);

      var elements = [];
      try {
        var src = Array.isArray(input.elements) ? input.elements.slice(0, 12) : [];
        for (var i = 0; i < src.length; i++) {
          var e = src[i] || {};
          var d = e.data || {};
          var ds = d.styles || {};
          var er = d.rect || {};
          elements.push({
            id: 'el-' + (i + 1),
            parent: 'el-0',
            tag: str(e.tag || d.tag, 32) || 'unknown',
            classification: str(e.classification, 32) || 'unknown',
            role: str((d.attributes && d.attributes.role) || null, 64),
            bounds: {
              page: rectOf({ x: er.x, y: er.y, width: er.width, height: er.height }),
              sectionRelative: (sx !== null && sy !== null && er.x !== undefined)
                ? rectOf({ x: er.x - sx, y: er.y - sy, width: er.width, height: er.height })
                : { x: null, y: null, width: num(er.width), height: num(er.height) },
            },
            text: str(d.text, 200),
            typography: {
              stack: str(ds.fontFamily, 200),
              size: str(ds.fontSize, 16),
              weight: str(ds.fontWeight, 12),
              lineHeight: str(ds.lineHeight, 16),
              letterSpacing: str(ds.letterSpacing, 16),
              transform: str(ds.textTransform, 16),
              align: str(ds.textAlign, 16),
              color: str(ds.color, 64),
            },
            visual: {
              background: str(ds.backgroundColor, 64),
              backgroundImage: str(ds.backgroundImage, 300),
              border: str(ds.border, 200),
              radius: str(ds.borderRadius, 64),
              shadow: str(ds.boxShadow, 300),
              opacity: str(ds.opacity, 16),
            },
            layout: {
              display: str(ds.display, 32),
              position: str(ds.position, 32),
              padding: str(ds.padding, 120),
              margin: str(ds.margin, 120),
            },
            childCount: num(d.childCount),
            children: [],
            confidence: 'MEASURED',
          });
        }
      } catch (e) { elements = []; }

      var assets = [];
      try {
        var alist = (ev.assets && Array.isArray(ev.assets.items)) ? ev.assets.items.slice(0, 40) : [];
        for (var a = 0; a < alist.length; a++) assets.push(mapAsset(alist[a], a));
      } catch (e) { assets = []; }

      var pseudo = [];
      try {
        var plist = Array.isArray(ev.pseudo) ? ev.pseudo.slice(0, 12) : [];
        for (var p = 0; p < plist.length; p++) {
          var q = plist[p] || {};
          pseudo.push({
            target: 'el-0',
            pseudo: str(q.pseudo, 16),
            content: str(q.content, 120),
            box: { width: str(q.width, 16), height: str(q.height, 16) },
            background: str(q.backgroundColor, 64),
            confidence: q.confidence === 'MEASURED' ? 'MEASURED' : 'UNKNOWN',
          });
        }
      } catch (e) { pseudo = []; }

      var colors = [];
      var backgrounds = [];
      var borders = [];
      var radii = [];
      var shadows = [];
      try {
        // Raw palette re-derived from the passed style pool (clicked element
        // styles + key-element styles supplied by the caller).
        var rawPool = Array.isArray(input.stylePool) ? input.stylePool.slice(0, 20) : [];
        var all = [cstyles].concat(rawPool);
        var cset = {}, bset = {}, rset = {}, sset = {};
        for (var s2 = 0; s2 < all.length; s2++) {
          var st = all[s2] || {};
          if (st.backgroundColor) bset[st.backgroundColor] = true;
          if (st.color) cset[st.color] = true;
          if (st.backgroundImage) backgrounds.push(str(st.backgroundImage, 300));
          if (st.border) borders.push(str(st.border, 200));
          if (st.borderRadius) rset[st.borderRadius] = true;
          if (st.boxShadow) sset[st.boxShadow] = true;
        }
        colors = Object.keys(cset).slice(0, 20).map(function (c) { return cv(c, 'MEASURED'); });
        backgrounds = backgrounds.slice(0, 10).map(function (c) { return cv(c, 'MEASURED'); });
        borders = borders.slice(0, 10).map(function (c) { return cv(c, 'MEASURED'); });
        radii = Object.keys(rset).slice(0, 10).map(function (c) { return cv(c, 'MEASURED'); });
        shadows = Object.keys(sset).slice(0, 10).map(function (c) { return cv(c, 'MEASURED'); });
      } catch (e) { colors = []; backgrounds = []; borders = []; radii = []; shadows = []; }

      var doc = {
        version: DCJSON_VERSION,
        capture: {
          type: 'section',
          timestamp: (typeof input.timestamp === 'number' ? input.timestamp : Date.now()),
          source: 'browser',
        },
        viewport: {
          width: num(vp.width), height: num(vp.height),
          devicePixelRatio: (typeof vp.dpr === 'number' && isFinite(vp.dpr)) ? vp.dpr : null,
        },
        referenceFrame: {
          method: (rf.method === 'native' || rf.method === 'fallback') ? rf.method : 'unknown',
          frameWidth: num(rf.frameWidth), frameHeight: num(rf.frameHeight),
          scroll: { x: scrollX, y: scrollY },
          sectionBounds: rectOf(rf.sectionBounds),
          cropBounds: rf.cropBounds ? rectOf(rf.cropBounds) : null,
          captureMs: num(rf.captureMs),
        },
        section: {
          tag: str(input.tag, 32) || 'unknown',
          role: str(input.role, 64),
          classification: 'section',
          bounds: {
            page: rectOf({
              x: (sx !== null && scrollX !== null) ? sx + scrollX : null,
              y: (sy !== null && scrollY !== null) ? sy + scrollY : null,
              width: num(clicked.rectW), height: num(clicked.rectH),
            }),
            viewport: rectOf({ x: sx, y: sy, width: num(clicked.rectW), height: num(clicked.rectH) }),
          },
          childCount: num(input.childCount),
          truncated: !!pruned.truncated,
        },
        layout: {
          display: str(cstyles.display, 32),
          position: str(cstyles.position, 32),
          width: str(cstyles.width, 32),
          height: str(cstyles.height, 32),
          spacing: {
            padding: str(cstyles.padding, 120),
            margin: str(cstyles.margin, 120),
            gap: str(cstyles.gap, 64),
          },
          alignment: {
            flexDirection: str(cstyles.flexDirection, 32),
            justifyContent: str(cstyles.justifyContent, 64),
            alignItems: str(cstyles.alignItems, 64),
          },
        },
        typography: {
          stacks: Array.isArray(fonts.stacks) ? fonts.stacks.slice(0, 20) : [],
          faces: Array.isArray(fonts.faces) ? fonts.faces.slice(0, 40) : [],
          sources: Array.isArray(fonts.sources) ? fonts.sources.slice(0, 30) : [],
        },
        visual: {
          colors: colors,
          backgrounds: backgrounds,
          borders: borders,
          radii: radii,
          shadows: shadows,
          effects: [],
        },
        assets: assets,
        pseudoElements: pseudo,
        stacking: (ev.stacking && typeof ev.stacking === 'object') ? ev.stacking : { confidence: 'UNKNOWN' },
        elements: elements,
        tree: pruned.tree,
        evidence: {
          treeTruncated: !!pruned.truncated,
          treeNodeCount: pruned.nodeCount,
          limitations: limitations,
        },
      };
      return doc;
    } catch (e) {
      return { version: DCJSON_VERSION, error: 'build-failed', evidence: { limitations: ['context build failed'] } };
    }
  }

  function measureJson(doc) {
    try {
      var s = JSON.stringify(doc);
      return { chars: s.length, kb: Math.round(s.length / 102.4) / 10, withinBudget: s.length <= DCJSON_MAX_CHARS };
    } catch (e) {
      return { chars: -1, kb: -1, withinBudget: false };
    }
  }

  globalThis.VIBEY_CTXJSON = {
    buildDesignContext: buildDesignContext,
    pruneTree: pruneTree,
    measureJson: measureJson,
    cv: cv,
    VERSION: DCJSON_VERSION,
    MAX_CHARS: DCJSON_MAX_CHARS,
  };
})();
