# Findings & Decisions

## Requirements

Source: user-provided audit (pasted-text-1.txt) comparing towncleanroom repo
against real Town.ai product. The audit identifies 8 red lines and 5 major
functional gaps. User demands: no fake data, fake tests, or fake verification.
Push to GitHub preserving existing workflow.

## Code Investigation Results (verified against actual source)

### Red Line 1: Auth is NOT production-grade — CONFIRMED

**Evidence found:**

1. **Cookie is NOT HttpOnly** — `apps/web-next/app/new/(auth)/login/page.tsx`
   line 8: `setCookie()` uses `document.cookie` which CANNOT set HttpOnly.
   Cookie is set as: `path=/; max-age=...; samesite=lax` — missing HttpOnly
   and Secure flags.

2. **Middleware does NOT validate token** — `apps/web-next/middleware.ts`:
   only checks `request.cookies.get(TOWN_TOKEN_COOKIE)?.value ?? ""`. Any
   non-empty string passes the middleware gate. No DB validation.

3. **App layout reads cookie client-side** —
   `apps/web-next/app/new/(app)/layout.tsx`: `readToken()` reads
   `document.cookie` and stores token in React state. Token is then passed
   to `ApiClientProvider` which creates a `TownClient` with the raw token.

4. **Allowlist-based, no email ownership verification** —
   `packages/identity/src/identity-service.ts`: `establishIdentity()` only
   checks if email is in allowlist (synced from
   `ACCESS_ALLOWLIST_EMAILS` env var). No verification email, no magic
   link, no OIDC for web login.

5. **Session token is a random 32-byte string** —
   `packages/identity/src/session-token.ts`: `generateSessionToken()` returns
   `town_session_` + base64url(32 random bytes). Token hash is SHA-256,
   stored in DB. This part is correct (hashed storage).

6. **30-day TTL, no rotation** — `identity-service.ts`: `sessionTtlMs` defaults
   to `30 * 24 * 60 * 60 * 1_000` (30 days). No refresh token, no rotation.

7. **API auth middleware DOES validate** — `apps/api/src/lib/auth.ts`:
   `createAuthMiddleware()` calls `identityService.authenticate(token)` which
   hashes and checks against DB. So API endpoints ARE protected. The gap is
   only in the frontend cookie handling.

8. **Logout is client-side only** — `layout.tsx`: `logout()` just clears the
   cookie via `document.cookie`. Does NOT call `DELETE /v1/me/session` to
   revoke server-side.

**Verdict:** The API layer is secure (Bearer token validated against DB).
The frontend layer is vulnerable: token in non-HttpOnly cookie (XSS can
steal), middleware doesn't validate (cosmetic gate only), logout doesn't
revoke server-side.

### Red Line 2: Encryption is minimal — CONFIRMED

**Evidence found:**

1. **Single master key** — `packages/identity/src/credential-cipher.ts`:
   `createCredentialCipher(masterKeyBase64url)` uses one 32-byte key for
   all encrypt/decrypt operations. `keyVersion: z.literal(1)` — no
   versioning support.

2. **AES-256-GCM is correct** — Algorithm choice is sound. AAD includes
   credentialId, ownerId, accountId, provider — good authenticated data.

3. **No KMS, no envelope encryption, no rotation** — No code for AWS KMS,
   GCP KMS, or envelope encryption. No key rotation mechanism. No audit
   trail for decryption operations.

**Verdict:** Base crypto is correct but lacks production key management.
Cannot implement real KMS without cloud provider credentials. Can document
the gap and add key versioning infrastructure.

### Red Line 3: E2E not in CI, not real user E2E — CONFIRMED

**Evidence found:**

1. **`pnpm verify` does NOT include `test:e2e`** — `package.json` scripts:
   `"verify": "pnpm check:source && pnpm format:check && pnpm lint &&
pnpm typecheck && pnpm test && pnpm build && pnpm check:build-entries"`
   — `test:e2e` is separate and not called.

2. **E2E test is gated** — `test/e2e/smoke.test.ts`: runs only when
   `RUN_E2E=true AND RESPONSES_API_KEY` are both set. Otherwise a dummy
   test asserts `shouldRun === false`.

3. **E2E uses testcontainers + in-process API** — No browser, no real
   Google OAuth, no real Worker process, no real external writes.

4. **No Playwright** — No browser-based E2E test exists anywhere in the repo.

**Verdict:** Module-level tests are real and pass. But no browser E2E,
no real user flow E2E in CI.

### Red Line 4: Integration maturity overstated — CONFIRMED

**Evidence found:**

1. **implementation-status.md marks everything "Implemented"** — All 35+
   rows show "Implemented" or "Verified" status. No maturity model.

