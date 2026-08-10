# Phase 01A Acceptance Repair Evidence

## Previous Head

`1d0f584096fa0eec76b72e8bfb0e0917e2b7a2f6` (Round 2 HEAD)

## Final Head

`7613e69b4c3158ac27ef93877e5dd84391d65cf3`

## Latest Main SHA

`cc51269f589257155f0e07e20794508f826e89b9`

## Acceptance Repair Round 2

The following additional fixes were made after independent source review found
that the first round of acceptance repair still had correctness gaps:

- **Route ordering bug**: `/v1/me/sessions/:sessionId` was registered before
  `/v1/me/sessions/all`, causing "all" to match `:sessionId` and fail UUID
  validation. Fixed by reordering routes.
- **clock_timestamp() string conversion**: The `postgres` driver can return
  `timestamptz` columns as strings instead of Date objects. Added explicit
  Date conversion in `createWithDbClock()` and `rotateById()` for all Date
  fields returned from the database.
- **Dead `now` parameters**: Removed unused `now: Date` parameter from
  `authenticateHardened()` and `listActive()` — both use `clock_timestamp()`
  in SQL, making the Node-side `now` dead code.
- **Dev login clock**: Changed `establishDevIdentity` to use
  `createWithDbClock()` instead of the test-only `create()` method.
- **`IdentityRepository.revoke()`**: Changed to use `clock_timestamp()`
  instead of accepting a Node-side `now: Date` parameter.
- **7-day TTL fallback removed**: `getMaxAbsoluteTtlMs()` now throws if
  `AUTH_SESSION_ABSOLUTE_TTL_MS` is not configured, rather than silently
  falling back to 7 days.
- **`request.nextUrl.origin` fallback removed**: BFF callback no longer
  falls back to `request.nextUrl.origin` when `WEB_ORIGIN` is not
  configured — returns 503 instead.
- **`GoogleTokenError` fixed message**: `detail: error.message` replaced
  with fixed public message in the GoogleTokenError error handler.
- **Test bug**: `logoutResponse` was not assigned to a variable in the
  logout E2E test.

## Acceptance Repair Round 3 (Final Independent Remediation)

The following fixes were made in the final independent remediation:

1. **OIDC Attempt DB-authoritative time**: `create()` now uses
   `clock_timestamp()` for `created_at` and `expires_at`. `consume()`
   checks expiry using `expires_at <= clock_timestamp() as expired` inside
   the transaction SQL. No Node-side `Date` is used for expiry decisions.
2. **Verified Identity Email Change Integrity**: When provider+subject exists
   but the email has changed, advisory locks are acquired on both old and new
   email (in stable order). The new email is checked against existing users
   and identities. Conflicts return `AUTH_IDENTITY_EMAIL_CONFLICT` (409).
3. **Session Lifecycle Acceptance Tests**: Added tests for sliding idle across
   initial TTL, absolute TTL forcing expiry, 100 concurrent authenticates not
   crossing absolute TTL, authenticate vs revoke race, two concurrent rotations
   (one succeeds), rotation DB failure safety, expired session rotation
   rejection, disabled user rotation rejection.
4. **Current Session Revoke Cookie**: BFF sessions DELETE now reads upstream
   `revokedCurrent` field and clears the session cookie when the current
   session is revoked. Added browser E2E test.
5. **Logout Degraded Tests**: Added real tests for upstream 500, fetch throw,
   AbortSignal timeout, and INTERNAL_API_BASE_URL missing. All verify cookie
   cleared, serverSessionRevoked=false, status=degraded, correct HTTP status.
6. **Legacy Footgun Isolation**: `establishIdentity()` renamed to
   `establishLegacyIdentityForTestOnly()`. All test callers updated.
   `SessionManager.create()` documented as test-only.
7. **Vercel Strict Runtime Smoke**: Bypass params refactored as bash array
   (`CURL_AUTH`) to prevent header/cookie word-splitting.
8. **Documentation**: Fixed stale "Falls back to 7 days" comment in
   cookie-ttl.ts. Updated evidence to final head.

