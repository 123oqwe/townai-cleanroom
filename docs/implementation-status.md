# Implementation status

This is the evidence ledger for the clean-room Town implementation. It keeps
observed behavior, engineering choices, and deployment state separate. A green
source row does not imply that an external provider is configured.

| Area                                     | Source status                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Honest boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and bearer sessions             | Implemented                   | `packages/identity`, API auth tests, transactional authoritative `ACCESS_ALLOWLIST_EMAILS` startup sync that disables removed addresses, authenticated `DELETE /v1/me/session` revocation and UI action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Requires a real database and session token at runtime                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Connected accounts and Google OAuth      | Implemented                   | `packages/identity`, PKCE OAuth start/callback tests with one-time state consumption and credential-backed account creation, Connected Accounts UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Provider credentials and redirect URI remain deployment configuration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Profile, Memory, People, Wiki            | Implemented                   | `packages/knowledge`, authenticated route tests, web editors, owner-scoped Person relationship graph edges                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | No external knowledge provider is invented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Agents, Threads, Tasks                   | Implemented                   | `packages/agents`, owner-scoped immutable Personal and Routine version history, task/thread tests, web surfaces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Assistant content is not fabricated when no worker is configured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Durable Sessions and Runs                | Implemented                   | `packages/runtime`, migration/transition/worker tests, owner-scoped bounded SSE event stream at `/v1/sessions/:sessionId/events/stream` with cursor replay and heartbeat; runtime worker exposes a bounded `runBatch` drain so Cron/long-running hosts can process multiple leased runs per tick                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Queue execution still needs a running worker and provider adapter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Codex-compatible Harness                 | Implemented                   | `packages/harness`, adapter tests, durable approval recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Private Town prompts/model routing are not claimed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Tool policy and approvals                | Implemented                   | `packages/tools`, lease-checked ToolCall lifecycle, MCP ToolDefinition normalization/bindings, and Harness MCP calls wired to durable propose/start/succeed/fail transitions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | External side effects remain approval-gated; authenticated MCP servers still need an explicit credential resolver                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Google Gmail/Calendar                    | Implemented                   | `packages/google`, API integration tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `OAUTH_NOT_CONFIGURED` is expected without deployment credentials                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Content, Channels, Billing, Operations   | Implemented                   | package repositories/API tests; Content Library kinds and explicit email/webhook/Telegram/WhatsApp/Slack/iMessage channel kinds; email outbox deliveries use an explicitly selected Google connected account and the real Gmail `messages/send` API; Telegram, WhatsApp Cloud API, and Slack delivery use credential references and provider HTTP requests; empty external credentials fail the delivery into retry state; retries are bounded at ten attempts; permanent 4xx/configuration failures are non-retryable; owner-scoped delivery observability API exposes failure and retry state; operations summary exposes failed-delivery backlog; committed delivery outcomes feed sanitized operations audit events; unified delivery/audit timeline endpoint with database-level stable cursor pagination; Responses provider usage is recorded in the owner-scoped idempotent model usage ledger only when the provider returns a response ID and explicit token counts; protected ElevenLabs TTS endpoint returns real `audio/mpeg` bytes when configured                                                                            | Provider-backed state is explicit when not configured; iMessage remains unsupported; provider pricing and credit conversion remain deployment policy; ElevenLabs credentials and voice/model selection remain deployment configuration                                                                                                                                                                                                                                                                                                                                                                                            |
| Routines and triggers                    | Implemented                   | `packages/routines`, immutable version history, share grants/install, documented stock-routine catalog at `GET /v1/routine-templates`, atomic template installation at `POST /v1/routine-templates/:templateId/install`, unified manual/incoming-email/calendar/voice/slack/webhook `queueTrigger`, typed `triggerType`/`triggerData`/idempotency fields, lease-claimed queued webhook scheduling, idempotent terminal-run replay, durable per-runtime `RoutineResult` records, runtime-run finalizer, authenticated Google Gmail ingestion and bounded worker polling with message-id idempotency, real Google Calendar Events polling with updated-version idempotency, Slack Events API `v0` signature verification plus URL challenge and durable `event_id`-based `app_mention` queueing, Twilio transcription callback signature validation and durable `voice_transcribed` queueing, Vapi transcript callback with bearer validation and durable `voice_transcribed` queueing, explicit outgoing-email notification association, routine-scoped webhook secret lookup plus content-type/size/idempotency guards, scheduler/API tests | The catalog intentionally does not claim Town's private prompts, model routing, or stock-routine tool graph; template installation requires an explicit cron/timezone/first-run time and configured database/Agent repository; Gmail/Calendar ingestion requires an active Google account, configured trigger, and OAuth credentials; Slack requires `SLACK_SIGNING_SECRET` and an installed routine mapping; Twilio voice requires `TWILIO_AUTH_TOKEN` and a configured transcription callback; Vapi requires `VAPI_WEBHOOK_SECRET`; telephony, speech recognition, and Town's private voice pipeline remain provider boundaries |
| Assistant-to-assistant (A2A)             | Implemented                   | `packages/a2a`, owner-scoped request lifecycle, optimistic revisions, recipient-only transitions, explicit scoped consent grant/deny/revoke persisted by migration `0039_a2a_consent.sql`, A2A repository tests and protected API route `/v1/a2a/requests/:requestId/consent`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | This is a clean-room consent envelope; Town's private cross-organization protocol, signatures, and field-level policy are not claimed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Need to Know candidate pipeline          | Implemented                   | `packages/suggestions.refreshCandidates`, protected `POST /v1/suggestions/refresh`, overdue owner-scoped tasks and next-24-hour enabled routines become deduplicated, persisted candidates; candidate integration test and browser refresh-before-list flow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Candidate rules are deterministic clean-room policy; Town's private ranking model, event fan-out, and scoring are not claimed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Content revision history                 | Implemented                   | Immutable `content_revisions` are exposed through owner-scoped `GET /v1/content/:contentId/revisions`; Library cards can expand revision history; revision ordering and owner isolation covered by content tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | No collaborative CRDT/OT protocol is claimed; edits remain optimistic-revision based                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Wiki revision history                    | Implemented                   | Knowledge API exposes owner-scoped `GET /v1/wiki/:documentId/revisions` through the existing citation-aware revision repository; API test covers ordered snapshots and authorization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Nightly Wiki upkeep, extraction models, and private ranking/index internals remain unclaimed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Tool outbound-risk preview               | Implemented                   | Protected `POST /v1/tools/policy/evaluate` exposes the deterministic policy engine's decision, rationale, and risk flags for private data, untrusted input, account targets, external communication, and destructive actions; API test covers the high-risk combination                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | This is the clean-room policy contract; Town's private scoring/feature flags are not claimed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Current web product surface              | Implemented                   | `apps/web`, `pnpm check:web`, desktop/mobile Chromium smoke tests, durable routine run/result history with replay action, channel credential/account configuration fields, server-truth delivery/audit timeline, paginated Need to Know cards, unified Home Schedule panel, browser-source deployment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | API base URL and bearer token must be supplied by the user; authenticated API workflows still require a configured account                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Wiki web surface                         | Implemented                   | Library dialog now lists owner-scoped Wiki pages, kinds, bodies, slugs, and current revision from `GET /v1/wiki`; browser contract and protected deployment checks pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Editing and nightly upkeep remain separate flows; no generated Wiki content is fabricated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Tool policy preview web surface          | Implemented                   | Connected accounts dialog previews the deterministic policy decision, rationale, and risk flags through protected `POST /v1/tools/policy/evaluate`; Web contract and protected deployment checks pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Preview is advisory only; tool execution and Town's private scoring internals are not claimed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Enabled tool catalog web surface         | Implemented                   | Connected accounts dialog lists the owner-scoped enabled tools from `GET /v1/tools` with version, side effect, data sensitivity, and account binding metadata; Web contract and protected deployment checks pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Catalog is descriptive; tool execution still follows the server-side Harness and approval state machine                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Centralized approval inbox               | Implemented                   | Owner-scoped `GET /v1/approvals` lists active pending approvals with frozen arguments and expiry; Connected accounts dialog resolves them through the existing CAS decision route; API and Web checks pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Approval decisions remain server-authoritative and require configured worker/provider execution to produce side effects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Task input-request inbox                 | Implemented                   | Owner-scoped `GET /v1/input-requests` lists pending task questions across active tasks; Connected accounts dialog answers through the existing task-scoped response route; API and Web checks pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Input requests are task-scoped and do not fabricate assistant answers; worker/task execution remains separately configured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Runtime user-input recovery              | Implemented                   | `session_runs.input_response` migration, atomic `answerInput` transition, owner-scoped `GET /v1/runtime-input-requests`, protected response route, Harness adapter replay of the stored answer, Runtime/API tests, and Web inbox surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Only explicit user answers resume a waiting run; model/provider execution still requires a configured worker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| MCP server catalog web surface           | Implemented                   | Connected accounts dialog lists owner-scoped MCP server names, URLs, transport, status, and whether an auth reference is configured from protected `GET /v1/mcp-servers`; Web contract and protected deployment checks pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Auth references are never rendered; creating, binding, and external MCP execution remain explicit server-side operations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| MCP Agent binding visibility             | Implemented                   | MCP catalog resolves the current Personal Agent version and owner-scoped `/v1/mcp-servers/bindings`; UI shows bound mode or an explicit unbound state without creating configuration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Binding creation/removal remains explicit server-side configuration; no external MCP call is fabricated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Personal Agent settings web surface      | Implemented                   | Profile dialog reads and revision-saves the owner-scoped Personal Agent display name, instructions, default approval mode, and preserves callable routine IDs through `GET/PUT /v1/agents/personal`; Web contract and protected deployment checks pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Publishing remains optimistic-revision based; private Town prompts/model routing are not claimed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Callable Routine selection web surface   | Implemented                   | Personal Agent settings loads real `/v1/routines`, selects callable routine IDs, and revision-saves them through `/v1/agents/personal` without inventing IDs; Web contract and protected deployment checks pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Routine execution still requires a configured worker and each selected routine's own schedule/input contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| MCP Agent binding management web surface | Implemented                   | MCP catalog binds or unbinds active servers to the current Personal Agent through existing owner-scoped POST/DELETE binding routes with revision checks; Web contract and protected deployment checks pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Binding does not test or invoke the remote MCP server; credentials remain server-side                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Current Vercel UI artifact               | Verified protected direct URL | `docs/deployment.md`, unauthenticated `302` SSO check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Generated project aliases currently remain public                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Production API deployment                | Deployed, protection verified | `api/index.js` lazy-loads the built function with structured `API_NOT_CONFIGURED` 503 fallback; `check:build-entries` validates package exports; `vercel.json`, `apps/api/src/index.ts` export the same built Vercel Function and hourly Cron worker; new Vercel project `townai-cleanroom` (`prj_6ogZiOqg2NLLO022FisesRLlA0lW`) created from commit `dc5ad92`, deployed as `dpl_FzfWmETq2YFpLqwS2jYhvogrebMs` in `READY` state; `vercel:protect` script enables SSO protection with plan-aware fallback (`all` → `all_except_custom_domains`); direct deployment URL returns `302` to Vercel SSO; production alias remains public due to Pro plan limitation                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Requires real PostgreSQL, encryption key, `CRON_SECRET`/worker secret, web origin, and project-level protection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Verification snapshot

