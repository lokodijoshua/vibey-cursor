function createEl(tag, id) {
  const el = document.createElement(tag);
  if (id) el.id = id;
  return el;
}

function showBadge(rect, text) {
  try {
    if (typeof vcUIVisible !== 'undefined' && !vcUIVisible) return;
  } catch (e) { /* visible by default */ }
  let badge = document.getElementById('vc-badge');
  if (!badge) {
    badge = createEl('div', 'vc-badge');
    document.documentElement.appendChild(badge);
  }
  badge.textContent = text;
  badge.style.display = 'block';
  const top = Math.max((rect.top || window.innerHeight - 100) - 40, 10);
  const left = Math.max((rect.left || window.innerWidth - 300), 10);
  badge.style.top = top + 'px';
  badge.style.left = left + 'px';
  clearTimeout(showBadge._t);
  showBadge._t = setTimeout(() => { badge.style.display = 'none'; }, 1400);
}

function showUpgradeToast(message) {
  const siteUrl = (globalThis.VIBEY_CONFIG && globalThis.VIBEY_CONFIG.SITE_URL) || 'https://vibey-cursor-landing-page.vercel.app';
  vcTrack('upsell_shown', { source: 'upgrade-toast' });
  showBadge(
    { top: window.innerHeight - 100, left: window.innerWidth - 300 },
    `${message} — upgrade at ${siteUrl}`
  );
}

async function getLicenseKey() {
  const { licenseKey } = await chrome.storage.local.get('licenseKey');
  return licenseKey || null;
}

function backendUrl() {
  return (globalThis.VIBEY_CONFIG && globalThis.VIBEY_CONFIG.BACKEND_URL) || 'https://vibey-cursor-backendv2.vercel.app';
}

// Behavior analytics helper (fire-and-forget; never blocks product).
// Sends metadata only: element type, dimensions, counts. Never text
// content, input values, or raw URLs (hostname only).
function vcTrack(event, props) {
  try {
    if (globalThis.VIBEY_ANALYTICS && globalThis.VIBEY_ANALYTICS.track) {
      globalThis.VIBEY_ANALYTICS.track(event, props || {});
    }
  } catch (e) { /* analytics must never break product */ }
}

// Icon helper (single SVG language from icons.js; empty string if missing).
function vcIcon(name) {
  try {
    if (typeof vibeyIcon === 'function') return vibeyIcon(name);
    if (globalThis.vibeyIcon) return globalThis.vibeyIcon(name);
  } catch (e) { /* icons are decorative */ }
  return '';
}

// Fire-and-forget runtime message. Promise rejections (extension
// reloading, no receiving end) are swallowed — never unhandled errors.
function vcSend(msg) {
  try {
    const p = chrome.runtime.sendMessage(msg);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) { /* messaging is best-effort */ }
}

function vcElementMeta(el, extra) {
  const out = Object.assign({}, extra);
  try {
    const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    out.viewport_w = vw;
    out.viewport_h = vh;
    if (rect) {
      out.el_w = Math.round(rect.width);
      out.el_h = Math.round(rect.height);
      if (vw > 0 && vh > 0) {
        out.norm_x = Math.min(1, Math.max(0, (rect.left + rect.width / 2) / vw));
        out.norm_y = Math.min(1, Math.max(0, (rect.top + rect.height / 2) / vh));
      }
    }
    try {
      out.hostname = location.hostname ? location.hostname.slice(0, 128) : undefined;
    } catch (e) { /* ignore */ }
  } catch (e) { /* metadata is best-effort */ }
  return out;
}

// UI-visibility state for the Ctrl+Shift+H toggle. Visibility only —
// never touches inspectorEnabled, license, history, or session state.
let vcUIVisible = true;
// Activation self-heal bookkeeping (see fetchEntitlements).
let vcEntHealTried = false;
let vcEntHealResult = null;

