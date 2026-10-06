import { supabase } from '../lib/supabase.js';
import { checkRateLimit, rateLimited } from '../lib/rateLimit.js';
import { config } from '../lib/config.js';
import { findLicense, entitlementFor, openActivations, touchActivation } from '../lib/licensing.js';

// POST /api/license { licenseKey, deviceId?, installationId? }
// Legacy-compatible validation. deviceId is treated as the installation id.
// Enforces the activation limit: a second browser binds if a slot is free,
// a third gets 409. Keeps the historical {valid, plan} response shape.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { allowed, retryAfterMs } = checkRateLimit(req, { limit: 30, windowMs: 60 * 1000, keyPrefix: 'license' });
  if (!allowed) return rateLimited(res, retryAfterMs);

  const { licenseKey, deviceId, installationId } = req.body || {};
  if (!licenseKey) return res.status(400).json({ error: 'Missing license key' });
  const installation = installationId || deviceId || null;

  const { license } = await findLicense(supabase, licenseKey);
  if (!license) {
    return res.status(404).json({ valid: false, plan: 'free', error: 'License not found' });
  }

  const { pro, plan } = entitlementFor(license);
  if (!pro) {
    return res.status(200).json({ valid: false, plan: 'free', email: license.email });
  }

  if (installation) {
    let slots;
    try {
      slots = await openActivations(supabase, license.id);
    } catch (err) {
      console.error('activation lookup failed');
      return res.status(500).json({ error: 'Validation failed, try again' });
    }

    const mine = slots.find((s) => s.installation_id === installation);
    if (mine) {
      await touchActivation(supabase, license.id, installation);
    } else if (slots.length >= config.MAX_ACTIVE_ACTIVATIONS) {
      return res.status(409).json({ valid: false, plan: 'free', reason: 'activation_limit', code: 'activation_limit' });
    } else {
      const { error: insertError } = await supabase.from('activations').insert({
        license_id: license.id,
        installation_id: installation,
        status: 'active',
      });
      if (insertError) {
        console.error('activation insert failed');
        return res.status(500).json({ error: 'Validation failed, try again' });
      }
    }
  }

  res.status(200).json({ valid: true, plan, email: license.email });
}
