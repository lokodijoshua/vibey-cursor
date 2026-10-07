import { supabase } from '../lib/supabase.js';
import { checkRateLimit, rateLimited } from '../lib/rateLimit.js';
import { config } from '../lib/config.js';
import { findLicense, entitlementFor, hashIdentity } from '../lib/licensing.js';
import crypto from 'crypto';

// POST /api/analytics { installationId, licenseKey?, sessionId?, planHint?, events: [...] }
// Behavior telemetry ingestion. Product intelligence only:
// metadata (element type, dimensions, counts) — never prompts, HTML,
// input values, keystrokes, or raw URLs. Fail-open for the product:
// ingestion errors never block capture/copy/enhance (client is
// fire-and-forget; server returns 202 on partial success).
//
// Privacy rules enforced here:
// - installationId is hashed (sha256) before storage; raw id never stored.
// - hostname (if sent) is hashed into metadata.hostname_hash; raw dropped.
// - licenseKey (if sent) resolves license_id + authoritative plan; raw never stored.
// - event names + element types are allowlisted; unknown values → 'other'/dropped.
// - per-installation rolling-24h cap bounds volume and cost.
const EVENT_ALLOWLIST = new Set([
  'inspector_toggled',
  'element_highlighted',
  'vibey_shown',
  'vibey_hidden',
  'capture_started',
  'capture_completed',
  'capture_denied',
  'capture_failed',
  'prompt_copied',
  'prompt_generated',
  'json_copied',
  'json_locked',
  'enhance_requested',
  'enhance_completed',
  'enhance_failed',
  'history_opened',
  'history_item_copied',
  'history_item_deleted',
  'upsell_shown',
  'upsell_clicked',
  'license_activated',
  'license_deactivated',
  'shortcut_used',
  'tool_deactivated',
]);

const ELEMENT_ALLOWLIST = new Set([
  'button',
  'link',
  'media',
  'heading',
  'text',
  'form-field',
  'form',
  'navigation',
  'section',
  'component',
  'list-table',
  'modal',
  'other',
]);

function cleanStr(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.slice(0, max);
  return s.length ? s : null;
}

function cleanNum(v, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < min || v > max) return null;
  return v;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { allowed, retryAfterMs } = checkRateLimit(req, { limit: 60, windowMs: 60 * 1000, keyPrefix: 'analytics' });
  if (!allowed) return rateLimited(res, retryAfterMs);

  const { installationId, licenseKey, sessionId, events } = req.body || {};
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'Missing events batch' });
  }
  if (events.length > config.ANALYTICS_MAX_BATCH) {
    return res.status(400).json({ error: 'Batch too large' });
  }
  if (!installationId || typeof installationId !== 'string' || installationId.length > 128) {
    return res.status(422).json({ error: 'Valid installationId required' });
  }

  const installationHash = hashIdentity(`install:${installationId}`);

  // Resolve authoritative plan + license link (never trust client plan).
  let licenseId = null;
  let plan = 'free';
  if (licenseKey) {
    try {
      const { license } = await findLicense(supabase, licenseKey);
      if (license) {
        licenseId = license.id;
        plan = entitlementFor(license).plan || 'free';
      }
    } catch (err) {
      console.error('analytics license lookup failed');
    }
  }

  // Rolling-24h per-installation volume cap.
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('analytics_events')
      .select('id')
      .eq('installation_hash', installationHash)
      .gte('created_at', since)
      .limit(config.ANALYTICS_DAILY_CAP + 1);
    if (!error && (data || []).length >= config.ANALYTICS_DAILY_CAP) {
      return res.status(429).json({ error: 'Analytics quota reached' });
    }
  } catch (err) {
    console.error('analytics cap check failed');
  }

  const cleanSession = cleanStr(sessionId, 36);

  const rows = [];
  for (const e of events.slice(0, config.ANALYTICS_MAX_BATCH)) {
    if (!e || typeof e !== 'object') continue;
    if (!EVENT_ALLOWLIST.has(e.event)) continue;
    const elementType = ELEMENT_ALLOWLIST.has(e.element_type) ? e.element_type : null;
    // Hostname is hashed; raw value is never persisted.
    const hostRaw = cleanStr(e.hostname, 128);
    const metadata = {
      tag: cleanStr(e.tag, 32),
      mode: e.mode === 'section' ? 'section' : e.mode === 'element' ? 'element' : null,
      viewport_w: cleanNum(e.viewport_w, 1, 10000),
      viewport_h: cleanNum(e.viewport_h, 1, 10000),
      el_w: cleanNum(e.el_w, 0, 20000),
      el_h: cleanNum(e.el_h, 0, 20000),
      norm_x: cleanNum(e.norm_x, 0, 1),
      norm_y: cleanNum(e.norm_y, 0, 1),
      prompt_chars: cleanNum(e.prompt_chars, 0, 100000),
      error: cleanStr(e.error, 64),
      source: cleanStr(e.source, 32),
    };
    if (hostRaw) {
      try {
        metadata.hostname_hash = hashIdentity(`host:${hostRaw.toLowerCase()}`);
      } catch (err) { /* hashing must never break ingestion */ }
    }
    // Strip nulls to keep rows small.
    for (const k of Object.keys(metadata)) {
      if (metadata[k] === null || metadata[k] === undefined) delete metadata[k];
    }
    rows.push({
      event_id: cleanStr(e.event_id, 36) || crypto.randomUUID(),
      event_name: e.event,
      installation_hash: installationHash,
      license_id: licenseId,
      session_id: cleanSession,
      plan,
      element_type: elementType,
      metadata,
    });
  }

  if (rows.length === 0) return res.status(202).json({ ok: true, stored: 0 });

  // event_id dedupe: duplicates (retries) are ignored, not errors.
  try {
    const { error } = await supabase.from('analytics_events').upsert(rows, {
      onConflict: 'event_id',
      ignoreDuplicates: true,
    });
    if (error) {
      console.error('analytics insert failed');
      return res.status(202).json({ ok: true, stored: 0 });
    }
  } catch (err) {
    console.error('analytics insert failed');
    return res.status(202).json({ ok: true, stored: 0 });
  }

  return res.status(202).json({ ok: true, stored: rows.length });
}
