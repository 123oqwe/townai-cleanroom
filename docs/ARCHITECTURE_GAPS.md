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

Real Town.ai uses Next.js 16.2.3 with App Router, RSC, and Turbopack. The
clean-room frontend is vanilla JavaScript (`apps/web/app.js`). A frontend
rewrite to Next.js + React + Convex React Client is a separate project scope.

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
| 2. Web & Realtime         | Vanilla JS + SSE/polling. Convex WebSocket — gap (platform rewrite).                                                                     |
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
