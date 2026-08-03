create table mcp_servers (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  url text not null,
  transport text not null default 'streamable_http',
  auth_ref text,
  status text not null default 'active',
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mcp_servers_owner_id_unique unique (owner_id, id),
  constraint mcp_servers_owner_name_unique unique (owner_id, name),
  constraint mcp_servers_url_http check (url ~ '^https?://'),
  constraint mcp_servers_transport_allowed check (transport in ('streamable_http', 'sse')),
  constraint mcp_servers_status_allowed check (status in ('active', 'disabled')),
  constraint mcp_servers_revision_positive check (revision > 0)
);
create index mcp_servers_owner_status_idx on mcp_servers(owner_id, status, created_at, id);