// Ask the server whether another capture is allowed right now.
// Sends installation id always, license key when present — the server
// decides the tier. Fails OPEN for network errors (offline captures
// proceed); authoritative denies (429/503 shapes) are honored.
async function checkQuota() {
  try {
    const { licenseKey } = await chrome.storage.local.get('licenseKey');
    const res = await fetch(`${backendUrl()}/api/usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(licenseKey ? { licenseKey } : {}),
        installationId: await getInstallationId(),
      })
    });
    if (!res.ok && res.status !== 429) return { allowed: true };
    const quota = await res.json();
    if (quota && typeof quota.remaining === 'number') {
      try { await chrome.storage.local.set({ vcQuota: { remaining: quota.remaining, limit: quota.limit || null } }); } catch (e) {}
    }
    return quota.allowed === false ? quota : { allowed: true, ...quota };
  } catch (e) {
    return { allowed: true };
  }
}

function showLimitPopup(quota) {
  let pop = document.getElementById('vc-limit-popup');
  if (!pop) {
    pop = createEl('div', 'vc-limit-popup');
    document.documentElement.appendChild(pop);
  }
  const siteUrl = (globalThis.VIBEY_CONFIG && globalThis.VIBEY_CONFIG.SITE_URL) || 'https://vibey-cursor-landing-page.vercel.app';
  const proLimit = (quota.limit || 20) > 20;
  const title = proLimit ? 'Daily Pro limit reached' : 'Daily free limit reached';
  const waitText = quota.retry_after_seconds
    ? `Try again in about ${Math.max(1, Math.round(quota.retry_after_seconds / 60))} min.`
    : 'Resets in 24 hours.';
  const sub = `You've used all ${quota.limit || 20} ${proLimit ? 'Pro' : 'free'} captures. ${waitText}`;
  pop.innerHTML = `
    <div class="vc-limit-title">${title}</div>
    <div class="vc-limit-sub">${sub}</div>
    ${proLimit ? '' : '<button id="vc-limit-upgrade">Upgrade to Pro</button>'}
    <button id="vc-limit-close">Maybe later</button>
  `;
  pop.style.display = 'block';
  const upBtn = pop.querySelector('#vc-limit-upgrade');
  if (upBtn) {
    upBtn.onclick = () => {
      vcTrack('upsell_clicked', { source: 'limit-popup' });
      window.open(`${siteUrl}/pricing.html`, '_blank');
      pop.style.display = 'none';
    };
  }
  pop.querySelector('#vc-limit-close').onclick = () => {
    pop.style.display = 'none';
  };
  vcTrack('upsell_shown', { source: quota && quota.limit > 20 ? 'limit-pro' : 'limit-free' });
  clearTimeout(showLimitPopup._t);
  showLimitPopup._t = setTimeout(() => { pop.style.display = 'none'; }, 8000);
}

function extractElementData(el) {
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const attrs = {};
  try {
    for (const name of ['id', 'role', 'type', 'href', 'placeholder', 'alt', 'title', 'aria-label', 'target', 'value']) {
      const v = el.getAttribute && el.getAttribute(name);
      if (v !== null && v !== undefined && String(v).length > 0 && String(v).length <= 200) attrs[name] = String(v);
    }
  } catch (e) { /* attributes are best-effort */ }
  // Direct-children outline: what the element is composed of (tags only,
  // capped — structure understanding without content harvesting).
  let children = [];
  try {
    children = Array.from(el.children).slice(0, 15).map((c) => {
      const cr = c.getBoundingClientRect();
      return {
        tag: c.tagName.toLowerCase(),
        w: Math.round(cr.width),
        h: Math.round(cr.height),
        text: c.children.length === 0 && c.innerText ? c.innerText.trim().slice(0, 60) : null,
      };
    });
  } catch (e) { children = []; }
  // Nearest section context: heading/landmark the element lives in.
  let context = null;
  try {
    const scope = (el.closest && el.closest('section,article,main,nav,header,footer,form,aside')) || null;
    if (scope && scope !== el) {
      const h = scope.querySelector ? scope.querySelector('h1,h2,h3,h4') : null;
      context = {
        container: scope.tagName.toLowerCase(),
        heading: h && h.innerText ? h.innerText.trim().slice(0, 80) : null,
      };
    }
  } catch (e) { context = null; }
  return {
    tag: el.tagName.toLowerCase(),
    classes: el.className && typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 10) : [],
    attributes: attrs,
    text: el.innerText ? el.innerText.trim().slice(0, 200) : null,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    childCount: el.children ? el.children.length : 0,
    children,
    context,
    interactive: el.tagName && /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)
      ? { disabled: !!el.disabled, ...(el.href ? { href: String(el.href).slice(0, 200) } : {}) }
      : null,
    styles: {
      display: cs.display,
      position: cs.position,
      width: cs.width,
      height: cs.height,
      padding: cs.padding,
      margin: cs.margin,
      backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 200) : null,
      color: cs.color,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily,
      fontStyle: cs.fontStyle,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      textAlign: cs.textAlign,
      textDecoration: cs.textDecoration,
      border: cs.border,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow.slice(0, 200) : null,
      textShadow: cs.textShadow && cs.textShadow !== 'none' ? cs.textShadow.slice(0, 200) : null,
      opacity: cs.opacity,
      cursor: cs.cursor,
      overflow: cs.overflow,
      zIndex: cs.zIndex,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      gap: cs.gap,
      gridTemplateColumns: cs.gridTemplateColumns && cs.gridTemplateColumns !== 'none' ? cs.gridTemplateColumns : null,
      gridTemplateRows: cs.gridTemplateRows && cs.gridTemplateRows !== 'none' ? cs.gridTemplateRows : null,
      transition: cs.transition && cs.transition !== 'all 0s ease 0s' ? cs.transition.slice(0, 200) : null,
      transform: cs.transform && cs.transform !== 'none' ? cs.transform : null,
    }
  };
}

// Replacement rule: the rebuilt element must UPDATE existing matching
// elements in place across the whole site — never append a duplicate in
// a random spot. Worded per element kind so the AI applies it literally.
function replacementRule(tag) {
  const t = String(tag || 'element');
  return [
    `INTEGRATION RULE (mandatory): do NOT add a new <${t}> somewhere else on the page.`,
    `Find EVERY existing <${t}> occurrence across the whole site and update them in place to this new design, preserving each one's position, surrounding layout, and function.`,
    `If no Instruction below says otherwise, apply the redesign to all matching instances so the site stays consistent — no duplicates, no stray copies in random places.`,
  ].join('\n');
}

function instructionBlock() {
  return `Instruction: []`;
}

