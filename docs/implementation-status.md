# Implementation Status

Evidence ledger for the clean-room implementation. Green source status means
the code exists and passes tests; it does not imply an external provider is
configured.

## Feature Matrix

| Area | Status | Package | Boundary |
|------|--------|---------|---------|
| Identity & sessions | Implemented | `identity` | Requires real database + session token |
| Google OAuth | Implemented | `identity` | PKCE + offline refresh; credentials are deployment config |
| Microsoft OAuth | Implemented | `identity` | Azure AD v2.0 PKCE; credentials are deployment config |
| Connected accounts | Implemented | `identity` | Token encryption at rest; never returned in API |
| Profile & Memory | Implemented | `knowledge` | No external knowledge provider invented |
| People & relationships | Implemented | `knowledge` | Owner-scoped typed edges; no cross-owner |
| Wiki + nightly upkeep | Implemented | `knowledge` | Server-side synthesis; no private model claimed |
| Goals & Projects | Implemented | `knowledge` | First-class entities with citations |
| Knowledge Graph | Implemented | `knowledge` | 12 node types, 15 edge types, 3-hop traversal |
| Context Builder | Implemented | `knowledge` | Retrieval planning + federated search + compression |
| Trusted contacts | Implemented | `knowledge` | Email + domain matching; prompt-injection detection |
| Agents & versions | Implemented | `agents` | Immutable version snapshots; no drift during run |
| Threads & tasks | Implemented | `agents` | Assistant content not fabricated without worker |
| Durable sessions | Implemented | `runtime` | Queue leases; pause/resume; SSE event stream |
| Codex harness | Verified | `harness` | End-to-end smoke test; `codex exec` subprocess |
| Responses API fallback | Implemented | `harness` | Activated by `RESPONSES_API_KEY` |
| Tool policy & approvals | Implemented | `tools` | Read-only/approval/autonomous; per-tool override |
| MCP client | Implemented | `tools` | Streamable HTTP + SSE; needs credential resolver |
| Routines & triggers | Implemented | `routines` | Cron, email, calendar, voice, Slack, webhook, Telegram, WhatsApp |
| Step cache & replay | Implemented | `routines` | Idempotent; reuses completed steps |
| Content library | Implemented | `content` | 10 types; immutable revisions; share tokens |
| Notification channels | Implemented | `channels` | Email/webhook/Telegram/WhatsApp/Slack; retry + replay |
| Squares & teams | Implemented | `teams` | Memberships, roles, team policy, shared accounts |
| Billing & usage | Implemented | `billing` | Usage ledger per session/model/tool; `not_configured` state |
| Audit & admin | Implemented | `operations` | Agent health, billing reconciliation, user/team projections |
| Suggestions | Implemented | `suggestions` | Overdue tasks + upcoming routines as candidates |
| A2A protocol | Implemented | `a2a` | Consent envelope; no private memory shared |
| Google Gmail/Calendar | Implemented | `google` | Search, get, send (RFC 822), freebusy, create event |
| E2B sandbox | Implemented | `api/code-runner` | `@e2b/code-interpreter`; falls back to local Node runner |
| Pipedream catalog | Implemented | `api/pipedream-routes` | App discovery/search proxy |
| Web search & browser | Implemented | `api/harness-tools` | `town_web_search`, `town_browser_interact` |
| ElevenLabs TTS | Implemented | `api/elevenlabs-voice` | Returns real audio/mpeg when configured |
| Slack inbound | Implemented | `api/slack-events` | v0 signature verification + event_id idempotency |
| Telegram inbound | Implemented | `api/telegram-events` | Secret-token verification |
| WhatsApp inbound | Implemented | `api/whatsapp-events` | X-Hub-Signature-256 + GET handshake |
| Twilio voice | Implemented | `api/twilio-voice-events` | Transcription callback signature validation |
| Vapi voice | Implemented | `api/vapi-voice-events` | Bearer-validated transcript callback |

## Remaining Gaps

See [ARCHITECTURE_GAPS.md](./ARCHITECTURE_GAPS.md) for the full parity matrix
against real Town.ai, including platform-level gaps (Convex WebSocket, Next.js
frontend, iMessage, email-to-Townie inbound).
