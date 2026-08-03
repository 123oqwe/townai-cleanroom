# Town Clean-Room

Town Clean-Room is an evidence-driven implementation of a durable personal AI operating system. It reconstructs externally observable product behavior using public documentation and authenticated production observations. It does not contain, claim to contain, or attempt to extract Town's private source code.

## Rules

- Observed behavior and clean-room engineering choices remain explicitly distinguishable.
- Product paths use real persistence and explicit `not_configured` states; they never invent dashboard data.
- External side effects require policy evaluation, idempotency, and an immutable execution record.
- Reverse-engineering captures, personal data, credentials, and investigation notes never enter this repository.
- Each module is verified and pushed independently.

## Development

Requires Node.js 24, pnpm 10, PostgreSQL 16, and Docker for the disposable
integration-test database.

```bash
pnpm install
pnpm verify
```

To run the API, copy `.env.example` to `.env`, set `DATABASE_URL`, and provide a
32-byte credential-encryption key encoded as base64url in
`CREDENTIAL_MASTER_KEY_BASE64URL`. The API applies pending migrations before it
starts. Never commit the populated `.env` file.

Generate a development encryption key without printing or storing it in source
control using your platform's secure secret-management workflow.

## Implemented backend modules

- Foundation contracts, source-only policy, health API, and CI.
- Allowlist-gated identity, hashed bearer sessions, encrypted OAuth credentials,
  and connected accounts.
- Owner-isolated Profile, global and routine-scoped Memory, People, editable
  Wiki/Goals/Projects, immutable revisions, citations, conflict resolution, and
  protected knowledge APIs.
- One owner-isolated personal Agent with immutable configuration versions;
  durable assistant and task Threads; append-only ordered Turns and validated
  Mentions; monotonic read state; and protected metadata/read APIs.
- Atomic Tasks with linked task Threads, schedules, source references, computed
  unread state, optimistic lifecycle updates, and durable InputRequests with
  compare-and-set answer and cancellation behavior.
- Persistent owner-isolated Sessions pinned to immutable AgentVersions;
  idempotent message-to-Turn/Run submission; append-only reconnectable events;
  PostgreSQL queue leases; and guarded start, wait/resume, completion, failure,
  and cancellation transitions.
- Owner-scoped Content Library with document/file metadata, immutable content
  revisions, collections, object-storage references, and privacy-safe expiring
  share tokens. Public share responses never expose storage keys or tenant/session metadata.
- Owner-scoped Squares with active memberships, owner/admin/member roles,
  canonical-owner invariants, team policy revisions, and authenticated API
  boundaries for member administration.
- Owner-scoped notification Channels (email/webhook/Telegram/WhatsApp metadata)
  with strict public configuration, disabled-channel controls, idempotent
  delivery outbox records, worker leases, claim-token completion, retry state,
  and no worker capability token in public delivery DTOs.
- Explicit Billing state with `not_configured` behavior, optimistic revisions,
  owner-scoped usage ledger entries, idempotent usage recording, and period
  summaries; no external payment state is invented when no provider is wired.
- Owner-scoped Operations audit events with deduplication, opaque keyset
  pagination, authenticated audit reads, and live runtime backlog summaries for
  sessions, runs, approvals, and notification delivery recovery.
- Owner-scoped Suggestions/Need-to-Know records with source provenance,
  fingerprint deduplication, expiry, and optimistic dismiss/convert actions;
  converting a suggestion atomically creates a Task thread and source
  reference; the API never invents suggestions when no internal candidate exists.
- Owner-scoped Routine schedules with strict five-field cron validation,
  timezone/next-run metadata, authenticated CRUD APIs under `/v1/routines`,
  optimistic revisions, and transactional due-work claims for an internal
  worker. Sync-run records expose owner-scoped history plus queued → running →
  succeeded/failed transitions. Schedules with run history are protected from
  destructive deletion; disable them instead. Routine webhooks support
  one-time `whsec_` secrets, rotation by recreation, disable/enable state,
  JSON/text payloads, bearer authentication, and idempotent asynchronous
  enqueueing with HTTP 202.
- Routine Agent versions persist an explicit `callableRoutineIds` allowlist;
  publication rejects missing, disabled, cross-owner, and self-referential
  child routines before the immutable version is activated. The harness exposes
  `invoke_routine` as an approval-gated operation that creates a child Task
  thread and durable queued Session Run using the child’s immutable version.
- A responsive, API-backed `apps/web` command center with explicit connection,
  empty, error, focus, and harness states; it uses no fabricated backend data.
  The Harness surface bootstraps an owner-scoped personal Agent, lists real
  assistant Threads, supports creating and switching Threads, renders persisted
  Turns, polls durable Runs/Events, and exposes only the approval decision
  recorded by the server.

