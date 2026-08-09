# Task Plan: Fix 8 Red Lines in towncleanroom

## Goal

Verify all 8 red lines from the audit against actual code, fix what is
genuinely fixable in code (no fake implementations), document what requires
external infrastructure, run CI/CD after each fix, and push to GitHub
preserving the existing commit workflow.

## Next Step

Phase 1: Auth security hardening — create server-side login/logout route
handlers with HttpOnly cookie, remove client-side token exposure.

## Current Phase

Phase 1

## Phases

### Phase 1: Auth Security Hardening (Red Line 1)

The most critical red line. Token is currently stored in a non-HttpOnly
cookie readable by any JavaScript on the page. Fix by moving cookie
management server-side.

- [ ] Create `apps/web-next/app/api/auth/login/route.ts` — POST handler
      that calls backend `/v1/auth/session`, sets HttpOnly+Secure+SameSite=Lax
      cookie, returns user info (NOT the token)
- [ ] Create `apps/web-next/app/api/auth/logout/route.ts` — POST handler
      that clears cookie and calls backend `DELETE /v1/me/session`
- [ ] Create `apps/web-next/app/api/auth/me/route.ts` — GET handler that
      reads HttpOnly cookie, calls backend `/v1/me`, returns user or 401
- [ ] Create `apps/web-next/app/api/proxy/[...path]/route.ts` — catch-all
      proxy that reads HttpOnly cookie, injects Bearer token, forwards to
      backend (handles JSON + SSE streaming)
- [ ] Update `apps/web-next/middleware.ts` — check HttpOnly cookie existence
      (cookie name stays the same, but now HttpOnly)
- [ ] Update `apps/web-next/app/new/(auth)/login/page.tsx` — POST to
      `/api/auth/login` instead of calling backend directly; remove
      `setCookie()` function
- [ ] Update `apps/web-next/app/new/(app)/layout.tsx` — remove `readToken()`,
      use `/api/auth/me` to check auth state; remove token from
      `ApiClientProvider`; update logout to POST `/api/auth/logout`
- [ ] Update `apps/web-next/app/api-client.tsx` — remove token prop from
      `ApiClientProvider`; `TownClient` uses empty baseUrl + no token
      (proxy handles auth)
- [ ] Update `apps/web-next/next.config.ts` — remove `/v1/*` rewrite to
      backend (proxy route handles it now)
- [ ] Add tests for new route handlers
- [ ] Run `pnpm verify` — must pass
- **Status:** in_progress

### Phase 2: Integration Maturity Model (Red Line 4)

Replace flat "Implemented" status with S0-S6 maturity levels in docs.

- [ ] Rewrite `docs/implementation-status.md` with S0-S6 columns:
      S0 Spec, S1 Implemented, S2 Tested, S3 Configured, S4 Live Verified,
      S5 Quality Gated, S6 Production Certified
- [ ] Assign honest maturity level to each integration based on code evidence: - Google OAuth/Gmail/Calendar: S2 (tested, not live-verified) - Microsoft OAuth: S1 (code exists, no action tools) - Pipedream: S1 (catalog only) - Web search/browser: S1 (adapter skeleton) - Slack/Telegram/WhatsApp/Twilio/Vapi: S2 (signature verification tested) - E2B sandbox: S2 (tested with fallback) - MCP: S2 (tested, needs credential resolver)
- [ ] Update README to remove implied parity claims
- [ ] Run `pnpm verify` — must pass
- **Status:** pending

### Phase 3: Rate Limiter Improvement (Red Line 6)

Add a database-backed rate limiter as an alternative to the in-process Map.

- [ ] Add `createDatabaseRateLimiter()` in `apps/api/src/lib/rate-limit.ts`
      that uses PostgreSQL for shared state across instances
- [ ] Add database table or use existing pattern for rate limit buckets
- [ ] Wire it as an optional alternative in `compose.ts` (env var gated)
- [ ] Add tests for the database-backed limiter (using testcontainers)
- [ ] Document when to use which limiter (dev vs production)
- [ ] Run `pnpm verify` — must pass
- **Status:** pending