function buildPrompt(el) {
  const data = extractElementData(el);
  const s = data.styles;
  const lines = [
    `Recreate this UI element in HTML/CSS (or React + Tailwind) with pixel-close fidelity.`,
    ``,
    `ELEMENT: <${data.tag}>${data.classes.length ? ' .' + data.classes.join('.') : ''}${data.attributes.id ? ' #' + data.attributes.id : ''}`,
    data.attributes.role ? `Role: ${data.attributes.role}` : null,
    data.context ? `Lives inside: <${data.context.container}>${data.context.heading ? ` headed "${data.context.heading}"` : ''}` : null,
    ``,
    `GEOMETRY: ${s.width} x ${s.height} (page position x:${data.rect.x}, y:${data.rect.y})`,
    `LAYOUT: display:${s.display}; position:${s.position}; overflow:${s.overflow}; z-index:${s.zIndex}`,
    (s.display.includes('flex') || s.display.includes('grid'))
      ? `ARRANGEMENT: direction:${s.flexDirection}; justify:${s.justifyContent}; align:${s.alignItems}; gap:${s.gap}${s.gridTemplateColumns ? `; columns:${s.gridTemplateColumns}` : ''}${s.gridTemplateRows ? `; rows:${s.gridTemplateRows}` : ''}`
      : null,
    `SPACING: padding:${s.padding}; margin:${s.margin}`,
    ``,
    `SURFACE: background:${s.backgroundColor}${s.backgroundImage ? ` + ${s.backgroundImage}` : ''}; border:${s.border}; radius:${s.borderRadius}${s.boxShadow ? `; shadow:${s.boxShadow}` : ''}; opacity:${s.opacity}`,
    `TEXT: color:${s.color}; font:${s.fontSize}/${s.fontWeight} ${s.fontFamily}; style:${s.fontStyle}; line-height:${s.lineHeight}; spacing:${s.letterSpacing}; transform:${s.textTransform}; align:${s.textAlign}; decoration:${s.textDecoration}${s.textShadow ? `; text-shadow:${s.textShadow}` : ''}`,
    `BEHAVIOR: cursor:${s.cursor}${s.transition ? `; transition:${s.transition}` : ''}${s.transform ? `; transform:${s.transform}` : ''}`,
    data.interactive ? `STATE: ${Object.entries(data.interactive).map(([k, v]) => `${k}=${v}`).join('; ')}` : null,
    data.text ? `CONTENT: "${data.text}"` : null,
    data.childCount ? `CONTAINS: ${data.childCount} direct child element(s)` : `CONTAINS: no child elements (leaf)`,
    ...data.children.map((c) => `  - <${c.tag}> ${c.w}x${c.h}${c.text ? ` "${c.text}"` : ''}`),
    ``,
    replacementRule(data.tag),
    ``,
    instructionBlock(),
  ];
  return lines.filter((l) => l !== null).join('\n');
}

async function captureScreenshot(el) {
  try {
    const canvas = await html2canvas(el, {
      backgroundColor: null,
      scale: 2,
      logging: false,
      useCORS: true
    });
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[VibeyCursor] screenshot failed', err);
    return null;
  }
}
const MODE = { ELEMENT: 'element', SECTION: 'section' };
let currentMode = MODE.ELEMENT;

function buildSectionTree(el, depth = 0, maxDepth = 4, maxChildren = 12) {
  if (!el || depth > maxDepth) return null;
  const cs = getComputedStyle(el);

  const node = {
    tag: el.tagName.toLowerCase(),
    classes: el.className && typeof el.className === 'string' ? el.className.split(' ').filter(Boolean) : [],
    text: depth === maxDepth ? null : (el.children.length === 0 ? el.innerText?.trim().slice(0, 100) || null : null),
    styles: {
      display: cs.display,
      position: cs.position,
      width: cs.width,
      height: cs.height,
      padding: cs.padding,
      margin: cs.margin,
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      border: cs.border,
      borderRadius: cs.borderRadius,
      gap: cs.gap,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems
    },
    children: []
  };

  const children = Array.from(el.children).slice(0, maxChildren);
  for (const child of children) {
    const childNode = buildSectionTree(child, depth + 1, maxDepth, maxChildren);
    if (childNode) node.children.push(childNode);
  }

  return node;
}

function treeToPromptText(node, indent = 0) {
  const pad = '  '.repeat(indent);
  let out = `${pad}<${node.tag}>${node.classes.length ? ' .' + node.classes.join('.') : ''}\n`;
  out += `${pad}  display:${node.styles.display}; size:${node.styles.width}x${node.styles.height}; bg:${node.styles.backgroundColor}; color:${node.styles.color}; font:${node.styles.fontSize}/${node.styles.fontWeight}; radius:${node.styles.borderRadius}; padding:${node.styles.padding}\n`;
  if (node.text) out += `${pad}  text: "${node.text}"\n`;
  node.children.forEach(child => { out += treeToPromptText(child, indent + 1); });
  return out;
}

function buildSectionPrompt(tree) {
  return `
Recreate this entire UI section in HTML/CSS (or React + Tailwind) with pixel-close fidelity.
This is a nested component tree — preserve the hierarchy, spacing, and layout structure exactly:

${treeToPromptText(tree)}

Build it as a single reusable component that matches this structure and styling as closely as possible.

${replacementRule('section')}

${instructionBlock()}
`.trim();
}

// ---- Section dossier (Pro): full-page scan packed into one AI-readable
// file. Full-page screenshot + up to 5 key-element screenshots (embedded
// as images) + layout tree + per-element specs + replacement rule +
// Instruction bracket. Copied to clipboard as rich HTML with a plain-text
// fallback, so the AI gets full context even without AI Enhance.
const DOSSIER_MAX_SHOT_BYTES = 600000; // dataURL chars per image (storage-safe)

