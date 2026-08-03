create table mcp_server_bindings (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  agent_version_id uuid not null,
  mcp_server_id uuid not null,
  mode_override text,
  account_scope jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mcp_bindings_owner_id_unique unique (owner_id, id),
  constraint mcp_bindings_owner_version_fk foreign key (owner_id, agent_version_id)
    references agent_versions(owner_id, id),
  constraint mcp_bindings_owner_server_fk foreign key (owner_id, mcp_server_id)
    references mcp_servers(owner_id, id),
  constraint mcp_bindings_owner_version_server_unique
    unique (owner_id, agent_version_id, mcp_server_id),
  constraint mcp_bindings_mode_allowed check (
    mode_override is null or mode_override in ('read_only', 'approval_required', 'autonomous')
  ),
  constraint mcp_bindings_account_scope_array check (jsonb_typeof(account_scope) = 'array'),
  constraint mcp_bindings_revision_positive check (revision > 0)
);

create index mcp_bindings_owner_version_idx
  on mcp_server_bindings(owner_id, agent_version_id, enabled, created_at, id);
