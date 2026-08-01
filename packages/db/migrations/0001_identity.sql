create extension if not exists citext;

create table access_allowlist (
  email citext primary key,
  enabled boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key,
  email citext not null unique,
  first_name text,
  last_name text,
  timezone text not null default 'UTC',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_status_allowed check (status in ('active', 'disabled')),
  constraint users_timezone_nonempty check (length(timezone) > 0)
);

create table auth_sessions (
  id uuid primary key,
  user_id uuid not null,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint auth_sessions_user_id_users_id_fk
    foreign key (user_id) references users(id) on delete cascade,
  constraint auth_sessions_expiry_after_creation check (expires_at > created_at)
);

create index auth_sessions_user_id_idx on auth_sessions(user_id);

create table oauth_credentials (
  id uuid primary key,
  owner_id uuid not null,
  key_version integer not null,
  envelope jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oauth_credentials_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint oauth_credentials_positive_key_version check (key_version > 0),
  constraint oauth_credentials_envelope_object check (jsonb_typeof(envelope) = 'object')
);

create index oauth_credentials_owner_id_idx on oauth_credentials(owner_id);

create table connected_accounts (
  id uuid primary key,
  owner_id uuid not null,
  provider text not null,
  provider_user_id text not null,
  email citext not null,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  capabilities jsonb not null default '{}'::jsonb,
  credential_id uuid,
  token_expires_at timestamptz,
  needs_reauth boolean not null default false,
  reauth_blocked_by_org_policy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connected_accounts_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint connected_accounts_credential_id_oauth_credentials_id_fk
    foreign key (credential_id) references oauth_credentials(id) on delete set null,
  constraint connected_accounts_owner_provider_identity_unique
    unique (owner_id, provider, provider_user_id),
  constraint connected_accounts_provider_allowed
    check (provider in ('google', 'microsoft', 'slack', 'notion', 'dropbox')),
  constraint connected_accounts_provider_user_id_nonempty check (length(provider_user_id) > 0),
  constraint connected_accounts_capabilities_object check (jsonb_typeof(capabilities) = 'object')
);

create index connected_accounts_owner_id_idx on connected_accounts(owner_id);
