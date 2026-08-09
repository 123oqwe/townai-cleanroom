# Implementation Status

Evidence ledger for the clean-room implementation. Each integration is rated
on a maturity scale to prevent conflating "code exists" with "production ready."

## Maturity Scale

| Level | Label                | Definition                                                           |
| ----- | -------------------- | -------------------------------------------------------------------- |
| S0    | Spec                 | Only a specification or type definition exists.                      |
| S1    | Implemented          | Source code exists. No tests yet.                                    |
| S2    | Tested               | Code exists and passes automated tests (unit or integration).        |
| S3    | Configured           | Real credentials and environment have been set up for a staging env. |
| S4    | Live Verified        | The integration has been exercised against a real external provider. |
| S5    | Quality Gated        | Golden eval suite and regression tests guard changes.                |
| S6    | Production Certified | Monitoring, alerting, recovery, and security audit are in place.     |

Only S6 qualifies as "Production Ready" in external documentation.

## Feature Matrix

### Core Platform

| Area                | Maturity | Package    | Evidence                                                    |
| ------------------- | -------- | ---------- | ----------------------------------------------------------- |
| Identity & sessions | S2       | `identity` | Hashed token storage; allowlist gate; 4 test files          |
| Google OAuth        | S2       | `identity` | PKCE + offline refresh; `google-oauth-routes.test.ts`       |
| Microsoft OAuth     | S1       | `identity` | Azure AD v2.0 PKCE flow; **no action tools registered**     |
| Connected accounts  | S2       | `identity` | AES-256-GCM encryption; `account-repository.test.ts`        |
| Credential cipher   | S2       | `identity` | AES-256-GCM; single master key; `credential-cipher.test.ts` |

### Knowledge Layer

| Area                   | Maturity | Package     | Evidence                                                    |
| ---------------------- | -------- | ----------- | ----------------------------------------------------------- |
| Profile & Memory       | S2       | `knowledge` | CRUD + provenance; `knowledge.test.ts`                      |
| People & relationships | S2       | `knowledge` | Owner-scoped typed edges; tested                            |
| Wiki + nightly upkeep  | S2       | `knowledge` | Server-side synthesis; upkeep scanner tested                |
| Goals & Projects       | S2       | `knowledge` | First-class entities with citations; tested                 |
| Knowledge Graph        | S2       | `knowledge` | 12 node types, 15 edge types, 3-hop traversal; tested       |
| Context Builder        | S2       | `knowledge` | Retrieval planning + federated search + compression; tested |
| Trusted contacts       | S2       | `knowledge` | Email + domain matching; prompt-injection detection; tested |

### Agent Runtime

| Area                   | Maturity | Package   | Evidence                                                     |
| ---------------------- | -------- | --------- | ------------------------------------------------------------ |
| Agents & versions      | S2       | `agents`  | Immutable version snapshots; `agents.test.ts`                |
| Threads & tasks        | S2       | `agents`  | CRUD + projections; tested                                   |
| Durable sessions       | S2       | `runtime` | Queue leases (FOR UPDATE SKIP LOCKED); `runtime.test.ts`     |
| Codex harness          | S2       | `harness` | `codex-exec.ts` + `codex-resolve.ts`; agent-factory tested   |
| Responses API fallback | S2       | `harness` | Activated by `RESPONSES_API_KEY`; loop + model-router tested |

### Tools & Integration

| Area                    | Maturity | Package                | Evidence                                                         |
| ----------------------- | -------- | ---------------------- | ---------------------------------------------------------------- |
| Tool policy & approvals | S2       | `tools`                | Read-only/approval/autonomous; `policy.test.ts`                  |
| MCP client              | S2       | `tools`                | Streamable HTTP + SSE; `mcp.test.ts` + `mcp-client.test.ts`      |
| Google Gmail/Calendar   | S2       | `google`               | Search, get, send, freebusy, create event; `google.test.ts`      |
| E2B sandbox             | S2       | `api/code-runner`      | `@e2b/code-interpreter`; `code-runner.test.ts`                   |
| Pipedream catalog       | S1       | `api/pipedream-routes` | App discovery/search proxy only; **no action execution**         |
| Web search              | S1       | `api/harness-tools`    | `town_web_search` requires external endpoint; adapter only       |
| Web browser             | S1       | `api/harness-tools`    | `town_browser_interact` requires external endpoint; adapter only |
| Web fetch               | S2       | `api/harness-tools`    | `town_web_fetch` HTTP + HTML strip; `harness-tools.test.ts`      |

