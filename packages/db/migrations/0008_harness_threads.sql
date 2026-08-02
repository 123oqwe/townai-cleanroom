create table harness_threads (
  id uuid primary key,
  snapshot jsonb not null,
  revision integer not null,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint harness_threads_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint harness_threads_revision_nonnegative check (revision >= 0),
  constraint harness_threads_lease_shape check (
    (lease_owner is null and lease_expires_at is null) or
    (lease_owner is not null and lease_expires_at is not null)
  )
);

create index harness_threads_lease_expiry_idx
  on harness_threads(lease_expires_at)
  where lease_expires_at is not null;
