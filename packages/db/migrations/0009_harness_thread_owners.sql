alter table harness_threads
  add column owner_id uuid references users(id) on delete cascade;

do $$
begin
  if exists (select 1 from harness_threads where owner_id is null) then
    raise exception '0009_harness_thread_owners requires explicit ownership for existing harness threads';
  end if;
end $$;

alter table harness_threads
  alter column owner_id set not null;

create index harness_threads_owner_idx
  on harness_threads(owner_id, updated_at, id);