The last completed full verification on 2026-08-04 (before the analytics event
migration) passed source-only policy, formatting, lint, typecheck, all 73 test
files (332 tests), and all workspace builds. After the analytics migration,
the focused database and operations regression suite passes 4 files / 9 tests;
the subsequent serial full-suite probe produced only passing dots for 22
minutes but was interrupted before Vitest emitted its final summary, so it is
not counted as a completed full-suite result. The current protected UI deployment is recorded in
[`deployment.md`](./deployment.md). This ledger now records the production API deployment as deployed and
protection-verified: a new Vercel project was created from current source,
deployed as production, and SSO protection was enabled (with plan-aware
fallback to all_except_custom_domains on the Pro plan). See
[`deployment.md`](./deployment.md) for the latest evidence. The production
alias remains public due to the Pro plan limitation; direct deployment URLs
are SSO-gated.

The full Vitest run used Testcontainers PostgreSQL and completed in about 286
seconds with 92/92 files and 452/452 tests passing. The repository inventory
therefore now has a fresh completed full-suite evidence point covering the
Harness model router, bounded knowledge context, Routine Step Executor, and
Wiki upkeep scanner rather than only a descriptive test count.

Routine version history is now exposed through the protected
`GET /v1/routines/:routineId/versions` route and the Routine dialog's immutable
version list. The route resolves the owner-scoped Routine Agent before reading
its versions; no private diff or generated history is claimed.

