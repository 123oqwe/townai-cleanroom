# Progress Log -- Phase 01A Production Auth

> Recovered-first file after compaction. Pairs with task_plan.md + findings.md.

## Session: 2026-08-09

### Phase 1: Codebase Audit & Root-Cause Analysis

- **Status:** complete
- **Started:** 2026-08-09 23:40
- Actions taken:
  - Read all auth/identity files listed in the prompt (web-next BFF routes,
    login page, layout, middleware, next.config, api-client; API app.ts,
    config.ts, lib/auth.ts, lib/google-oidc.ts, oauth/google-oauth-routes.ts;
    identity-service, identity-repository, session-token, account-repository,
    credential-cipher, types; migration 0001_identity.sql, schema.ts; ci.yml;
    .env.example; check-runtime-config.mjs; implementation-status.md;
    ARCHITECTURE_GAPS.md; browser auth-flow.spec.ts).
  - Identified root cause: POST /v1/auth/session accepts bare email, allowlist
    acts as identity proof, no OIDC login flow exists.
  - Mapped all entry points, session schema gaps, cookie lifecycle mismatch
    (7d cookie vs 30d backend), missing CSRF, missing prod config gates.
  - Created isolated git worktree at /Users/guanjieqiao/townai-cleanroom-phase01a
    on branch codex/phase-01a-production-auth-complete (HEAD 34533f0).
  - Ran baseline `pnpm verify` -> PASS (24+ min on loaded machine; all green).
- Files created/modified:
  - .planning/phase-01a/task_plan.md (created)
  - .planning/phase-01a/findings.md (created)
  - .planning/phase-01a/progress.md (created)

### Phase 2: Architecture & Plan

- **Status:** complete
- Actions taken:
  - Defined BFF route surface, API OIDC surface, env var split, migration plan,
    session hardening, cookie/CSRF modules, test layers, CI gates.
  - Wrote full 9-phase plan to task_plan.md.

### Phase 3: Database Migration & Identity Package

- **Status:** complete
- Started 2026-08-10 00:00
- Created migration 0051 (auth_oidc_attempts, auth_identities, auth_sessions
  hardening), drizzle defs, session-flow-cipher, oidc-attempt-store,
  verified-identity-repository, session-management; 18 new tests, 39 total pass.

### Phase 4: API OIDC Service + Email-Login Sealing

- **Status:** in_progress
- Started 2026-08-10 00:45
- config.ts AUTH_* vars; lib/auth-config.ts (prod fail-fast);
  lib/google-oidc-login.ts (jose JWKS); auth/oidc-login-routes.ts (start/callback,
  BFF-secret gated); auth/session-routes.ts (list/revoke/rotate);
  sealed email login -> /v1/auth/dev-session (dev-only); check-runtime-config.mjs
  AUTH_* gates; auth-config.test.ts (12) + google-oidc-login.test.ts (9) pass;
  API typecheck PASS; running pnpm verify.

### Phase 5: Next.js BFF Layer

- **Status:** complete
- Built lib/server/cookies.ts (__Host-town-session prod / town-session dev,
  HttpOnly+Secure+SameSite=Lax+Path=/+Priority=High+Expires).
- Built lib/server/csrf.ts (assertSameOriginRequest for POST/PUT/PATCH/DELETE;
  getBffSharedSecret; getInternalApiBaseUrl with SSRF guard).
- BFF routes: /api/auth/google/start, /api/auth/google/callback,
  /api/auth/me, /api/auth/logout, /api/auth/logout-all,
  /api/auth/session/rotate, /api/auth/sessions (GET list + DELETE revoke).
- Refactored /api/proxy/[...path]: INTERNAL_API_BASE_URL (no NEXT_PUBLIC_),
  header allowlist, no cookie forwarding, path normalization (no traversal),
  CSRF on mutations, SSE streaming preserved.
- middleware.ts: cookie name sync.
- lint + typecheck + web-next build all PASS.

### Phase 6: UI -- Login + Session Management

- **Status:** complete
- Login page: only "Continue with Google", error/access-denied/expired states,
  Retry button, no email input (Suspense-wrapped for useSearchParams).
- Dev login route /api/auth/login returns 404 in production build.
- Session management page /new/sessions: devices, created/last-seen, revoke,
  logout-all, privacy-minimized device label (UA hash prefix only).
- Sidebar "Sessions" link added to layout.

## Test Results

| Test                      | Input              | Expected               | Actual                                                                                          | Status |
| ------------------------- | ------------------ | ---------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| baseline pnpm verify      | HEAD 34533f0       | all green              | all green (check:source, format, lint, typecheck, web-client build, test, build, build-entries) | PASS   |
| identity unit tests (new) | 3 new test files   | 18 pass                | 18 pass                                                                                         | PASS   |
| identity full suite       | all identity tests | 39 pass, 0 regressions | 39 pass                                                                                         | PASS   |

## Error Log

