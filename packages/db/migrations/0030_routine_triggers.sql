create table routine_triggers (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  routine_schedule_id uuid not null,
  kind text not null,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routine_triggers_owner_routine_fk
    foreign key (owner_id, routine_schedule_id)
    references routine_schedules(owner_id, id) on delete cascade,
  constraint routine_triggers_kind_allowed check (
    kind in ('manual','schedule','incoming_email','outgoing_email',
      'email_to_assistant','calendar_start','calendar_end','calendar_rsvp',
      'calendar_changed','voice_transcribed','slack_mention','webhook')
  ),
  constraint routine_triggers_config_object check (jsonb_typeof(config) = 'object'),
  constraint routine_triggers_revision_positive check (revision > 0),
  constraint routine_triggers_owner_id_unique unique (owner_id, id)
);
create index routine_triggers_owner_routine_idx
  on routine_triggers(owner_id, routine_schedule_id, enabled, created_at, id);
