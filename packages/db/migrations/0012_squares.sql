create table squares (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  status text not null default 'active',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint squares_owner_id_id_unique unique (owner_id, id),
  constraint squares_owner_slug_unique unique (owner_id, slug),
  constraint squares_status_allowed check (status in ('active','archived')),
  constraint squares_settings_object check (jsonb_typeof(settings) = 'object')
);
create index squares_owner_status_idx on squares(owner_id, status, updated_at desc, id desc);

create table square_memberships (
  square_id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  owner_id uuid not null references users(id) on delete cascade,
  role text not null,
  status text not null default 'active',
  invited_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(square_id, user_id),
  constraint square_memberships_owner_square_fk
    foreign key (owner_id, square_id) references squares(owner_id, id) on delete cascade,
  constraint square_memberships_role_allowed check (role in ('owner','admin','member')),
  constraint square_memberships_status_allowed check (status in ('invited','active','suspended'))
  ,constraint square_memberships_owner_invariant check ((user_id = owner_id and role = 'owner' and status = 'active') or (user_id <> owner_id and role <> 'owner'))
);
create index square_memberships_user_status_idx on square_memberships(user_id, status, square_id);
create index square_memberships_square_role_idx on square_memberships(square_id, status, role, user_id);

create table square_policies (
  square_id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  default_mode text not null default 'approval_required',
  allowed_domains jsonb not null default '[]'::jsonb,
  allowed_tool_names jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint square_policies_owner_square_fk
    foreign key (owner_id, square_id) references squares(owner_id, id) on delete cascade,
  constraint square_policies_mode_allowed check (default_mode in ('read_only','approval_required','autonomous')),
  constraint square_policies_domains_array check (jsonb_typeof(allowed_domains) = 'array'),
  constraint square_policies_tools_array check (jsonb_typeof(allowed_tool_names) = 'array'),
  constraint square_policies_settings_object check (jsonb_typeof(settings) = 'object'),
  constraint square_policies_revision_positive check (revision > 0)
);
