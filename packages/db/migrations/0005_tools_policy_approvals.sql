create table tool_definitions (
  id uuid primary key,
  owner_id uuid not null,
  name text not null,
  version integer not null default 1,
  description text not null,
  input_schema jsonb not null,
  output_schema jsonb,
  side_effect text not null,
  data_sensitivity text not null,
  account_binding text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint tool_definitions_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint tool_definitions_owner_id_id_unique unique (owner_id, id),
  constraint tool_definitions_owner_name_version_unique
    unique (owner_id, name, version),
  constraint tool_definitions_name_nonempty check (length(btrim(name)) > 0),
  constraint tool_definitions_version_positive check (version > 0),
  constraint tool_definitions_description_nonempty
    check (length(btrim(description)) > 0),
  constraint tool_definitions_input_schema_object
    check (jsonb_typeof(input_schema) = 'object'),
  constraint tool_definitions_output_schema_object
    check (output_schema is null or jsonb_typeof(output_schema) = 'object'),
  constraint tool_definitions_side_effect_allowed check (
    side_effect in ('read', 'private_write', 'external_write', 'destructive')
  ),
  constraint tool_definitions_data_sensitivity_allowed check (
    data_sensitivity in ('public', 'private', 'restricted')
  ),
  constraint tool_definitions_account_binding_allowed check (
    account_binding in ('required', 'optional', 'none')
  )
);

create index tool_definitions_owner_name_idx
  on tool_definitions(owner_id, name, version desc, id);

create table agent_tool_bindings (
  id uuid primary key,
  owner_id uuid not null,
  agent_version_id uuid not null,
  tool_definition_id uuid not null,
  mode_override text,
  account_scope jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint agent_tool_bindings_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint agent_tool_bindings_owner_agent_version_fk
    foreign key (owner_id, agent_version_id)
    references agent_versions(owner_id, id),
  constraint agent_tool_bindings_owner_tool_definition_fk
    foreign key (owner_id, tool_definition_id)
    references tool_definitions(owner_id, id),
  constraint agent_tool_bindings_owner_id_id_unique unique (owner_id, id),
  constraint agent_tool_bindings_owner_version_tool_unique
    unique (owner_id, agent_version_id, tool_definition_id),
  constraint agent_tool_bindings_mode_allowed check (
    mode_override is null or mode_override in
      ('read_only', 'approval_required', 'autonomous')
  ),
  constraint agent_tool_bindings_account_scope_array
    check (jsonb_typeof(account_scope) = 'array')
);

create index agent_tool_bindings_owner_version_idx
  on agent_tool_bindings(owner_id, agent_version_id, created_at, id);

create table policy_decisions (
  id uuid primary key,
  owner_id uuid not null,
  session_id uuid not null,
  run_id uuid not null,
  tool_call_id uuid,
  decision text not null,
  session_mode text not null,
  routine_mode text not null,
  per_tool_override text,
  side_effect text not null,
  data_sensitivity text not null,
  input_trust text not null,
  target_is_self boolean not null,
  target_is_trusted boolean not null,
  account_id uuid,
  risk_flags jsonb not null default '[]'::jsonb,
  rationale text not null,
  created_at timestamptz not null default now(),
  constraint policy_decisions_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint policy_decisions_owner_session_fk
    foreign key (owner_id, session_id) references runtime_sessions(owner_id, id),
  constraint policy_decisions_owner_session_run_fk
    foreign key (owner_id, session_id, run_id)
    references session_runs(owner_id, session_id, id),
  constraint policy_decisions_owner_account_fk
    foreign key (owner_id, account_id)
    references connected_accounts(owner_id, id),
  constraint policy_decisions_owner_id_id_unique unique (owner_id, id),
  constraint policy_decisions_decision_allowed check (
    decision in ('allow', 'approval_required', 'deny')
  ),
  constraint policy_decisions_session_mode_allowed check (
    session_mode in ('ask_before_changes', 'allow_safe_actions', 'allow_all')
  ),
  constraint policy_decisions_routine_mode_allowed check (
    routine_mode in ('read_only', 'approval_required', 'autonomous')
  ),
  constraint policy_decisions_override_allowed check (
    per_tool_override is null or per_tool_override in
      ('read_only', 'approval_required', 'autonomous')
  ),
  constraint policy_decisions_side_effect_allowed check (
    side_effect in ('read', 'private_write', 'external_write', 'destructive')
  ),
  constraint policy_decisions_data_sensitivity_allowed check (
    data_sensitivity in ('public', 'private', 'restricted')
  ),
  constraint policy_decisions_input_trust_allowed check (
    input_trust in ('trusted_instruction', 'trusted_data', 'untrusted_data')
  ),
  constraint policy_decisions_risk_flags_array
    check (jsonb_typeof(risk_flags) = 'array'),
  constraint policy_decisions_rationale_nonempty
    check (length(btrim(rationale)) > 0)
);

