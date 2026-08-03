create table harness_approval_decisions (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  session_id uuid not null references runtime_sessions(id) on delete cascade,
  run_id uuid not null references session_runs(id) on delete cascade,
  approval_id text not null check (length(btrim(approval_id)) between 1 and 500),
  decision text not null check (decision in ('approve','reject')),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint harness_approval_decisions_owner_session_fk foreign key (owner_id, session_id)
    references runtime_sessions(owner_id, id) on delete cascade,
  constraint harness_approval_decisions_owner_run_fk foreign key (owner_id, session_id, run_id)
    references session_runs(owner_id, session_id, id) on delete cascade,
  constraint harness_approval_decisions_unique unique (owner_id, run_id, approval_id)
);
create index harness_approval_decisions_pending_idx
  on harness_approval_decisions(owner_id, run_id, consumed_at)
  where consumed_at is null;
