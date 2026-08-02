create table notification_channels (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  kind text not null,
  address text not null,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_channels_kind_allowed check (kind in ('email','webhook','telegram','whatsapp')),
  constraint notification_channels_status_allowed check (status in ('active','disabled')),
  constraint notification_channels_config_object check (jsonb_typeof(config) = 'object'),
  constraint notification_channels_address_nonempty check (length(btrim(address)) > 0),
  constraint notification_channels_owner_id_unique unique (owner_id,id)
);
create index notification_channels_owner_status_idx on notification_channels(owner_id,status,created_at desc,id desc);

create table notification_deliveries (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  channel_id uuid not null,
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null,
  fingerprint text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  claimed_by text,
  claim_token text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_owner_channel_fk foreign key (owner_id,channel_id) references notification_channels(owner_id,id) on delete cascade,
  constraint notification_deliveries_status_allowed check (status in ('queued','attempting','succeeded','failed')),
  constraint notification_deliveries_attempts_nonnegative check (attempts >= 0),
  constraint notification_deliveries_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint notification_deliveries_owner_key_unique unique (owner_id,idempotency_key)
);
create index notification_deliveries_claim_idx on notification_deliveries(status,next_attempt_at,created_at,id);
create index notification_deliveries_owner_idx on notification_deliveries(owner_id,created_at desc,id desc);
