create unique index integration_sync_runs_trigger_idempotency_unique
  on integration_sync_runs(owner_id, trigger_type, idempotency_key)
  where idempotency_key is not null;
