-- Structured knowledge graph with typed edges between arbitrary entities.
-- Real Town.ai has a knowledge graph with typed edges like works_at,
-- reports_to, communicated_with, attended, related_to, owns, mentioned_in.

create table if not exists knowledge_graph_edges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  from_type text not null check (from_type in ('person','organization','project','goal','topic','email_thread','calendar_event','document','task','routine','memory','wiki')),
  from_id text not null,
  to_type text not null check (to_type in ('person','organization','project','goal','topic','email_thread','calendar_event','document','task','routine','memory','wiki')),
  to_id text not null,
  edge_type text not null check (edge_type in ('works_at','reports_to','communicated_with','attended','related_to','owns','mentioned_in','member_of','part_of','created_by','assigned_to','references','depends_on','collaborated_on','manages')),
  notes text,
  metadata jsonb not null default '{}',
  revision integer not null default 1,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists graph_edges_owner_from_to_type_unique
  on knowledge_graph_edges(owner_id, from_type, from_id, to_type, to_id, edge_type);
create index if not exists graph_edges_owner_idx on knowledge_graph_edges(owner_id);
create index if not exists graph_edges_from_idx on knowledge_graph_edges(from_type, from_id, status);
create index if not exists graph_edges_to_idx on knowledge_graph_edges(to_type, to_id, status);
create index if not exists graph_edges_owner_edge_type_idx on knowledge_graph_edges(owner_id, edge_type, status);
