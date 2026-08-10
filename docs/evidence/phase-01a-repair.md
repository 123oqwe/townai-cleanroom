# Phase 01A Acceptance Repair Evidence

## Previous Head

`ef5872ffef00728e50938005bc8148cfeb288fca`

## Latest Main SHA

`cc51269f589257155f0e07e20794508f826e89b9`

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

- Identity tests: 35 passed (9 OIDC + 12 session + 5 verified identity + 9 identity service)
- API identity tests: 18 passed
- Web-next tests: 16 passed
- Browser E2E: 7 passed, 0 skipped

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

- AUTH-AR-P1-008: Auth attempt cleanup not scheduled (no retention worker)
- AUTH-AR-P1-009: Expired/revoked session cleanup not scheduled (no cleanup worker)
