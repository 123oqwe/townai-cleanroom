# Architecture Gaps — Clean-room vs Real Town.ai

This document records the remaining gaps between the clean-room implementation
and the real Town.ai architecture, based on the architecture notes and reverse
engineering report. Gaps are prioritized by impact on functional parity.

## Closed in this session (commit 7019ca9)

- **Codex binary missing**: `@openai/codex` platform binary was never installed;
  `new Codex()` threw at runtime. Fixed + verified with subprocess smoke test.
- **codexPathOverride fallback**: system `codex` CLI detection for deployments
  where the vendored binary does not resolve.
- **Microsoft OAuth**: full PKCE flow via Azure AD v2.0 with Mail.ReadWrite and
  Calendars.ReadWrite scopes.
- **Telegram inbound webhook**: secret-token verification + queueTrigger.
- **WhatsApp inbound webhook**: X-Hub-Signature-256 + GET verification handshake.
- **E2B sandbox code runner**: `@e2b/code-interpreter` backend activated by
  `E2B_API_KEY`, falls back to local Node `--permission` runner.
- **Pipedream integration catalog**: proxy routes for app discovery and search.

## Low priority — platform-level rewrite

These gaps require a platform-level rewrite and are documented for future work.
They do not affect the core Agent runtime, knowledge layer, tool execution, or
trust engine functionality.

### 1. Convex WebSocket realtime layer

Real Town.ai uses Convex as the primary realtime state layer with a
multiplexed WebSocket (`wss://api.town.com/api/1.42.0/sync`). The clean-room
implementation uses HTTP polling and Server-Sent Events (SSE) for realtime
updates. A Convex migration would replace the entire persistence + subscription
layer.

### 2. Next.js / React frontend

**Closed.** The production frontend is now Next.js 15 (App Router, React 19,
TypeScript, Tailwind v4) at `apps/web-next`, served from `/new/*`. The legacy
vanilla JavaScript app (`apps/web/app.js`) has been deleted. The
`@town/web-client` typed API client covers all 18 namespaces
(auth, me, threads, sessions, knowledge, routines, content, tasks, suggestions,
approvals, tools, mcp, channels, accounts, voice, billing, squares, operations,
admin) with 131 unit tests. Vercel `outputDirectory` is `apps/web-next`.

### 3. iMessage channel

iMessage is declared in the channel type enum but has no inbound/outbound
adapter. Implementing iMessage requires an Apple Business Chat integration or
a macOS relay host, which is environment-dependent.

### 4. Email-to-Townie inbound

**Closed.** Gmail Pub/Sub push listener is implemented. The endpoint
`POST /v1/internal/gmail/pubsub` verifies the Google OIDC JWT in the
Authorization header, decodes the push payload, fetches new messages via the
Gmail History API, matches the email address to a routine's
`email_to_assistant` trigger, and queues a RoutineRun. Watch renewal runs
daily from the worker loop. See `docs/deployment.md` for configuration.

## Functional parity summary (9 architecture layers)

| Layer                     | Status                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Channels & Triggers    | Web, Slack, Telegram, WhatsApp, Twilio voice, Vapi voice, Schedule, Calendar, Gmail Pub/Sub email inbound — implemented. iMessage — gap. |
| 2. Web & Realtime         | Next.js 15 + React 19 + SSE. Vanilla JS app deleted. Convex WebSocket — gap (platform rewrite).                                          |
| 3. Identity & Accounts    | Google OAuth + Microsoft OAuth + multi-account + token encryption — implemented.                                                         |
| 4. Personal Knowledge     | Profile, Memory, People, Wiki, Goals/Projects, Knowledge Graph, Trusted Contacts — implemented.                                          |
| 5. Context Builder        | Retrieval planning, federated search, dedup, compression, citations — implemented.                                                       |
| 6. Agent Runtime          | Durable session, Codex SDK harness, model loop, tool execution, pause/resume, version snapshots — implemented + verified end-to-end.     |
| 7. Durable Routine Engine | Triggers, step cache, idempotency, pause/resume, version history — implemented.                                                          |
| 8. Tools & Integration    | Town tools, MCP, web search, browser, E2B sandbox, Pipedream catalog, code runner — implemented.                                         |
| 9. Trust & Policy         | Read-only/approval/autonomous modes, per-tool override, trusted contacts, prompt-injection detection — implemented.                      |
| Content Library           | All 10 content types, collections, share, search — implemented.                                                                          |
| Tasks & Suggestions       | Task projection, suggestion engine, need-to-know — implemented.                                                                          |
| Squares & Teams           | Membership, shared integrations, team routines, A2A — implemented.                                                                       |
| Platform Ops              | Credits, usage ledger, model routing, admin health — implemented.                                                                        |

