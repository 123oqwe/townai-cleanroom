create table oauth_connect_states (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  provider text not null,
  state_hash bytea not null unique,
  redirect_uri text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint oauth_connect_states_hash_size check (octet_length(state_hash) = 32),
  constraint oauth_connect_states_provider_allowed check (provider in ('google')),
  constraint oauth_connect_states_expiry_valid check (expires_at > created_at)
);
create index oauth_connect_states_owner_provider_idx on oauth_connect_states(owner_id, provider, created_at desc);
create index oauth_connect_states_expiry_idx on oauth_connect_states(expires_at) where consumed_at is null;
