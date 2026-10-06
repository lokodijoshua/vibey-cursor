import { supabase } from '../lib/supabase.js';
import { checkRateLimit, rateLimited } from '../lib/rateLimit.js';
import { findLicense } from '../lib/licensing.js';

// POST /api/deactivate { licenseKey, installationId }
// Frees an installation slot (idempotent: unknown slot still returns ok).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { allowed, retryAfterMs } = checkRateLimit(req, { limit: 30, windowMs: 60 * 1000, keyPrefix: 'deactivate' });
  if (!allowed) return rateLimited(res, retryAfterMs);

  const { licenseKey, installationId } = req.body || {};
  if (!licenseKey) return res.status(400).json({ error: 'Missing license key' });
  if (!installationId || typeof installationId !== 'string' || installationId.length > 128) {
    return res.status(422).json({ error: 'Valid installationId required' });
  }

  const { license } = await findLicense(supabase, licenseKey);
  if (!license) return res.status(404).json({ error: 'License not found' });

  const { error } = await supabase
    .from('activations')
    .update({ deactivated_at: new Date().toISOString(), status: 'revoked' })
    .eq('license_id', license.id)
    .eq('installation_id', installationId)
    .is('deactivated_at', null);

  if (error) {
    console.error('deactivation failed');
    return res.status(500).json({ error: 'Deactivation failed, try again' });
  }

  res.status(200).json({ ok: true });
}
