import crypto from 'crypto';
import { supabase } from '../lib/supabase.js';
import { checkRateLimit, rateLimited } from '../lib/rateLimit.js';

// Daily capture quotas, enforced server-side so they survive browser wipes,
// incognito and new profiles:
//   free (no valid license): 20/day, keyed by SHA-256 of the caller IP.
//   pro  (valid licenseKey): 300/day, keyed by SHA-256 of the license key
//          (stable for paying users across networks).
// Raw IPs and raw keys are never stored. Fail OPEN on DB trouble so a
// backend hiccup never bricks capturing.

const FREE_LIMIT = 20;
const PRO_LIMIT = 300;

function getClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function nextMidnightUTC() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}

const failOpen = (limit) => ({ allowed: true, remaining: limit - 1, resetAt: nextMidnightUTC(), limit });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { allowed: rlOk, retryAfterMs } = checkRateLimit(req, { limit: 60, windowMs: 60 * 1000, keyPrefix: 'usage' });
  if (!rlOk) return rateLimited(res, retryAfterMs);

  // Pro path: a valid, active Pro license upgrades the quota and the identity.
  let scope = 'free';
  let keyHash = crypto.createHash('sha256').update(getClientIp(req)).digest('hex');
  let limit = FREE_LIMIT;

  const { licenseKey } = req.body || {};
  if (licenseKey) {
    const { data: license } = await supabase
      .from('licenses')
      .select('plan, status')
      .eq('license_key', licenseKey)
      .single();
    if (license && license.status === 'active' && license.plan === 'pro') {
      scope = 'pro';
      keyHash = crypto.createHash('sha256').update(licenseKey).digest('hex');
      limit = PRO_LIMIT;
    }
  }

  const day = todayUTC();

  const { data: row, error: readError } = await supabase
    .from('usage_quota')
    .select('count')
    .eq('scope', scope)
    .eq('ip_hash', keyHash)
    .eq('day', day)
    .single();

  if (readError && readError.code !== 'PGRST116') {
    console.error('usage_quota read failed');
    return res.status(200).json(failOpen(limit));
  }

  const used = row ? row.count : 0;
  if (used >= limit) {
    return res.status(200).json({ allowed: false, remaining: 0, resetAt: nextMidnightUTC(), limit });
  }

  const { error: writeError } = await supabase
    .from('usage_quota')
    .upsert({ scope, ip_hash: keyHash, day, count: used + 1, updated_at: new Date().toISOString() }, { onConflict: 'scope,ip_hash,day' });

  if (writeError) {
    console.error('usage_quota write failed');
    return res.status(200).json(failOpen(limit));
  }

  res.status(200).json({ allowed: true, remaining: limit - (used + 1), resetAt: nextMidnightUTC(), limit });
}
