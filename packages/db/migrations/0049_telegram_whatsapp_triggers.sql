-- Allow Telegram and WhatsApp message triggers on integration_sync_runs
alter table integration_sync_runs
  drop constraint if exists integration_sync_runs_trigger_type_allowed;

alter table integration_sync_runs
  add constraint integration_sync_runs_trigger_type_allowed
  check (trigger_type in (
    'schedule','manual','webhook','incoming_email','email_to_assistant',
    'calendar','voice_transcribed','slack_mention',
    'telegram_message','whatsapp_message'
  ));