### Phase 4: Honest Documentation for Remaining Red Lines (2, 5, 7)

Document gaps that cannot be fixed in code without external infrastructure.

- [ ] Add "Production Readiness Gaps" section to `docs/ARCHITECTURE_GAPS.md`: - Red Line 2: Encryption lacks KMS/envelope encryption/rotation - Red Line 5: Billing is internal ledger only, no Stripe/payment processing - Red Line 7: Deployment configuration exists, live deployment unverified
- [ ] Add "Security Hardening Roadmap" section with concrete steps for each
- [ ] Update `docs/deployment.md` with honest deployment status
- [ ] Run `pnpm verify` — must pass
- **Status:** pending

### Phase 5: Playwright Browser E2E in CI (Red Line 3)

Add a real browser-based E2E test that runs in CI without external services.

- [ ] Add `@playwright/test` as devDependency
- [ ] Create `test/e2e/browser/auth-flow.spec.ts` — tests login page renders,
      rejects non-allowlist email, accepts allowlist email, redirects to
      threads page, logout works
- [ ] The test starts a local API with testcontainers PostgreSQL and the
      Next.js dev server
- [ ] Add Playwright install step to CI workflow
- [ ] Add `test:e2e:browser` script to package.json
- [ ] Add browser E2E to CI workflow (not in `pnpm verify` — too slow for
      local dev, but runs in CI)
- [ ] Run `pnpm verify` — must still pass
- [ ] Run browser E2E locally — must pass
- **Status:** pending

### Phase 6: LICENSE Update (Red Line 8)

Update license to permit commercial use, since user owns all copyright.

- [ ] Rewrite `LICENSE` to Apache 2.0 (permissive, commercial-friendly,
      standard, well-understood)
- [ ] Update copyright notice if needed
- [ ] Run `pnpm verify` — must pass
- **Status:** pending

### Phase 7: Final Verification & Push

- [ ] Run full `pnpm verify` — all checks must pass
- [ ] Run browser E2E — must pass
- [ ] Review all changes with `git diff`
- [ ] Commit with descriptive messages matching existing style
      (e.g., `fix(auth): ...`, `docs: ...`, `feat: ...`)
- [ ] Push to `origin/main`
- [ ] Verify CI passes on GitHub
- **Status:** pending

## Key Questions

1. Should the auth proxy support SSE streaming? — Yes, the thread view uses SSE.
2. Should we keep the allowlist login or add Google OIDC? — Keep allowlist for
   now (no Google OIDC credentials for web login), but make the cookie secure.
3. Should the DB rate limiter replace the in-process one? — No, keep both.
   In-process for dev/single-instance, DB for production multi-instance.
4. What license to use? — Apache 2.0 is the standard permissive license.
5. Should Playwright E2E be in `pnpm verify`? — No, too slow. Separate CI job.

## Decisions Made

| Decision                               | Rationale                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------- |
| HttpOnly cookie + server-side proxy    | Eliminates XSS token theft. Real fix, not cosmetic.                       |
| Keep allowlist login (no OIDC for web) | No Google OIDC credentials available. Cookie fix is the real improvement. |
| S0-S6 maturity model                   | Industry standard. Honest. Granular.                                      |
| DB-backed rate limiter as option       | Real fix for multi-instance. Doesn't break dev experience.                |
| Playwright in separate CI job          | Browser tests are slow. Keep `pnpm verify` fast.                          |
| Apache 2.0 license                     | Permissive, commercial-friendly, well-understood.                         |
| Document KMS/Stripe/deployment gaps    | Cannot implement without external credentials. Honesty over fake code.    |

## Errors Encountered

| Error | Attempt | Resolution |
| ----- | ------- | ---------- |
|       | 1       |            |

## Notes

- Each phase ends with `pnpm verify` before moving to the next
- No fake data, fake tests, or fake verification
- Push to GitHub preserving existing commit message style
- The audit's functional gaps (Personalization Engine, real integrations,
  proactive intelligence, UI redesign) are larger product-level changes that
  require separate planning and are out of scope for this red-line fix pass
