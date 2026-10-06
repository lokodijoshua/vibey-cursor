// Pro + enhance smoke: entitlement gates and the OpenAI cost ceiling.
// Setup: TEST_KEY must be an ACTIVE pro license (supabase insert).
// This makes exactly ONE real OpenAI call. Teardown: delete the row.
// Run: TEST_KEY=<KEY> node scripts/smoke-pro.js
import { check, post, freshInstall, finish } from './smoke-helpers.js';

const KEY = process.env.TEST_KEY;
if (!KEY) { console.error('TEST_KEY env required'); process.exit(2); }
const I = freshInstall();

console.log('enhance without key -> 403');
let r = await post('/api/enhance', { prompt: 'hello' });
check('no key 403', r.status === 403, `got ${r.status}`);

console.log('enhance bad key -> 403');
r = await post('/api/enhance', { prompt: 'hello', licenseKey: 'VIBEY-NOPE' });
check('bad key 403', r.status === 403, `got ${r.status}`);

console.log('enhance oversize -> 400');
r = await post('/api/enhance', { prompt: 'x'.repeat(4001), licenseKey: KEY });
check('oversize 400', r.status === 400, `got ${r.status}`);

console.log('enhance unknown installation -> 403 activation_required');
r = await post('/api/enhance', { prompt: 'red button', licenseKey: KEY, installationId: `ghost-${I}` });
check('unactivated install 403', r.status === 403, `got ${r.status} ${JSON.stringify(r.json)}`);

console.log('activate install, then enhance -> 200 (one OpenAI call)');
await post('/api/activate', { licenseKey: KEY, installationId: I });
r = await post('/api/enhance', { prompt: 'blue button, 100px wide', licenseKey: KEY, installationId: I });
check('pro enhance ok', r.status === 200 && typeof r.json?.enhanced === 'string' && r.json.enhanced.length > 0, `got ${r.status}`);

console.log('pro quota tier visible');
const q = await post('/api/usage', { licenseKey: KEY, installationId: I });
check('pro tier limit', q.status === 200 && q.json?.limit === 500, `got ${q.status} ${JSON.stringify(q.json)}`);

console.log('cleanup');
await post('/api/deactivate', { licenseKey: KEY, installationId: I });

finish('smoke-pro');