async function shotCapped(target, scale, shotOpts) {
  try {
    const canvas = await html2canvas(target, Object.assign({
      backgroundColor: null,
      scale: scale || 1,
      logging: false,
      useCORS: true,
    }, shotOpts || {}));
    let url = canvas.toDataURL('image/png');
    let w = canvas.width;
    let guard = 0;
    while (url.length > DOSSIER_MAX_SHOT_BYTES && guard < 3 && w > 320) {
      w = Math.max(320, Math.floor(w / 2));
      const small = document.createElement('canvas');
      small.width = w;
      small.height = Math.max(1, Math.round(canvas.height * (w / canvas.width)));
      small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
      url = small.toDataURL('image/png');
      guard++;
    }
    return url.length > DOSSIER_MAX_SHOT_BYTES * 2 ? null : url;
  } catch (e) {
    return null; // screenshots are enhancement, never fatal
  }
}

// Heuristic key elements: large, visible, near the top — buttons, CTAs,
// headings, hero media, forms. Deduplicated, capped.
function visibleKeyElements(excludeEl, max) {
  try {
    const found = [];
    const cands = Array.from(
      document.querySelectorAll('button, a, h1, h2, img, form, nav, input[type="submit"], [role="button"]')
    ).slice(0, 250);
    for (const c of cands) {
      if (!c || c === excludeEl || isVibeyUI(c)) continue;
      const r = c.getBoundingClientRect();
      if (r.width < 40 || r.height < 14) continue;
      if (r.bottom < 0 || r.top > window.innerHeight * 1.5) continue;
      const area = Math.min(r.width, 1200) * Math.min(r.height, 800);
      const score = area / (1 + Math.max(0, r.top) / 600);
      found.push({ el: c, score });
    }
    found.sort((a, b) => b.score - a.score);
    const picked = [];
    const seen = new Set();
    for (const f of found) {
      const key = `${f.el.tagName}:${(f.el.innerText || '').trim().slice(0, 30)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(f.el);
      if (picked.length >= (max || 5)) break;
    }
    return picked;
  } catch (e) {
    return [];
  }
}

function escDossier(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function dossierElementSpec(data, imgLabel) {
  const s = data.styles;
  return [
    `${imgLabel} <${data.tag}>${data.classes.length ? ' .' + data.classes.join('.') : ''} — ${data.rect.width}x${data.rect.height} at (${data.rect.x},${data.rect.y})`,
    `  surface: ${s.backgroundColor}; radius:${s.borderRadius}; border:${s.border}${s.boxShadow ? `; shadow:${s.boxShadow}` : ''}`,
    `  text: ${s.color} ${s.fontSize}/${s.fontWeight}${data.text ? ` "${data.text}"` : ''}`,
    `  layout: ${s.display} ${s.position}; padding:${s.padding}; margin:${s.margin}`,
  ].join('\n');
}

function buildDossier(parts) {
  const figHtml = parts.elements.map((p, i) => `
    <figure style="margin:0 0 16px;">
      <img src="${p.shot}" alt="${escDossier(p.data.tag)} capture" style="max-width:100%;border:1px solid #333;border-radius:8px;" />
      <figcaption style="font:12px monospace;white-space:pre-wrap;">${escDossier(p.spec)}</figcaption>
    </figure>`).join('\n');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escDossier(parts.title)} — VibeyCursor section dossier</title></head>`
    + `<body style="font-family:sans-serif;max-width:900px;margin:0 auto;padding:24px;background:#fff;color:#111;">`
    + `<h1>${escDossier(parts.title)}</h1>`
    + `<p>Source: ${escDossier(parts.url)} · Captured with VibeyCursor section scan.</p>`
    + (parts.pageShot ? `<h2>Full page</h2><img src="${parts.pageShot}" alt="full page screenshot" style="max-width:100%;border:1px solid #333;border-radius:8px;" />` : `<p><em>Full-page screenshot unavailable for this page.</em></p>`)
    + `<h2>Key elements (${parts.elements.length})</h2>${figHtml}`
    + `<h2>Section structure</h2><pre style="font:12px monospace;white-space:pre-wrap;">${escDossier(parts.treeText)}</pre>`
    + `<h2>Integration rule</h2><pre style="font:12px monospace;white-space:pre-wrap;">${escDossier(parts.rule)}</pre>`
    + `<h2>Instruction</h2><pre style="font:12px monospace;">${escDossier(parts.instruction)}</pre>`
    + `</body></html>`;
  const text = [
    `${parts.title} — VibeyCursor section dossier`,
    `Source: ${parts.url}`,
    ``,
    `KEY ELEMENTS (${parts.elements.length}):`,
    ...parts.elements.map((p) => p.spec),
    ``,
    `SECTION STRUCTURE:`,
    parts.treeText,
    ``,
    parts.rule,
    ``,
    parts.instruction,
  ].join('\n');
  return { html, text };
}

async function performSectionDossier(el, meta) {
  const rect = el.getBoundingClientRect();
  showBadge(rect, 'Scanning page...');
  const tag = el.tagName ? el.tagName.toLowerCase() : 'section';

  // 1. Full-page screenshot (falls back to current viewport on huge pages).
  let pageShot = null;
  try {
    const huge = document.body && (document.body.scrollHeight > 9000 || document.body.scrollWidth > 3000);
    if (!huge && document.body) {
      pageShot = await shotCapped(document.body, 1);
    } else {
      pageShot = await shotCapped(document.body || document.documentElement, 1, {
        x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight,
      });
    }
  } catch (e) { pageShot = null; }

  // 2. Up to 5 key-element screenshots + specs (deep scan, like free capture).
  const keyEls = visibleKeyElements(el, 5);
  const elements = [];
  for (const k of keyEls) {
    try {
      const shot = await shotCapped(k, 1);
      if (!shot) continue;
      const data = extractElementData(k);
      elements.push({ shot, data, spec: dossierElementSpec(data, `Shot ${elements.length + 1}`) });
    } catch (e) { /* one bad element never sinks the dossier */ }
  }

  // 3. Section structure tree for the clicked element.
  const tree = buildSectionTree(el);
  const treeText = tree ? treeToPromptText(tree) : `<${tag}> (structure unreadable)`;

  const rule = replacementRule('section');
  const instruction = instructionBlock();
  const dossier = buildDossier({
    title: document.title || 'Untitled page',
    url: location.href,
    treeText,
    elements,
    pageShot,
    rule,
    instruction,
  });

  // 4. Clipboard: rich single file first, plain text as fallback.
  let copied = false;
  try {
    const htmlBlob = new Blob([dossier.html], { type: 'text/html' });
    const textBlob = new Blob([dossier.text], { type: 'text/plain' });
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob }),
    ]);
    copied = true;
  } catch (e) {
    try {
      await navigator.clipboard.writeText(dossier.text);
      copied = true;
    } catch (e2) { copied = false; }
  }

  const capture = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    url: location.href,
    siteTitle: document.title,
    mode: 'section',
    tag,
    prompt: dossier.text,
    json: { tree, elements: elements.map((p) => ({ spec: p.spec, tag: p.data.tag, rect: p.data.rect })) },
    screenshot: pageShot || (elements[0] ? elements[0].shot : null),
    images: [pageShot, ...elements.map((p) => p.shot)].filter(Boolean).slice(0, 6),
  };
  if (can('history')) await saveToHistory(capture);

  vcTrack('capture_completed', vcElementMeta(el, {
    element_type: 'section', tag, mode: 'section', prompt_chars: dossier.text.length,
  }));
  vcTrack('prompt_generated', vcElementMeta(el, {
    element_type: 'section', tag, mode: 'section', prompt_chars: dossier.text.length,
  }));
  if (copied) {
    vcTrack('prompt_copied', vcElementMeta(el, { element_type: 'section', tag, mode: 'section', source: 'dossier' }));
  }

  showActionBar(rect, capture);
  showBadge(rect, copied
    ? `Section dossier copied (${elements.length} element shots${pageShot ? ' + full page' : ''})`
    : 'Dossier built — copy failed in this browser');
}
function createModeSwitch() {
  const switcher = createEl('div', 'vc-mode-switch');
  switcher.innerHTML = `
    <button id="vc-mode-element" class="active">Element</button>
    <button id="vc-mode-section">Section</button>
  `;
  switcher.querySelector('#vc-mode-element').addEventListener('click', (e) => {
    e.stopPropagation();
    currentMode = MODE.ELEMENT;
    switcher.querySelector('#vc-mode-element').classList.add('active');
    switcher.querySelector('#vc-mode-section').classList.remove('active');
  });
  switcher.querySelector('#vc-mode-section').addEventListener('click', async (e) => {
    e.stopPropagation();
    await fetchEntitlements();
    if (entitlements.plan !== 'pro') {
      const { licenseKey } = await chrome.storage.local.get('licenseKey');
      if (vcEntHealResult === 'limit') {
        return showUpgradeToast('Pro is active on 2 other browsers — deactivate one first');
      }
      if (licenseKey) {
        return showUpgradeToast('Still verifying Pro on this browser — try again in a moment');
      }
      return showUpgradeToast('Section capture is a Pro feature');
    }
    currentMode = MODE.SECTION;
    switcher.querySelector('#vc-mode-section').classList.add('active');
    switcher.querySelector('#vc-mode-element').classList.remove('active');
  });
  return switcher;
}

