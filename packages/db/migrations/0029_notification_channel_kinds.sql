alter table notification_channels
  drop constraint notification_channels_kind_allowed;
alter table notification_channels
  add constraint notification_channels_kind_allowed check (
    kind in ('email', 'webhook', 'telegram', 'whatsapp', 'slack', 'imessage')
  );
