-- AI/OpenAI observability: one row per server-side AI call.
-- Token counts come from the OpenAI response (authoritative); dollar cost
-- is an accounting estimate from backend/lib/ai-costs.js. No prompts,
-- HTML, keys, or PII stored — identifiers are ids/hashes only.

create table if not exists ai_usage_events (
  id bigserial primary key,
  license_id uuid references licenses(id) on delete set null,
  installation_hash text,
  operation text not null default 'enhance',
  element_type text,
  prompt_chars integer,
  estimated_input_tokens integer,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  cached_input_tokens integer,
  estimated_cost_usd numeric(10,6),
  latency_ms integer,
  status text not null,
  error_category text,
  request_id text,
  created_at timestamp with time zone default now()
);

create index if not exists idx_ai_usage_license_time
  on ai_usage_events (license_id, created_at desc);
create index if not exists idx_ai_usage_created
  on ai_usage_events (created_at desc);
