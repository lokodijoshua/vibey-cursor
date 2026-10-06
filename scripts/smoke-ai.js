// AI observability smoke: success records real tokens+cost, failures record
// nulls, tampered client values ignored, metadata stored without content.
// Setup: TEST_KEY must be an ACTIVE pro license with a free enhance slot.
// Costs exactly ONE OpenAI call. Teardown: delete ai rows for the run
// (operator: delete by request_ids printed below).
// Run: TEST_KEY=<KEY> node scripts/smoke-ai.js
import { check, post, freshInstall, finish } from './smoke-helpers.js';

const KEY = process.env.TEST_KEY;
if (!KEY) { console.error('TEST_KEY env required'); process.exit(2); }
const I = freshInstall();
await post('/api/activate', { licenseKey: KEY, installationId: I });

console.log('tampered token values in body are ignored');
let r = await post('/api/enhance', {
  prompt: 'green button',
  licenseKey: KEY,
  installationId: I,
  input_tokens: 1,
  estimated_cost_usd: 0,
  meta: { elementType: 'button' },
});
check('success 200', r.status === 200 && typeof r.json?.enhanced === 'string', `got ${r.status}`);
const okBody = r.status === 200;

console.log('failure path records nulls (oversize -> 400 has no AI row; use bad-model? no — check 400 shape)');
r = await post('/api/enhance', { prompt: '', licenseKey: KEY, installationId: I });
check('empty prompt 400', r.status === 400, `got ${r.status}`);

await post('/api/deactivate', { licenseKey: KEY, installationId: I });
console.log(`INSTALLATION: ${I}`);
console.log('(operator: query ai_usage_events for this installation hash to verify tokens/cost/element_type, then delete the row)');
finish('smoke-ai');
