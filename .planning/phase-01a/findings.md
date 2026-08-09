# Findings & Decisions -- Phase 01A Production Auth

> Recovered-first file after compaction. Pairs with task_plan.md + progress.md.

## Requirements

From pasted-text-1.txt (Phase 01A prompt). Hard requirements:

- Real Google OIDC (Authorization Code + PKCE) replaces email-only login in prod.
- Allowlist becomes authorization-only, checked AFTER identity verification.
- Production must have NO bare-email session creation entry point.
- Session token never returned to browser JS (HttpOnly cookie, hash-at-rest).
- Google login OAuth and Workspace/Gmail/Calendar OAuth are two independent flows.
- No real Google credentials => code complete + BLOCKED_BY_CREDENTIAL, never S4.
- Migration backward compatible; do not edit old migrations.
- Full unit + PG-integration + browser-E2E + live smoke scaffold.
- Auth Code Gate GO only if all 16 acceptance criteria met; Public Beta Gate
  NO-GO until real Google live smoke passes.

## Audit Conclusions (from reading the listed files)

### Current Email-only Login entry points

1. apps/api/src/app.ts:824 `POST /v1/auth/session` -- accepts `{email,...}`,
   calls identityService.establishIdentity. NO identity proof. This is the
   production hole.
2. apps/web-next/app/api/auth/login/route.ts -- BFF POST /api/auth/login
   forwards `{email}` to the API. Sets HttpOnly cookie `town-token`.
3. apps/web-next/app/new/(auth)/login/page.tsx -- email input form POSTs
   /api/auth/login. Shown in production.
4. apps/web-next/middleware.ts -- reads `town-token` cookie; gates /new/*.
5. apps/web-next/app/api/proxy/[...path]/route.ts -- reads cookie, injects
   `Authorization: Bearer <token>` to backend. No CSRF/Origin check on mutations.

### Current Session Schema (packages/db/migrations/0001_identity.sql)

- auth_sessions: id, user_id, token_hash (bytea unique), expires_at,
  revoked_at, created_at, last_seen_at.
- MISSING: idle_expires_at, absolute_expires_at, auth_method/provider,
  user_agent_hash, ip_metadata_hash, session_family_id,
  rotated_from_session_id, current-session flag.
- Token: `town_session_<32-byte-base64url>`, SHA-256 hashed at rest. Good base.
- TTL: cookie 7 days (login route) vs backend 30 days (identity-service
  sessionTtlMs). MISMATCH -- prompt section IX point 4 violation.

### Google Workspace OAuth vs Web Login boundary

- apps/api/src/oauth/google-oauth-routes.ts handles CONNECTED ACCOUNTS:
  scopes include gmail.modify + calendar.*. Uses GOOGLE_OAUTH_CLIENT_ID/SECRET.
  State stored in oauth_connect_states (migration 0023). PKCE verifier in
  HttpOnly cookie `town_oauth_verifier`. This is the Connected Account flow --
  must remain separate from login.
- apps/api/src/lib/google-oidc.ts only verifies Pub/Sub push JWTs -- NOT a
  login OIDC flow. Missing: nonce, iat, azp, email_verified, login scopes.
- NO login OIDC flow exists. Must be built fresh with AUTH_GOOGLE_* vars.

### Cookie lifecycle

- Name `town-token`, HttpOnly, SameSite=Lax, Secure in prod, Path=/, maxAge 7d.
- Set in login route, cleared in logout route (maxAge 0).
- NOT __Host- prefixed; Domain unset (good). No Priority=High. No Expires.
- Cookie name hardcoded in 4+ files (login, logout, me, proxy, middleware,
  api-client). Needs unified module.

### Logout & Session Revoke

- API: DELETE /v1/me/session -> identityService.revokeSession (sets revoked_at).
- BFF: POST /api/auth/logout -> calls DELETE /v1/me/session, clears cookie.
- MISSING: logout-all (revoke all user sessions), session listing, rotation.
- authenticate() checks revoked_at IS NULL and expires_at > now. Does NOT
  check idle expiry (none exists). last_seen_at updated EVERY request (no
  throttle) -- prompt IX point 6 violation.

### CSRF / Origin protection

- NONE. Proxy accepts POST/PUT/PATCH/DELETE with no Origin/Host check.
- CORS: app.ts sets cors on /v1/* using dependencies.webOrigin (single origin).
- No assertSameOriginRequest. Prompt section XI entirely unmet.

### Production environment validation

- scripts/check-runtime-config.mjs checks DATABASE_URL, CREDENTIAL_MASTER_KEY,
  WEB_ORIGIN, and optional integrations. Does NOT check any AUTH_* vars, does
  NOT fail-fast on missing prod auth config, does NOT block
  DEV_EMAIL_LOGIN_ENABLED in production.
- config.ts (environmentSchema) has no AUTH_* fields, no DEV_EMAIL_LOGIN_ENABLED.

### BFF server config

- Uses NEXT_PUBLIC_API_BASE_URL (client-exposed) for server-side proxy URL.
- Prompt XII: must move to INTERNAL_API_BASE_URL (server-only). No SSRF guard,
  no path normalization beyond join, forwards a fixed header allowlist (ok),
  does not forward Cookie (good), but no protection against user-supplied
  Authorization overriding session (proxy hardcodes Authorization so OK).

## Technical Decisions

| Decision                                                      | Rationale                                                                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| jose for ID-token verification                                | Prompt mandates reliable JWT/JWKS; jose is the standard, supports JWKS caching + all claim checks                    |
| Separate AUTH_FLOW_ENCRYPTION_KEY for code_verifier at-rest   | Prompt section VI; isolated from CREDENTIAL_MASTER_KEY; 32-byte base64url; AES-256-GCM reuse existing cipher pattern |
| auth_oidc_attempts table with state_hash unique + consumed_at | One-time consume via tx + FOR UPDATE; replay protection                                                              |
| auth_identities (provider, provider_subject) unique           | Verified identity model; conflict detection on email mismatch                                                        |
| Session hardening via additive columns on auth_sessions       | Backward compatible; existing rows get nullable defaults                                                             |
| __Host-town-session prod cookie                               | __Host- prefix forces Secure+Path=/+no Domain; matches prompt X                                                      |
| BFF shared secret with timing-safe compare                    | OIDC start/callback are server-to-server only; browser must not call API OIDC directly                               |

## Issues Encountered

| Issue                                            | Resolution                                         |
| ------------------------------------------------ | -------------------------------------------------- |
| apply_patch Add File needs `+` line prefixes     | Use `+` prefix on every content line               |
| zsh glob fails on `[...path]`                    | Quote paths; setopt NO_NOMATCH                     |
| Parallel session runs pnpm test on main worktree | Use isolated git worktree to avoid lock/contention |

## Resources

- Prompt: /Users/guanjieqiao/.codex/attachments/b5cc898b-674a-4038-a447-9cd75b09e4ed/pasted-text-1.txt
- Skill: ~/.codex/skills/manus2.0planningwithfiles/SKILL.md
- Worktree: /Users/guanjieqiao/townai-cleanroom-phase01a
- Key files: see task_plan.md phase checklists

## Visual/Browser Findings

(none yet -- browser E2E screenshots captured in Phase 7)

---

_Update after every 2 view/browser/search operations_
