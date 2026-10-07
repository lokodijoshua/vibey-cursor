const BACKEND = (globalThis.VIBEY_CONFIG && globalThis.VIBEY_CONFIG.BACKEND_URL) || 'https://vibeycursor-backend.vercel.app';
const SITE_URL = (globalThis.VIBEY_CONFIG && globalThis.VIBEY_CONFIG.SITE_URL) || 'https://landing-page-navy-six-58.vercel.app';

const pricingLink = document.getElementById('pricing-link');
if (pricingLink) {
  pricingLink.href = `${SITE_URL}/pricing.html`;
  try {
    if (globalThis.vibeyIcon) {
      const span = pricingLink.querySelector('span') || pricingLink;
      span.insertAdjacentHTML('afterend', globalThis.vibeyIcon('arrowR'));
    }
  } catch (e) { /* text label is sufficient */ }
  pricingLink.addEventListener('click', () => {
    try {
      if (globalThis.VIBEY_ANALYTICS) globalThis.VIBEY_ANALYTICS.track('upsell_clicked', { source: 'popup' });
    } catch (e) { /* never break UI */ }
  });
}

// Decorative background art only — failures fall back to the gradient.
// (typeof guard: config.js may evolve; never break the popup over art.)
try {
  const gifUrl = typeof POPUP_BACKGROUND_GIF_URL === 'string' ? POPUP_BACKGROUND_GIF_URL : '';
  const gifEl = document.getElementById('popup-bg-gif');
  if (gifUrl && gifEl) {
    gifEl.onerror = () => { gifEl.style.display = 'none'; };
    gifEl.src = gifUrl;
  } else if (gifEl) {
    gifEl.style.display = 'none';
  }
} catch (e) { /* art must never break function */ }

// Keys look like VIBEY-AB12-CD34-EF56-7890. Normalize pasted input
// (trim + uppercase) and reject anything malformed before any network call.
const LICENSE_RE = /^VIBEY-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

function showFormError(msg) {
  let el = document.getElementById('form-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'form-error';
    el.style.cssText = 'font-size:11px; color:#ef4444; margin-bottom:8px; min-height:14px;';
    document.getElementById('activate-btn').before(el);
  }
  el.textContent = msg || '';
}

async function getDeviceId() {
  const { vcDeviceId } = await chrome.storage.local.get('vcDeviceId');
  if (vcDeviceId) return vcDeviceId;
  const fresh = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random()}`);
  await chrome.storage.local.set({ vcDeviceId: fresh });
  return fresh;
}

async function refreshUI() {
  const { licenseKey, licensePlan, licenseEmail, vcQuota } = await chrome.storage.local.get(['licenseKey', 'licensePlan', 'licenseEmail', 'vcQuota']);
  const freeView = document.getElementById('free-view');
  const proView = document.getElementById('pro-view');
  const status = document.getElementById('status');
  const pill = document.getElementById('plan-pill');

  if (licenseKey && licensePlan && licensePlan !== 'free') {
    freeView.style.display = 'none';
    proView.style.display = 'block';
    status.textContent = `Plan: ${licensePlan.toUpperCase()}`;
    pill.textContent = 'PRO';
    pill.style.background = '#a855f7';
    pill.style.color = '#fff';
    document.getElementById('pro-email').textContent = licenseEmail || '';
    try {
      const line = document.getElementById('pro-active-line');
      if (line && globalThis.vibeyIcon && !line.querySelector('svg')) {
        line.insertAdjacentHTML('afterbegin', globalThis.vibeyIcon('checkCircle'));
      }
    } catch (e) { /* text label is sufficient */ }
  } else {
    freeView.style.display = 'block';
    proView.style.display = 'none';
    const left = vcQuota && typeof vcQuota.remaining === 'number' ? ` · ${vcQuota.remaining} left` : '';
    status.textContent = `Free plan — upgrade anytime${left}`;
    pill.textContent = `FREE${left}`;
    pill.style.background = '#2a2a35';
    pill.style.color = '#9a9aad';
  }
}

document.getElementById('activate-btn').addEventListener('click', async () => {
  showFormError('');
  const raw = document.getElementById('license-input').value;
  const key = (raw || '').trim().toUpperCase();
  if (!key) return;
  if (key.length > 64) {
    showFormError('That key is too long — check for extra pasted text.');
    return;
  }
  if (!LICENSE_RE.test(key)) {
    showFormError('Invalid key format. Keys look like VIBEY-AB12-CD34-EF56-7890.');
    return;
  }

  const btn = document.getElementById('activate-btn');
  btn.textContent = 'Checking...';

  try {
    const res = await fetch(`${BACKEND}/api/license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: key, deviceId: await getDeviceId() })
    });
    const data = await res.json();

    if (data.valid) {
      await chrome.storage.local.set({ licenseKey: key, licensePlan: data.plan, licenseEmail: data.email || '' });
      try {
        if (globalThis.VIBEY_ANALYTICS) globalThis.VIBEY_ANALYTICS.track('license_activated', {});
      } catch (e) { /* never break UI */ }
      refreshUI();
    } else if (data.code === 'activation_limit' || data.reason === 'activation_limit') {
      showFormError('This key is already active on 2 browsers. Deactivate it on an old browser first, then try again.');
    } else if (data.reason === 'device_mismatch') {
      showFormError('This key is already active in another browser. Contact support to move it.');
    } else {
      showFormError('Invalid or inactive license key.');
    }
  } catch (err) {
    showFormError('Could not verify license. Check your connection.');
  }
  btn.textContent = 'Activate Pro';
});

document.getElementById('deactivate-btn').addEventListener('click', async () => {
  // Free the server-side activation slot first (best-effort), then wipe local.
  try {
    const { licenseKey } = await chrome.storage.local.get('licenseKey');
    const { vcDeviceId } = await chrome.storage.local.get('vcDeviceId');
    if (licenseKey && vcDeviceId) {
      await fetch(`${BACKEND}/api/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey, installationId: vcDeviceId })
      });
    }
  } catch (err) {
    // Offline deactivation still clears local state below.
  }
  await chrome.storage.local.remove(['licenseKey', 'licensePlan', 'licenseEmail']);
  try {
    if (globalThis.VIBEY_ANALYTICS) globalThis.VIBEY_ANALYTICS.track('license_deactivated', {});
  } catch (err) { /* never break UI */ }
  refreshUI();
});

refreshUI();