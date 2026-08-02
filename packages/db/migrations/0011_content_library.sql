create table content_items (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  kind text not null,
  title text not null,
  mime_type text,
  storage_key text,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  source_session_id uuid,
  status text not null default 'active',
  current_revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_items_kind_allowed check (kind in ('document','file','image','audio','recording','briefing')),
  constraint content_items_status_allowed check (status in ('active','archived','deleted')),
  constraint content_items_payload_present check (storage_key is not null or body is not null),
  constraint content_items_metadata_object check (jsonb_typeof(metadata) = 'object')
);
alter table content_items add constraint content_items_owner_id_id_unique unique (owner_id, id);
alter table content_items add constraint content_items_owner_source_session_fk
  foreign key (owner_id, source_session_id) references runtime_sessions(owner_id, id);
create index content_items_owner_status_idx on content_items(owner_id, status, updated_at desc, id desc);
create unique index content_items_owner_storage_key_unique on content_items(owner_id, storage_key) where storage_key is not null;

create table content_revisions (
  id uuid primary key,
  content_id uuid not null references content_items(id) on delete cascade,
  owner_id uuid not null references users(id) on delete cascade,
  revision integer not null,
  title text not null,
  mime_type text,
  storage_key text,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(content_id, revision),
  constraint content_revisions_payload_present check (storage_key is not null or body is not null),
  constraint content_revisions_metadata_object check (jsonb_typeof(metadata) = 'object')
);
alter table content_revisions add constraint content_revisions_owner_content_fk
  foreign key (owner_id, content_id) references content_items(owner_id, id) on delete cascade;
create index content_revisions_owner_content_idx on content_revisions(owner_id, content_id, revision desc);

create table content_collections (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, name)
);
create index content_collections_owner_idx on content_collections(owner_id, updated_at desc, id desc);
alter table content_collections add constraint content_collections_owner_id_unique unique (owner_id, id);

create table content_collection_items (
  collection_id uuid not null references content_collections(id) on delete cascade,
  content_id uuid not null references content_items(id) on delete cascade,
  owner_id uuid not null references users(id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key(collection_id, content_id),
  constraint content_collection_items_position_nonnegative check (position >= 0)
);
alter table content_collection_items add constraint content_collection_items_owner_collection_fk
  foreign key (owner_id, collection_id) references content_collections(owner_id, id) on delete cascade;
alter table content_collection_items add constraint content_collection_items_owner_content_fk
  foreign key (owner_id, content_id) references content_items(owner_id, id) on delete cascade;
create index content_collection_items_owner_idx on content_collection_items(owner_id, collection_id, position, content_id);

create table content_share_tokens (
  id uuid primary key,
  content_id uuid not null references content_items(id) on delete cascade,
  owner_id uuid not null references users(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index content_share_tokens_lookup_idx on content_share_tokens(token_hash) where revoked_at is null;
alter table content_share_tokens add constraint content_share_tokens_owner_content_fk
  foreign key (owner_id, content_id) references content_items(owner_id, id) on delete cascade;
