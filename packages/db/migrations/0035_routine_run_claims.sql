alter table integration_sync_runs
  add column claim_token uuid,
  add column claimed_by text,
  add column claim_expires_at timestamptz;

alter table integration_sync_runs
  add constraint integration_sync_runs_claimed_by_shape
    check (claimed_by is null or length(btrim(claimed_by)) between 1 and 200),
  add constraint integration_sync_runs_claim_state_shape
    check ((claim_token is null and claimed_by is null and claim_expires_at is null)
      or (claim_token is not null and claimed_by is not null and claim_expires_at is not null));

create index integration_sync_runs_queued_claim_idx
  on integration_sync_runs(owner_id, status, claim_expires_at, created_at, id)
  where status = 'queued';