async function saveToHistory(capture) {
  const { vcHistory = [] } = await chrome.storage.local.get('vcHistory');
  vcHistory.unshift(capture);
  const trimmed = vcHistory.slice(0, 50); // Pro history cap: 50 entries
  await chrome.storage.local.set({ vcHistory: trimmed });
}

async function performCapture(el) {
  await refreshPlan();
  await fetchEntitlements();
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  const elementType = elementTypeFromTag(tag, currentMode);
  vcTrack('capture_started', vcElementMeta(el, { element_type: elementType, tag, mode: currentMode }));
  const quota = await checkQuota();
  if (!quota.allowed) {
    vcTrack('capture_denied', vcElementMeta(el, { element_type: elementType, tag, mode: currentMode, source: 'quota' }));
    showLimitPopup(quota);
    return;
  }

  const rect = el.getBoundingClientRect();
  const isSection = currentMode === MODE.SECTION;

  // Section mode (Pro) builds the full-page dossier instead of a single prompt.
  if (isSection) {
    try {
      await performSectionDossier(el, { elementType, tag });
    } catch (err) {
      vcTrack('capture_failed', vcElementMeta(el, {
        element_type: 'section', tag, mode: currentMode,
        error: err && err.name ? String(err.name).slice(0, 64) : 'error',
      }));
      showBadge(rect, 'Section scan failed — try again');
    }
    return;
  }

  showBadge(rect, 'Capturing...');

  try {
  const wantShot = can('screenshot_context');
  const screenshot = wantShot ? await captureScreenshot(el) : null;

  let prompt, jsonData;
  jsonData = extractElementData(el);
  prompt = buildPrompt(el);

  const capture = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    url: location.href,
    siteTitle: document.title,
    mode: currentMode,
    tag: el.tagName.toLowerCase(),
    prompt,
    json: jsonData,
    screenshot
  };

  await navigator.clipboard.writeText(prompt);
  if (can('history')) await saveToHistory(capture);
  vcTrack('capture_completed', vcElementMeta(el, {
    element_type: elementTypeFromTag(capture.tag, capture.mode),
    tag: capture.tag, mode: capture.mode, prompt_chars: prompt ? prompt.length : 0,
  }));
  vcTrack('prompt_generated', vcElementMeta(el, {
    element_type: elementTypeFromTag(capture.tag, capture.mode),
    tag: capture.tag, mode: capture.mode, prompt_chars: prompt ? prompt.length : 0,
  }));
  vcTrack('prompt_copied', vcElementMeta(el, {
    element_type: elementTypeFromTag(capture.tag, capture.mode),
    tag: capture.tag, mode: capture.mode, source: 'capture',
  }));

  showActionBar(rect, capture);
  if (screenshot) showBadge(rect, 'Screenshot + prompt copied');
  else if (wantShot) showBadge(rect, 'Prompt copied (screenshot failed)');
  else showBadge(rect, 'Copied as prompt');
  } catch (err) {
    vcTrack('capture_failed', vcElementMeta(el, {
      element_type: elementType, tag, mode: currentMode,
      error: err && err.name ? String(err.name).slice(0, 64) : 'error',
    }));
    showBadge(rect, 'Capture failed — try again');
  }
}

