import { supabase } from '../lib/supabase.js';
import { checkRateLimit, rateLimited } from '../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { allowed, retryAfterMs } = checkRateLimit(req, { limit: 30, windowMs: 60 * 1000, keyPrefix: 'license' });
  if (!allowed) return rateLimited(res, retryAfterMs);

  const { licenseKey, deviceId } = req.body || {};
  if (!licenseKey) return res.status(400).json({ error: 'Missing license key' });

  const { data, error } = await supabase
    .from('licenses')
    .select('plan, status, email, device_id')
    .eq('license_key', licenseKey)
    .single();

  if (error || !data) {
    return res.status(200).json({ valid: false, plan: 'free' });
  }

  const valid = data.status === 'active';

  if (valid && deviceId) {
    if (!data.device_id) {
      // First activation on this key: bind it to this browser.
      await supabase
        .from('licenses')
        .update({ device_id: deviceId, device_bound_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('license_key', licenseKey);
    } else if (data.device_id !== deviceId) {
      // Key already belongs to a different browser.
      return res.status(200).json({ valid: false, plan: 'free', reason: 'device_mismatch' });
    }
  }

  res.status(200).json({
    valid,
    plan: valid ? data.plan : 'free',
    email: data.email
  });
}
