alter table integration_sync_runs
  add constraint integration_sync_runs_owner_id_unique unique (owner_id, id);

create table routine_step_results (
  owner_id uuid not null references users(id) on delete cascade,
  run_id uuid not null,
  step_key text not null,
  status text not null,
  output jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, run_id, step_key),
  constraint routine_step_results_owner_run_fk
    foreign key (owner_id, run_id)
    references integration_sync_runs(owner_id, id) on delete cascade,
  constraint routine_step_results_status_allowed check (
    status in ('running', 'completed', 'failed')
  ),
  constraint routine_step_results_step_key_shape check (length(btrim(step_key)) between 1 and 200),
  constraint routine_step_results_state_shape check (
    (status = 'running' and output is null and error_code is null and error_message is null and started_at is not null and finished_at is null)
    or (status = 'completed' and output is not null and error_code is null and error_message is null and started_at is not null and finished_at is not null)
    or (status = 'failed' and output is null and error_code is not null and length(btrim(error_code)) > 0 and error_message is not null and length(btrim(error_message)) > 0 and started_at is not null and finished_at is not null)
  )
);

create index routine_step_results_owner_run_idx
  on routine_step_results(owner_id, run_id, created_at, step_key);
