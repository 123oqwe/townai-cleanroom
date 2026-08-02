create table routine_schedules (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  agent_id uuid not null,
  agent_version_id uuid not null,
  name text not null,
  cron text not null,
  timezone text not null default 'UTC',
  enabled boolean not null default true,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routine_schedules_owner_agent_fk foreign key (owner_id, agent_id)
    references agents(owner_id, id) on delete cascade,
  constraint routine_schedules_owner_version_fk foreign key (owner_id, agent_id, agent_version_id)
    references agent_versions(owner_id, agent_id, id) on delete restrict,
  constraint routine_schedules_owner_id_unique unique (owner_id, id),
  constraint routine_schedules_cron_shape check (cron ~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+$'),
  constraint routine_schedules_revision_positive check (revision > 0)
);
create index routine_schedules_due_idx
  on routine_schedules(owner_id, enabled, next_run_at, id);
create unique index routine_schedules_owner_name_unique
  on routine_schedules(owner_id, lower(name));

create table integration_sync_runs (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  account_id uuid not null,
  routine_schedule_id uuid,
  provider text not null,
  status text not null default 'queued',
  cursor jsonb not null default '{}',
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint integration_sync_runs_owner_account_fk foreign key (owner_id, account_id)
    references connected_accounts(owner_id, id) on delete cascade,
  constraint integration_sync_runs_owner_routine_fk foreign key (owner_id, routine_schedule_id)
    references routine_schedules(owner_id, id) on delete set null,
  constraint integration_sync_runs_status_allowed check (status in ('queued','running','succeeded','failed','blocked')),
  constraint integration_sync_runs_cursor_object check (jsonb_typeof(cursor) = 'object')
);
create index integration_sync_runs_owner_status_idx
  on integration_sync_runs(owner_id, status, created_at, id);