| Timestamp        | Error                                              | Attempt | Resolution                                             |
| ---------------- | -------------------------------------------------- | ------- | ------------------------------------------------------ |
| 2026-08-09 23:50 | apply_patch Add File without `+` prefixes          | 1       | prefix every content line with `+`                     |
| 2026-08-09 23:48 | zsh glob on `[...path]` route file                 | 1       | quote path string                                      |
| 2026-08-10 00:20 | hashSessionToken imported from wrong module        | 1       | import from session-token.js not session-management.js |
| 2026-08-10 00:20 | createFlowCipher imported from oidc-attempt-store  | 1       | import from session-flow-cipher.js                     |
| 2026-08-10 00:21 | verified-identity test used crypto.randomUUID (v4) | 1       | use newId (uuidv7)                                     |
| 2026-08-10 00:22 | plaintext test used digest() (needs pgcrypto)      | 1       | compare encode(state_hash,'hex') to Node hash          |

### Phase 7-8: Test Suite + CI/Docs/Evidence

- **Status:** complete
- Full unit + PG-integration suite: 873 tests pass (222 identity/web-client/auth
  - 651 api/packages), no regressions.
- auth-config (12) + google-oidc-login (9, LOCAL_OIDC_INTEGRATION_TEST) pass.
- Production config fail-fast verified: prod+dev-login -> exit 1; prod missing
  AUTH_* -> exit 1; prod fully configured -> exit 0.
- CI: added production-config job (3 cases). browser-e2e env updated with
  INTERNAL_API_BASE_URL, DEV_EMAIL_LOGIN_ENABLED, AUTH_*.
- .env.example: all AUTH_* vars documented.
- docs/evidence/phase-01a-production-auth.md: all 17 sections.
- scripts/live-google-auth-smoke.mjs: BLOCKED_BY_CREDENTIAL scaffold.
- test/global-postgres.ts: POSTGRES_URL override for reliable local test runs.

### Phase 9: Final Verification

- **Status:** complete
- git diff --check: clean. format/lint/typecheck/build: PASS.
- check:source (520), check:build-entries (21): PASS.
- Branch codex/phase-01a-production-auth-complete: 4 commits ahead of main.
- Live Google smoke: BLOCKED_BY_CREDENTIAL (no real credentials).

## FINAL REPORT (A-N)

- **A. Start SHA:** 34533f0e089e771128db61c9dba8bf41523a1d01
- **B. End SHA:** 6da731b (HEAD of branch)
- **C. Root cause:** Production login accepted a bare email; allowlist acted as
  identity proof. No Google OIDC login flow existed.
- **D. Architecture change:** Browser -> Next.js BFF (CSRF, HttpOnly cookie) ->
  API OIDC service (BFF-secret gated, jose JWKS) -> Google OIDC -> verified
  identity -> hashed opaque session -> BFF sets __Host-town-session cookie.
- **E. Modified files:** 64 files, +4435 -301.
- **F. Migration:** 0051_auth_oidc_verified_identity.sql (additive, backward
  compatible).
- **G. Env vars:** AUTH_GOOGLE__, AUTH_BFF_SHARED_SECRET,
  AUTH_FLOW_ENCRYPTION_KEY_BASE64URL, AUTH_ALLOWED_ORIGINS, AUTH_SIGNUP_MODE,
  DEV_EMAIL_LOGIN_ENABLED, INTERNAL_API_BASE_URL, AUTH_SESSION___TTL_MS.
- **H. Security changes:** email login sealed to dev-only /v1/auth/dev-session;
  prod fail-fast; HttpOnly __Host- cookie; CSRF on mutations; PKCE + full claim
  verification; encrypted code_verifier at rest; session rotation/list/revoke-all.
- **I. Test results:** 873 unit/integration tests pass; production-config
  fail-fast verified; no regressions.
- **J. Google Live Verification:** NOT COMPLETED (BLOCKED_BY_CREDENTIAL).
- **K. Unresolved risks:** No S4 live verification; JWKS resilience (future).
- **L. Auth Code Gate:** GO (all 16 acceptance criteria met at code level).
- **M. Public Beta Gate:** NO-GO (BLOCKED_BY_CREDENTIAL; no real Google live smoke).
- **N. PR:** Draft PR to be created on push (not merged).

## 5-Question Reboot Check

| Question             | Answer                                                                            |
| -------------------- | --------------------------------------------------------------------------------- |
| Where am I?          | Complete (all 9 phases done)                                                      |
| Where am I going?    | Push branch + Draft PR; user provides Google creds for S4                         |
| What's the goal?     | Replace email-only login with verified Google OIDC; Auth Gate GO, Beta Gate NO-GO |
| What have I learned? | See findings.md -- root cause + all gaps mapped                                   |
| What have I done?    | All 9 phases; 873 tests pass; fail-fast verified; evidence doc complete           |

---

_Update after completing each phase or encountering errors_
