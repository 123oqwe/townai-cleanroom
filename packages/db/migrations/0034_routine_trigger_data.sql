alter table integration_sync_runs
  add column trigger_type text not null default 'schedule',
  add column trigger_data jsonb not null default '{}'::jsonb,
  add column idempotency_key text;

alter table integration_sync_runs
  add constraint integration_sync_runs_trigger_type_allowed
    check (trigger_type in ('schedule', 'manual', 'webhook', 'incoming_email', 'calendar', 'voice_transcribed', 'slack_mention')),
  add constraint integration_sync_runs_trigger_data_object
    check (jsonb_typeof(trigger_data) = 'object'),
  add constraint integration_sync_runs_idempotency_key_shape
    check (idempotency_key is null or length(btrim(idempotency_key)) between 1 and 500);

create index integration_sync_runs_owner_trigger_idx
  on integration_sync_runs(owner_id, trigger_type, created_at desc, id desc);