Knowledge search uses PostgreSQL full-text ranking and opaque keyset cursors. Its
responses identify the source as `local_postgresql` with algorithm
`postgres_full_text_v1`. This is a documented clean-room implementation choice;
it is not represented as Town's private ranking system or as live federated
search across unconfigured external accounts.

Authenticated knowledge resources are available under `/v1/profile`,
`/v1/memories`, `/v1/people`, `/v1/wiki`, and `/v1/knowledge`. Public API writes
are recorded as user-authored citations; assistant and system provenance can
only be written by internal runtime code.

Authenticated connected-account management is available under `/v1/accounts`:
safe account listing, owner-scoped credential rotation, and account removal.
OAuth secrets are encrypted at rest and are never returned in API projections;
Google OAuth callback wiring is implemented with PKCE, one-time state, offline
refresh scope, userinfo verification, and encrypted credential persistence. It
returns `OAUTH_NOT_CONFIGURED` until the deployment supplies Google client
credentials and a registered redirect URI.
Server-side Google access-token refresh is available at
`POST /v1/accounts/:accountId/refresh`; plaintext credentials stay inside the
provider boundary and the response is only the safe connected-account view.
The Harness now exposes owner-scoped read-only `google_gmail_search` and
`google_calendar_freebusy` tools. They use the selected connected account,
refresh once on expiry/401 when configured, and validate provider responses;
they do not fabricate connector data.
It also exposes read-only `google_gmail_get_message` and approval-gated
`google_calendar_create_event`; external event creation cannot execute until
the durable Harness approval context is resumed.
Approval-gated `google_gmail_send` uses Gmail's RFC 822 `messages.send` API,
rejects header-injection input, and reports success only after Google confirms
the sent message.

Notification channels now have a real webhook outbox executor: queued
deliveries are leased, POSTed as `{ eventType, payload }`, marked succeeded only
on a 2xx response, and scheduled for bounded exponential retry on provider
failure. The executor runs from the protected internal worker endpoint and the
local worker loop.

Waiting runtime runs can be durably re-enqueued through
`POST /v1/sessions/:sessionId/runs/:runId/resume` with an explicit
`expectedState` of `waiting_approval` or `waiting_user_input`; stale or
cross-owner resumes are rejected by the transition service.
For Harness approvals, `POST /v1/sessions/:sessionId/runs/:runId/approval`
persists a one-time owner/run-bound decision and requeues the run. The next
worker execution consumes that decision through `approval/resolve` before
continuing the persisted Harness thread.

Cross-owner Agent-to-Agent requests are available under `/v1/a2a/requests`.
They use an explicit request/result envelope, recipient consent, expiry metadata,
and revision-checked transitions; private Memory and credentials are never
shared by this clean-room protocol.

Authenticated Agent, Thread, Turn-read, Task, and InputRequest resources are
available under `/v1/agents`, `/v1/threads`, and `/v1/tasks`. Owner identity,
runtime role, Turn sequence, and source provenance are server-derived.

Routine Agents can be created, listed, and optimistically version-published
under `/v1/agents/routines`; their immutable active versions are then
referenced by `/v1/routines` schedules. An authenticated
`POST /v1/routines/:routineId/run` creates a real child Task/Session Run and
returns queued state for the worker; it never reports a fabricated completion.
The local/serverless worker tick also claims due schedules and submits them
through that same Session queue; trigger failures are recorded as failed sync
runs, and each claimed sync run stores the resulting runtime `runId` for
reconciliation and recovery. Worker completion/failure callbacks reconcile that
linked sync record to `succeeded`/`failed` without changing the runtime result.

Authenticated message submission is available at
`/v1/threads/:threadId/messages`; Session, Run, and reconnectable event reads are
available under `/v1/sessions`. Submission requires an idempotency key and
returns queued state without inventing assistant content. Queue claims, leases,
event writes, runtime roles, and assistant-output writes are internal only.

Module 4 defines the durable execution boundary and a provider-neutral runtime
adapter port. The Responses/Codex-compatible harness adapter is wired only when
its explicit API key is configured; no provider call or assistant output is
fabricated otherwise. Without an injected provider adapter, Runs remain honestly
queued. Genuine assistant output can only be recorded by an internal worker
holding the current unexpired Run lease.

The runtime package now includes a durable `createRuntimeWorker` loop that
claims queue leases, forwards adapter phases/output, handles wait states,
heartbeats active leases, and records completion/failure transitions. It still
requires an explicitly injected provider adapter; the worker itself never
generates model content.

For local durable execution, set `RESPONSES_API_KEY` and
`WORKER_ENABLED=true` in the environment. The API process then runs one worker
poller alongside the HTTP listener; leave the flag false in serverless
deployments. Serverless deployments can instead set `WORKER_SECRET` and invoke
`POST /v1/internal/worker` with `Authorization: Bearer <secret>` once per
scheduled tick; the endpoint processes at most one leased queue item and is not
registered when the secret is absent.

The current product objective is recorded in [GOAL.md](./GOAL.md).
