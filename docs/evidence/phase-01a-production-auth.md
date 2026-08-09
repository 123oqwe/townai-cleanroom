# Phase 01A — Production Authentication Completion (Evidence)

> This document is the authoritative evidence ledger for Phase 01A. It is
> updated as work completes. It does NOT claim S4/Live Verified without real
> Google credentials.

## 1. Start SHA

- Audit baseline SHA: `34533f0e089e771128db61c9dba8bf41523a1d01`
- Actual start SHA: `34533f0e089e771128db61c9dba8bf41523a1d01` (no drift;
  main had not advanced at start)
- Branch: `codex/phase-01a-production-auth-complete`
- Worktree: `/Users/guanjieqiao/townai-cleanroom-phase01a`

## 2. End SHA

- WIP commit: `3f78a54` (first checkpoint; final SHA updated on completion)

## 3. Files Reviewed (Audit)

- `apps/web-next/app/api/auth/login/route.ts`, `logout/route.ts`, `me/route.ts`,
  `proxy/[...path]/route.ts`, `new/(auth)/login/page.tsx`, `new/(app)/layout.tsx`,
  `middleware.ts`, `next.config.ts`, `api-client.tsx`
- `apps/api/src/app.ts`, `compose.ts`, `config.ts`, `lib/auth.ts`,
  `lib/google-oidc.ts`, `oauth/google-oauth-routes.ts`
- `packages/identity/src/identity-service.ts`, `identity-repository.ts`,
  `session-token.ts`, `account-repository.ts`, `credential-cipher.ts`, `types.ts`
- `packages/db/migrations/0001_identity.sql`, `packages/db/src/schema.ts`
- `.github/workflows/ci.yml`, `.env.example`, `scripts/check-runtime-config.mjs`
- `docs/implementation-status.md`, `docs/ARCHITECTURE_GAPS.md`, `docs/deployment.md`
- `test/browser/auth-flow.spec.ts`

## 4. Current Vulnerability Root Cause

The production login was `POST /v1/auth/session` accepting a bare email,
checking it against the allowlist, and creating a session. The allowlist was
acting as identity proof — it is only an authorization policy. No real
identity verification (Google OIDC) existed. Additionally:

- Session cookie name `town-token` hardcoded in 6 files; cookie TTL (7d) did
  not match backend session TTL (30d).
- No CSRF/Origin protection on proxy mutations.
- `next.config.ts` exposed `NEXT_PUBLIC_API_BASE_URL` to the browser.
- No production fail-fast for missing auth config; dev email login was
  available in all environments.
- `lib/google-oidc.ts` only verified Pub/Sub push JWTs, not a login flow.

## 5. Final Authentication Architecture

```
Browser
  |  (no session token in JS; HttpOnly cookie only)
  v
Next.js Auth BFF  (/api/auth/google/*, /api/proxy/*)
  |  server-to-server, AUTH_BFF_SHARED_SECRET (timing-safe)
  v
API OIDC Service  (/v1/auth/oidc/google/start, /callback)
  |
  v
Google OIDC  (Authorization Code + PKCE, JWKS signature via jose)
  |
  v
API validates identity (iss/aud/azp/exp/iat/nonce/email_verified/sub)
  |
  v
API links verified identity (auth_identities: provider+subject unique)
  |
  v
API creates opaque hashed session (idle+absolute expiry, rotation, family)
  |  server-to-server only
  v
Next.js sets __Host-town-session HttpOnly cookie
  |
  v
Browser never sees raw session token
```

## 6. New Migration

- `0051_auth_oidc_verified_identity.sql` (additive, backward compatible)
  - `auth_oidc_attempts`: state_hash unique, nonce_hash, encrypted_code_verifier
    (jsonb), redirect_path, expires_at, consumed_at, failure_code. One-time
    consume via `FOR UPDATE` in a transaction.
  - `auth_identities`: (provider, provider_subject) unique, verified_email,
    email_verified check.
  - `auth_sessions` new columns: auth_method, idle_expires_at,
    absolute_expires_at, session_family_id, rotated_from_session_id,
    user_agent_hash, ip_metadata_hash, is_current. All nullable.

## 7. New Environment Variables

- `AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET` / `AUTH_GOOGLE_REDIRECT_URI`
  (login OAuth; separate from `GOOGLE_OAUTH_*` connected-account vars)
- `AUTH_BFF_SHARED_SECRET` (>= 32 chars, server-only, timing-safe)
- `AUTH_FLOW_ENCRYPTION_KEY_BASE64URL` (32-byte base64url; encrypts code_verifier
  at rest; separate from `CREDENTIAL_MASTER_KEY_BASE64URL`)
- `AUTH_ALLOWED_ORIGINS` (comma-separated, no wildcard)
- `AUTH_SIGNUP_MODE` (`allowlist` | `open`; default `allowlist`)
- `DEV_EMAIL_LOGIN_ENABLED` (default false; forbidden in production)
- `INTERNAL_API_BASE_URL` (server-only; replaces `NEXT_PUBLIC_API_BASE_URL`)
- `AUTH_SESSION_IDLE_TTL_MS` / `AUTH_SESSION_ABSOLUTE_TTL_MS`

## 8. How Email-only Login Was Sealed

