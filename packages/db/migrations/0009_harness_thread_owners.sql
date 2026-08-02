alter table harness_threads
  add column owner_id uuid references users(id) on delete cascade;

create index harness_threads_owner_idx
  on harness_threads(owner_id, updated_at, id);