2. **Green = "code exists and passes tests"** — The doc itself says:
   "Green source status means the code exists and passes tests; it does
   not imply an external provider is configured."

3. **Microsoft has OAuth but no action tools** —
   `apps/api/src/oauth/microsoft-oauth-routes.ts` exists but there are no
   Microsoft Outlook/Calendar/OneDrive/Teams tools registered.

4. **Pipedream is catalog-only** —
   `apps/api/src/routes/pipedream-routes.ts` only does app discovery and
   search. No connection, action execution, or webhook subscription.

5. **Web tools are adapter skeletons** —
   `apps/api/src/tools/web-tools.ts` provides `town_web_fetch` (HTTP +
   regex HTML strip) and optional `town_web_search` /
   `town_browser_interact` that require external endpoint configuration.

**Verdict:** The docs overstate capability. Need S0-S6 maturity model.

### Red Line 5: Billing is NOT a payment system — CONFIRMED

**Evidence found:**

1. **billing-routes.ts has ONE endpoint** — `GET /v1/billing` returns
   billing state and usage summary. No checkout, no subscription, no
   Stripe webhook, no payment processing.

2. **billing-repository.ts** — Manages internal credit/usage ledger only.
   No Stripe integration anywhere in the codebase.

**Verdict:** Internal credit tracking exists. Real payment processing
does not. Cannot implement Stripe without Stripe credentials.

### Red Line 6: Rate limiter can't scale — CONFIRMED

**Evidence found:**

1. **In-process Map** — `apps/api/src/lib/rate-limit.ts`: uses
   `const buckets = new Map<string, RateLimitEntry>()`. Each process has
   its own map. Multi-instance deployments have independent limits.

2. **Comment acknowledges limitation** — "Multi-worker deployments accept
   eventual consistency: each process tracks its own window."

3. **No Redis/database backing** — No shared storage option.

**Verdict:** Real limitation. Can add a database-backed limiter as
alternative, or document the shared storage requirement.

### Red Line 7: Deployment unverified — CONFIRMED

**Evidence found:**

1. **Vercel config exists** — `vercel.json` has build command, output
   directory, rewrites, and cron schedule.

2. **Fly worker config exists** — `deploy/worker-fly/` has Dockerfile
   and fly.toml.

3. **No evidence of live deployment** — Cannot verify from repo alone
   whether the system is actually running.

**Verdict:** Configuration exists. Live deployment status cannot be
verified from code. Can document honestly.

### Red Line 8: LICENSE prevents commercialization — CONFIRMED

**Evidence found:**

1. **LICENSE says non-commercial** — "internal, non-commercial,
   evaluation, and research purposes only." "NO RIGHTS ARE GRANTED TO
   USE, COPY, MODIFY, MERGE, PUBLISH, DISTRIBUTE, SUBLICENSE, OR SELL."

2. **Copyright holder** — "Copyright (c) 2026 TownAI Clean-Room
   Contributors. All Rights Reserved."

**Verdict:** License explicitly blocks commercial use. User must decide
whether to change it.

## Technical Decisions

| Decision                                          | Rationale                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Fix auth with HttpOnly cookie + server-side proxy | Real security improvement: token never exposed to JS. Eliminates XSS token theft. |
| Use S0-S6 maturity model in docs                  | Honest, granular, industry-standard. Prevents overstating capability.             |
| Add DB-backed rate limiter as option              | Real improvement for multi-instance. Keeps in-process as default for dev.         |
| Add Playwright browser E2E to CI                  | Real browser test of login flow. Does not need external services.                 |
| Document gaps for KMS, Stripe, deployment         | Honest documentation. Cannot implement without external credentials.              |
| Keep existing commit message style                | User said "push to GitHub preserving existing workflow"                           |

## Resources

- Repo: `/Users/guanjieqiao/townai-cleanroom`
- GitHub: `123oqwe/townai-cleanroom`
- Auth code: `apps/web-next/app/new/(auth)/login/page.tsx`, `apps/web-next/middleware.ts`
- API auth: `apps/api/src/lib/auth.ts`, `packages/identity/src/identity-service.ts`
- Rate limiter: `apps/api/src/lib/rate-limit.ts`
- Billing: `apps/api/src/routes/billing-routes.ts`
- E2E: `test/e2e/smoke.test.ts`, `vitest.e2e.config.ts`
- Docs: `docs/implementation-status.md`, `docs/ARCHITECTURE_GAPS.md`, `docs/deployment.md`
- License: `LICENSE`
- CI: `.github/workflows/ci.yml`, `package.json` (verify script)