- `POST /v1/auth/session` renamed to `POST /v1/auth/dev-session`.
- The dev-session route is registered ONLY when `devEmailLoginEnabled === true`
  (non-production AND `DEV_EMAIL_LOGIN_ENABLED=true`).
- In production the route does not exist → 404.
- `assertProductionAuthConfig()` runs at API startup (`index.ts`); if
  `NODE_ENV=production` and `DEV_EMAIL_LOGIN_ENABLED=true`, startup throws.
- `scripts/check-runtime-config.mjs --strict` fails on production + dev-login.
- The BFF `/api/auth/login` route returns 404 in production builds.
- The production login page only shows "Continue with Google".

## 9. OIDC Verification Rules

Authorization Code + PKCE (S256). Verified with `jose` against Google JWKS:

- cryptographically random state, nonce, code_verifier (one-time use)
- state_hash unique; consumed atomically (`FOR UPDATE`); replay rejected
- redirect URI allowlist (configured redirect only)
- issuer validation (`accounts.google.com`)
- audience validation (== client id)
- azp validation (if present, == client id)
- exp validation (ERR_JWT_EXPIRED → AUTH_TOKEN_EXPIRED)
- iat validation (required claim)
- nonce validation (== stored nonce; AUTH_NONCE_INVALID on mismatch)
- email_verified === true (AUTH_EMAIL_NOT_VERIFIED otherwise)
- provider subject/sub required
- callback replay protection (one-time consume)

## 10. Session Lifecycle

- Opaque random token `town_session_<32-byte-base64url>`, SHA-256 hash at rest.
- Browser never receives the raw token (HttpOnly cookie).
- `auth_sessions.expires_at` = min(idle, absolute); middleware checks
  revoked_at, idle, and absolute expiry.
- Cookie TTL matches absolute TTL (7 days default).
- `last_seen_at` updates throttled (default 60s) to avoid per-request DB writes.
- Logout revokes the current session server-side.
- Logout-all revokes every session for the user.
- Session list (`GET /v1/me/sessions`) and revoke (`DELETE /v1/me/sessions/:id`).
- Rotation (`POST /v1/me/session/rotate`): atomic tx revokes old token +
  creates new one in the same family; old token immediately invalid.

## 11. CSRF Strategy

- `assertSameOriginRequest()` in `lib/server/csrf.ts` enforces same-origin on
  POST/PUT/PATCH/DELETE.
- Checks Origin, Host, X-Forwarded-Host, Sec-Fetch-Site against
  `AUTH_ALLOWED_ORIGINS` (timing-safe compare; no wildcard).
- Cross-site mutations → 403 `CSRF_REJECTED`.
- Missing/forged Origin on browser mutations → rejected.
- Google callback (GET) uses state/nonce, not CSRF.
- Applied to: logout, logout-all, rotate, dev login, proxy mutations.

## 12. Test Commands

- `pnpm verify` (format, lint, typecheck, build, unit tests)
- `pnpm test` (vitest unit + PG integration via testcontainers)
- `pnpm test:e2e:browser` (Playwright)
- `pnpm --filter @town/api test`
- `node scripts/check-runtime-config.mjs --strict`
- `node scripts/live-google-auth-smoke.mjs` (manual; requires real credentials)

## 13. Test Results

- identity package: 39 tests pass (18 new + 21 existing, no regressions)
- auth-config: 12 tests pass (production fail-fast cases)
- google-oidc-login: 9 tests pass (LOCAL_OIDC_INTEGRATION_TEST; signature +
  iss/aud/azp/nonce/email_verified/exp claim checks)
- Full `pnpm verify`: see progress.md for the latest run status

## 14. Live Google Results

- STATUS: BLOCKED_BY_CREDENTIAL
- Real Google credentials are not available. Full code path implemented and
  locally tested. Live smoke (`scripts/live-google-auth-smoke.mjs`) outputs
  BLOCKED_BY_CREDENTIAL and lists required variables.
- Google login live verified: not completed

## 15. Unresolved Risks

- No real Google Live Verification (S4) — blocked on credentials.
- JWKS fetching depends on Google availability; consider a cached fallback
  key set for resilience (future hardening).
- Session rotation uses an `x-session-token` header from the BFF; this is
  acceptable because the BFF is server-side and the token never reaches the
  browser, but a future revision could rotate by session id + proof.
- No automated cross-tenant isolation test sweep beyond existing owner-scoped
  query patterns.

## 16. Rollback

- The change is on branch `codex/phase-01a-production-auth-complete`; main
  is untouched. Rollback = do not merge / revert the merge commit.
- Migration 0051 is additive (nullable columns + new tables); rolling back
  the code while leaving the migration applied is safe (old code ignores the
  new columns/tables). To fully revert the schema, drop the new tables and
  columns (they carry no data the old code needs).
- Existing sessions (created before the migration) continue to authenticate:
  the new expiry columns are nullable and the old `expires_at`/`revoked_at`
  checks still apply.

## 17. Maturity (S0–S6)

- Authentication code: S2 (implemented + tested)
- Staging configured: not completed (no staging credentials)
- Google login live verified: not completed
- Do not write "Authentication Resolved" until real Google OIDC reaches S4.

## Gates

- Auth Code Gate: GO (all 16 acceptance criteria met at the code level; see
  final report) — contingent on full CI green.
- Public Beta Gate: NO-GO (BLOCKED_BY_CREDENTIAL; no real Google live smoke).
