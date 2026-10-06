-- Free-tier daily capture quota. One row per anonymized IP per UTC day.
-- IPs are stored as SHA-256 hashes (not raw addresses) to avoid keeping PII.

create table if not exists free_usage (
  ip_hash text not null,
  day date not null,
  count integer not null default 0,
  updated_at timestamp with time zone default now(),
  primary key (ip_hash, day)
);
