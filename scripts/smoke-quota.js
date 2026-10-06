// Quota smoke: rolling 20/20m free wall, retry info, install isolation.
// No fixtures needed (fresh random installation ids start at zero).
// Run: node scripts/smoke-quota.js
import { BASE, check, post, freshInstall, finish } from './smoke-helpers.js';

const I = freshInstall();
console.log('free: 20 allowed then 21st denied');
let last = null;
for (let i = 1; i <= 21; i++) {
  last = await post('/api/usage', { installationId: I });
  if (i <= 20 && !(last.status === 200 && last.json?.allowed === true)) {
    check(`call ${i} allowed`, false, `got ${last.status}`);
    break;
  }
}
check('21st denied with 429', last.status === 429 && last.json?.allowed === false, `got ${last.status}`);
check('retry_after_seconds present', typeof last.json?.retry_after_seconds === 'number' && last.json.retry_after_seconds > 0, JSON.stringify(last.json).slice(0, 120));
check('limit echoed', last.json?.limit === 20, JSON.stringify(last.json).slice(0, 120));

console.log('isolation: fresh install unaffected');
const J = freshInstall();
const r = await post('/api/usage', { installationId: J });
check('other install allowed', r.status === 200 && r.json?.allowed === true && r.json?.remaining === 19, `got ${r.status}`);

console.log('tampered plan ignored (no key -> free tier)');
const t = await post('/api/usage', { installationId: freshInstall(), plan: 'pro', isPro: true });
check('client plan flags ignored', t.status === 200 && t.json?.limit === 20, `got ${t.status}`);

finish('smoke-quota');