The Personal Agent version history surface is implemented: Profile lists
owner-scoped immutable versions from `GET /v1/agents/personal/versions`, with
version, creator, timestamp, and approval mode. It does not claim unverified
prompt diffs or private routing internals.

Square shared Connected Accounts are now surfaced in the Square inspector:
the Web client lists active shared references from `GET /v1/squares/:squareId/accounts`,
derives selectable capabilities from the user's real active account metadata,
and grants or revokes access through the existing protected routes. The UI
keeps capability selection explicit and does not expose credentials or invoke
external providers. `pnpm check:web` and `git diff --check` pass.

Square membership management is now surfaced alongside the inspector: admins
can add/reactivate a user by UUID and update the existing member role/status
through the protected Square routes. The UI renders the server's real
membership enum and leaves authorization to the repository policy.

People relationship graph controls are now surfaced in the People dialog:
the client selects persisted people, reads owner-scoped relationship edges,
creates typed edges with notes, and archives them using the server-provided
optimistic revision. No relationship or contact is fabricated. `pnpm check:web`
and `git diff --check` pass.

Durable memory cards now support inline edit and retire actions. Updates send
the server's current revision, preserve global/routine scope, and reload the
owner-scoped list after success; retire uses the existing revision-checked
delete route. No memory state is fabricated.

Square policy management is now editable in the inspector: the UI loads the
server policy revision, exposes the real `read_only`, `approval_required`, and
`autonomous` modes plus newline-separated allowed domains/tools, and PATCHes
with the expected revision. Stale policy writes remain server-rejected.

