create table presence_sessions (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  session_id text not null check (char_length(session_id) between 1 and 200),
  surface text not null check (surface in ('web','ios','macos','email','slack','whatsapp','telegram','imessage')),
  client_sha text check (client_sha is null or char_length(client_sha) between 1 and 200),
  deployment_time timestamptz,
  user_agent text check (user_agent is null or char_length(user_agent) <= 1_000),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (owner_id, session_id)
);

create index presence_sessions_owner_expiry_idx
  on presence_sessions (owner_id, expires_at desc);
