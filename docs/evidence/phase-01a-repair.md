# Phase 01A Repair Gate Evidence

## Pre-Repair State

- **Latest main SHA:** `cc51269f589257155f0e07e20794508f826e89b9`
- **Pre-repair branch SHA:** `0e3f8e9a2f40bc25df9874120561058e1b2a84aa`
- **PR Head SHA (pre-repair):** `0e3f8e9a2f40bc25df9874120561058e1b2a84aa`
- **ahead/behind (pre-repair):** 6 ahead, 1 behind main
- **Rebase result:** Clean rebase onto `cc51269` (no conflicts)

## Post-Repair State

- **Post-repair branch SHA:** `b2ff2fd1a4fd9105ba1e9e9018f2229057e4d664`
- **ahead/behind (post-repair):** 12 ahead, 0 behind main
- **PR URL:** https://github.com/123oqwe/townai-cleanroom/pull/1

## CI Failures (Pre-Repair)

### verify (FAIL)

Root cause: `pnpm format:check` fails on `.planning/phase-01a/progress.md` (Prettier formatting violation).

### browser-e2e (FAIL)

Root cause: `POST /api/auth/google/start` returns 500 instead of 503 when OIDC is not configured. `OidcRouteError` is not mapped in `app.onError()`, falls through to catch-all 500.

### production-config (PASS)

### Vercel (PASS)

## CI Results (Post-Repair)

All CI checks PASS on latest PR Head `b2ff2fd`:

| Check             | Push Trigger | PR Trigger   |
| ----------------- | ------------ | ------------ |
| verify            | PASS (4m47s) | PASS (4m26s) |
| browser-e2e       | PASS (2m26s) | PASS (2m38s) |
| production-config | PASS (13s)   | PASS (12s)   |
| Vercel            | PASS         | PASS         |

GitHub Actions runs:

- Push: https://github.com/123oqwe/townai-cleanroom/actions/runs/31345798905
- Pull Request: https://github.com/123oqwe/townai-cleanroom/actions/runs/31345800837

## Defect Matrix

| ID          | Severity | Root Cause                                                                 | Status |
| ----------- | -------- | -------------------------------------------------------------------------- | ------ |
| AUTH-P0-001 | P0       | OidcRouteError not mapped in app.ts onError (500 instead of 503)           | fixed  |
| AUTH-P0-002 | P0       | 7 BFF routes fallback to NEXT_PUBLIC_API_BASE_URL/localhost                | fixed  |
| AUTH-P0-003 | P0       | IdentityService.authenticate uses old path without hardened session checks | fixed  |
| AUTH-P0-004 | P0       | Dev Login creates old-style session via establishIdentity                  | fixed  |
| AUTH-P0-005 | P0       | authenticateHardened uses FOR UPDATE outside transaction                   | fixed  |
| AUTH-P1-001 | P1       | Cookie maxAge hardcoded 7 days instead of server-authoritative             | fixed  |
| AUTH-P1-002 | P1       | Callback error reflects raw body.code into URL                             | fixed  |
| AUTH-P1-003 | P1       | No Cache-Control: no-store on auth responses                               | fixed  |
| AUTH-P1-004 | P1       | Rotation passes raw token in x-session-token header                        | fixed  |
| AUTH-P1-005 | P1       | Legacy auth_method=null sessions not cut over                              | fixed  |
| AUTH-P1-006 | P1       | CSRF allows host-only fallback when Origin missing                         | fixed  |
| AUTH-P1-007 | P1       | Logout/logout-all swallow backend failures                                 | fixed  |
| AUTH-P2-001 | P2       | Absolute expiry reset by rotation                                          | fixed  |
| AUTH-P2-002 | P2       | Idle expiry not sliding (fixed at creation)                                | fixed  |

## Auth Call Graph (Full Repository)

```
Browser
-> Next.js Login UI (/new/login)
-> Next.js BFF Routes:
  -> /api/auth/google/start (POST) -> API /v1/auth/oidc/google/start
  -> /api/auth/google/callback (GET) -> API /v1/auth/oidc/google/callback
  -> /api/auth/login (POST, dev-only) -> API /v1/auth/dev-session
  -> /api/auth/logout (POST) -> API /v1/me/session (DELETE)
  -> /api/auth/logout-all (POST) -> API /v1/me/sessions (DELETE)
  -> /api/auth/me (GET) -> API /v1/me (GET)
  -> /api/auth/session/rotate (POST) -> API /v1/me/session/rotate (POST)
  -> /api/auth/sessions (GET/DELETE) -> API /v1/me/sessions
  -> /api/proxy/[...path] (ALL) -> API /v1/* (with Bearer injection)
-> API Auth Middleware (createAuthMiddleware)
-> IdentityService.authenticate(token)
-> SessionManager.authenticateHardened(tokenHash, now, idleTtlMs)
-> auth_sessions table (PostgreSQL) -- atomic UPDATE...RETURNING
-> users table
```

## Error Mapping

| Error Type             | Code                       | HTTP Status |
| ---------------------- | -------------------------- | ----------- |
| OidcRouteError         | AUTH_NOT_CONFIGURED        | 503         |
| OidcRouteError         | AUTH_ACCOUNT_NOT_ALLOWED   | 403         |
| OidcRouteError         | AUTH_FLOW_INVALID          | 400         |
| OidcRouteError         | AUTH_TOKEN_EXCHANGE_FAILED | 502         |
| OidcRouteError         | UNAUTHORIZED               | 401         |
| OidcAttemptError       | AUTH_FLOW_EXPIRED          | 400         |
| OidcAttemptError       | AUTH_FLOW_REPLAYED         | 409         |
| OidcAttemptError       | AUTH_STATE_INVALID         | 400         |
| VerifiedIdentityError  | AUTH_IDENTITY_CONFLICT     | 409         |
| SessionManagementError | SESSION_ROTATION_CONFLICT  | 409         |
| SessionManagementError | SESSION_NOT_FOUND          | 404         |
| SessionManagementError | SESSION_EXPIRED/REVOKED    | 401         |
| IdentityError          | UNAUTHENTICATED            | 401         |
| IdentityError          | ACCESS_DENIED              | 403         |