Notification channels now expose the existing owner-scoped disable action in
the Web surface. Active channel cards can be disabled through
`DELETE /v1/channels/:channelId`, then reload server truth; no provider
credentials or delivery result is fabricated.

Routine trigger state is now visible and controllable in the Routine dialog:
the client reads owner-scoped trigger kind/config/revision and enables or
disables triggers through the existing optimistic `PATCH /v1/routine-triggers`
route. It does not invent trigger configuration or provider events.

Routine triggers can now also be created from the Routine dialog. The UI uses
the server's trigger-kind contract, validates config as a JSON object, submits
to the protected owner-scoped create route, and reloads the authoritative
trigger list.

Routine triggers can now be removed from the same surface through the
revision-checked `DELETE /v1/routine-triggers/:triggerId` route. The client
reloads the authoritative list after removal and surfaces stale-write errors.

Content Library cards now expose the owner-scoped archive action through
`POST /v1/content/:contentId/archive`; after success the active list reloads
from the server, so archived content is not merely hidden in the client.

Content Library now supports creating owner-scoped content from the UI using
the server's real content-kind enum, title, body, and metadata contract. The
new item is persisted through `POST /v1/content` and the active list reloads
from server truth.

Content Collections now have an owner-scoped discovery route
`GET /v1/content/collections`, backed by the real repository query. The Web
Library can create collections, list them, and open a collection to read its
persisted items; it does not invent collection IDs or membership.

Collection detail now allows adding an active Library content item through
the existing owner-scoped collection-item route. The client filters already
included items from the selector and reloads the collection after the server
confirms the relation.

Content Library cards now support inline editing through the existing
revision-aware `PATCH /v1/content/:contentId` route. The client first fetches
the authoritative content item, preserves its MIME/storage/metadata fields,
and reloads after a successful save; stale revisions remain server-rejected.

People cards now support inline edit through the existing owner-scoped
`PUT /v1/people/:personId` route. The UI fetches the authoritative person
before editing, preserves organization/role, submits `expectedRevision`, and
reloads the list after success.

Wiki pages now support creation and inline editing in Library. Creation uses
the real `profile`/`goal`/`project`/`page` kind contract and the protected
`POST /v1/wiki`; edits fetch the authoritative document and use
revision-aware `PUT /v1/wiki/:documentId`, preserving server-side citations.

Task cards now support inline title/description/status edits through the
owner-scoped revision-aware `PATCH /v1/tasks/:taskId` route. The UI fetches the
authoritative task, preserves its scheduled time, and reloads the open-task
view after a successful update.

Routine schedules now support inline name/cron/timezone/next-run/enabled edits
and revision-checked deletion through the existing `PATCH/DELETE
/v1/routines/:routineId` routes. The UI preserves the routine's real agent and
agent-version bindings and reloads the schedule list after mutation.

Routine sharing is now available from the selected Routine: the UI creates a
24-hour token through `POST /v1/routines/:routineId/shares`, displays the
one-time share URL, copies it, and revokes it through the protected DELETE
route. Tokens and private routine internals are not exposed beyond the URL.

Task cards now expose the existing owner-scoped mark-read and revision-checked
delete actions. `POST /v1/tasks/:taskId/mark-read` and
`DELETE /v1/tasks/:taskId` are followed by a server-truth reload; no client-only
read or removal state is claimed.

Recipients can now install a shared Routine from the Routine dialog using the
real `rtnshare_…` token and first-run contract through
`POST /v1/routines/install`; the installed schedule is reloaded from the
owner-scoped server list.

Runtime transition requeue behavior is now verified to match the production
contract in source: `requeue` is only permitted from `running`, and requeued
runs emit `run_queued` events with explicit `{ retry: true, delayMs: ... }`
payloads after the queue lease and schedule are reset for the next attempt.

Connected Account cards now expose the existing provider refresh (Google only)
and owner-scoped remove actions. Credentials remain server-side; each action
reloads `/v1/accounts` and reports provider/configuration errors without
fabricating account state.

A2A request cards now expose lifecycle transitions after consent: accepted
requests can be marked completed and pending requests can be cancelled via the
existing revision-aware `PATCH /v1/a2a/requests/:requestId` route. Server-side
role and revision checks remain authoritative.
Knowledge conflicts now appear in Library from GET /v1/knowledge/conflicts. Each pending conflict shows the proposed snapshot and explicit Accept/Reject actions using expectedRevision via POST /v1/knowledge/conflicts/:conflictId/resolve. Server-side revision/citation application remains authoritative.
Routine details now expose Gmail ingestion through a selected connected Google account, optional Gmail query, and bounded max-message input calling POST /v1/routines/:routineId/ingest/email. Provider access, trigger configuration, idempotency, and queue creation remain server-authoritative.