### Routines

| Area                | Maturity | Package    | Evidence                                                         |
| ------------------- | -------- | ---------- | ---------------------------------------------------------------- |
| Routines & triggers | S2       | `routines` | Cron, email, calendar, voice, Slack, webhook; `routines.test.ts` |
| Step cache & replay | S2       | `routines` | Idempotent; reuses completed steps; tested                       |

### Content & Channels

| Area                  | Maturity | Package               | Evidence                                                      |
| --------------------- | -------- | --------------------- | ------------------------------------------------------------- |
| Content library       | S2       | `content`             | 10 types; immutable revisions; share tokens; tested           |
| Notification channels | S2       | `channels`            | Email/webhook/Telegram/WhatsApp/Slack; retry + replay; tested |
| Content storage       | S2       | `api/content-storage` | File + S3 backends; `content-storage.test.ts`                 |

### Teams & Billing

| Area            | Maturity | Package       | Evidence                                                      |
| --------------- | -------- | ------------- | ------------------------------------------------------------- |
| Squares & teams | S2       | `teams`       | Memberships, roles, team policy, shared accounts; tested      |
| Billing & usage | S1       | `billing`     | Internal credit/usage ledger only; **no Stripe, no payments** |
| Audit & admin   | S2       | `operations`  | Agent health, billing reconciliation, user/team projections   |
| Suggestions     | S2       | `suggestions` | Overdue tasks + upcoming routines as candidates; tested       |
| A2A protocol    | S2       | `a2a`         | Consent envelope; no private memory shared; tested            |

### Voice

| Area           | Maturity | Package                | Evidence                                                        |
| -------------- | -------- | ---------------------- | --------------------------------------------------------------- |
| ElevenLabs TTS | S2       | `api/elevenlabs-voice` | Returns real audio/mpeg when configured; `voice-routes.test.ts` |

### Inbound Webhooks

| Area             | Maturity | Package                   | Evidence                                                           |
| ---------------- | -------- | ------------------------- | ------------------------------------------------------------------ |
| Slack inbound    | S2       | `api/slack-events`        | v0 signature verification + event_id idempotency; tested           |
| Telegram inbound | S2       | `api/telegram-events`     | Secret-token verification; tested                                  |
| WhatsApp inbound | S2       | `api/whatsapp-events`     | X-Hub-Signature-256 + GET handshake; tested                        |
| Twilio voice     | S2       | `api/twilio-voice-events` | Transcription callback signature validation; tested                |
| Vapi voice       | S2       | `api/vapi-voice-events`   | Bearer-validated transcript callback; tested                       |
| Gmail Pub/Sub    | S2       | `api/gmail-pubsub-events` | OIDC JWT verification + History API; `gmail-pubsub-events.test.ts` |

## Summary

- **S2 (Tested):** 33 areas — code exists and passes automated tests
- **S1 (Implemented):** 4 areas — code exists but lacks full testing or is a partial implementation:
  - Microsoft OAuth: OAuth flow exists but no action tools (Outlook/Calendar/OneDrive/Teams)
  - Pipedream: catalog browse/search only, no connection or action execution
  - Web search/browser: adapter skeletons requiring external service endpoints
  - Billing: internal ledger only, no payment processing (see Red Line 5)
- **S0-S6 progression requires:** No integration has reached S3+ (configured with real
  credentials in a staging environment). This is a deployment and operations task,
  not a code task.

## Remaining Gaps

See [ARCHITECTURE_GAPS.md](./ARCHITECTURE_GAPS.md) for the full parity matrix
against real Town.ai, including platform-level gaps (Convex WebSocket, iMessage,
email-to-Townie inbound) and production readiness gaps (KMS, Stripe, deployment).
