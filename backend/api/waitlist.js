import { supabase } from '../lib/supabase.js';
import { checkRateLimit, rateLimited } from '../lib/rateLimit.js';

// Waitlist signup for the pre-launch landing page.
// Always returns { ok: true } for valid input — even for duplicate emails —
// so the endpoint can't be used to probe which addresses signed up.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { allowed, retryAfterMs } = checkRateLimit(req, { limit: 10, windowMs: 60 * 1000, keyPrefix: 'waitlist' });
  if (!allowed) return rateLimited(res, retryAfterMs);

  const { email, source } = req.body || {};
  const clean = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!clean || clean.length > 254 || !EMAIL_RE.test(clean)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const { error } = await supabase
    .from('waitlist')
    .upsert(
      { email: clean, source: typeof source === 'string' && source.length <= 64 ? source : 'waitlist-page' },
      { onConflict: 'email', ignoreDuplicates: true }
    );

  if (error) {
    console.error('waitlist insert failed');
    return res.status(500).json({ error: 'Signup failed, try again' });
  }

  res.status(200).json({ ok: true });
}