Google Gmail polling now preserves the configured `email_to_assistant` trigger
kind instead of collapsing it into `incoming_email`. The database constraint,
routine repository, poller target contract, and idempotent queue path all carry
the distinct kind; the provider still requires an active Google account and a
deployment-specific assistant address. Trigger creation/update now requires a
valid `assistantAddress`, and Gmail queries append an address-bound `to:`
clause before enqueueing the untrusted message payload.
Approval inbox cards now support an explicit Inspect action that fetches the owner-scoped ToolCall record and shows its normalized name, status, side-effect class, data sensitivity, account binding, and arguments before a decision.
Content creation now exposes the complete server content-kind enum, including image, video, audio, and recording, with optional MIME type and storage key fields. The server still requires either body or storageKey and remains authoritative for persistence.

Content blob reads now have a real optional local filesystem adapter. `CONTENT_STORAGE_ROOT` binds storage keys to a resolved root, rejects absolute/traversal/symlink escapes, enforces a 50 MiB per-object limit, and infers common MIME types. Deployments without this setting remain explicit 503 rather than pretending that metadata is backed by durable bytes.

The same ContentStorage port now has a standards-based S3-compatible adapter. It performs real GET/PUT requests with AWS Signature V4, bounded response/request bodies, content-type propagation, 404-to-null reads, and fail-closed configuration validation. `CONTENT_STORAGE_S3_ENDPOINT`, bucket, region, access key, and secret must be supplied together; the runtime rejects partial or conflicting local/S3 configuration.

The Harness now has an optional `town_workspace` binding when `WORKSPACE_ROOT` is configured. It lists directories, reads bounded UTF-8 files, performs literal bounded `grep`, copies files, and performs atomic writes only after the existing approval pause/resume boundary. All paths are resolved under the workspace root, symlink escapes are rejected, binary files are not returned as text, and the binding is absent when no workspace is configured. This is a clean-room bounded file port; it does not claim Town's private E2B implementation.

An opt-in `town_code_run` binding now executes short JavaScript snippets in a separate Node child with the permission model enabled, no inherited secrets, no shell command, bounded timeout/output, and mandatory approval. It is controlled by `CODE_RUNNER_ENABLED=false` by default. This is an auditable local runner, not an assertion that Node's permission model equals a hardened E2B sandbox.

The production Responses adapter now consumes the existing Harness `ModelRouter` port when `RESPONSES_FALLBACKS_JSON` is configured. The primary route remains the current endpoint/model; each fallback is a real endpoint/model using the same configured API key, ordered by explicit priority, and attempted only after a provider rejection. Empty configuration preserves the single-route behavior, while malformed or overlarge route configuration fails startup rather than inventing a provider.

Authenticated owners can now upload a raw blob with `PUT /v1/content/:contentId/blob`. The route enforces the same 50 MiB bound, derives a stable key when an item has none, writes through the storage port, and records the key with an optimistic revision update. Vercel remains unconfigured for local filesystem persistence, so this capability is explicit rather than falsely durable there.

The Library UI now exposes a real file picker for Content creation. It creates the server-authoritative Content item, uploads the selected bytes through the authenticated blob route, clears the form only after both operations succeed, and surfaces provider/storage errors without claiming success. Browser smoke coverage confirms the new control is reachable from Library without console errors.

Library content cards now also expose an authenticated Open action. It fetches the owner-scoped blob, opens the actual response as a temporary object URL, revokes that URL after one minute, and reports HTTP/storage failures in the card instead of rendering a fabricated preview.
Notifications now expose owner-scoped delivery records with status filtering through GET /v1/notification-deliveries, alongside the existing audit timeline. The UI displays event type, channel, attempts, timestamps, and server-reported errors.
Approval Inspect now reads both GET /v1/tool-calls/:toolCallId and GET /v1/approvals/:approvalId, showing approval status/revision/expiry alongside immutable normalized ToolCall metadata before a decision.
Waiting Harness runs now expose Cancel run alongside Continue. Cancellation uses the existing owner-scoped POST /v1/sessions/:sessionId/runs/:runId/cancel transition and reloads server truth.
Profile Settings now expose immutable profile revision history from GET /v1/profile/history, including author, timestamp, revision and expandable server snapshots.
Selected Routines now expose their versioned Routine Agent display name, instructions, and default approval mode. Publishing uses owner-scoped revision-aware PUT /v1/agents/routines/:agentId; callable routines are preserved as an explicit empty list until separately configured.
Routine Agent publishing now also exposes the server-validated callableRoutineIds whitelist, excluding the selected agent itself and preserving only explicitly checked child routines.
MCP management now exposes owner-scoped server creation (name, URL, transport, optional auth reference) and revision-checked disable actions through POST/DELETE /v1/mcp-servers, alongside existing Agent binding controls.
MCP binding creation now exposes the real modeOverride and accountScope policy fields; the client submits explicit mode and account IDs instead of silently defaulting to null/empty policy.
Routine details now expose the generic owner-scoped external trigger queue via POST /v1/routines/:routineId/trigger, with explicit trigger kind, JSON data validation, and generated Idempotency-Key.
Harness now consumes the authenticated session event SSE endpoint for live run updates, aborting the stream when the user switches threads; existing polling remains as the reconnect fallback.

