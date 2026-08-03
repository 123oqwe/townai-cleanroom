alter table a2a_requests
  add column consent_status text not null default 'pending'
    check (consent_status in ('pending','granted','denied','revoked')),
  add column consent_scope jsonb not null default '[]'::jsonb
    check (jsonb_typeof(consent_scope)='array'),
  add column consented_by uuid references users(id) on delete set null,
  add column consented_at timestamptz;

create index a2a_requests_consent_status_idx
  on a2a_requests(recipient_id, consent_status, updated_at desc);
