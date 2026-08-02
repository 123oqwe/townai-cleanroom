create table a2a_requests (
  id uuid primary key, requester_id uuid not null references users(id) on delete cascade,
  recipient_id uuid not null references users(id) on delete cascade,
  capability text not null check (length(btrim(capability)) between 1 and 200),
  request jsonb not null check (jsonb_typeof(request)='object'), result jsonb,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','completed')),
  revision integer not null default 1 check (revision > 0), expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (requester_id <> recipient_id), check (result is null or jsonb_typeof(result)='object')
);
create index a2a_requests_recipient_status_idx on a2a_requests(recipient_id,status,created_at desc);
create index a2a_requests_requester_status_idx on a2a_requests(requester_id,status,created_at desc);