Connected Account cards now expose credential rotation through the existing
owner-scoped PATCH /v1/accounts/:accountId/credential route. Access and refresh
tokens are accepted only in a transient password form, sent over the
authenticated API, and cleared immediately after a successful encrypted server
write; they are never persisted in browser storage or rendered back into the
account card.

The Vercel API entrypoint now logs initialization failures server-side while
returning a fixed generic 503 response to callers. Database URLs, encryption
configuration, and parser details are no longer reflected in public error
payloads; the application still refuses to start without its real runtime
configuration.

The full-source Vercel build exposed and fixed a deployment compatibility issue:
the root Node engine constraint now accepts Node 20+ (the Vercel build
environment) instead of requiring Node 24. Local API and workspace builds remain
the verification gate; no deployment is called READY until the full source
build completes.

The subsequent Vercel build showed the host's pnpm version does not satisfy a
runtime engine constraint, so that redundant pnpm engine restriction was removed
while the packageManager pin remains for local reproducibility.

All workspace package manifests now declare zod 4.4.3 explicitly and the lock
file no longer relies on pnpm catalog syntax. This keeps dependency resolution
identical locally while allowing standard Vercel dependency detection to parse
the workspace lock file.

Workspace manifests now also expose standard npm workspaces and use equivalent
local file references for internal @town packages. pnpm continues to build the
same graph; npm-based hosts can now link every internal package instead of
installing only the root devDependencies.

Allowlisted identity now has a first-class API/UI entry point:
The `POST /v1/auth/session` endpoint validates email and timezone, delegates authorization to
the database-backed allowlist, and returns a bearer session only after the
server accepts the identity. The connection dialog can establish that session
without asking users to manually paste a token; existing token-based connection
remains available.

The public `GET /v1/health/capabilities` contract now distinguishes API/auth
availability from Harness provider, worker, and Google OAuth readiness without
exposing keys or environment values. The command center reads this capability
response and shows “Harness ready”, “Harness queued”, or “data only”, so a
connected database is not presented as an executable AI runtime when the
Responses provider or worker is unconfigured.

Notification recovery now has an explicit dead-letter replay boundary. A
terminal failed delivery (non-retryable or exhausted) can be replayed only by
its authenticated owner into a new queued delivery linked by
`replay_of_delivery_id`. The source failure remains immutable, the new request
uses its own idempotency key, and the replay is recorded in the operations audit
timeline. Non-terminal failures, disabled channels, and cross-owner requests
remain rejected.

The notification timeline now has its own wildcard-free authentication mount;
unauthenticated requests are rejected before the route can read an owner-scoped
operations repository. This closes the same nested-route class of boundary bug
previously fixed for connected-account mutations and delivery replay.

The clean-room admin health surface now exposes
`GET /v1/admin/agent-health/:userId` for deployment-configured administrator
emails only (`ADMIN_ALLOWLIST_EMAILS`). It reports a safe user projection,
runtime readiness flags, and owner-scoped Operations backlog counts. It does
not claim Town's private admin implementation and never returns prompts,
credentials, or provider payloads; an empty admin allowlist denies the route.

The same admin boundary now exposes
`GET /v1/admin/billing-reconciliation/:userId` with a bounded period, internal
usage-ledger totals, and current Billing state. External payment data is never
invented: `reconciliation.externalProvider` and `discrepancy` remain explicitly
`not_configured`/`null` until a real provider adapter exists.

The admin user surface now exposes `GET /v1/admin/users/:userId` with a safe
identity projection, active resource counts, and connected-account metadata.
Credential material and private knowledge content remain excluded by contract;
the endpoint is unavailable to users outside the deployment admin allowlist.

The corresponding admin team surface now exposes
`GET /v1/admin/teams/:squareId` with a safe Square projection, owner identity,
membership-state counts, and policy mode/revision. It is read-only and does not
grant membership or expose connected-account credentials.

The Harness dialog now consumes the same readiness contract before creating a
thread or queuing a turn. When the worker is not configured, the composer and
thread controls are disabled and the UI explains that data/settings remain
available; it does not present a queue action that cannot execute.

Public content and Routine share tokens now support a browser-readable HTML
representation when the request advertises `Accept: text/html`. API clients
continue to receive the existing JSON envelopes. The renderer escapes all
user-controlled title, body, instructions, and schedule metadata; token
expiry, revocation, and active-content checks remain in the repositories.

