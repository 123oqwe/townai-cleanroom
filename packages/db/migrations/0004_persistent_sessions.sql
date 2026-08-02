alter table thread_turns
  add constraint thread_turns_owner_thread_id_unique
  unique (owner_id, thread_id, id);

create table runtime_sessions (
  id uuid primary key,
  owner_id uuid not null,
  thread_id uuid not null,
  agent_id uuid not null,
  agent_version_id uuid not null,
  state text not null default 'idle',
  revision integer not null default 1,
  last_event_sequence integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runtime_sessions_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint runtime_sessions_owner_thread_fk
    foreign key (owner_id, thread_id) references threads(owner_id, id),
  constraint runtime_sessions_owner_agent_fk
    foreign key (owner_id, agent_id) references agents(owner_id, id),
  constraint runtime_sessions_owner_agent_version_fk
    foreign key (owner_id, agent_id, agent_version_id)
    references agent_versions(owner_id, agent_id, id),
  constraint runtime_sessions_owner_id_id_unique unique (owner_id, id),
  constraint runtime_sessions_owner_thread_unique unique (owner_id, thread_id),
  constraint runtime_sessions_owner_thread_id_unique
    unique (owner_id, thread_id, id),
  constraint runtime_sessions_state_allowed check (
    state in (
      'idle', 'running', 'waiting_approval', 'waiting_user_input',
      'failed', 'cancelled'
    )
  ),
  constraint runtime_sessions_revision_positive check (revision > 0),
  constraint runtime_sessions_event_sequence_nonnegative
    check (last_event_sequence >= 0)
);

create index runtime_sessions_owner_state_activity_idx
  on runtime_sessions(owner_id, state, updated_at desc, id);

create table session_runs (
  id uuid primary key,
  owner_id uuid not null,
  session_id uuid not null,
  thread_id uuid not null,
  triggering_turn_id uuid not null,
  idempotency_hash bytea not null,
  request_fingerprint bytea not null,
  state text not null default 'queued',
  attempt integer not null default 0,
  wait_reason text,
  outcome jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint session_runs_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint session_runs_owner_session_thread_fk
    foreign key (owner_id, thread_id, session_id)
    references runtime_sessions(owner_id, thread_id, id),
  constraint session_runs_owner_triggering_turn_fk
    foreign key (owner_id, thread_id, triggering_turn_id)
    references thread_turns(owner_id, thread_id, id),
  constraint session_runs_owner_id_id_unique unique (owner_id, id),
  constraint session_runs_owner_session_id_id_unique
    unique (owner_id, session_id, id),
  constraint session_runs_owner_session_turn_unique
    unique (owner_id, session_id, triggering_turn_id),
  constraint session_runs_owner_session_idempotency_unique
    unique (owner_id, session_id, idempotency_hash),
  constraint session_runs_idempotency_hash_size
    check (octet_length(idempotency_hash) = 32),
  constraint session_runs_request_fingerprint_size
    check (octet_length(request_fingerprint) = 32),
  constraint session_runs_state_allowed check (
    state in (
      'queued', 'running', 'waiting_approval', 'waiting_user_input',
      'completed', 'failed', 'cancelled'
    )
  ),
  constraint session_runs_attempt_nonnegative check (attempt >= 0),
  constraint session_runs_wait_reason_nonempty
    check (wait_reason is null or length(btrim(wait_reason)) > 0),
  constraint session_runs_outcome_object
    check (outcome is null or jsonb_typeof(outcome) = 'object'),
  constraint session_runs_error_code_nonempty
    check (error_code is null or length(btrim(error_code)) > 0),
  constraint session_runs_lifecycle_valid check (
    (state = 'queued' and started_at is null and finished_at is null
      and wait_reason is null and outcome is null and error_code is null) or
    (state = 'running' and started_at is not null and finished_at is null
      and wait_reason is null and error_code is null) or
    (state in ('waiting_approval', 'waiting_user_input')
      and started_at is not null and finished_at is null
      and wait_reason is not null and error_code is null) or
    (state = 'completed' and started_at is not null and finished_at is not null
      and wait_reason is null and error_code is null) or
    (state = 'failed' and finished_at is not null
      and wait_reason is null and error_code is not null) or
    (state = 'cancelled' and finished_at is not null
      and wait_reason is null and outcome is null and error_code is null)
  )
);

create index session_runs_owner_session_created_idx
  on session_runs(owner_id, session_id, created_at desc, id);

create table session_events (
  id uuid primary key,
  owner_id uuid not null,
  session_id uuid not null,
  run_id uuid not null,
  sequence integer not null,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint session_events_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint session_events_owner_session_fk
    foreign key (owner_id, session_id)
    references runtime_sessions(owner_id, id) on delete cascade,
  constraint session_events_owner_session_run_fk
    foreign key (owner_id, session_id, run_id)
    references session_runs(owner_id, session_id, id) on delete cascade,
  constraint session_events_owner_id_id_unique unique (owner_id, id),
  constraint session_events_owner_session_sequence_unique
    unique (owner_id, session_id, sequence),
  constraint session_events_sequence_positive check (sequence > 0),
  constraint session_events_kind_allowed check (
    kind in (
      'run_queued', 'run_started', 'phase_changed', 'input_observed',
      'assistant_output_recorded', 'run_waiting', 'run_resumed',
      'run_completed', 'run_failed', 'run_cancelled'
    )
  ),
  constraint session_events_payload_object
    check (jsonb_typeof(payload) = 'object')
);

create index session_events_owner_session_sequence_idx
  on session_events(owner_id, session_id, sequence, id);

create table runtime_jobs (
  run_id uuid primary key,
  owner_id uuid not null,
  session_id uuid not null,
  state text not null default 'queued',
  attempt integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token_hash bytea,
  leased_by text,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runtime_jobs_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint runtime_jobs_owner_session_run_fk
    foreign key (owner_id, session_id, run_id)
    references session_runs(owner_id, session_id, id) on delete cascade,
  constraint runtime_jobs_owner_run_unique unique (owner_id, run_id),
  constraint runtime_jobs_state_allowed check (state in ('queued', 'leased')),
  constraint runtime_jobs_attempt_nonnegative check (attempt >= 0),
  constraint runtime_jobs_lease_token_hash_size
    check (lease_token_hash is null or octet_length(lease_token_hash) = 32),
  constraint runtime_jobs_leased_by_nonempty
    check (leased_by is null or length(btrim(leased_by)) > 0),
  constraint runtime_jobs_lease_shape_valid check (
    (state = 'queued' and lease_token_hash is null and leased_by is null
      and leased_at is null and lease_expires_at is null) or
    (state = 'leased' and lease_token_hash is not null and leased_by is not null
      and leased_at is not null and lease_expires_at > leased_at)
  )
);

create index runtime_jobs_claim_idx
  on runtime_jobs(state, available_at, created_at, run_id);

create trigger session_events_immutable_update
before update or delete on session_events
for each row execute function reject_immutable_history_mutation();
