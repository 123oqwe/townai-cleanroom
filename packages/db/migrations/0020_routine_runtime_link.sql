alter table integration_sync_runs
  add column runtime_run_id uuid;

alter table integration_sync_runs
  add constraint integration_sync_runs_owner_runtime_run_fk
  foreign key (owner_id, runtime_run_id)
  references session_runs(owner_id, id) on delete set null;

create index integration_sync_runs_runtime_run_idx
  on integration_sync_runs(owner_id, runtime_run_id)
  where runtime_run_id is not null;