The allowlisted administrative overview is now available at
`GET /v1/admin/overview`. It returns deployment-database aggregate counters for
users, connected accounts, sessions, runs, approvals, deliveries, Squares, and
recent failed audit events, plus explicit readiness flags. It never returns
credentials, prompts, or provider payloads; this is a clean-room operational
surface rather than a claim about Town's private admin console.

The admin report surface now exposes `GET /v1/admin/reports/:slug` as a read-only
aggregate endpoint for operational and capacity snapshots (`overview`, `runtime`,
`delivery`, `safety`, `teams`, `content`, `billing`). It resolves safe
readiness flags and precomputed counts only. Unknown slugs return
`REPORT_NOT_FOUND` with a 404, which keeps the endpoint explicit and avoids
implicit schema leakage for unsupported report types.

Harness now also exposes a provider-neutral model router with explicit
`interactive`, `routine`, and `compaction` operation classes. Routes are sorted
by configured priority, disabled routes are excluded, and fallback occurs only
after a provider port rejects; an operation with no enabled route fails
explicitly. `createResponsesAgentFactory` can consume this router while the
default single Responses model remains available. This is an honest routing
boundary and does not claim Town's private model scores, prompts, or provider
selection weights.

Knowledge context construction is now a first-class owner-scoped contract at
`GET /v1/knowledge/context` and the Harness `town_context` tool. It reuses the
real PostgreSQL full-text search results, preserves citations, emits a bounded
plain-text context block, and marks cursor/budget truncation explicitly. It
does not summarize, invent, or cross owner boundaries; model-side compression
remains an injected provider responsibility.

Routine step execution now has a public `createRoutineStepExecutor` wrapper
around `routine_step_results`. It returns completed outputs from cache, claims
new or previously failed steps, persists successful JSON output, records
bounded failures, and rejects concurrent running work explicitly. This makes
the durable Step cache executable by routine adapters rather than only
inspectable through the repository; it still requires a caller-provided
Routine adapter and does not claim Town's private step graph or retry policy.

Wiki upkeep now has a protected read-only scanner at
`GET /v1/knowledge/upkeep`. It reports owner-scoped active memories that are
expired or not observed recently and active Wiki documents not updated within
the requested window, with current revisions and timestamps. It never writes,
retires, summarizes, or invents replacement content; any future provider job
must submit a cited, revision-aware conflict through the existing knowledge
service.

The serverless API fallback now validates runtime readiness semantically rather
than only checking variable presence: `DATABASE_URL` must use PostgreSQL,
`CREDENTIAL_MASTER_KEY_BASE64URL` must decode to exactly 32 bytes, and
`WEB_ORIGIN` must be an HTTP(S) URL. Malformed deployments therefore report
`api:false`/`auth:false` and retain the generic `API_NOT_CONFIGURED` boundary
instead of claiming an executable API.

The unauthenticated capability probe now reports provider readiness separately
for `slackEvents`, `twilioVoice`, and `voiceSynthesis`. These flags only reflect
the presence of the corresponding deployment credentials; they do not claim
that a provider account, callback mapping, or external quota is valid.

Routine webhook ingestion now rejects bodies over 256 KiB with `413`, malformed
JSON with `400`, and does so before calling the durable repository. Valid
payloads retain the existing bearer-secret and `X-Town-Idempotency-Key`
contract, and each webhook is limited to 60 new deliveries per rolling minute
using its locked durable delivery rows. Rate-limited requests return a typed
`429`; this is a clean-room reliability boundary, not a claim about
Slack/Voice provider-specific signatures.

Runtime worker draining is now explicitly bounded: `WORKER_BATCH_SIZE` accepts
1–100 (default 10), and the protected worker endpoint/local loop calls
`runBatch` until the queue is empty or the bound is reached. This reduces
backlog amplification without creating an unbounded serverless invocation;
provider/model execution remains the injected adapter boundary.

Runtime worker execution now recovers from lease or startup race failures by
re-queuing the current run with a short fixed `retry` delay when the lease
is valid but the run fails before entering the explicit `started` transition.
This preserves durable progress while avoiding a permanent stuck lease when a
worker process restarts or a transition precondition fails between claim and
state bump.

Slack inbound events now have a real provider adapter at
`POST /v1/integrations/slack/events/:routineId`. It verifies the exact raw body
with Slack's `v0` HMAC signature and five-minute replay window, answers URL
verification challenges, ignores unsupported event types, and queues
`app_mention` callbacks with Slack's durable `event_id` as the idempotency key.
The signing secret is deployment configuration; no Slack credentials or
private Town routing are fabricated.

Voice transcription callbacks now have a Twilio adapter at
`POST /v1/integrations/twilio/voice/:routineId`. It validates the full request
URL plus sorted form parameters with `X-Twilio-Signature`, requires a
transcription and `CallSid`, and queues `voice_transcribed` with
`TranscriptionSid`/`CallSid`-based durable idempotency. It does not claim to
implement telephony or speech recognition itself; those remain Twilio and
provider configuration boundaries.