## Production Readiness Gaps

These gaps cannot be resolved by code alone. They require external
infrastructure, credentials, or operational setup that is beyond the scope
of this repository. They are documented here for transparency.

### Gap A: Secret Management (Red Line 2)

**Current state:** AES-256-GCM with a single `CREDENTIAL_MASTER_KEY_BASE64URL`
environment variable. `keyVersion: 1` — no rotation support.

**What's missing:**

- Cloud KMS integration (AWS KMS, GCP KMS, or HashiCorp Vault)
- Envelope encryption (data encryption key wrapped by KMS master key)
- Per-environment key separation
- Key versioning and automatic rotation
- Credential re-encryption on key rotation
- Audit trail for decryption operations
- Secrets never logged

**Why it can't be fixed in code:** KMS integration requires cloud provider
credentials and a configured KMS instance. The current single-key approach is
correct for development and evaluation, but not for production with real user
credentials.

### Gap B: Payment Processing (Red Line 5)

**Current state:** Internal credit/usage ledger in `packages/billing`. Tracks
plan state, credit balance, and per-session/model/tool usage. One API endpoint
(`GET /v1/billing`) returns billing state and usage summary.

**What's missing:**

- Stripe Checkout / Subscription / Payment Intent
- Stripe webhook handling (signature verification, idempotency)
- Checkout flow, trial, upgrade/downgrade, proration
- Payment failure handling, dunning, grace period
- Invoice generation, refund, tax
- Entitlements enforcement (credit reservation → execution → reconciliation)
- Seat billing, organization shared credits
- Abuse/fraud controls

**Why it can't be fixed in code:** Stripe integration requires a Stripe account
with API keys, configured webhooks, and product/price catalog. The internal
ledger is correct for tracking usage, but payment collection requires external
infrastructure.

### Gap C: Live Deployment Verification (Red Line 7)

**Current state:** Deployment configuration exists (`vercel.json`, Fly worker
Dockerfile/fly.toml, deployment docs). No evidence of a live, continuously
running production deployment.

**What's missing:**

- Verified live Web URL accessible to users
- Verified live API endpoint
- Verified always-on Worker process
- Verified PostgreSQL connectivity from both API and Worker
- Verified migrations applied in production
- Verified OAuth redirect URIs use production domain
- Verified webhooks reachable from public internet
- Verified logs, metrics, and alerts are operational
- Worker restart recovery verified
- Scheduled Routine execution with browser closed verified

**Why it can't be fixed in code:** Live deployment requires provisioned
infrastructure (Vercel project, Fly.io app, managed PostgreSQL), configured
environment variables with real credentials, and a domain with DNS pointing
to the deployment. This is an operations task, not a code task.

## Security Hardening Roadmap

The following items are required before any production deployment with real
user data. They are ordered by priority:

1. **Authentication** — Resolved in this session: HttpOnly cookie, server-side
   proxy, server-side logout. Still needed: Google OIDC for web login (not
   just allowlist), MFA/passkey, session rotation, device management.
2. **Secret Management** — See Gap A above.
3. **Cross-Tenant Isolation** — Automated tests that verify no cross-owner
   data access is possible through any API endpoint.
4. **Rate Limiting** — Resolved in this session: database-backed limiter
   option. Still needed: per-tenant, per-tool, per-model dimension limits.
   Phase 01B hotfix: fixed integer overflow (`timestamp::int`), added
   real per-key `FOR UPDATE` locking, SHA-256 key hashing, production
   fail-fast for memory backend, real cleanup, and concurrency tests with
   pool max>=20. Still needed: per-tenant, per-tool, per-model limits.
5. **Audit Logging** — Exists in `operations` package. Needs verification
   that all sensitive actions (credential access, tool execution, approval
   decisions) are logged with sufficient detail.
6. **Data Encryption** — At rest (PostgreSQL) and in transit (TLS). Requires
   infrastructure configuration.
7. **Backup and Recovery** — PostgreSQL backup strategy, RPO/RTO defined,
   restore drill performed.
8. **Compliance** — Privacy policy, terms of service, DPA, subprocessor
   list, GDPR/CCPA data export/deletion.
