create table square_account_shares (
  id uuid primary key,
  square_id uuid not null,
  square_owner_id uuid not null references users(id) on delete cascade,
  account_id uuid not null,
  account_owner_id uuid not null references users(id) on delete cascade,
  granted_by uuid not null references users(id) on delete restrict,
  capabilities jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint square_account_shares_owner_square_fk
    foreign key (square_owner_id, square_id) references squares(owner_id, id) on delete cascade,
  constraint square_account_shares_owner_account_fk
    foreign key (account_owner_id, account_id) references connected_accounts(owner_id, id) on delete cascade,
  constraint square_account_shares_unique unique (square_id, account_owner_id, account_id),
  constraint square_account_shares_capabilities_array check (jsonb_typeof(capabilities) = 'array'),
  constraint square_account_shares_status_allowed check (status in ('active','revoked')),
  constraint square_account_shares_revoked_shape check ((status = 'active' and revoked_at is null) or (status = 'revoked' and revoked_at is not null))
);
create index square_account_shares_square_status_idx on square_account_shares(square_owner_id, square_id, status, created_at desc, id desc);
create index square_account_shares_account_idx on square_account_shares(account_owner_id, account_id, status);