let inspectorEnabled = false;

function isVibeyUI(el) {
  return !!(el && el.closest && el.closest('#vc-toggle-btn,#vc-history-btn,#vc-mode-switch,#vc-action-bar,#vc-badge,#vc-highlight,#vc-tooltip,#vc-limit-popup'));
}

let highlightBox = null;
let tooltip = null;

function ensureOverlay() {
  if (!highlightBox) {
    highlightBox = createEl('div', 'vc-highlight');
    document.documentElement.appendChild(highlightBox);
  }
  if (!tooltip) {
    tooltip = createEl('div', 'vc-tooltip');
    document.documentElement.appendChild(tooltip);
  }
}

function positionHighlight(el) {
  if (!vcUIVisible) return;
  ensureOverlay();
  const rect = el.getBoundingClientRect();
  highlightBox.style.display = 'block';
  highlightBox.style.top = rect.top + 'px';
  highlightBox.style.left = rect.left + 'px';
  highlightBox.style.width = rect.width + 'px';
  highlightBox.style.height = rect.height + 'px';
  tooltip.style.display = 'block';
  tooltip.textContent = `<${el.tagName.toLowerCase()}> — click to copy`;
  tooltip.style.top = Math.max(rect.top - 28, 4) + 'px';
  tooltip.style.left = Math.max(rect.left, 4) + 'px';
}

function hideHighlight() {
  if (highlightBox) highlightBox.style.display = 'none';
  if (tooltip) tooltip.style.display = 'none';
}

function setInspectorEnabled(on, source) {
  inspectorEnabled = on;
  toggleBtn.textContent = `VibeyCursor: ${on ? 'ON' : 'OFF'}`;
  toggleBtn.classList.toggle('off', !on);
  vcTrack('inspector_toggled', { source: source || 'unknown', error: on ? 'on' : 'off' });
  if (on) vcTrack('vibey_shown', { source: source || 'unknown' });
  else {
    vcTrack('vibey_hidden', { source: source || 'unknown' });
    vcTrack('tool_deactivated', { source: source || 'unknown' });
    hideHighlight();
  }
}

document.addEventListener('mouseover', (e) => {
  if (!inspectorEnabled) return;
  const el = e.target;
  if (!el || el === document.documentElement || el === document.body) return;
  if (isVibeyUI(el)) { hideHighlight(); return; }
  if (!(el instanceof Element)) return;
  positionHighlight(el);
  // Sampled highlight telemetry (1-in-50) — never a request per hover.
  try {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    vcTrack('element_highlighted', vcElementMeta(el, {
      element_type: elementTypeFromTag(tag, currentMode), tag, mode: currentMode, sample: 50,
    }));
  } catch (err) { /* best-effort */ }
});

document.addEventListener('mouseout', (e) => {
  if (!inspectorEnabled) return;
  if (isVibeyUI(e.target)) return;
});

document.addEventListener('click', (e) => {
  if (!inspectorEnabled) return;
  if (isVibeyUI(e.target)) return;
  const el = e.target;
  if (!(el instanceof Element)) return;
  e.preventDefault();
  e.stopPropagation();
  performCapture(el);
}, true);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TOGGLE_INSPECTOR') {
    setInspectorEnabled(!inspectorEnabled, 'shortcut');
    vcTrack('shortcut_used', { source: 'toggle-inspector' });
  }
  if (msg.type === 'TOGGLE_VIBEY_UI') {
    setUIVisible(!vcUIVisible, 'shortcut');
    vcTrack('shortcut_used', { source: 'toggle-vibey-ui' });
  }
});

