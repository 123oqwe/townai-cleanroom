create table operation_audit_events (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  outcome text not null default 'succeeded',
  request_id text,
  dedupe_key text,
  fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint operation_audit_outcome_allowed check (outcome in ('succeeded','failed')),
  constraint operation_audit_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint operation_audit_dedupe_unique unique (owner_id, dedupe_key)
);
create index operation_audit_owner_created_idx
  on operation_audit_events(owner_id, created_at desc, id desc);
create index operation_audit_owner_action_idx
  on operation_audit_events(owner_id, action, created_at desc, id desc);
