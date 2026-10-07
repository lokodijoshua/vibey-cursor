-- Behavior analytics foundation (product intelligence, not surveillance).
-- One row per VibeyCursor workflow event. Metadata-only: element type,
-- dimensions, counts — never prompts, HTML, input values, or raw URLs.
-- Identifiers are hashes/ids only. Retention mirrors usage events (30d).

create table if not exists analytics_events (
  id bigserial primary key,
  event_id uuid not null unique,
  event_name text not null,
  installation_hash text,
  license_id uuid references licenses(id) on delete set null,
  session_id uuid,
  plan text not null default 'free',
  element_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

create index if not exists idx_analytics_event_time
  on analytics_events (event_name, created_at desc);
create index if not exists idx_analytics_install_time
  on analytics_events (installation_hash, created_at desc);
create index if not exists idx_analytics_created
  on analytics_events (created_at desc);
