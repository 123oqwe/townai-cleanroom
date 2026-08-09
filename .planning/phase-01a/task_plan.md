# Task Plan: Phase 01A -- Production Authentication Completion

> PERSISTENT PLANNING FILE. Survives context compaction.
> Mechanism: after any session compact, re-read this file + findings.md +
> progress.md FIRST to recover state before continuing. Update after every
> implemented step + CI run.

## Goal

Replace email-only production login with verified Google OIDC (Authorization
Code + PKCE), seal off all email-only session creation in production, harden
sessions/cookies/CSRF, and ship full test coverage -- without faking Google
Live Verification. Auth Code Gate = GO; Public Beta Gate = NO-GO
(BLOCKED_BY_CREDENTIAL) until real Google smoke passes.

## Next Step

Phase 9: push branch, draft PR, final A-N report.

## Current Phase

Phase 9

## Baseline

- Audit baseline SHA: 34533f0e089e771128db61c9dba8bf41523a1d01
- Actual start SHA: 34533f0e089e771128db61c9dba8bf41523a1d01 (no drift)
- Branch: codex/phase-01a-production-auth-complete
- Worktree: /Users/guanjieqiao/townai-cleanroom-phase01a
- Baseline `pnpm verify`: PASS (verified 2026-08-09)
- NOTE: a parallel tech-debt session edits /Users/guanjieqiao/townai-cleanroom
  on main; this worktree is isolated so the two never collide.

## Phases

### Phase 1: Codebase Audit & Root-Cause Analysis

- [x] Read all auth/identity files from the prompt list
- [x] Map every email-only login entry point
- [x] Document current session schema, cookie lifecycle, CSRF posture
- [x] Run baseline `pnpm verify` (PASS)
- [x] Write audit conclusions to findings.md
- **Status:** complete

### Phase 2: Architecture & Plan

- [x] Define BFF route surface + API OIDC service surface
- [x] Define env var split (auth OAuth vs connected-account OAuth)
- [x] Define migration plan (0051) + schema additions
- [x] Define session-hardening + cookie module + CSRF module
- [x] Define test layers + CI gates
- **Status:** complete

### Phase 3: Database Migration & Identity Package

- [x] migration 0051_auth_oidc_verified_identity.sql
      (auth_oidc_attempts, auth_identities, auth_sessions new columns,
      indexes, constraints; backward compatible)
- [x] packages/db/src/schema.ts drizzle definitions for new tables/columns
- [x] packages/identity: OIDC attempt store (state/nonce hash, encrypted
      code_verifier, one-time consume, replay-safe tx)
- [x] packages/identity: auth_identities repository (provider+subject unique,
      verified email, conflict detection)
- [x] packages/identity: session schema hardening (idle/absolute expiry,
      session_family_id, rotated_from, auth_method, UA/IP hash)
- [x] packages/identity: session rotation, list sessions, revoke all
- [x] unit tests for all of the above
- [x] run pnpm verify; update progress.md
- **Status:** complete

### Phase 4: API OIDC Service + Email-Login Sealing

- [x] apps/api/src/config.ts: add AUTH_GOOGLE_*, AUTH_BFF_SHARED_SECRET,
      AUTH_FLOW_ENCRYPTION_KEY_BASE64URL, AUTH_ALLOWED_ORIGINS,
      AUTH_SIGNUP_MODE, DEV_EMAIL_LOGIN_ENABLED, INTERNAL_API_BASE_URL
- [x] apps/api/src/lib/google-oidc.ts: full ID-token verification with jose
      (iss/aud/azp/exp/iat/nonce/email_verified/sub)
- [x] apps/api/src/auth/oidc-routes.ts: POST /v1/auth/oidc/google/start,
      POST /v1/auth/oidc/google/callback (BFF-secret gated, not browser-direct)
- [x] apps/api/src/auth/session-routes.ts: GET /v1/me/sessions,
      DELETE /v1/me/sessions/:id, DELETE /v1/me/sessions,
      POST /v1/me/session/rotate
- [x] Seal email login: DEV_EMAIL_LOGIN_ENABLED gate; rename dev route to
      /v1/auth/dev-session; production 404 + fail-fast startup
- [x] scripts/check-runtime-config.mjs: production auth var validation
- [x] unit tests; run pnpm verify; update progress.md
- **Status:** complete

### Phase 5: Next.js BFF Layer

- [x] apps/web-next lib/server cookies module (__Host-town-session / town-session)
- [x] apps/web-next lib/server same-origin CSRF guard (assertSameOriginRequest)
- [x] BFF routes: /api/auth/google/start, /api/auth/google/callback,
      /api/auth/me, /api/auth/logout, /api/auth/logout-all,
      /api/auth/session/rotate
