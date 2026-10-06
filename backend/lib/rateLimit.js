// Simple in-memory fixed-window rate limiter.
// Limitation: per serverless instance only — counts reset on cold start
// and are not shared across instances. Sufficient as P0 abuse brake,
// replace with Upstash Redis for production multi-instance limits.

const hits = new Map();

function getClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function checkRateLimit(req, { limit = 20, windowMs = 60 * 1000, keyPrefix = '' } = {}) {
  const ip = getClientIp(req);
  const key = `${keyPrefix}:${ip}`;
  const now = Date.now();

  const entry = hits.get(key);
  if (!entry || now > entry.reset) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return { allowed: true };
  }

  if (entry.count >= limit) {
    return { allowed: false, retryAfterMs: entry.reset - now };
  }

  entry.count += 1;
  return { allowed: true };
}

export function rateLimited(res, retryAfterMs) {
  res.setHeader('Retry-After', Math.ceil((retryAfterMs || 60000) / 1000));
  return res.status(429).json({ error: 'Too many requests' });
}
