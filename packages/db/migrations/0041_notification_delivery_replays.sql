alter table notification_deliveries
  add column replay_of_delivery_id uuid;

alter table notification_deliveries
  add constraint notification_deliveries_owner_id_unique
  unique (owner_id, id);

alter table notification_deliveries
  add constraint notification_deliveries_owner_replay_fk
  foreign key (owner_id, replay_of_delivery_id)
  references notification_deliveries (owner_id, id)
  on delete restrict;

create index notification_deliveries_replay_idx
  on notification_deliveries (owner_id, replay_of_delivery_id, created_at desc, id desc);
