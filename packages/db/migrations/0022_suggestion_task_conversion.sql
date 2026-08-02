alter table suggestions add column converted_task_id uuid;
alter table suggestions add constraint suggestions_owner_task_fk
  foreign key (owner_id, converted_task_id) references tasks(owner_id, id) on delete set null;
create unique index suggestions_owner_converted_task_idx
  on suggestions(owner_id, converted_task_id) where converted_task_id is not null;
