import { supabase } from '../lib/supabase.js';
import { checkRateLimit, rateLimited } from '../lib/rateLimit.js';
import { config } from '../lib/config.js';
import {
  findLicense,
  entitlementFor,
  openActivations,
  touchActivation,
  hashIdentity,
  countRecentEvents,
  recordEvent,
} from '../lib/licensing.js';

// POST /api/usage { licenseKey?, installationId? }
// Persistent rolling-window capture quota — the authoritative business
// quota (in-memory limits are only an outer abuse ring).
//   free: 20 captures / rolling 20 min, identity = installation id if known,
//         else anonymous record, else IP hash (abuse ring).
//   pro:  500 captures / rolling 24h, identity = license hash.
// FAIL-CLOSED: if Supabase cannot be read/written, respond 503 with retry
// info instead of granting unlimited usage. Raw IPs/keys are never stored.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { allowed: rlOk, retryAfterMs } = checkRateLimit(req, { limit: 60, windowMs: 60 * 1000, keyPrefix: 'usage' });
  if (!rlOk) return rateLimited(res, retryAfterMs);

  const unavailable = () =>
    res.status(503).json({ error: 'Quota service temporarily unavailable', retry_after_seconds: config.QUOTA_UNAVAILABLE_RETRY_SECONDS });

  try {
    const { licenseKey, installationId } = req.body || {};

    let identityHash;
    let identityType;
    let limit;
    let windowMinutes;

    if (licenseKey) {
      const { license } = await findLicense(supabase, licenseKey);
      const { pro } = entitlementFor(license);
      if (license && pro) {
        identityHash = hashIdentity(`license:${license.id}`);
        identityType = 'license';
        limit = config.PRO_INTERNAL_CAPTURE_LIMIT;
        windowMinutes = 24 * 60;
        if (installationId) {
          try {
            const slots = await openActivations(supabase, license.id);
            if (slots.find((s) => s.installation_id === installationId)) {
              await touchActivation(supabase, license.id, installationId);
            }
          } catch (err) {
            console.error('usage activation touch failed');
          }
        }
      }
    }

    if (!identityHash) {
      if (installationId && typeof installationId === 'string' && installationId.length <= 128) {
        identityHash = hashIdentity(`install:${installationId}`);
        identityType = 'install';
        try {
          await supabase.from('anonymous_installations').upsert(
            { installation_id: installationId, last_seen: new Date().toISOString() },
            { onConflict: 'installation_id', ignoreDuplicates: false }
          );
        } catch (err) {
          console.error('anonymous installation record failed');
        }
      } else {
        const forwarded = req.headers?.['x-forwarded-for'];
        const ip = typeof forwarded === 'string' && forwarded.length > 0
          ? forwarded.split(',')[0].trim()
          : req.socket?.remoteAddress || 'unknown';
        identityHash = hashIdentity(`ip:${ip}`);
        identityType = 'ip';
      }
      limit = config.FREE_CAPTURE_LIMIT;
      windowMinutes = config.FREE_CAPTURE_WINDOW_MINUTES;
    }

    const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const { data: events, error: readError } = await supabase
      .from('usage_events')
      .select('created_at')
      .eq('identity_hash', identityHash)
      .eq('operation', 'capture')
      .eq('result', 'allowed')
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    if (readError) {
      console.error('usage read failed');
      return unavailable();
    }

    const used = (events || []).length;
    if (used >= limit) {
      try {
        await recordEvent(supabase, { identityHash, identityType, operation: 'capture', result: 'denied' });
      } catch (err) {
        console.error('usage deny-record failed');
      }
      const oldest = new Date(events[0].created_at).getTime();
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMinutes * 60 * 1000 - Date.now()) / 1000));
      return res.status(429).json({
        allowed: false,
        remaining: 0,
        limit,
        error: 'Quota exceeded',
        code: 'quota_exceeded',
        retry_after_seconds: retryAfter,
        resetAt: new Date(oldest + windowMinutes * 60 * 1000).toISOString(),
      });
    }

    try {
      await recordEvent(supabase, { identityHash, identityType, operation: 'capture', result: 'allowed' });
    } catch (err) {
      console.error('usage record failed');
      return unavailable();
    }

    return res.status(200).json({
      allowed: true,
      remaining: limit - used - 1,
      limit,
      resetAt: new Date(Date.now() + windowMinutes * 60 * 1000).toISOString(),
    });
  } catch (err) {
    console.error('usage handler failed');
    return unavailable();
  }
}
