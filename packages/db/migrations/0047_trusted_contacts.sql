-- Trusted contacts/domains for the trust engine.
-- Real Town.ai allows users to mark specific recipients as trusted
-- so routine email/calendar actions don't require approval each time.

create table if not exists trusted_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  scope text not null check (scope in ('email','domain','phone','handle')),
  value text not null,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists trusted_contacts_owner_scope_value_unique
  on trusted_contacts(owner_id, scope, value);
create index if not exists trusted_contacts_owner_idx on trusted_contacts(owner_id);
