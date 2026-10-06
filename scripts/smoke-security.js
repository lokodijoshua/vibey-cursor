// Security smoke: tampering, replay posture, fail-closed posture.
// Run: TEST_KEY=<active-pro-key> node scripts/smoke-security.js
// (uses the key read-only except one harmless touch via entitlements)
import { check, post, freshInstall, finish } from './smoke-helpers.js';

const KEY = process.env.TEST_KEY;
if (!KEY) { console.error('TEST_KEY env required'); process.exit(2); }

console.log('storage-style tamper: fake pro claims change nothing server-side');
let r = await post('/api/entitlements', { installationId: freshInstall() });
check('anon install is free', r.json?.plan === 'free' && r.json?.features?.screenshot_context === false, `got ${r.status}`);

console.log('plan field in body ignored');
r = await post('/api/usage', { installationId: freshInstall(), plan: 'pro', features: { ai_enhance: true } });
check('body plan ignored', r.json?.limit === 20, `got ${r.status}`);

console.log('old activation response cannot mint quota (live check per call)');
r = await post('/api/entitlements', { licenseKey: 'VIBEY-STALE-KEY', installationId: freshInstall() });
check('stale key stays free', r.json?.plan === 'free', `got ${r.status}`);

console.log('canceled subscription loses pro (operator flips status, then:)');
// operator: update licenses set status='canceled' where license_key='<KEY>'
r = await post('/api/entitlements', { licenseKey: KEY, installationId: freshInstall() });
console.log(`  (run again after cancel flip; currently plan=${r.json?.plan})`);

console.log('method enforcement');
{
  const { BASE } = await import('./smoke-helpers.js');
  const g = await fetch(BASE + '/api/activate');
  check('GET activate 405', g.status === 405, `got ${g.status}`);
}

finish('smoke-security');
