function createEl(tag, id) {
  const el = document.createElement(tag);
  if (id) el.id = id;
  return el;
}

function showBadge(rect, text) {
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
  const siteUrl = (globalThis.VIBEY_CONFIG && globalThis.VIBEY_CONFIG.SITE_URL) || 'https://landing-page-navy-six-58.vercel.app';
  showBadge(
    { top: window.innerHeight - 100, left: window.innerWidth - 300 },
    `🔒 ${message} — upgrade at ${siteUrl}`
  );
}

async function getLicenseKey() {
  const { licenseKey } = await chrome.storage.local.get('licenseKey');
  return licenseKey || null;
}

function backendUrl() {
  return (globalThis.VIBEY_CONFIG && globalThis.VIBEY_CONFIG.BACKEND_URL) || 'https://vibeycursor-backend.vercel.app';
}

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
  const siteUrl = (globalThis.VIBEY_CONFIG && globalThis.VIBEY_CONFIG.SITE_URL) || 'https://landing-page-navy-six-58.vercel.app';
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
      window.open(`${siteUrl}/pricing.html`, '_blank');
      pop.style.display = 'none';
    };
  }
  pop.querySelector('#vc-limit-close').onclick = () => {
    pop.style.display = 'none';
  };
  clearTimeout(showLimitPopup._t);
  showLimitPopup._t = setTimeout(() => { pop.style.display = 'none'; }, 8000);
}

function extractElementData(el) {
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    classes: el.className && typeof el.className === 'string' ? el.className.split(' ').filter(Boolean) : [],
    text: el.innerText ? el.innerText.trim().slice(0, 200) : null,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
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
      fontFamily: cs.fontFamily,
      border: cs.border,
      borderRadius: cs.borderRadius
    }
  };
}

function buildPrompt(el) {
  const data = extractElementData(el);
  return [
    `Recreate this UI element in HTML/CSS (or React + Tailwind).`,
    `<${data.tag}>${data.classes.length ? ' .' + data.classes.join('.') : ''}`,
    `Size: ${data.styles.width} x ${data.styles.height}`,
    `Display: ${data.styles.display}; Position: ${data.styles.position}`,
    `Background: ${data.styles.backgroundColor}; Color: ${data.styles.color}`,
    `Font: ${data.styles.fontSize} / ${data.styles.fontWeight} ${data.styles.fontFamily}`,
    `Padding: ${data.styles.padding}; Margin: ${data.styles.margin}`,
    `Border: ${data.styles.border}; Radius: ${data.styles.borderRadius}`,
    data.text ? `Text: "${data.text}"` : null
  ].filter(Boolean).join('\n');
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
Recreate this entire UI section in HTML/CSS (or React + Tailwind).
This is a nested component tree — preserve the hierarchy, spacing, and layout structure exactly:

${treeToPromptText(tree)}

Build it as a single reusable component that matches this structure and styling as closely as possible.
`.trim();
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
    if (entitlements.plan !== 'pro') return showUpgradeToast('Section capture is a Pro feature');
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
  const quota = await checkQuota();
  if (!quota.allowed) {
    showLimitPopup(quota);
    return;
  }

  const rect = el.getBoundingClientRect();
  const isSection = currentMode === MODE.SECTION;

  showBadge(rect, 'Capturing...');

  const wantShot = can('screenshot_context');
  const screenshot = wantShot ? await captureScreenshot(el) : null;

  let prompt, jsonData;
  if (isSection) {
    const tree = buildSectionTree(el);
    prompt = buildSectionPrompt(tree);
    jsonData = tree;
  } else {
    jsonData = extractElementData(el);
    prompt = buildPrompt(el);
  }

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

  showActionBar(rect, capture);
  if (screenshot) showBadge(rect, 'Screenshot + prompt copied ✓');
  else if (wantShot) showBadge(rect, 'Prompt copied ✓ (screenshot failed)');
  else showBadge(rect, 'Copied as prompt ✓');
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

function setInspectorEnabled(on) {
  inspectorEnabled = on;
  toggleBtn.textContent = `VibeyCursor: ${on ? 'ON' : 'OFF'}`;
  toggleBtn.classList.toggle('off', !on);
  if (!on) hideHighlight();
}

document.addEventListener('mouseover', (e) => {
  if (!inspectorEnabled) return;
  const el = e.target;
  if (!el || el === document.documentElement || el === document.body) return;
  if (isVibeyUI(el)) { hideHighlight(); return; }
  if (!(el instanceof Element)) return;
  positionHighlight(el);
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
    setInspectorEnabled(!inspectorEnabled);
  }
});

const toggleBtn = createEl('div', 'vc-toggle-btn');
toggleBtn.textContent = 'VibeyCursor: OFF';
toggleBtn.classList.add('off');
toggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setInspectorEnabled(!inspectorEnabled);
});
toggleBtn.addEventListener('dblclick', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
});

const historyBtn = createEl('div', 'vc-history-btn');
historyBtn.textContent = '📜 History';
historyBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
});
if (document.body) {
  document.body.appendChild(toggleBtn);
  document.body.appendChild(historyBtn);
  document.body.appendChild(createModeSwitch());
} else {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(toggleBtn);
    document.body.appendChild(historyBtn);
    document.body.appendChild(createModeSwitch());
  });
}

// content.js — inside action bar button handler
function exportJSON(capture) {
  const json = JSON.stringify({ prompt: capture.prompt, data: capture.json }, null, 2);
  chrome.runtime.sendMessage({ type: 'DOWNLOAD_JSON', json, filename: `vc-${capture.id}.json` });
}

function showActionBar(rect, capture) {
  let bar = document.getElementById('vc-action-bar');
  if (!bar) bar = createEl('div', 'vc-action-bar');

  bar.innerHTML = `
    ${capture.screenshot ? `<img id="vc-shot-thumb" src="${capture.screenshot}" alt="capture">` : ''}
    <button id="vc-copy-prompt">Copy Prompt</button>
    <button id="vc-copy-json" class="${can('json_context') ? '' : 'locked'}">JSON</button>
    <button id="vc-ai-enhance" class="premium">✨ AI Enhance</button>
    <button id="vc-open-history">📜 History</button>
  `;
  bar.style.display = 'flex';
  bar.style.top = Math.max(rect.top - 80, 10) + 'px';
  bar.style.left = rect.left + 'px';

  bar.querySelector('#vc-copy-prompt').onclick = () => navigator.clipboard.writeText(capture.prompt);
  bar.querySelector('#vc-copy-json').onclick = () => {
    if (!can('json_context')) return showUpgradeToast('JSON export is a Pro feature');
    navigator.clipboard.writeText(JSON.stringify(capture.json, null, 2));
  };
  bar.querySelector('#vc-ai-enhance').onclick = async () => {
    if (!can('ai_enhance')) return showUpgradeToast('AI Enhance is a Pro feature');
    bar.querySelector('#vc-ai-enhance').textContent = 'Enhancing...';
    chrome.runtime.sendMessage(
      { type: 'AI_ENHANCE', prompt: capture.prompt, licenseKey: await getLicenseKey(), installationId: await getInstallationId() },
      (res) => {
        if (res?.success) {
          navigator.clipboard.writeText(res.enhanced);
          showBadge(rect, 'Enhanced prompt copied ✓');
        }
        bar.querySelector('#vc-ai-enhance').textContent = '✨ AI Enhance';
      }
    );
  };

  bar.querySelector('#vc-open-history').onclick = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
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