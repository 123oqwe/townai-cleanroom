create table agents (
  id uuid primary key,
  owner_id uuid not null,
  kind text not null,
  active_version_id uuid,
  revision integer not null default 1,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agents_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint agents_owner_id_id_unique unique (owner_id, id),
  constraint agents_kind_allowed check (kind in ('personal', 'routine')),
  constraint agents_status_allowed check (status in ('active', 'disabled')),
  constraint agents_revision_positive check (revision > 0)
);

create unique index agents_one_personal_per_owner_idx
  on agents(owner_id) where kind = 'personal';
create index agents_owner_status_idx on agents(owner_id, status, created_at, id);

create table agent_versions (
  id uuid primary key,
  owner_id uuid not null,
  agent_id uuid not null,
  version integer not null,
  snapshot jsonb not null,
  change_reason text,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint agent_versions_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint agent_versions_owner_agent_fk
    foreign key (owner_id, agent_id) references agents(owner_id, id)
      on delete cascade,
  constraint agent_versions_owner_id_id_unique unique (owner_id, id),
  constraint agent_versions_owner_agent_id_id_unique
    unique (owner_id, agent_id, id),
  constraint agent_versions_owner_agent_version_unique
    unique (owner_id, agent_id, version),
  constraint agent_versions_version_positive check (version > 0),
  constraint agent_versions_snapshot_object
    check (jsonb_typeof(snapshot) = 'object'),
  constraint agent_versions_created_by_allowed
    check (created_by in ('user', 'system')),
  constraint agent_versions_change_reason_nonempty
    check (change_reason is null or length(btrim(change_reason)) > 0)
);

alter table agents
  add constraint agents_owner_active_version_fk
  foreign key (owner_id, id, active_version_id)
  references agent_versions(owner_id, agent_id, id);

create index agent_versions_owner_agent_version_idx
  on agent_versions(owner_id, agent_id, version desc, id);

create table threads (
  id uuid primary key,
  owner_id uuid not null,
  agent_id uuid not null,
  kind text not null,
  title text not null,
  approval_mode text not null,
  status text not null default 'active',
  pinned_at timestamptz,
  revision integer not null default 1,
  last_turn_sequence integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint threads_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint threads_owner_agent_fk
    foreign key (owner_id, agent_id) references agents(owner_id, id),
  constraint threads_owner_id_id_unique unique (owner_id, id),
  constraint threads_kind_allowed check (kind in ('assistant', 'task')),
  constraint threads_title_nonempty check (length(btrim(title)) > 0),
  constraint threads_approval_mode_allowed check (
    approval_mode in ('respect_tool_setting', 'require_approval', 'autonomous')
  ),
  constraint threads_status_allowed
    check (status in ('active', 'archived', 'deleted')),
  constraint threads_revision_positive check (revision > 0),
  constraint threads_last_turn_sequence_nonnegative
    check (last_turn_sequence >= 0),
  constraint threads_deletion_state_valid check (
    (status <> 'deleted' and deleted_at is null) or
    (status = 'deleted' and deleted_at is not null)
  )
);

create index threads_owner_status_activity_idx
  on threads(owner_id, status, (pinned_at is not null) desc,
    pinned_at desc, updated_at desc, id);

create table thread_turns (
  id uuid primary key,
  owner_id uuid not null,
  thread_id uuid not null,
  sequence integer not null,
  role text not null,
  text text not null,
  source_type text not null,
  source_ref text,
  created_at timestamptz not null default now(),
  constraint thread_turns_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint thread_turns_owner_thread_fk
    foreign key (owner_id, thread_id) references threads(owner_id, id)
      on delete cascade,
  constraint thread_turns_owner_id_id_unique unique (owner_id, id),
  constraint thread_turns_owner_thread_sequence_unique
    unique (owner_id, thread_id, sequence),
  constraint thread_turns_sequence_positive check (sequence > 0),
  constraint thread_turns_role_allowed
    check (role in ('user', 'assistant', 'system')),
  constraint thread_turns_text_nonempty check (length(btrim(text)) > 0),
  constraint thread_turns_source_type_allowed
    check (source_type in ('user', 'runtime', 'channel')),
  constraint thread_turns_source_binding_valid check (
    (source_type = 'user' and role = 'user' and source_ref is null) or
    (source_type = 'runtime' and role in ('assistant', 'system')
      and source_ref is not null and length(btrim(source_ref)) > 0) or
    (source_type = 'channel' and role = 'user'
      and source_ref is not null and length(btrim(source_ref)) > 0)
  )
);

create index thread_turns_owner_thread_sequence_idx
  on thread_turns(owner_id, thread_id, sequence, id);