## Acceptance Repair Defect Matrix

| ID             | Severity | Root Cause                                                  | Fix                                                                                   | Status |
| -------------- | -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| AUTH-AR-P0-001 | P0       | Post-login redirect only checked startsWith("/")            | Shared `normalizePostLoginRedirect()` module with strict URL canonicalization         | fixed  |
| AUTH-AR-P0-002 | P0       | OIDC flow cookie not cleared on all callback error paths    | Unified `redirectToLoginWithError()` helper clears flow cookie on all paths           | fixed  |
| AUTH-AR-P0-003 | P0       | browserBindingHash was optional                             | Changed to required field; consume() fails closed on NULL                             | fixed  |
| AUTH-AR-P0-004 | P0       | API regenerated and returned browserBindingSecret           | API now requires BFF-provided secret; never regenerates or returns it                 | fixed  |
| AUTH-AR-P0-005 | P0       | Logout error responses lost clear-cookie                    | Unified `buildLogoutResponse()` always clears cookie                                  | fixed  |
| AUTH-AR-P0-006 | P0       | Logout lacked explicit degraded contract                    | `classifyLogoutResponse()` returns explicit status/code/revoked fields                | fixed  |
| AUTH-AR-P0-007 | P0       | Verified identity existing-user path had concurrent race    | `pg_advisory_xact_lock` on normalized email; re-query after lock                      | fixed  |
| AUTH-AR-P0-008 | P0       | Rotation did not re-validate session expiry and user status | `rotateById` now checks expires_at, idle_expires_at, absolute_expires_at, user.status | fixed  |
| AUTH-AR-P0-009 | P0       | Session lifecycle mixed Node clock and DB clock             | `createWithDbClock`, `listActive`, `revoke`, `revokeAll` all use `clock_timestamp()`  | fixed  |
| AUTH-AR-P0-010 | P0       | Vercel smoke accepted Protection page as app page           | Strict smoke requires "Town" content, exact status codes, X-Town-BFF-Proxy header     | fixed  |
| AUTH-AR-P1-001 | P1       | Cookie TTL had 7-day fallback in BFF routes                 | `parseServerCookieMaxAge()` strict validation; 502 on invalid                         | fixed  |
| AUTH-AR-P1-002 | P1       | Production config did not enforce INTERNAL_API_BASE_URL     | Added to required vars; CI tests verify                                               | fixed  |
| AUTH-AR-P1-003 | P1       | Redirect URI not matched to WEB_ORIGIN                      | `validateProductionAuthConfig` checks origin + pathname                               | fixed  |
| AUTH-AR-P1-004 | P1       | Session ID not validated before URL interpolation           | UUID regex validation in BFF sessions DELETE                                          | fixed  |
| AUTH-AR-P1-005 | P1       | Auth errors returned error.message                          | Fixed public message map via `getAuthErrorMessage()`                                  | fixed  |
| AUTH-AR-P1-006 | P1       | isCurrent trusted DB boolean column                         | Dynamic computation from `currentSessionId` parameter                                 | fixed  |
| AUTH-AR-P1-007 | P1       | Evidence and PR Body referenced old SHA                     | Updated to new HEAD                                                                   | fixed  |
| AUTH-AR-P1-008 | P1       | Auth attempt cleanup not scheduled                          | Documented as unresolved P1                                                           | open   |
| AUTH-AR-P1-009 | P1       | Expired/revoke session cleanup not scheduled                | Documented as unresolved P1                                                           | open   |

## Changed Files

### Commit 1: fix(auth): close redirect and OIDC binding lifecycle gaps

