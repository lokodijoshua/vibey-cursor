// VibeyCursor behavior analytics — fire-and-forget, never blocks product.
// Queue in memory + chrome.storage.local (survives SW suspension), flushed
// by the background service worker. Sampling for high-volume events.
// No prompts, HTML, input values, keystrokes, or raw URLs ever queued.
(function () {
  const QUEUE_KEY = 'vcAnalyticsQueue';
  const SESSION_KEY = 'vcSessionId';
  const MAX_QUEUE = 200;
  const FLUSH_AT = 20;

  let memQueue = [];
  let sessionId = null;
  let hydrated = false;

  function uuid() {
    try {
      if (crypto.randomUUID) return crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }

  async function ensureSession() {
    if (sessionId) return sessionId;
    try {
      const got = await chrome.storage.local.get(SESSION_KEY);
      if (got && got[SESSION_KEY]) {
        sessionId = got[SESSION_KEY];
        return sessionId;
      }
    } catch (e) { /* storage may be unavailable */ }
    sessionId = uuid();
    try {
      await chrome.storage.local.set({ [SESSION_KEY]: sessionId });
    } catch (e) { /* non-fatal */ }
    return sessionId;
  }

  async function hydrate() {
    if (hydrated) return;
    hydrated = true;
    try {
      const got = await chrome.storage.local.get(QUEUE_KEY);
      if (got && Array.isArray(got[QUEUE_KEY])) memQueue = got[QUEUE_KEY].slice(-MAX_QUEUE);
    } catch (e) { memQueue = []; }
    ensureSession();
  }

  async function persist() {
    try {
      await chrome.storage.local.set({ [QUEUE_KEY]: memQueue.slice(-MAX_QUEUE) });
    } catch (e) { /* queue is best-effort */ }
  }

  // Sampling: hover/highlight-type events pass `sample: 50` (1-in-50).
  function track(event, props) {
    try {
      hydrate();
      const p = props && typeof props === 'object' ? props : {};
      if (p.sample && p.sample > 1) {
        if (Math.floor(Math.random() * p.sample) !== 0) return;
      }
      const entry = {
        event_id: uuid(),
        event,
        ts_client: Date.now(),
        session_hint: sessionId,
      };
      for (const k of ['element_type', 'tag', 'mode', 'viewport_w', 'viewport_h',
        'el_w', 'el_h', 'norm_x', 'norm_y', 'prompt_chars', 'hostname',
        'error', 'source']) {
        if (p[k] !== undefined && p[k] !== null) entry[k] = p[k];
      }
      memQueue.push(entry);
      if (memQueue.length > MAX_QUEUE) memQueue = memQueue.slice(-MAX_QUEUE);
      persist();
      // Nudge the background to flush soon (no-op if SW unavailable).
      // The promise form is caught: during reload/update there may be no
      // receiving end yet, which must never surface as an unhandled error.
      try {
        if (chrome.runtime && chrome.runtime.sendMessage) {
          const p = chrome.runtime.sendMessage({ type: 'ANALYTICS_FLUSH_HINT' });
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch (e) { /* sw may be asleep; alarm flush covers it */ }
    } catch (e) { /* analytics must never throw into product code */ }
  }

  // Called by background SW: drain up to `limit` events for one POST.
  async function drain(limit) {
    await hydrate();
    const n = Math.min(limit || 50, memQueue.length);
    if (n === 0) return [];
    const batch = memQueue.slice(0, n);
    memQueue = memQueue.slice(n);
    await persist();
    return batch;
  }

  // Called by background SW on POST failure: re-queue at front (bounded).
  async function requeue(batch) {
    await hydrate();
    if (!Array.isArray(batch) || batch.length === 0) return;
    memQueue = batch.concat(memQueue).slice(0, MAX_QUEUE);
    await persist();
  }

  globalThis.VIBEY_ANALYTICS = { track, drain, requeue, SESSION_KEY, QUEUE_KEY, FLUSH_AT };
})();