// Visibility-only toggle (Ctrl+Shift+H). Hides/shows EVERY VibeyCursor
// node (overlay, buttons, mode switch, bars, badges, popups) without
// changing capture mode, license, history, or session. Selector-based so
// any future vc-* UI is covered automatically.
function setUIVisible(visible, source) {
  vcUIVisible = visible;
  let nodes = [];
  try {
    nodes = Array.from(document.querySelectorAll('[id^="vc-"]'));
  } catch (e) { nodes = []; }
  for (const node of nodes) {
    try {
      if (!visible) {
        if (!node.dataset.vcPrevDisplay) node.dataset.vcPrevDisplay = node.style.display || '';
        node.style.display = 'none';
      } else {
        node.style.display = node.dataset.vcPrevDisplay || '';
        delete node.dataset.vcPrevDisplay;
      }
    } catch (e) { /* best-effort */ }
  }
  if (!visible) hideHighlight();
  try {
    chrome.storage.local.set({ vcUIVisible: visible });
  } catch (e) { /* persistence is best-effort */ }
  vcTrack(visible ? 'vibey_shown' : 'vibey_hidden', { source: source || 'unknown' });
}

// Restore persisted visibility once the floating UI exists.
function restoreUIVisibility() {
  try {
    chrome.storage.local.get('vcUIVisible', (data) => {
      if (data && data.vcUIVisible === false) setUIVisible(false, 'restore');
    });
  } catch (e) { /* visible by default */ }
}

const toggleBtn = createEl('div', 'vc-toggle-btn');
toggleBtn.textContent = 'VibeyCursor: OFF';
toggleBtn.classList.add('off');
toggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setInspectorEnabled(!inspectorEnabled, 'toggle-btn');
});
toggleBtn.addEventListener('dblclick', () => {
  vcTrack('history_opened', { source: 'toggle-dblclick' });
  vcSend({ type: 'OPEN_SIDE_PANEL' });
});

const historyBtn = createEl('div', 'vc-history-btn');
historyBtn.innerHTML = `${vcIcon('history')}<span>History</span>`;
historyBtn.setAttribute('aria-label', 'Open capture history');
historyBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  vcTrack('history_opened', { source: 'history-btn' });
  vcSend({ type: 'OPEN_SIDE_PANEL' });
});
if (document.body) {
  document.body.appendChild(toggleBtn);
  document.body.appendChild(historyBtn);
  document.body.appendChild(createModeSwitch());
  restoreUIVisibility();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(toggleBtn);
    document.body.appendChild(historyBtn);
    document.body.appendChild(createModeSwitch());
    restoreUIVisibility();
  });
}

// content.js — inside action bar button handler
function exportJSON(capture) {
  const json = JSON.stringify({ prompt: capture.prompt, data: capture.json }, null, 2);
  chrome.runtime.sendMessage({ type: 'DOWNLOAD_JSON', json, filename: `vc-${capture.id}.json` });
}

// Coarse element taxonomy for owner analytics (informational only — the
// server never trusts it for billing or security).
// Minimal 13-value set: button, link, media, heading, text, form-field,
// form, navigation, section, component, list-table, modal, other.
function elementTypeFromTag(tag, mode) {
  if (mode === 'section') return 'section';
  const t = String(tag || '').toLowerCase();
  if (t === 'button') return 'button';
  if (t === 'a') return 'link';
  if (['img', 'picture', 'video', 'svg', 'canvas'].includes(t)) return 'media';
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(t)) return 'heading';
  if (['p', 'span'].includes(t)) return 'text';
  if (['input', 'textarea', 'select'].includes(t)) return 'form-field';
  if (['form', 'label'].includes(t)) return 'form';
  if (['nav', 'header', 'footer'].includes(t)) return 'navigation';
  if (t === 'dialog' || t.includes('modal')) return 'modal';
  if (['ul', 'ol', 'li', 'table', 'dl', 'dt', 'dd'].includes(t)) return 'list-table';
  if (['div', 'section', 'article', 'main', 'aside'].includes(t)) return 'component';
  return 'other';
}

