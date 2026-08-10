# Phase 01A Repair Gate Evidence

## Pre-Repair State

- **Latest main SHA:** `cc51269f589257155f0e07e20794508f826e89b9`
- **Pre-repair branch SHA:** `0e3f8e9a2f40bc25df9874120561058e1b2a84aa`
- **PR Head SHA:** `0e3f8e9a2f40bc25df9874120561058e1b2a84aa`
- **ahead/behind:** 6 ahead, 1 behind main
- **Rebase result:** Clean rebase onto `cc51269` (no conflicts)

## CI Failures (Pre-Repair)

### verify (FAIL)

Root cause: `pnpm format:check` fails on `.planning/phase-01a/progress.md`.

### browser-e2e (FAIL)

Root cause: `POST /api/auth/google/start` returns 500 instead of 503 when OIDC is not configured. `OidcRouteError` is not mapped in `app.onError()`.

### production-config (PASS)

### Vercel (PASS)

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

## Auth Code Gate: NO-GO (pre-repair)
