create table public_analytics_events (
  id uuid primary key,
  session_key text not null check (char_length(session_key) between 16 and 128),
  event_name text not null check (char_length(event_name) between 1 and 200),
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (session_key, dedupe_key)
);

create index public_analytics_events_created_idx
  on public_analytics_events (created_at desc, id desc);