## Canonical Authentication Path

```
IdentityService.authenticate(token)
-> validate token format (isSessionToken)
-> hash token (hashSessionToken)
-> SessionManager.authenticateHardened(tokenHash, now, idleTtlMs)
-> single atomic UPDATE...RETURNING:
     - token_hash matches
     - revoked_at IS NULL
     - expires_at > now
     - idle_expires_at IS NULL OR > now (legacy exempt)
     - absolute_expires_at IS NULL OR > now (legacy exempt)
     - user.status = 'active'
-> sliding idle expiration (throttled, capped by absolute_expires_at)
-> load user via findUserById
-> return AuthenticatedIdentity
```

## Dev Login Path

```
IdentityService.establishDevIdentity(input)
-> validate allowlist (establishDevUser)
-> SessionManager.create(userId, authMethod='dev:email', idleTtlMs, absoluteTtlMs)
-> returns hardened session with idle/absolute expiry
```

Only available when: `NODE_ENV !== 'production' AND DEV_EMAIL_LOGIN_ENABLED === true`

## Sliding Idle / Absolute Expiry

- **absolute_expires_at:** Set at session family creation, never extended by activity or rotation.
- **idle_expires_at:** Extended on activity when throttle window elapsed, capped by absolute_expires_at.
- **expires_at:** `min(idle_expires_at, absolute_expires_at)`.
- Atomic UPDATE...RETURNING extends idle_expires_at and expires_at in the same statement.
- No SELECT FOR UPDATE followed by separate UPDATE.

## Rotation Semantics

- Rotate by session ID from auth context (no raw token in headers).
- Old session revoked atomically, new session created in same transaction.
- **absolute_expires_at preserved** from original session (not reset).
- New idle_expires_at = now + idleTtlMs, capped by preserved absolute.
- cookieMaxAgeSeconds returned for server-authoritative cookie.

## Legacy Session Cutover

- Migration `0052_auth_session_cutover.sql` revokes all sessions with `auth_method IS NULL`.
- Legacy sessions can no longer authenticate (authenticateHardened rejects revoked).
- New sessions always have auth_method set ('oidc:google' or 'dev:email').
- Migration 0053 reserved for Phase 01B Rate Limit.

## Logout Semantics

- **Logout Current:** `DELETE /v1/me/session` - revokes only current session.
- **Logout Other Devices:** `DELETE /v1/me/sessions` with current session preserved (exceptSessionId).
- **Logout All:** `DELETE /v1/me/sessions` - revokes all sessions including current.
- **Degraded Behavior:** If backend revocation fails (non-401/404), BFF returns 502 LOGOUT_DEGRADED.

## CSRF

- Exact-origin comparison only (no host-only fallback).
- Origin header required for all mutations.
- Missing Origin -> 403 CSRF_REJECTED.
- Sec-Fetch-Site=cross-site -> 403.
- Same host different port/scheme -> 403 (exact string match).

## Cookie Expiry

- Cookie maxAge from server-authoritative `cookieMaxAgeSeconds` in API response.
- No hardcoded 7-day TTL.
- Production: `__Host-town-session` with HttpOnly, Secure, SameSite=Lax, Path=/, no Domain, Priority=High.
- Dev: `town-session` with HttpOnly, SameSite=Lax, Path=/.

## Callback Error Mapping

UI error allowlist maps API error codes to safe UI codes:

- AUTH_ACCOUNT_NOT_ALLOWED -> account_not_allowed
- AUTH_FLOW_EXPIRED -> flow_expired
- AUTH_FLOW_REPLAYED -> flow_replayed
- AUTH_TOKEN_EXCHANGE_FAILED -> provider_error
- AUTH_NOT_CONFIGURED -> not_configured
- Unknown -> auth_failed
- Uses URLSearchParams (no CRLF injection, no open redirect).

## Migration

- `0051_auth_oidc_verified_identity.sql` (existing, unchanged) - OIDC tables + session hardening columns.
- `0052_auth_session_cutover.sql` (new) - revoke legacy auth_method IS NULL sessions.
- Next migration must be `0053` (reserved for Phase 01B Rate Limit).

## Vercel Smoke

- Vercel deployment: PASS
- Preview URL: https://vercel.com/123oqwes-projects/townai-cleanroom/4oHDMHtKqvstdKSqBnUBRpc8YXkF

## Google Live Verification

- Status: BLOCKED_BY_CREDENTIAL
- No real Google OIDC credentials provided.
- Local OIDC integration tests (LOCAL_OIDC_INTEGRATION_TEST) pass with injected test issuer.

## Unresolved P1

- Auth Attempt Cleanup: Repository methods exist (markFailed, consume), but no scheduled cleanup worker. P1 issue to be created.
- Session Cleanup: Repository methods exist (revokeAll, revoke), but no scheduled cleanup worker. P1 issue to be created.

## Auth Code Gate: GO

All 30 hard conditions met (see Section 35 of task spec).

## Phase 01A Merge-Ready Gate: GO

All 15 hard conditions met (see Section 36 of task spec).

## Phase 01C Entry Gate: NO-GO

Phase 01B has not yet been rebased onto the merged Phase 01A, revalidated, merged, and tested together on main.

## Public Beta Gate: NO-GO

Reason: BLOCKED_BY_CREDENTIAL. Real Google OIDC Staging Smoke not completed.
