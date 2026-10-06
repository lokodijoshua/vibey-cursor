-- Waitlist signups for the pre-launch landing page.
-- One row per email; repeats are silently ignored (no enumeration).

create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  source text not null default 'waitlist-page',
  created_at timestamp with time zone default now()
);

create index if not exists idx_waitlist_email on waitlist (email);
