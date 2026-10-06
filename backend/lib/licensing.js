import crypto from 'crypto';
import { config, FEATURES } from './config.js';

// Shared licensing core. Every privileged endpoint derives authorization
// from here — never from client-supplied plan flags.
//
// Security rules enforced in this module:
// - License lookup is by SHA-256 hash of the presented key. A plaintext
//   fallback exists during the transition and self-heals (backfills the
//   hash); the plaintext column is dropped in a later migration.
// - Raw keys are never logged. Log identifiers/hashes only.
// - Server timestamps only. Client clocks are never trusted.

export function hashKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey || '')).digest('hex');
}

export function hashIdentity(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

// Find a license by presented key: hash first, plaintext fallback + backfill.
export async function findLicense(supabase, rawKey) {
  if (!rawKey) return { license: null };
  const hash = hashKey(rawKey);

  const byHash = await supabase
    .from('licenses')
    .select('id, email, license_key, plan, status, device_id, grace_until')
    .eq('key_hash', hash)
    .single();
  if (byHash.data && !byHash.error) return { license: byHash.data };

  const byPlain = await supabase
    .from('licenses')
    .select('id, email, license_key, plan, status, device_id, grace_until')
    .eq('license_key', rawKey)
    .single();
  if (byPlain.error || !byPlain.data) return { license: null };

  // Self-healing backfill: store the hash so next lookup hits the fast path.
  await supabase
    .from('licenses')
    .update({ key_hash: hash, updated_at: new Date().toISOString() })
    .eq('id', byPlain.data.id);

  return { license: byPlain.data };
}

// Central subscription-status → entitlement mapping. The ONLY place that
// decides what a status means. Past-due stays Pro inside the grace window.
export function entitlementFor(license) {
  if (!license || String(license.plan || '').toLowerCase() !== 'pro') {
    return { pro: false, plan: 'free' };
  }
  if (license.status === 'active') return { pro: true, plan: 'pro' };
  if (license.status === 'past_due' && license.grace_until && new Date(license.grace_until) > new Date()) {
    return { pro: true, plan: 'pro' };
  }
  return { pro: false, plan: 'free' };
}

export function featuresFor(plan) {
  return { ...(FEATURES[plan] || FEATURES.free) };
}

// Open (non-deactivated) activations for a license, oldest first.
export async function openActivations(supabase, licenseId) {
  const { data, error } = await supabase
    .from('activations')
    .select('id, installation_id, activated_at, last_seen_at')
    .eq('license_id', licenseId)
    .is('deactivated_at', null)
    .order('activated_at', { ascending: true });
  if (error) throw new Error('activation lookup failed');
  return data || [];
}

export async function touchActivation(supabase, licenseId, installationId) {
  await supabase
    .from('activations')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('license_id', licenseId)
    .eq('installation_id', installationId)
    .is('deactivated_at', null);
}

// Count usage_events for an identity inside a rolling window (minutes).
export async function countRecentEvents(supabase, identityHash, windowMinutes) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('usage_events')
    .select('id')
    .eq('identity_hash', identityHash)
    .gte('created_at', since);
  if (error) throw new Error('usage lookup failed');
  return (data || []).length;
}

export async function recordEvent(supabase, { identityHash, identityType, operation, result }) {
  const { error } = await supabase.from('usage_events').insert({
    identity_hash: identityHash,
    identity_type: identityType,
    operation,
    result,
  });
  if (error) throw new Error('usage record failed');
}
