// Stripe + session smoke: signature enforcement, key non-exposure.
// Cannot forge a valid signature without the webhook secret — that IS the
// test: unsigned/tampered posts must fail. Idempotency + lifecycle are
// verified on the next real payment (Stripe Dashboard -> test clock or live).
// Run: node scripts/smoke-stripe.js
import { check, post, finish } from './smoke-helpers.js';
import { BASE } from './smoke-helpers.js';

console.log('webhook without signature -> 400');
{
  const r = await fetch(BASE + '/api/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } }),
  });
  check('unsigned webhook 400', r.status === 400, `got ${r.status}`);
}

console.log('webhook with forged signature -> 400');
{
  const r = await fetch(BASE + '/api/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=123,v1=forged' },
    body: JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } }),
  });
  check('forged webhook 400', r.status === 400, `got ${r.status}`);
}

console.log('session-status exposes no key');
{
  const r = await fetch(BASE + '/api/session-status?session_id=cs_test_bogus');
  const j = await r.json().catch(() => ({}));
  const hasKey = JSON.stringify(j).includes('VIBEY-');
  check('no key in body', !hasKey, `got ${r.status}`);
}

console.log('waitlist validation intact');
{
  const r = await post('/api/waitlist', { email: 'not-an-email' });
  check('bad email 400', r.status === 400, `got ${r.status}`);
}

finish('smoke-stripe');
