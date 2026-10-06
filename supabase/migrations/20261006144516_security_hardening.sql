-- Security hardening: activations, key hashing, webhook idempotency,
-- rolling-window usage events, anonymous installs, subscription grace.
-- All additive. Existing rows preserved. Plaintext license_key column is
-- kept until the hashed flow is proven; it is dropped in a later migration.

-- 1. License key hash (SHA-256). Verification looks up by hash so the raw
-- key never needs to live in the database. Hashes are computed in Node
-- (not pgcrypto) and backfilled lazily by the license endpoint on next
-- validation of each key, so no SQL-level hashing is required here.
alter table licenses add column if not exists key_hash text;
alter table licenses add column if not exists grace_until timestamp with time zone;

create unique index if not exists idx_licenses_key_hash on licenses (key_hash);

-- 2. Activations: license -> installation slots (max 2 open per license).
create table if not exists activations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses(id) on delete cascade,
  installation_id text not null,
  activated_at timestamp with time zone default now(),
  last_seen_at timestamp with time zone default now(),
  deactivated_at timestamp with time zone,
  status text not null default 'active',
  created_at timestamp with time zone default now()
);

-- One open slot per (license, installation); history rows stay for audit.
create unique index if not exists idx_activations_open
  on activations (license_id, installation_id)
  where deactivated_at is null;
create index if not exists idx_activations_license on activations (license_id);
create index if not exists idx_activations_installation on activations (installation_id);

-- Backfill: every legacy device binding becomes one open activation.
insert into activations (license_id, installation_id, activated_at, last_seen_at, status)
select id, device_id, coalesce(device_bound_at, created_at, now()), now(), 'active'
from licenses
where device_id is not null
on conflict do nothing;

-- 3. Stripe webhook idempotency: one row per processed event id.
create table if not exists stripe_events (
  event_id text primary key,
  type text not null,
  received_at timestamp with time zone default now(),
  result text not null default 'processed'
);
create index if not exists idx_stripe_events_type on stripe_events (type);

-- 4. Usage events for rolling-window quotas and cost control.
-- identity_hash = sha256(installation id | license key | ip), never raw.
create table if not exists usage_events (
  id bigserial primary key,
  identity_hash text not null,
  identity_type text not null,
  operation text not null,
  result text not null,
  created_at timestamp with time zone default now()
);
create index if not exists idx_usage_events_identity_time
  on usage_events (identity_hash, created_at desc);

-- 5. Anonymous installations: server-side record of free installation ids.
create table if not exists anonymous_installations (
  installation_id text primary key,
  first_seen timestamp with time zone default now(),
  last_seen timestamp with time zone default now()
);
create index if not exists idx_anon_installations_last_seen
  on anonymous_installations (last_seen desc);