function showActionBar(rect, capture) {
  let bar = document.getElementById('vc-action-bar');
  if (!bar) bar = createEl('div', 'vc-action-bar');

  bar.innerHTML = `
    ${capture.screenshot ? `<img id="vc-shot-thumb" src="${capture.screenshot}" alt="capture">` : ''}
    <button id="vc-copy-prompt" aria-label="Copy prompt">${vcIcon('copy')}<span>Copy Prompt</span></button>
    <button id="vc-copy-json" class="${can('json_context') ? '' : 'locked'}" aria-label="Copy JSON">${vcIcon('code')}<span>JSON</span></button>
    <button id="vc-ai-enhance" class="premium" aria-label="AI enhance prompt">${vcIcon('spark')}<span>AI Enhance</span></button>
    <button id="vc-open-history" aria-label="Open history">${vcIcon('history')}<span>History</span></button>
  `;
  bar.style.display = 'flex';
  bar.style.top = Math.max(rect.top - 80, 10) + 'px';
  bar.style.left = rect.left + 'px';

  bar.querySelector('#vc-copy-prompt').onclick = () => {
    navigator.clipboard.writeText(capture.prompt);
    vcTrack('prompt_copied', { element_type: elementTypeFromTag(capture.tag, capture.mode), tag: capture.tag, mode: capture.mode, source: 'action-bar' });
  };
  bar.querySelector('#vc-copy-json').onclick = () => {
    if (!can('json_context')) {
      vcTrack('json_locked', { element_type: elementTypeFromTag(capture.tag, capture.mode), tag: capture.tag, mode: capture.mode });
      return showUpgradeToast('JSON export is a Pro feature');
    }
    navigator.clipboard.writeText(JSON.stringify(capture.json, null, 2));
    vcTrack('json_copied', { element_type: elementTypeFromTag(capture.tag, capture.mode), tag: capture.tag, mode: capture.mode });
  };
  bar.querySelector('#vc-ai-enhance').onclick = async () => {
    if (!can('ai_enhance')) {
      vcTrack('enhance_failed', { element_type: elementTypeFromTag(capture.tag, capture.mode), tag: capture.tag, mode: capture.mode, error: 'locked' });
      return showUpgradeToast('AI Enhance is a Pro feature');
    }
    vcTrack('enhance_requested', { element_type: elementTypeFromTag(capture.tag, capture.mode), tag: capture.tag, mode: capture.mode, prompt_chars: capture.prompt ? capture.prompt.length : 0 });
    bar.querySelector('#vc-ai-enhance').innerHTML = `<span>Enhancing...</span>`;
    // Server caps enhance input (4000 chars): send a condensed head slice so
    // long section dossiers still get AI analysis instead of a rejection.
    // The full dossier is already on the clipboard — nothing is lost.
    const enhanceInput = capture.prompt && capture.prompt.length > 3800
      ? capture.prompt.slice(0, 3800)
      : capture.prompt;
    chrome.runtime.sendMessage(
      {
        type: 'AI_ENHANCE',
        prompt: enhanceInput,
        licenseKey: await getLicenseKey(),
        installationId: await getInstallationId(),
        meta: { elementType: elementTypeFromTag(capture.tag, capture.mode) },
      },
      (res) => {
        if (res?.success) {
          navigator.clipboard.writeText(res.enhanced);
          vcTrack('enhance_completed', { element_type: elementTypeFromTag(capture.tag, capture.mode), tag: capture.tag, mode: capture.mode });
          showBadge(rect, 'Enhanced prompt copied');
        } else {
          vcTrack('enhance_failed', { element_type: elementTypeFromTag(capture.tag, capture.mode), tag: capture.tag, mode: capture.mode, error: 'upstream' });
        }
        bar.querySelector('#vc-ai-enhance').innerHTML = `${vcIcon('spark')}<span>AI Enhance</span>`;
      }
    );
  };

  bar.querySelector('#vc-open-history').onclick = () => {
    vcTrack('history_opened', { source: 'action-bar' });
    vcSend({ type: 'OPEN_SIDE_PANEL' });
  };

  setTimeout(() => { bar.style.display = 'none'; }, 6000);
}
let currentPlan = 'free';

// Central entitlement state. Fetched from /api/entitlements (the single
// authority); cached up to 1h for UX. Server re-verifies on every
// privileged operation, so this cache can never grant real access.
let entitlements = { plan: 'free', features: {} };
let entFetchedAt = 0;
const ENT_TTL_MS = 60 * 60 * 1000;

async function getInstallationId() {
  const { vcDeviceId } = await chrome.storage.local.get('vcDeviceId');
  if (vcDeviceId) return vcDeviceId;
  const fresh = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random()}`);
  await chrome.storage.local.set({ vcDeviceId: fresh });
  return fresh;
}

async function fetchEntitlements(force = false) {
  if (!force && Date.now() - entFetchedAt < ENT_TTL_MS && entFetchedAt > 0) return entitlements;
  try {
    const { licenseKey } = await chrome.storage.local.get('licenseKey');
    const res = await fetch(`${backendUrl()}/api/entitlements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(licenseKey ? { licenseKey } : {}),
        installationId: await getInstallationId(),
      })
    });
    if (res.ok) {
      entitlements = await res.json();
      entFetchedAt = Date.now();
      currentPlan = entitlements.plan || 'free';
      await chrome.storage.local.set({ licensePlan: currentPlan });
    }
  } catch (e) {
    // Offline: keep last-known state; server still guards everything.
  }
  // Self-heal (once per page session): a stored license with no Pro
  // entitlement usually means the activation slot was never bound on this
  // browser (reinstall, or validated while the backend was unreachable).
  // Binding is idempotent server-side; 409 (slots full) just stays locked.
  if (!vcEntHealTried) {
    try {
      const { licenseKey } = await chrome.storage.local.get('licenseKey');
      if (licenseKey && String(entitlements.plan || '').toLowerCase() !== 'pro') {
        vcEntHealTried = true;
        const heal = await fetch(`${backendUrl()}/api/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ licenseKey, installationId: await getInstallationId() }),
        });
        vcEntHealResult = heal.ok ? 'ok' : (heal.status === 409 ? 'limit' : 'error');
        if (heal.ok) {
          entFetchedAt = 0;
          return fetchEntitlements(true);
        }
      }
    } catch (e) { vcEntHealResult = 'error'; }
  }
  return entitlements;
}

function can(feature) {
  return !!(entitlements.features && entitlements.features[feature]);
}

function isPro() {
  // Legacy alias kept for compatibility; new code must use can(feature) or
  // entitlements.plan. Single source of truth remains /api/entitlements.
  return String(entitlements.plan || currentPlan || 'free').toLowerCase() === 'pro';
}

chrome.storage.local.get('licensePlan', (data) => {
  currentPlan = data.licensePlan || 'free';
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.licensePlan) {
    currentPlan = changes.licensePlan.newValue;
    entFetchedAt = 0; // plan changed (activation): refresh entitlements next use
    fetchEntitlements(true);
  }
});

// Re-read the plan fresh before gating anything Pro: content scripts can hold
// a stale value if the user activated after the page was injected.
async function refreshPlan() {
  const { licensePlan } = await chrome.storage.local.get('licensePlan');
  currentPlan = licensePlan || 'free';
}

// Warm the entitlement cache on startup (spec: refresh on extension start).
fetchEntitlements();