create index policy_decisions_owner_run_idx
  on policy_decisions(owner_id, session_id, run_id, created_at desc, id);

create table tool_calls (
  id uuid primary key,
  owner_id uuid not null,
  session_id uuid not null,
  run_id uuid not null,
  agent_version_id uuid not null,
  tool_definition_id uuid not null,
  policy_decision_id uuid not null,
  step_key text not null,
  idempotency_key_hash bytea not null,
  argument_hash bytea not null,
  arguments jsonb not null,
  status text not null default 'proposed',
  approval_request_id uuid,
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint tool_calls_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint tool_calls_owner_session_fk
    foreign key (owner_id, session_id) references runtime_sessions(owner_id, id),
  constraint tool_calls_owner_session_run_fk
    foreign key (owner_id, session_id, run_id)
    references session_runs(owner_id, session_id, id),
  constraint tool_calls_owner_agent_version_fk
    foreign key (owner_id, agent_version_id)
    references agent_versions(owner_id, id),
  constraint tool_calls_owner_tool_definition_fk
    foreign key (owner_id, tool_definition_id)
    references tool_definitions(owner_id, id),
  constraint tool_calls_owner_policy_decision_fk
    foreign key (owner_id, policy_decision_id)
    references policy_decisions(owner_id, id),
  constraint tool_calls_owner_id_id_unique unique (owner_id, id),
  constraint tool_calls_owner_step_idempotency_unique
    unique (owner_id, run_id, step_key, idempotency_key_hash),
  constraint tool_calls_step_key_nonempty check (length(btrim(step_key)) > 0),
  constraint tool_calls_idempotency_key_hash_size
    check (octet_length(idempotency_key_hash) = 32),
  constraint tool_calls_argument_hash_size
    check (octet_length(argument_hash) = 32),
  constraint tool_calls_arguments_object
    check (jsonb_typeof(arguments) = 'object'),
  constraint tool_calls_status_allowed check (
    status in (
      'proposed', 'allowed', 'waiting_approval', 'denied', 'approved',
      'executing', 'succeeded', 'failed', 'cancelled'
    )
  ),
  constraint tool_calls_result_object
    check (result is null or jsonb_typeof(result) = 'object'),
  constraint tool_calls_error_code_nonempty
    check (error_code is null or length(btrim(error_code)) > 0)
);

create index tool_calls_owner_run_idx
  on tool_calls(owner_id, session_id, run_id, created_at, id);

create table approval_requests (
  id uuid primary key,
  owner_id uuid not null,
  session_id uuid not null,
  run_id uuid not null,
  tool_call_id uuid not null,
  argument_hash bytea not null,
  arguments jsonb not null,
  state text not null default 'pending',
  revision integer not null default 1,
  requested_at timestamptz not null default now(),
  expires_at timestamptz,
  decided_at timestamptz,
  decided_by uuid,
  decision_note text,
  constraint approval_requests_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint approval_requests_owner_session_fk
    foreign key (owner_id, session_id) references runtime_sessions(owner_id, id),
  constraint approval_requests_owner_session_run_fk
    foreign key (owner_id, session_id, run_id)
    references session_runs(owner_id, session_id, id),
  constraint approval_requests_owner_tool_call_fk
    foreign key (owner_id, tool_call_id) references tool_calls(owner_id, id),
  constraint approval_requests_owner_decided_by_fk
    foreign key (decided_by) references users(id),
  constraint approval_requests_owner_id_id_unique unique (owner_id, id),
  constraint approval_requests_tool_call_unique unique (owner_id, tool_call_id),
  constraint approval_requests_argument_hash_size
    check (octet_length(argument_hash) = 32),
  constraint approval_requests_frozen_arguments_object
    check (jsonb_typeof(arguments) = 'object'),
  constraint approval_requests_state_allowed check (
    state in ('pending', 'approved', 'rejected', 'expired', 'cancelled')
  ),
  constraint approval_requests_revision_positive check (revision > 0),
  constraint approval_requests_decision_shape check (
    (state = 'pending' and decided_at is null and decided_by is null) or
    (state <> 'pending' and decided_at is not null and decided_by is not null)
  )
);

create index approval_requests_owner_status_idx
  on approval_requests(owner_id, state, requested_at desc, id);

create function reject_tool_policy_immutable_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'tool policy history records cannot be changed';
end;
$$;

create trigger tool_definitions_immutable_update
before update or delete on tool_definitions
for each row execute function reject_tool_policy_immutable_mutation();

create trigger agent_tool_bindings_immutable_update
before update or delete on agent_tool_bindings
for each row execute function reject_tool_policy_immutable_mutation();

create trigger policy_decisions_immutable_update
before update or delete on policy_decisions
for each row execute function reject_tool_policy_immutable_mutation();
