-- Goals and Projects as first-class knowledge entities.
-- Real Town.ai treats Goals and Projects as structured objects, not just Wiki text.

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title text not null,
  description text not null default '',
  status text not null default 'active' check (status in ('active','completed','paused','archived')),
  metadata jsonb not null default '{}',
  current_revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists goals_owner_idx on goals(owner_id);
create index if not exists goals_owner_status_idx on goals(owner_id, status);
create index if not exists goals_search_idx on goals
  using gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title text not null,
  description text not null default '',
  status text not null default 'active' check (status in ('active','on_hold','completed','archived')),
  goal_id uuid references goals(id) on delete set null,
  metadata jsonb not null default '{}',
  current_revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_idx on projects(owner_id);
create index if not exists projects_owner_status_idx on projects(owner_id, status);
create index if not exists projects_goal_idx on projects(goal_id);
create index if not exists projects_search_idx on projects
  using gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));
