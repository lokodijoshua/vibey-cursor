import { supabase } from '../lib/supabase.js';
import { checkRateLimit, rateLimited } from '../lib/rateLimit.js';
import { config } from '../lib/config.js';
import { findLicense, entitlementFor, openActivations, touchActivation, hashIdentity, countRecentEvents, featuresFor } from '../lib/licensing.js';

// POST /api/entitlements { licenseKey?, installationId? }
// Central capability source. Answers "what can this installation do?"
// derived live from license + subscription + activation state.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { allowed, retryAfterMs } = checkRateLimit(req, { limit: 60, windowMs: 60 * 1000, keyPrefix: 'entitlements' });
  if (!allowed) return rateLimited(res, retryAfterMs);

  const { licenseKey, installationId } = req.body || {};
  if (!licenseKey && !installationId) {
    return res.status(401).json({ error: 'Unknown identity' });
  }

  let plan = 'free';
  let features = featuresFor('free');

  if (licenseKey) {
    const { license } = await findLicense(supabase, licenseKey);
    if (license) {
      const ent = entitlementFor(license);
      if (ent.pro) {
        if (installationId) {
          try {
            const slots = await openActivations(supabase, license.id);
            const mine = slots.find((s) => s.installation_id === installationId);
            if (mine) {
              await touchActivation(supabase, license.id, installationId);
              plan = 'pro';
              features = featuresFor('pro');
            }
          } catch (err) {
            console.error('entitlement activation check failed');
          }
        } else {
          plan = 'pro';
          features = featuresFor('pro');
        }
      }
    }
  }

  // Quota snapshot for the caller's identity (best-effort; never blocks).
  let quota = null;
  try {
    const idHash = hashIdentity(installationId || licenseKey || 'unknown');
    const windowMinutes = plan === 'pro' ? 24 * 60 : config.FREE_CAPTURE_WINDOW_MINUTES;
    const used = await countRecentEvents(supabase, idHash, windowMinutes);
    const limit = plan === 'pro' ? config.PRO_INTERNAL_CAPTURE_LIMIT : config.FREE_CAPTURE_LIMIT;
    quota = {
      remaining: Math.max(0, limit - used),
      limit,
      resetInMinutes: windowMinutes,
    };
  } catch (err) {
    quota = null;
  }

  res.status(200).json({ plan, features, quota });
}
