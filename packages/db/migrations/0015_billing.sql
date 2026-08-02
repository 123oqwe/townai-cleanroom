create table billing_accounts (
  owner_id uuid primary key references users(id) on delete cascade,
  plan_name text not null,
  is_blocked boolean not null default false,
  is_trial boolean not null default false,
  is_enterprise boolean not null default false,
  credit_band text not null default 'healthy',
  credit_banners jsonb not null default '[]'::jsonb,
  period_start timestamptz,
  period_end timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_accounts_credit_band_allowed check (credit_band in ('healthy','warning','blocked')),
  constraint billing_accounts_banners_array check (jsonb_typeof(credit_banners) = 'array'),
  constraint billing_accounts_revision_positive check (revision > 0),
  constraint billing_accounts_period_shape check (period_start is null or period_end is null or period_end > period_start)
);

create table usage_ledger (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  idempotency_key text not null,
  category text not null,
  quantity integer not null,
  unit text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint usage_ledger_owner_key_unique unique (owner_id,idempotency_key),
  constraint usage_ledger_category_allowed check (category in ('model','tool','search','routine','storage')),
  constraint usage_ledger_quantity_positive check (quantity > 0),
  constraint usage_ledger_metadata_object check (jsonb_typeof(metadata) = 'object')
);
create index usage_ledger_owner_time_idx on usage_ledger(owner_id,occurred_at desc,id desc);
