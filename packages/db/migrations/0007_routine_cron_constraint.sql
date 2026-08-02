alter table routine_schedules drop constraint routine_schedules_cron_shape;
alter table routine_schedules add constraint routine_schedules_cron_shape
  check (cron ~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+$');
