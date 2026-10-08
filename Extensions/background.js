try { importScripts('config.js'); } catch (e) { /* config optional in some contexts */ }
try { importScripts('analytics.js'); } catch (e) { /* queue lib optional in some contexts */ }
const BACKEND_URL = (globalThis.VIBEY_CONFIG && globalThis.VIBEY_CONFIG.BACKEND_URL) || 'https://vibey-cursor-backendv2.vercel.app';

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'OPEN_SIDE_PANEL' && sender.tab?.id) {
    chrome.sidePanel.open({ tabId: sender.tab.id });
  }
});
// background.js addition
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DOWNLOAD_JSON') {
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(msg.json);
    chrome.downloads.download({ url: dataUrl, filename: msg.filename });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'AI_ENHANCE') {
    fetch(`${BACKEND_URL}/api/enhance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: msg.prompt, licenseKey: msg.licenseKey, installationId: msg.installationId || undefined, meta: msg.meta && typeof msg.meta === 'object' ? msg.meta : undefined })
    })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, enhanced: data.enhanced }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ANALYTICS_FLUSH_HINT') {
    scheduleAnalyticsFlush();
  }
});

// Generic backend proxy for content scripts. fetch() inside a content
// script runs under the PAGE's Content-Security-Policy, so on strict-CSP
// sites every direct backend call fails and Pro looks permanently locked
// (entitlements/quota/activation all fail closed or fail silent). The
// service worker is exempt from page CSP (host_permissions apply), so all
// content-script backend traffic goes through here — same pattern as the
// AI_ENHANCE proxy below. Path allowlist: product endpoints only.
const VC_API_ALLOW = ['/api/entitlements', '/api/activate', '/api/usage', '/api/analytics'];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'VC_API' || !VC_API_ALLOW.includes(msg.path)) return false;
  fetch(`${BACKEND_URL}${msg.path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg.body && typeof msg.body === 'object' ? msg.body : {}),
  })
    .then(async (r) => {
      let data = null;
      try { data = await r.json(); } catch (e) { data = null; }
      sendResponse({ ok: r.ok, status: r.status, data });
    })
    .catch((err) => sendResponse({
      ok: false, status: 0,
      error: String((err && err.message) || err).slice(0, 120),
    }));
  return true; // keep channel open for async response
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-inspector' && command !== 'toggle-vibey-ui') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const msg = command === 'toggle-inspector' ? { type: 'TOGGLE_INSPECTOR' } : { type: 'TOGGLE_VIBEY_UI' };
    // Awaited inside try: on chrome:// pages, the Web Store, or tabs where
    // the content script never injected, this rejects — treated as a no-op
    // instead of an unhandled (and scary-looking) promise rejection.
    await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) { /* no content script on this tab: nothing to toggle */ }
});

chrome.alarms.create('revalidate-license', { periodInMinutes: 60 });
chrome.alarms.create('analytics-flush', { periodInMinutes: 5 });

// Stable per-browser ID (random, not hardware info). Generated once and
// reused so a license stays bound to the browser that activated it.
async function getDeviceId() {
  const { vcDeviceId } = await chrome.storage.local.get('vcDeviceId');
  if (vcDeviceId) return vcDeviceId;
  const fresh = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random()}`);
  await chrome.storage.local.set({ vcDeviceId: fresh });
  return fresh;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'analytics-flush') {
    flushAnalytics();
    return;
  }
  if (alarm.name !== 'revalidate-license') return;

  const { licenseKey } = await chrome.storage.local.get('licenseKey');
  if (!licenseKey) return;

  try {
    const res = await fetch(`${BACKEND_URL}/api/license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, deviceId: await getDeviceId() })
    });
    const data = await res.json();
    await chrome.storage.local.set({ licensePlan: data.valid ? data.plan : 'free' });
  } catch (err) {
    console.warn('License revalidation failed', err);
  }
});

// ---- Behavior analytics flush (best-effort; never affects product) ----
let analyticsFlushTimer = null;
let analyticsFlushInFlight = false;
let analyticsBackoffMs = 0;

function scheduleAnalyticsFlush() {
  if (analyticsFlushTimer) return;
  analyticsFlushTimer = setTimeout(() => {
    analyticsFlushTimer = null;
    flushAnalytics();
  }, 5000);
}

async function flushAnalytics() {
  if (analyticsFlushInFlight) return;
  const QA = globalThis.VIBEY_ANALYTICS;
  if (!QA || !QA.drain) return;
  analyticsFlushInFlight = true;
  try {
    if (analyticsBackoffMs > 0) {
      await new Promise((r) => setTimeout(r, analyticsBackoffMs));
    }
    const batch = await QA.drain(50);
    if (!batch || batch.length === 0) {
      analyticsBackoffMs = 0;
      return;
    }
    const store = await chrome.storage.local.get(['licenseKey', 'vcSessionId']);
    const res = await fetch(`${BACKEND_URL}/api/analytics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: await getDeviceId(),
        licenseKey: store.licenseKey || undefined,
        sessionId: store.vcSessionId || undefined,
        events: batch,
      }),
    });
    if (!res.ok) {
      await QA.requeue(batch);
      analyticsBackoffMs = Math.min(analyticsBackoffMs ? analyticsBackoffMs * 2 : 60000, 30 * 60000);
    } else {
      analyticsBackoffMs = 0;
    }
  } catch (err) {
    try {
      // Network/offline: leave events queued for the next alarm.
    } catch (e) { /* never throw */ }
  } finally {
    analyticsFlushInFlight = false;
  }
}