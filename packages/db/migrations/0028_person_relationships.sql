alter table people
  add constraint people_owner_id_unique unique (owner_id, id);

create table person_relationships (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  person_id uuid not null,
  related_person_id uuid not null,
  relationship_type text not null,
  notes text not null default '',
  status text not null default 'active',
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint person_relationships_owner_person_fk
    foreign key (owner_id, person_id) references people(owner_id, id) on delete cascade,
  constraint person_relationships_owner_related_fk
    foreign key (owner_id, related_person_id) references people(owner_id, id) on delete cascade,
  constraint person_relationships_distinct_people check (person_id <> related_person_id),
  constraint person_relationships_type_nonempty check (length(btrim(relationship_type)) > 0),
  constraint person_relationships_status_allowed check (status in ('active', 'retired')),
  constraint person_relationships_revision_positive check (revision > 0),
  constraint person_relationships_owner_id_unique unique (owner_id, id),
  constraint person_relationships_unique_edge unique (owner_id, person_id, related_person_id, relationship_type)
);
create index person_relationships_owner_person_idx
  on person_relationships(owner_id, person_id, status, created_at, id);
create index person_relationships_owner_related_idx
  on person_relationships(owner_id, related_person_id, status, created_at, id);
