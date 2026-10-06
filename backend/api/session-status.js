import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';
import { checkRateLimit, rateLimited } from '../lib/rateLimit.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  const { allowed, retryAfterMs } = checkRateLimit(req, { limit: 60, windowMs: 60 * 1000, keyPrefix: 'session-status' });
  if (!allowed) return rateLimited(res, retryAfterMs);

  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const email = session.customer_email;

    const { data } = await supabase
      .from('licenses')
      .select('plan')
      .eq('email', email)
      .single();

    if (!data) return res.status(200).json({ ready: false });

    // The license key itself is never exposed here; it travels by email only.
    res.status(200).json({ ready: true, plan: String(data.plan || 'free').toLowerCase(), email });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch session' });
  }
}
