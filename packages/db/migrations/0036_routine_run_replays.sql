alter table integration_sync_runs
  add column replay_of_run_id uuid,
  add column replay_key text;

alter table integration_sync_runs
  add constraint integration_sync_runs_owner_replay_fk
    foreign key (owner_id, replay_of_run_id)
    references integration_sync_runs(owner_id, id) on delete set null,
  add constraint integration_sync_runs_replay_key_shape
    check (replay_key is null or length(btrim(replay_key)) between 1 and 500),
  add constraint integration_sync_runs_replay_state_shape
    check ((replay_of_run_id is null and replay_key is null)
      or (replay_of_run_id is not null and replay_key is not null));

create unique index integration_sync_runs_replay_unique
  on integration_sync_runs(owner_id, replay_of_run_id, replay_key)
  where replay_of_run_id is not null;
