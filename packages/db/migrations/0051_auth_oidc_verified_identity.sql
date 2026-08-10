-- Phase 01A: verified Google OIDC login + session hardening.
-- Backward compatible: additive only; no existing migration is modified.

-- ===========================================================================
-- auth_oidc_attempts: short-lived OIDC Authorization Code + PKCE state.
-- state is one-time-use; callback replay is rejected by atomic consume.
-- code_verifier is stored encrypted (never plaintext) at rest.
-- ===========================================================================
create table auth_oidc_attempts (
  id uuid primary key,
  provider text not null,
  flow_type text not null,
  state_hash bytea not null unique,
  nonce_hash bytea not null,
  encrypted_code_verifier jsonb not null,
  redirect_path text not null default '/',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  failure_code text,
  request_metadata_hash bytea,
  constraint auth_oidc_attempts_provider_check
    check (provider in ('google')),
  constraint auth_oidc_attempts_flow_type_check
    check (flow_type in ('login')),
  constraint auth_oidc_attempts_expiry_after_creation
    check (expires_at > created_at),
  constraint auth_oidc_attempts_verifier_object
    check (jsonb_typeof(encrypted_code_verifier) = 'object')
);

create index auth_oidc_attempts_expires_at_idx on auth_oidc_attempts(expires_at);
create index auth_oidc_attempts_consumed_at_idx on auth_oidc_attempts(consumed_at);

-- ===========================================================================
-- auth_identities: verified external identities (provider + subject).
-- Replaces "email alone is identity". (provider, provider_subject) is unique.
-- ===========================================================================
create table auth_identities (
  id uuid primary key,
  user_id uuid not null,
  provider text not null,
  provider_subject text not null,
  verified_email citext not null,
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  constraint auth_identities_user_id_users_id_fk
    foreign key (user_id) references users(id) on delete cascade,
  constraint auth_identities_provider_subject_unique
    unique (provider, provider_subject),
  constraint auth_identities_provider_check
    check (provider in ('google')),
  constraint auth_identities_subject_nonempty
    check (length(provider_subject) > 0),
  constraint auth_identities_email_verified_implied
    check (email_verified = true)
);

create index auth_identities_user_id_idx on auth_identities(user_id);
create index auth_identities_verified_email_idx on auth_identities(verified_email);

-- ===========================================================================
-- auth_sessions hardening: idle/absolute expiry, rotation, auth method,
-- privacy-minimized device metadata. All new columns are nullable so existing
-- rows continue to authenticate.
-- ===========================================================================
alter table auth_sessions
  add column auth_method text,
  add column idle_expires_at timestamptz,
  add column absolute_expires_at timestamptz,
  add column session_family_id uuid,
  add column rotated_from_session_id uuid,
  add column user_agent_hash bytea,
  add column ip_metadata_hash bytea,
  add column is_current boolean not null default true,
  add constraint auth_sessions_auth_method_check
    check (auth_method is null or auth_method in ('oidc:google', 'dev:email')),
  add constraint auth_sessions_idle_after_creation
    check (idle_expires_at is null or idle_expires_at > created_at),
  add constraint auth_sessions_absolute_after_creation
    check (absolute_expires_at is null or absolute_expires_at > created_at);

create index auth_sessions_user_active_idx
  on auth_sessions(user_id)
  where revoked_at is null;
create index auth_sessions_family_idx
  on auth_sessions(session_family_id)
  where session_family_id is not null;

-- Foreign key for rotation chain (self-referential, restricted delete).
alter table auth_sessions
  add constraint auth_sessions_rotated_from_fk
    foreign key (rotated_from_session_id) references auth_sessions(id)
    on delete restrict;
