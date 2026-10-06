try { importScripts('config.js'); } catch (e) { /* config optional in some contexts */ }
const BACKEND_URL = (globalThis.VIBEY_CONFIG && globalThis.VIBEY_CONFIG.BACKEND_URL) || 'https://vibeycursor-backend.vercel.app';

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
      body: JSON.stringify({ prompt: msg.prompt, licenseKey: msg.licenseKey })
    })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, enhanced: data.enhanced }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-inspector') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_INSPECTOR' });
  } catch (e) { /* tab may not have content script */ }
});

chrome.alarms.create('revalidate-license', { periodInMinutes: 60 });

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