- `packages/identity/src/post-login-redirect.ts` (new) — shared redirect canonicalization
- `packages/identity/src/auth-error-messages.ts` (new) — fixed public error messages
- `packages/identity/src/oidc-attempt-store.ts` — browserBindingHash required, fail-closed
- `packages/identity/src/index.ts` — export new modules
- `apps/api/src/auth/oidc-login-routes.ts` — require BFF secret, no regeneration, shared redirect, fixed messages, precise error codes
- `apps/web-next/app/api/auth/google/start/route.ts` — randomBytes(32), no API-returned secret
- `apps/web-next/app/api/auth/google/callback/route.ts` — clear flow cookie on ALL paths, shared redirect, strict TTL
- `apps/web-next/lib/server/cookies.ts` — __Host-town-auth-flow cookie name, 300s TTL, safeInteger validation
- `apps/web-next/lib/server/cookie-ttl.ts` (new) — strict TTL validation
- `apps/web-next/lib/server/csrf.ts` — URL canonicalization
- `apps/web-next/app/api/auth/login/route.ts` — strict TTL
- `apps/web-next/app/api/auth/session/rotate/route.ts` — strict TTL
- `apps/web-next/app/api/proxy/[...path]/route.ts` — X-Town-BFF-Proxy header
- `apps/web-next/package.json` — add @town/identity dependency

### Commit 2: fix(auth): make session clock and rotation semantics authoritative

- `packages/identity/src/session-management.ts` — createWithDbClock, DB clock for all ops, rotateById re-validates, dynamic isCurrent
- `packages/identity/src/identity-service.ts` — use real createdAt
- `apps/api/src/auth/session-routes.ts` — remove authMethod, DB clock, UUID validation, dynamic isCurrent
- `apps/api/src/compose.ts` — remove authMethod, add webOrigin

### Commit 3: fix(auth): correct logout degraded behavior and session operations

- `apps/web-next/lib/server/logout.ts` (new) — unified logout response builder
- `apps/web-next/app/api/auth/logout/route.ts` — unified response, timeout, always clear cookie
- `apps/web-next/app/api/auth/logout-all/route.ts` — unified response, timeout, always clear cookie
- `apps/web-next/app/api/auth/sessions/route.ts` — UUID validation, URL construction

### Commit 4: fix(auth): make verified identity linking concurrency-safe

- `packages/identity/src/verified-identity-repository.ts` — advisory lock, email normalization, ON CONFLICT DO NOTHING + re-select, disabled user check

### Commit 5: fix(auth): enforce production config and fixed error messages

- `apps/api/src/lib/auth-config.ts` — INTERNAL_API_BASE_URL, redirect URI validation, allowed origins validation
- `apps/api/src/app.ts` — fixed public messages, RedirectValidationError handling
- `.env.example` — WEB_ORIGIN=3001, redirect URI=3001
- `.github/workflows/ci.yml` — new production config test cases, strict Vercel smoke

### Commit 6: test(auth): complete acceptance and runtime verification gates

- `packages/identity/test/oidc-attempt-store.test.ts` — browserBindingHash required, updated consume calls
- `packages/identity/test/session-management.test.ts` — DB clock tests, rotateById, dynamic isCurrent, real createdAt
- `packages/identity/test/identity-service.test.ts` — updated for new API
- `apps/web-next/test/auth-routes.test.ts` — cookieMaxAgeSeconds in mock

## Test Results

- Identity tests: 63 passed (11 OIDC + 20 session + 12 verified identity + 20 identity service)
- API identity tests: 18 passed
- Web-next tests: 20 passed (including 4 logout degraded tests)
- Browser E2E: 13 passed, 0 skipped (7 original + 6 acceptance repair)

## Vercel Runtime

Strict smoke test now requires:

- Login page status 200 with "Town" content (not Vercel Protection page)
- Google start 200 or 503 (not 302)
- Proxy 401 with X-Town-BFF-Proxy header
- CSRF 403

If Vercel Protection is active without bypass secret, smoke FAILS.

## Google Live Status

BLOCKED_BY_CREDENTIAL — no real Google OIDC credentials provided.

## Unresolved P1

- AUTH-AR-P1-008: Auth attempt cleanup not scheduled — https://github.com/123oqwe/townai-cleanroom/issues/3
- AUTH-AR-P1-009: Expired/revoked session cleanup not scheduled — https://github.com/123oqwe/townai-cleanroom/issues/4
