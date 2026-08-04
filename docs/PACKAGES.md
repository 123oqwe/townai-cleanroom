# Package Reference

This document describes the responsibility of each workspace package.

## Core Runtime

| Package | Responsibility |
|---------|---------------|
| `@town/contracts` | Shared types: branded IDs, Zod schemas, cursor pagination, error codes, event types |
| `@town/db` | PostgreSQL client, schema definitions (53 tables), migration runner (49 migrations) |
| `@town/harness` | Agent harness: ModelPort (Codex SDK + Responses API), ToolPort, policy-aware tool bindings, session server, approval flow |
| `@town/runtime` | Durable execution: session/run/event repositories, queue leases, transition service, worker loop |
| `@town/tools` | Tool registry, policy engine (read-only/approval/autonomous), MCP JSON-RPC client, tool definitions, approval requests |

## Identity & Knowledge

| Package | Responsibility |
|---------|---------------|
| `@town/identity` | Auth sessions, bearer tokens, OAuth credential encryption (AES-256-GCM), connected accounts (Google + Microsoft), allowlist |
| `@town/knowledge` | Profile, global/routine Memory, People + relationship edges, Wiki + revisions, Goals/Projects, Knowledge Graph (12 node types, 15 edge types), Context Builder (retrieval planning, federated search, dedup, compression), trusted contacts, nightly Wiki upkeep |
| `@town/agents` | Agent definitions (personal + routine), immutable version snapshots, threads, turns, mentions, tasks, input requests |

## Automation & Channels

| Package | Responsibility |
|---------|---------------|
| `@town/routines` | Routine schedules (cron), triggers (manual/email/calendar/voice/Slack/Telegram/WhatsApp/webhook), step cache, idempotent replay, RoutineResult, trigger definitions, share/install |
| `@town/channels` | Notification delivery outbox: email (via Gmail), webhook, Telegram, WhatsApp Cloud API, Slack. Retry with bounded exponential backoff, lease-claimed execution, replay |
| `@town/content` | Content library: 10 types (document, email_draft, spreadsheet, deck, file, image, video, audio, recording, briefing), immutable revisions, collections, expiring share tokens |
| `@town/suggestions` | Need-to-know candidate pipeline: overdue tasks + upcoming routines become deduplicated candidates with provenance, dismiss/convert lifecycle |

## Platform

| Package | Responsibility |
|---------|---------------|
| `@town/teams` | Squares (team workspaces), memberships, roles (owner/admin/member), team policy revisions, shared account bindings |
| `@town/billing` | Billing state, usage ledger (per-session/model/tool), idempotent recording, period summaries, plan/credit bands |
| `@town/operations` | Audit events with deduplication, opaque keyset pagination, admin diagnostics (agent health, billing reconciliation, user/team projections) |
| `@town/a2a` | Agent-to-agent request/result envelope: cross-owner consent, expiry, revision-checked transitions, scoped grant/deny/revoke |

## External Integrations

| Package | Responsibility |
|---------|---------------|
| `@town/google` | Google Workspace API client: Gmail search/get/send (RFC 822), Calendar events/freebusy/create, OAuth token refresh |

## Apps

| App | Responsibility |
|-----|---------------|
| `apps/api` | Hono REST API: 90+ authenticated routes, durable worker, Slack/Telegram/WhatsApp/Twilio/Vapi webhook receivers, Google/Microsoft OAuth, E2B sandbox, Pipedream catalog, ElevenLabs TTS, Vercel serverless entry |
| `apps/web` | Vanilla JS command center: threads, knowledge search, content library, people, routines, tasks, approvals, channels, billing, squares, A2A |

## Dependency Flow

    contracts  <--  (all packages)
    db  <--  identity, knowledge, agents, runtime, tools, routines, content, channels, teams, billing, operations, suggestions, a2a
    identity  <--  google, harness (credential cipher)
    harness  <--  api (Codex SDK + Responses API backends)
    runtime  <--  api (worker loop, session/run lifecycle)
    tools  <--  harness (policy-aware tool bindings)
    knowledge  <--  api (context builder, search)
    google  <--  api (Gmail/Calendar tools)
