create table routine_webhooks (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  routine_schedule_id uuid not null,
  token_hash bytea not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routine_webhooks_owner_routine_fk foreign key (owner_id, routine_schedule_id)
    references routine_schedules(owner_id, id) on delete cascade,
  constraint routine_webhooks_token_hash_size check (octet_length(token_hash) = 32),
  constraint routine_webhooks_owner_id_unique unique (owner_id, id),
  constraint routine_webhooks_owner_routine_unique unique (owner_id, routine_schedule_id)
);

create table routine_webhook_deliveries (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  webhook_id uuid not null references routine_webhooks(id) on delete cascade,
  idempotency_key text not null,
  payload jsonb not null default '{}',
  run_id uuid not null,
  created_at timestamptz not null default now(),
  constraint routine_webhook_deliveries_owner_webhook_fk foreign key (owner_id, webhook_id)
    references routine_webhooks(owner_id, id) on delete cascade,
  constraint routine_webhook_deliveries_owner_run_fk foreign key (owner_id, run_id)
    references integration_sync_runs(owner_id, id) on delete cascade,
  constraint routine_webhook_deliveries_key_shape check (length(btrim(idempotency_key)) between 1 and 500),
  constraint routine_webhook_deliveries_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint routine_webhook_deliveries_webhook_key_unique unique (webhook_id, idempotency_key)
);

create index routine_webhooks_enabled_idx on routine_webhooks(enabled, id);
create index routine_webhook_deliveries_owner_created_idx on routine_webhook_deliveries(owner_id, created_at desc, id desc);