create table thread_mentions (
  id uuid primary key,
  owner_id uuid not null,
  turn_id uuid not null,
  position integer not null,
  target_type text not null,
  target_id uuid not null,
  label text not null,
  created_at timestamptz not null default now(),
  constraint thread_mentions_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint thread_mentions_owner_turn_fk
    foreign key (owner_id, turn_id) references thread_turns(owner_id, id)
      on delete cascade,
  constraint thread_mentions_owner_turn_position_unique
    unique (owner_id, turn_id, position),
  constraint thread_mentions_position_nonnegative check (position >= 0),
  constraint thread_mentions_target_type_allowed check (
    target_type in ('agent', 'thread', 'task', 'routine', 'content')
  ),
  constraint thread_mentions_label_nonempty check (length(btrim(label)) > 0)
);

create index thread_mentions_owner_turn_idx
  on thread_mentions(owner_id, turn_id, position, id);

create table thread_read_states (
  owner_id uuid not null,
  thread_id uuid not null,
  read_through_sequence integer not null default 0,
  force_unread boolean not null default false,
  read_at timestamptz,
  constraint thread_read_states_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint thread_read_states_owner_thread_fk
    foreign key (owner_id, thread_id) references threads(owner_id, id)
      on delete cascade,
  constraint thread_read_states_owner_thread_unique
    primary key (owner_id, thread_id),
  constraint thread_read_states_sequence_nonnegative
    check (read_through_sequence >= 0)
);

create table tasks (
  id uuid primary key,
  owner_id uuid not null,
  thread_id uuid not null,
  title text not null,
  description text not null default '',
  status text not null default 'open',
  scheduled_for timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  constraint tasks_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint tasks_owner_thread_fk
    foreign key (owner_id, thread_id) references threads(owner_id, id),
  constraint tasks_owner_id_id_unique unique (owner_id, id),
  constraint tasks_owner_thread_unique unique (owner_id, thread_id),
  constraint tasks_title_nonempty check (length(btrim(title)) > 0),
  constraint tasks_status_allowed check (status in ('open', 'completed', 'deleted')),
  constraint tasks_revision_positive check (revision > 0),
  constraint tasks_lifecycle_valid check (
    (status = 'open' and completed_at is null and deleted_at is null) or
    (status = 'completed' and completed_at is not null and deleted_at is null) or
    (status = 'deleted' and deleted_at is not null)
  )
);

create index tasks_owner_status_schedule_idx
  on tasks(owner_id, status, scheduled_for, updated_at desc, id);

create table task_source_refs (
  id uuid primary key,
  owner_id uuid not null,
  task_id uuid not null,
  source_type text not null,
  source_ref text not null,
  account_id uuid,
  source_label text,
  created_at timestamptz not null default now(),
  constraint task_source_refs_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint task_source_refs_owner_task_fk
    foreign key (owner_id, task_id) references tasks(owner_id, id)
      on delete cascade,
  constraint task_source_refs_owner_account_fk
    foreign key (owner_id, account_id)
    references connected_accounts(owner_id, id) on delete set null (account_id),
  constraint task_source_refs_type_allowed check (
    source_type in ('thread', 'need_to_know', 'email', 'calendar', 'routine_run', 'external')
  ),
  constraint task_source_refs_ref_nonempty check (length(btrim(source_ref)) > 0),
  constraint task_source_refs_label_nonempty
    check (source_label is null or length(btrim(source_label)) > 0)
);

create index task_source_refs_owner_task_idx
  on task_source_refs(owner_id, task_id, created_at, id);

create table task_input_requests (
  id uuid primary key,
  owner_id uuid not null,
  task_id uuid not null,
  prompt text not null,
  status text not null default 'pending',
  response text,
  requested_at timestamptz not null default now(),
  answered_at timestamptz,
  cancelled_at timestamptz,
  constraint task_input_requests_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint task_input_requests_owner_task_fk
    foreign key (owner_id, task_id) references tasks(owner_id, id)
      on delete cascade,
  constraint task_input_requests_prompt_nonempty check (length(btrim(prompt)) > 0),
  constraint task_input_requests_status_allowed
    check (status in ('pending', 'answered', 'cancelled')),
  constraint task_input_requests_state_valid check (
    (status = 'pending' and response is null
      and answered_at is null and cancelled_at is null) or
    (status = 'answered' and response is not null
      and length(btrim(response)) > 0
      and answered_at is not null and cancelled_at is null) or
    (status = 'cancelled' and response is null
      and answered_at is null and cancelled_at is not null)
  )
);

create index task_input_requests_owner_task_status_idx
  on task_input_requests(owner_id, task_id, status, requested_at, id);

create function reject_immutable_history_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception using
    errcode = '55000',
    message = 'immutable history records cannot be changed';
end;
$$;

create trigger agent_versions_immutable_update
before update or delete on agent_versions
for each row execute function reject_immutable_history_mutation();

create trigger thread_turns_immutable_update
before update or delete on thread_turns
for each row execute function reject_immutable_history_mutation();

create trigger thread_mentions_immutable_update
before update or delete on thread_mentions
for each row execute function reject_immutable_history_mutation();
