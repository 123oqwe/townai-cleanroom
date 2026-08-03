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

The repository also contains the production entrypoint used by Vercel:
`api/index.js` re-exports the built `apps/api/dist/index.js` application and
`vercel.json` builds the workspace before serving `apps/web`. Vercel startup
still requires the real environment variables; this entrypoint does not embed
fallback credentials or a fake database.

Generate a development encryption key without printing or storing it in source
control using your platform's secure secret-management workflow.

For an allowlisted deployment, set `ACCESS_ALLOWLIST_EMAILS` to a comma-separated
list of approved email addresses. Startup idempotently enables those rows in
the server-side allowlist; it never disables or deletes unlisted rows. Leave it
empty to preserve the database's existing allowlist state.

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
- The same UI exposes a real owner-scoped Knowledge search and active Content
  Library view. Search results identify their resource type and local search
  algorithm; empty or unavailable stores remain explicit instead of being
  replaced with sample cards.
- Content Library cards can create a server-issued 24-hour share token and
  revoke it again. The UI only shows the API share URL; public responses stay
  limited to safe content fields.
- The Content Library accepts the verified kinds `document`, `email_draft`,
  `spreadsheet`, `deck`, `file`, `image`, `video`, `audio`, `recording`,
  `briefing`, `link`, and `session`; each remains a typed item with immutable
  revisions.
- The People surface reads active relationship records from `/v1/people` and
  can create a user-authored person with category, email, and notes. It does
  not infer or fabricate contacts.
- The workspace profile chip opens a versioned JSON editor backed by
  `/v1/profile`. New profiles use the real create path; existing saves carry
  `expectedRevision` and surface conflicts instead of overwriting newer data.
- Library also reads active `/v1/memories` and supports creating a global,
  user-authored memory with optional confidence. Routine-scoped memories stay
  out of this simple surface until a real routine selector is present.
- The Runs signal now opens a real Task surface backed by `/v1/tasks`, with
  owner-scoped open-task reads and task creation that creates the linked Task
  Thread on the server. No task is marked complete by the UI without server
  state.
- The system signal also exposes configured Routines from `/v1/routines` and
  can trigger a selected routine through its idempotent `/run` endpoint. The
  UI reports the returned queued Run; it does not claim provider completion.
- Routine selection also exposes the real webhook lifecycle: create/rotate a
  one-time `whsec_` secret, copy the endpoint, and enable or disable delivery.
  The secret is never refetched or rendered after the one-time response.
- The top account control reads safe connected-account projections from
  `/v1/accounts` and starts the authenticated Google OAuth flow. OAuth and
  provider credentials remain server-side; an unconfigured deployment reports
  the API's explicit error instead of showing a fake connected account.
- The System Signal surface also exposes notification Channels from
  `/v1/channels` and supports creating channel metadata for email, webhook,
  Telegram, and WhatsApp. Delivery remains asynchronous and server-owned;
  saving a channel never claims a message was sent.
- The Run trail opens a read-only Operations audit view backed by
  `/v1/operations/audit`, with outcome filtering and opaque cursor pagination;
  audit records cannot be edited from the UI.
- Usage & Billing is read from `/v1/billing`; configured workspaces show the
  plan, credit band, period, and recorded category totals, while an absent
  billing provider renders the server's `not_configured` state.
- Need to Know is read from `/v1/suggestions`; the command center shows only
  server-recorded, provenance-bearing candidates and supports optimistic
  dismiss or atomic conversion into a real Task.
- Squares is read from `/v1/squares`; the command center shows explicit
  memberships and can create an owner-controlled workspace without granting
  implicit access or bypassing its policy boundary.

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
and revision-checked transitions; expired pending requests are hidden from the
pending view and cannot be accepted. Private Memory and credentials are never
shared by this clean-room protocol.

The command center exposes the same A2A envelope: send a request to an explicit
recipient, inspect pending/accepted state, and accept or decline with the
server's revision check. The UI never manufactures a recipient identity or a
result payload.

Authenticated Agent, Thread, Turn-read, Task, and InputRequest resources are
available under `/v1/agents`, `/v1/threads`, and `/v1/tasks`. Owner identity,
runtime role, Turn sequence, and source provenance are server-derived.

Routine Agents can be created, listed, and optimistically version-published
under `/v1/agents/routines`; their immutable active versions are then
referenced by `/v1/routines` schedules. An authenticated
`GET /v1/agents/routines/:agentId/versions` exposes the owner-scoped immutable
history used to audit which Routine configuration a schedule can execute.
Routine schedules can also create a one-time `rtnshare_…` token through
`POST /v1/routines/:routineId/shares`; the public
`GET /v1/routine-shares/:token` response contains only the shared schedule and
version snapshot, and the owner can revoke it through
`DELETE /v1/routines/shares/:shareId`. Tokens are hashed at rest and expire by
default after 24 hours.
An authenticated `POST /v1/routines/install` can fork a live share into a new
owner-scoped Routine Agent, immutable version, and schedule atomically. The
fork clears `callableRoutineIds`, so sharing a Routine never grants access to
the source workspace's child Routines.
An authenticated
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

Vercel deployments may set `CRON_SECRET` instead. `vercel.json` schedules the
same protected worker endpoint hourly, and Vercel supplies that secret as the
Bearer credential. The endpoint remains unregistered when neither secret is
present.

The current product objective is recorded in [GOAL.md](./GOAL.md).