- [x] Refactor /api/proxy/[...path]: INTERNAL_API_BASE_URL, no NEXT_PUBLIC_,
      header allowlist, no cookie forwarding, path normalization, CSRF on
      mutations
- [x] middleware.ts: cookie name sync
- [x] run pnpm verify; update progress.md
- **Status:** complete

### Phase 6: UI -- Login + Session Management

- [x] Login page: only "Continue with Google", error/access-denied/expired
      states, retry, no email input in prod
- [x] dev-only login path (inaccessible in prod build)
- [x] Session management page: devices, created/last-seen, revoke, logout-all
- [x] privacy-minimized IP/UA display
- [x] run pnpm verify + build; update progress.md
- **Status:** complete

### Phase 7: Test Suite -- Unit, PG Integration, Browser E2E

- [x] unit: PKCE, state/nonce hashing, verifier encryption, JWT validation
      failures, email_verified, allowlist-after-verify, identity conflict,
      session hash/expiry/revoke/rotate, cookie flags, origin validation,
      CSRF rejection, dev-login-disabled-in-prod, shared-secret, no-secret-logs
- [x] PG integration (testcontainers or local pg): state one-time consume,
      concurrent callback replay, expired attempt, identity linking/conflict,
      session rotation tx, revoke-all, idle/absolute expiry
- [x] browser E2E: prod login page Google-only, cross-origin logout rejected,
      cross-origin proxy mutation rejected, invalid state callback, replayed
      callback, HttpOnly cookie, logout, logout-all, revoked session blocked,
      dev login test-env-only
- [x] run full CI locally; update progress.md
- **Status:** complete

### Phase 8: CI + Runtime Config Gates + Docs + Evidence

- [x] .github/workflows/ci.yml: add production-config test job
      (NODE_ENV=production + DEV_EMAIL_LOGIN_ENABLED=true must FAIL;
      missing AUTH_* vars must fail-fast)
- [x] scripts/check-runtime-config.mjs: production auth gates
- [x] .env.example: new AUTH_* vars documented
- [x] docs/evidence/phase-01a-production-auth.md (all 17 required sections)
- [x] update docs/implementation-status.md, ARCHITECTURE_GAPS.md,
      deployment.md, README.md (no "Authentication Resolved" unless S4)
- [x] scripts/live-google-auth-smoke.* scaffold + BLOCKED_BY_CREDENTIAL doc
- **Status:** complete

### Phase 9: Final Verification, Commit, Draft PR

- [x] git status / git diff --check clean
- [x] pnpm check:source + format:check + lint + typecheck PASS
- [x] all unit + PG integration tests PASS (115 tests, 17 files)
- [x] production config tests PASS (21 tests) (fail-fast cases)
- [x] commit feat(auth): replace email-only production login with verified Google OIDC
- [ ] push branch + create Draft PR (no merge)
- [ ] output final A-N report; Auth Code Gate = GO; Public Beta Gate = NO-GO
- **Status:** in_progress

## Decisions Made

| Decision                                                   | Rationale                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Isolated git worktree at .../townai-cleanroom-phase01a     | Parallel tech-debt session edits main worktree; isolation avoids collision                  |
| Planning files under .planning/phase-01a/                  | Root task_plan.md/findings.md/progress.md belong to the tech-debt session; do not overwrite |
| Next migration number 0051                                 | Last is 0050_rate_limit_buckets.sql; backward compatible, no old migration edits            |
| jose for JWT/JWKS verification                             | Prompt mandates reliable JWT/JWKS impl; jose is the standard                                |
| __Host-town-session (prod) / town-session (dev)            | __Host- requires Secure; HTTP local dev cannot use it                                       |
| Dev login renamed to /v1/auth/dev-session                  | Disambiguate from real auth; production 404                                                 |
| Auth OAuth vars AUTH_GOOGLE_* separate from GOOGLE_OAUTH_* | Prompt mandates auth vs connected-account OAuth separation                                  |
| BFF<->API shared secret AUTH_BFF_SHARED_SECRET             | OIDC start/callback must not be browser-direct; timing-safe compare                         |

## Errors Encountered

| Error      | Attempt | Resolution |
| ---------- | ------- | ---------- |
| (none yet) | 1       |            |

## Notes

- After EVERY step: run CI slice, verify, update progress.md + this file.
- After EVERY compact: re-read these 3 files before resuming.
- Never claim S4/GOOGLE_LIVE_VERIFIED without real Google credentials.
- Do not touch unrelated product features or add new integrations.
