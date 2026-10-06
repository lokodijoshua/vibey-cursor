// Licensing smoke: activation limit, idempotency, deactivation, entitlements.
// Setup (operator, Supabase CLI):
//   insert into licenses (email, license_key, plan, status)
//   values ('smoke-lic@example.com', '<KEY>', 'pro', 'active');
// Run: TEST_KEY=<KEY> node scripts/smoke-licensing.js
// Teardown: delete the row + its activations.
import { BASE, check, post, freshInstall, finish } from './smoke-helpers.js';

const KEY = process.env.TEST_KEY;
if (!KEY) { console.error('TEST_KEY env required'); process.exit(2); }

const A = freshInstall();
const B = freshInstall();
const C = freshInstall();

console.log('bad key -> 404');
let r = await post('/api/activate', { licenseKey: 'VIBEY-NOPE-NOPE-NOPE-NOPE', installationId: A });
check('unknown license 404', r.status === 404, `got ${r.status}`);

console.log('missing installationId -> 422');
r = await post('/api/activate', { licenseKey: KEY });
check('installation required 422', r.status === 422, `got ${r.status}`);

console.log('activate A -> ok');
r = await post('/api/activate', { licenseKey: KEY, installationId: A });
check('activate A ok', r.status === 200 && r.json?.ok === true && r.json?.plan === 'pro', `got ${r.status}`);

console.log('re-activate A -> idempotent ok');
r = await post('/api/activate', { licenseKey: KEY, installationId: A });
check('re-activate idempotent', r.status === 200 && r.json?.ok === true, `got ${r.status}`);

console.log('activate B -> ok (slot 2)');
r = await post('/api/activate', { licenseKey: KEY, installationId: B });
check('activate B ok', r.status === 200 && r.json?.ok === true, `got ${r.status}`);

console.log('activate C -> 409');
r = await post('/api/activate', { licenseKey: KEY, installationId: C });
check('third install 409', r.status === 409 && r.json?.code === 'activation_limit', `got ${r.status}`);

console.log('deactivate B -> frees slot');
r = await post('/api/deactivate', { licenseKey: KEY, installationId: B });
check('deactivate ok', r.status === 200 && r.json?.ok === true, `got ${r.status}`);

console.log('activate C retry -> ok');
r = await post('/api/activate', { licenseKey: KEY, installationId: C });
check('slot freed', r.status === 200 && r.json?.ok === true, `got ${r.status}`);

console.log('entitlements (key+install A)');
r = await post('/api/entitlements', { licenseKey: KEY, installationId: A });
check('pro entitlements', r.status === 200 && r.json?.plan === 'pro' && r.json?.features?.screenshot_context === true, `got ${r.status}`);

console.log('entitlements (unknown) -> 401');
r = await post('/api/entitlements', {});
check('unknown identity 401', r.status === 401, `got ${r.status}`);

console.log('legacy license check still binds');
r = await post('/api/license', { licenseKey: KEY, installationId: A });
check('legacy valid', r.status === 200 && r.json?.valid === true, `got ${r.status}`);

console.log('cleanup: deactivate A + C (operator deletes license row)');
await post('/api/deactivate', { licenseKey: KEY, installationId: A });
await post('/api/deactivate', { licenseKey: KEY, installationId: C });

finish('smoke-licensing');
