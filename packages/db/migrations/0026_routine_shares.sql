create table routine_share_grants (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  routine_schedule_id uuid not null,
  token_hash bytea not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint routine_share_grants_owner_routine_fk
    foreign key (owner_id, routine_schedule_id)
    references routine_schedules(owner_id, id) on delete cascade,
  constraint routine_share_grants_owner_id_unique unique (owner_id, id),
  constraint routine_share_grants_token_hash_unique unique (token_hash),
  constraint routine_share_grants_token_hash_size check (octet_length(token_hash) = 32),
  constraint routine_share_grants_expiry_valid check (expires_at is null or expires_at > created_at)
);
create index routine_share_grants_lookup_idx on routine_share_grants(token_hash)
  where revoked_at is null;
