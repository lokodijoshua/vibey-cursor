-- VibeyCursor licenses table: one row per paying customer (keyed by email).
-- plan is 'free' | 'pro' (single paid plan). status tracks the Stripe lifecycle.

create table if not exists licenses (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  license_key text unique not null,
  plan text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'active',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists idx_licenses_license_key on licenses (license_key);
create index if not exists idx_licenses_email on licenses (email);
