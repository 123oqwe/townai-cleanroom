create table profiles (
  id uuid primary key,
  owner_id uuid not null,
  content jsonb not null default '{}'::jsonb,
  current_revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint profiles_owner_id_unique unique (owner_id),
  constraint profiles_content_object check (jsonb_typeof(content) = 'object'),
  constraint profiles_revision_positive check (current_revision > 0)
);

create table memories (
  id uuid primary key,
  owner_id uuid not null,
  scope text not null,
  scope_id uuid,
  content text not null,
  status text not null default 'active',
  confidence real,
  observed_at timestamptz not null,
  expires_at timestamptz,
  current_revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memories_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint memories_scope_valid check (
    (scope = 'global' and scope_id is null) or
    (scope = 'routine' and scope_id is not null)
  ),
  constraint memories_content_nonempty check (length(btrim(content)) > 0),
  constraint memories_status_allowed
    check (status in ('active', 'stale', 'superseded', 'retired')),
  constraint memories_confidence_valid
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint memories_freshness_valid
    check (expires_at is null or expires_at > observed_at),
  constraint memories_revision_positive check (current_revision > 0)
);

create index memories_owner_scope_status_idx
  on memories(owner_id, scope, scope_id, status);
create index memories_search_idx
  on memories using gin (to_tsvector('simple', content));

create table people (
  id uuid primary key,
  owner_id uuid not null,
  display_name text not null,
  primary_email citext,
  category text not null default 'uncategorized',
  organization text,
  role text,
  notes text not null default '',
  status text not null default 'active',
  current_revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint people_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint people_display_name_nonempty check (length(btrim(display_name)) > 0),
  constraint people_category_allowed
    check (category in ('uncategorized', 'coworker', 'family', 'personal')),
  constraint people_status_allowed check (status in ('active', 'retired')),
  constraint people_revision_positive check (current_revision > 0),
  constraint people_owner_email_unique unique (owner_id, primary_email)
);

create index people_owner_category_status_idx
  on people(owner_id, category, status);
create index people_search_idx on people using gin (
  to_tsvector(
    'simple',
    display_name || ' ' || coalesce(organization, '') || ' ' ||
      coalesce(role, '') || ' ' || notes
  )
);

create table wiki_documents (
  id uuid primary key,
  owner_id uuid not null,
  kind text not null,
  slug text not null,
  title text not null,
  body text not null default '',
  status text not null default 'active',
  current_revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_documents_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint wiki_documents_kind_allowed
    check (kind in ('profile', 'goal', 'project', 'page')),
  constraint wiki_documents_slug_nonempty check (length(btrim(slug)) > 0),
  constraint wiki_documents_title_nonempty check (length(btrim(title)) > 0),
  constraint wiki_documents_status_allowed check (status in ('active', 'retired')),
  constraint wiki_documents_revision_positive check (current_revision > 0),
  constraint wiki_documents_owner_kind_slug_unique unique (owner_id, kind, slug)
);

create index wiki_documents_owner_kind_status_idx
  on wiki_documents(owner_id, kind, status);
create index wiki_documents_search_idx on wiki_documents using gin (
  to_tsvector('simple', title || ' ' || body)
);

create index profiles_search_idx on profiles using gin (
  to_tsvector('simple', content::text)
);

create table knowledge_revisions (
  id uuid primary key,
  owner_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  revision integer not null,
  base_revision integer not null,
  author_type text not null,
  snapshot jsonb not null,
  change_reason text,
  created_at timestamptz not null default now(),
  constraint knowledge_revisions_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint knowledge_revisions_resource_type_allowed
    check (resource_type in ('profile', 'memory', 'person', 'wiki')),
  constraint knowledge_revisions_author_type_allowed
    check (author_type in ('user', 'assistant', 'system')),
  constraint knowledge_revisions_revision_valid
    check (revision > 0 and base_revision >= 0 and base_revision < revision),
  constraint knowledge_revisions_snapshot_object
    check (jsonb_typeof(snapshot) = 'object'),
  constraint knowledge_revisions_resource_revision_unique
    unique (resource_type, resource_id, revision)
);

create index knowledge_revisions_owner_resource_idx
  on knowledge_revisions(owner_id, resource_type, resource_id, revision desc);

create table knowledge_citations (
  id uuid primary key,
  owner_id uuid not null,
  revision_id uuid not null,
  source_type text not null,
  source_ref text not null,
  source_label text,
  account_id uuid,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint knowledge_citations_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint knowledge_citations_revision_id_knowledge_revisions_id_fk
    foreign key (revision_id) references knowledge_revisions(id) on delete cascade,
  constraint knowledge_citations_account_id_connected_accounts_id_fk
    foreign key (account_id) references connected_accounts(id) on delete set null,
  constraint knowledge_citations_source_type_allowed
    check (source_type in ('user', 'account', 'session', 'web', 'system')),
  constraint knowledge_citations_account_binding_valid check (
    (source_type = 'account' and account_id is not null) or
    (source_type <> 'account' and account_id is null)
  ),
  constraint knowledge_citations_source_ref_nonempty
    check (length(btrim(source_ref)) > 0)
);

create index knowledge_citations_owner_revision_idx
  on knowledge_citations(owner_id, revision_id);

create table knowledge_conflicts (
  id uuid primary key,
  owner_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  base_revision integer not null,
  current_revision integer not null,
  proposed_author_type text not null,
  proposed_snapshot jsonb not null,
  proposed_citations jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  resolution_revision integer,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint knowledge_conflicts_owner_id_users_id_fk
    foreign key (owner_id) references users(id) on delete cascade,
  constraint knowledge_conflicts_resource_type_allowed
    check (resource_type in ('profile', 'memory', 'person', 'wiki')),
  constraint knowledge_conflicts_author_type_allowed
    check (proposed_author_type in ('assistant', 'system')),
  constraint knowledge_conflicts_revision_order
    check (base_revision >= 0 and current_revision > base_revision),
  constraint knowledge_conflicts_snapshot_object
    check (jsonb_typeof(proposed_snapshot) = 'object'),
  constraint knowledge_conflicts_citations_array
    check (jsonb_typeof(proposed_citations) = 'array'),
  constraint knowledge_conflicts_status_allowed
    check (status in ('pending', 'resolved', 'rejected')),
  constraint knowledge_conflicts_resolution_valid check (
    (status = 'pending' and resolution_revision is null and resolved_at is null) or
    (status in ('resolved', 'rejected') and resolved_at is not null)
  )
);

create index knowledge_conflicts_owner_status_idx
  on knowledge_conflicts(owner_id, status, created_at, id);
