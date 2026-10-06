// Shared smoke-test helpers. Usage:
//   node scripts/smoke-licensing.js
// Throwaway fixtures are created/deleted by the operator via Supabase CLI;
// scripts never contain secrets. BASE defaults to production.
import { randomUUID } from 'crypto';

export const BASE = process.env.VC_BASE || 'https://vibeycursor-backend.vercel.app';

let failures = 0;
export function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name} ${detail}`.slice(0, 300)); }
}

export async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}

export function freshInstall() {
  return `smoke-${randomUUID()}`;
}

export function finish(label) {
  console.log(failures === 0 ? `PASS ${label}` : `FAILURES ${label}: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}
