create table routine_results (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  routine_schedule_id uuid,
  session_id uuid not null,
  run_id uuid not null,
  subject text not null,
  status text not null,
  output jsonb,
  error_code text,
  error_message text,
  document_id uuid,
  notification_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routine_results_owner_id_id_unique unique (owner_id, id),
  constraint routine_results_owner_schedule_fk foreign key (owner_id, routine_schedule_id)
    references routine_schedules(owner_id, id) on delete set null,
  constraint routine_results_owner_session_fk foreign key (owner_id, session_id)
    references runtime_sessions(owner_id, id) on delete cascade,
  constraint routine_results_owner_run_fk foreign key (owner_id, session_id, run_id)
    references session_runs(owner_id, session_id, id) on delete cascade,
  constraint routine_results_owner_run_unique unique (owner_id, run_id),
  constraint routine_results_subject_nonempty check (length(btrim(subject)) between 1 and 500),
  constraint routine_results_status_allowed check (status in ('completed', 'failed')),
  constraint routine_results_output_object check (output is null or jsonb_typeof(output) = 'object'),
  constraint routine_results_error_code_nonempty check (error_code is null or length(btrim(error_code)) > 0),
  constraint routine_results_error_message_nonempty check (error_message is null or length(btrim(error_message)) > 0),
  constraint routine_results_lifecycle_valid check (
    (status = 'completed' and output is not null and error_code is null and error_message is null)
    or (status = 'failed' and output is null and error_code is not null and error_message is not null)
  )
);

create index routine_results_owner_session_created_idx
  on routine_results(owner_id, session_id, created_at desc, id);

create index routine_results_owner_schedule_created_idx
  on routine_results(owner_id, routine_schedule_id, created_at desc, id)
  where routine_schedule_id is not null;
