alter table integration_sync_runs
  add column updated_at timestamptz not null default now();

create index integration_sync_runs_owner_updated_idx
  on integration_sync_runs(owner_id, updated_at desc, id desc);
