-- Phase 01A: Legacy session cutover.
-- Sessions created before OIDC hardening have auth_method IS NULL.
-- These old email-only sessions must be revoked to force re-authentication
-- through the hardened path (OIDC or dev:email with idle/absolute expiry).
--
-- This migration is safe and idempotent: it only updates rows where
-- revoked_at IS NULL AND auth_method IS NULL, setting revoked_at to now().
-- Sessions already revoked are left untouched.

update auth_sessions
  set revoked_at = now(),
      is_current = false
  where auth_method is null
    and revoked_at is null;

-- Index for future cleanup queries (find legacy sessions for audit).
create index if not exists auth_sessions_legacy_auth_method_idx
  on auth_sessions(auth_method)
  where auth_method is null;