Voice output now has a provider port at `POST /v1/voice/synthesize` and the
optional Harness tool `town_voice_speak`. The ElevenLabs implementation sends
the requested text to the configured voice and returns the provider's actual
`audio/mpeg` bytes; the Harness tool is approval-gated and missing credentials
keep both surfaces absent rather than returning placeholder audio.

The Harness transcript now gives each assistant turn a small play control. It
requests `/v1/voice/synthesize` with the authenticated session, plays the
returned audio blob locally, and stops/replaces the previous playback. A
provider-unconfigured API therefore produces an explicit error state instead
of a fake browser-side voice.

Vapi phone events now have a provider adapter at
`POST /v1/integrations/vapi/voice/:routineId`. It accepts the documented
`message.type` envelope for `transcript` and `end-of-call-report`, extracts a
user transcript and call id, authenticates with a deployment bearer secret,
and queues a durable `voice_transcribed` trigger. It intentionally does not
claim Vapi call orchestration or undocumented signature semantics. The
adapter accepts both the current configurable bearer `Authorization` form and
Vapi's documented legacy `X-Vapi-Secret` form, and the Routine webhook secret
is bound to the requested routine id.

The Harness now includes a real `town_web_fetch` read tool. It follows at most
two public HTTP redirects, blocks localhost/private address patterns, enforces
a ten-second request timeout and bounded text output, strips executable HTML
content, and labels the returned page text as `untrusted_data`. It does not
claim Town's private browser automation or sandbox implementation.

Content media now has an owner-scoped `GET /v1/content/:contentId/blob` read
boundary. It requires a configured storage adapter, verifies ownership through
the Content repository, returns the provider's actual bytes with a private
no-store response, and fails explicitly when storage or the object is absent;
the API never fabricates file data.

Content share tokens can now retrieve stored media through
`GET /v1/content-shares/:token/blob`. The token resolver remains the only
authorization boundary, storage keys stay server-side, and the same explicit
503/404/409 states apply when storage or a blob is unavailable.

Owner-scoped analytics events are now persisted through `POST
/v1/analytics/events` and listed through `GET /v1/analytics/events`. The
repository applies the same bounded metadata and sensitive-key rejection used
by operations audit events, supports idempotent dedupe keys and stable cursor
pagination, and never forwards event payloads to an unconfigured third party.
This records the observed product-analytics contract without claiming Town's
private event taxonomy or downstream Axiom pipeline.

Presence is now persisted through `POST /v1/presence/heartbeat` and queried
through `GET /v1/presence`. Heartbeats upsert by owner/session, retain only
bounded client metadata, expire after a bounded interval, and never expose
another owner's sessions. This is the durable presence boundary observed in
the product; a Convex-compatible multiplexed WebSocket transport is not
claimed yet.

Billing state now gates new assistant message submissions when an explicitly
configured owner account is blocked: `POST /v1/threads/:threadId/messages`
returns a structured `402 BILLING_BLOCKED` response before creating a queued
run. Unconfigured billing remains backward-compatible and does not pretend to
enforce credits; queued work is not silently deleted when a later block is
provisioned.

The observed unauthenticated web-vital path now has a separate
`POST /v1/analytics/public/events` ingestion boundary. It accepts only an
opaque client session key, bounded event metadata, and an optional idempotency
key; it stores no IP, cookie, credential, or user-agent identity and returns a
minimal receipt. Owner analytics remain authenticated and isolated. Town's
private downstream analytics transport and event taxonomy are not claimed. The
public session is additionally limited to 100 writes per rolling minute in
the durable store and returns `429` after the bound.

Runtime workers now expose an explicit opt-in retry policy for provider
adapters. An adapter must throw the exported `RetryableRuntimeError`; the
worker then requeues the leased run with bounded exponential backoff only
within a 2–10 attempt budget. Ordinary errors remain terminal failures, so
external side effects are never retried by assumption. The runtime worker reads
optional `WORKER_RETRY_MAX_ATTEMPTS` and `WORKER_RETRY_BASE_DELAY_MS`
environment variables and enables this behavior only when both are present.
Harness transport failures that are clearly transient (connection/timeouts,
server-side dispatch failures) are now mapped to the same retry boundary via
`RetryableRuntimeError`, so durable runs can be re-queued for bounded
recovery without inventing additional retry assumptions. This is a clean-room
retry boundary rather than a claim about Town's private retry classifier.

Admin operations now expose `GET /v1/admin/routines/:slug` with read-only
aggregates for routine schedules, triggers, sync runs, webhook deliveries, and
share grants. The route set mirrors Town's surface with production-safe counters,
owner-safe readiness/status fields, and period-gated time-window slices where
applicable.
