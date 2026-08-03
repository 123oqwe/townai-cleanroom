create table analytics_events (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  event_name text not null check (char_length(event_name) between 1 and 200),
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, dedupe_key)
);

create index analytics_events_owner_created_idx
  on analytics_events (owner_id, created_at desc, id desc);
