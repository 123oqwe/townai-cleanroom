alter table integration_sync_runs
  drop constraint integration_sync_runs_owner_routine_fk;

alter table integration_sync_runs
  add constraint integration_sync_runs_owner_routine_fk
  foreign key (owner_id, routine_schedule_id)
  references routine_schedules(owner_id, id)
  on delete restrict;
