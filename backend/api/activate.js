import { supabase } from '../lib/supabase.js';
import { checkRateLimit, rateLimited } from '../lib/rateLimit.js';
import { config } from '../lib/config.js';
import { findLicense, entitlementFor, openActivations, touchActivation, featuresFor } from '../lib/licensing.js';

// POST /api/activate { licenseKey, installationId }
// Binds an installation slot to a Pro license (max 2 open). Idempotent for
// the same installation. Returns 409 when all slots are taken by others.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { allowed, retryAfterMs } = checkRateLimit(req, { limit: 30, windowMs: 60 * 1000, keyPrefix: 'activate' });
  if (!allowed) return rateLimited(res, retryAfterMs);

  const { licenseKey, installationId } = req.body || {};
  if (!licenseKey) return res.status(400).json({ error: 'Missing license key' });
  if (!installationId || typeof installationId !== 'string' || installationId.length > 128) {
    return res.status(422).json({ error: 'Valid installationId required' });
  }

  const { license } = await findLicense(supabase, licenseKey);
  if (!license) return res.status(404).json({ error: 'License not found' });

  const { pro, plan } = entitlementFor(license);
  if (!pro) {
    return res.status(403).json({ error: 'Subscription is not active', plan: 'free' });
  }

  let slots;
  try {
    slots = await openActivations(supabase, license.id);
  } catch (err) {
    console.error('activation lookup failed');
    return res.status(500).json({ error: 'Activation failed, try again' });
  }

  const existing = slots.find((s) => s.installation_id === installationId);
  if (existing) {
    await touchActivation(supabase, license.id, installationId);
    return res.status(200).json({ ok: true, plan, features: featuresFor(plan), email: license.email });
  }

  if (slots.length >= config.MAX_ACTIVE_ACTIVATIONS) {
    return res.status(409).json({ error: 'License already active on 2 browsers', code: 'activation_limit', plan: 'free' });
  }

  const { error: insertError } = await supabase.from('activations').insert({
    license_id: license.id,
    installation_id: installationId,
    status: 'active',
  });
  if (insertError) {
    console.error('activation insert failed');
    return res.status(500).json({ error: 'Activation failed, try again' });
  }

  res.status(200).json({ ok: true, plan, features: featuresFor(plan), email: license.email });
}
