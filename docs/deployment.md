# Deployment evidence

The command center UI was deployed to a protected Vercel preview from the
pushed source state `411bf16`.

- Project: `town-clear`
- Deployment: `dpl_G4KfdNtHkpe1F7kkC1qyZ6ohR1g7`
- Preview hostname: `town-clear-47rzf1bv0-123oqwes-projects.vercel.app`
- State: `READY`
- Access check: an unauthenticated fetch receives a Vercel SSO `302` redirect;
  deployment protection was not disabled.

The UI remains API-configurable through its connection dialog. Production API
deployment is intentionally pending until a real PostgreSQL URL,
`CREDENTIAL_MASTER_KEY_BASE64URL`, and an approved production `WEB_ORIGIN` are
available. No placeholder credentials or fabricated server state are used.

The preview was created with Vercel's deployment connector. The first tiny
probe deployment was superseded by the full UI deployment and is not used as a
release artifact.

A production-target UI deployment was also created for smoke validation:

- Deployment: `dpl_6TBYK3KFzWjjj1TvjvWQ4bnunhby`
- Production alias: `https://town-clear.vercel.app`
- State: `READY`
- Access check: unauthenticated fetch currently returns `200` (public).

This production deployment is therefore **not accepted as the final release**
until project-level Deployment Protection is enabled for all deployments. The
protected preview above remains the only accepted hosted artifact at this
stage. Vercel's documentation states that protecting production domains with
"All Deployments" requires a plan that supports production Deployment
Protection; the project setting must be verified before claiming a restricted
production release.

The available Vercel API credential was verified as the `123oqwe` account, but
the REST API cannot resolve the connector-created `town-clear` project or its
deployment IDs. The deployment connector exposes no project-settings mutation
endpoint, so enabling protection requires reconnecting the project to the
owner's Vercel API scope (or enabling the setting in the Vercel dashboard).

The API entrypoint now exports the Hono app as the default from
`apps/api/src/index.ts` when `VERCEL=1`; local development still uses the Node
server listener. This keeps serverless invocation separate from local process
shutdown and does not weaken the API's database or authentication requirements.

## Current verification snapshot

The source repository has since advanced beyond the hosted preview to commit
`6bc92cf`, including the Harness, Knowledge, People, Memory, Task, Routine,
Connected Accounts, Channels, Billing, Suggestions, Squares, Square policy
detail, the built Vercel API entrypoint, the hourly worker Cron, A2A expiry
enforcement, the A2A command center, Content share controls, Operations audit
view, and Routine webhook controls. A fresh unauthenticated check still
shows:

- the preview hostname above returns `302` to Vercel SSO;
- `https://town-clear.vercel.app` returns `200` without an SSO redirect.

The preview is therefore protected but stale, while the production alias is
public. Neither is accepted as the final release until a deployment built from
the current source is protected for all deployments. This distinction keeps
hosted state from being represented as newer than the verified source.

## Latest current-source deployment

Using the Vercel deployment connector, the current command center and API
Function were deployed from the verified source files at:

- Deployment: `dpl_i6tnqHzEANd8LiM9yLPBKXb2zHjL`
- Protected direct URL: `https://town-clear-current-imwqo8q0i-123oqwes-projects.vercel.app`
- State: `READY`
- Direct URL access check: unauthenticated request returns `302` to Vercel SSO.
- Generated project aliases currently return `200` publicly and are not accepted
  as restricted release URLs.

The protected direct URL is the current minimal hosted artifact, now including
the Vercel API Function. The API remains operationally unconfigured until a
real PostgreSQL connection, credential-encryption key, worker secret, and
approved web origin are supplied; no request-level API success is claimed from
the SSO-only smoke check.

The latest Vercel build's error-only log contains no TypeScript diagnostics;
it reports only the Node engine warning and a successful build completion.

The source also declares an hourly Vercel Cron for `/v1/internal/worker`.
Cron execution is only effective after the deployment supplies `DATABASE_URL`,
`CREDENTIAL_MASTER_KEY_BASE64URL`, and `CRON_SECRET` (or `WORKER_SECRET`).

The API also accepts `ACCESS_ALLOWLIST_EMAILS` at deployment startup. It
idempotently enables the listed email rows in `access_allowlist`; an empty value
preserves database state, and unlisted rows are never disabled or deleted
automatically. This is application-level access control and does not replace
Vercel project-level Deployment Protection.

This deployment also contains the owner-scoped Routine Agent version-history
endpoint (`GET /v1/agents/routines/:agentId/versions`); direct unauthenticated
requests to the preview hostname still receive a Vercel SSO `302`.

It also includes the Routine share grant migration and API. The share token is
hashed at rest, expires by default after 24 hours, and the public share route
returns `404` after owner revocation or expiry.

The authenticated `/v1/routines/install` endpoint atomically forks a valid
share into a new owner-scoped Agent, immutable Version, and Schedule. It clears
the source `callableRoutineIds` allowlist so child-Routine permissions do not
cross the workspace boundary.

This deployment also includes the expanded Content Library kind constraint and
the `0027_content_library_kinds.sql` migration; unauthenticated requests to
the preview hostname still return a Vercel SSO `302`.

It also includes the `0028_person_relationships.sql` migration and the
owner-scoped Person relationship routes; no relationship can be created with
people belonging to a different owner.

This version also includes the `0029_notification_channel_kinds.sql` migration
and explicit Slack/iMessage channel kinds. Channel creation still only records
metadata; delivery remains an outbox/provider state transition.

It also includes the `0030_routine_triggers.sql` migration and revision-checked
Routine trigger definitions for Manual, Schedule, email, calendar, voice,
Slack mention, and Webhook trigger kinds. Definitions do not imply provider
execution.

The latest current-source deployment is `dpl_8cbF36Tv1xFGKx3FmFkJHsLRhDd2`,
built from commit `808834c`. Its protected direct URL is
`https://town-clear-current-eb0lqssuy-123oqwes-projects.vercel.app` and its
state is `READY`. It includes `0031_mcp_servers.sql` and the owner-scoped
`/v1/mcp-servers` metadata API. The API records HTTPS endpoint metadata,
transport, and an optional non-secret credential reference; it does not claim
remote MCP execution or automatic trust. An unauthenticated curl to the direct
URL still receives the Vercel SSO `302` protection redirect.

MCP servers can also be explicitly bound to an immutable AgentVersion through
`POST /v1/mcp-servers/:serverId/bindings`; effective bindings are owner-scoped,
revision-checked, and filtered to active servers. This records enablement only;
the runtime still requires an explicit MCP transport adapter before any remote
tool call can occur.

The binding module is deployed in `dpl_3YkKjTonKCkpD5cZroyr6bmq6eWa`, built
from commit `8e5d2c8`. Its protected direct URL is
`https://town-clear-current-2r5db99u5-123oqwes-projects.vercel.app`, state
`READY`; an unauthenticated curl receives the Vercel SSO `302` redirect.

The final ownership-hardening fix is deployed in `dpl_5Wm5ud8oL6Jv9RyLbGdBL97zefQZ`,
built from commit `e313e60`. Its protected direct URL is
`https://town-clear-current-idv8i0k9k-123oqwes-projects.vercel.app`, state
`READY`; an unauthenticated curl also receives the Vercel SSO `302` redirect.

The MCP transport client is deployed in `dpl_Hs6Hy2UeMfm74MyVjxudCt4JKfss`,
built from commit `9abdd90`. Its protected direct URL is
`https://town-clear-current-6hngpb13p-123oqwes-projects.vercel.app`, state
`READY`; error-only build logs contain no diagnostics beyond the Node engine
warning and the unauthenticated URL check returns the Vercel SSO `302`.

The Harness policy integration is deployed in `dpl_7AT7hu75FTqSzdrFfqie8Sm6wHcR`,
built from commit `c6fdcbc`. Its protected direct URL is
`https://town-clear-current-e2f79wif8-123oqwes-projects.vercel.app`, state
`READY`; the unauthenticated URL check returns the Vercel SSO `302`.

The durable ToolCall lifecycle is deployed in `dpl_2X8F9qVSkXxv3yUUfTUS4v6gEzef`,
built from commit `9e9f008`. Its protected direct URL is
`https://town-clear-current-eg68of1pn-123oqwes-projects.vercel.app`, state
`READY`; error-only build logs contain only the Node engine warning and the
unauthenticated URL check returns the Vercel SSO `302`.

MCP ToolDefinition normalization is deployed in
`dpl_7Qf1BzcKHQo5KnPAU6JurMxHXUef`, built from commit `3ce6573`. Its protected
direct URL is `https://town-clear-current-370sg6u7f-123oqwes-projects.vercel.app`,
state `READY`; the unauthenticated URL check returns the Vercel SSO `302`.

Durable MCP execution is deployed in
`dpl_4M2GHKXByJJH7nKFgZTET9ZGyz1i`, built from commit `c88e80e`. Its protected
direct URL is `https://town-clear-current-kmjn76ap3-123oqwes-projects.vercel.app`,
state `READY`; approved leased MCP calls now create, start, and complete/fail a
durable ToolCall, and the unauthenticated URL check returns the Vercel SSO
`302`.

Routine result persistence is deployed in
`dpl_4o14wgFQNC8n531qMPk9wwvUZRmw`, built from commit `06661d3`. Its protected
direct URL is `https://town-clear-current-3ohxxsy50-123oqwes-projects.vercel.app`,
state `READY`; the deployment includes `0033_routine_results.sql`, the
owner-scoped `/v1/routine-results?sessionId=...` read API, and an unauthenticated
curl still receives the Vercel SSO `302` protection redirect.

Runtime-to-routine result finalization is deployed in
`dpl_DeLojFea4rTcEzrUK4tAjqazZYCF`, built from commit `3b8509f`. Its protected
direct URL is `https://town-clear-current-gjrsrjw6g-123oqwes-projects.vercel.app`,
state `READY`; only runtime runs linked to a routine schedule produce a
RoutineResult, and the unauthenticated URL check returns the Vercel SSO `302`.

Typed routine trigger data is deployed in
`dpl_A4ez9U7ozhWoybd98cFcgEvfjf5a`, built from commit `2c1679d`. Its protected
direct URL is `https://town-clear-current-5mtxcrmji-123oqwes-projects.vercel.app`,
state `READY`; `0034_routine_trigger_data.sql` records trigger type, payload,
and idempotency key, while the unauthenticated URL check returns the Vercel SSO
`302`.

Queued webhook trigger claiming is deployed in
`dpl_3Vn8YLN5zEsi5ngwH2nSSd6TA194`, built from commit `e880983`. Its protected
direct URL is `https://town-clear-current-isikp0w1h-123oqwes-projects.vercel.app`,
state `READY`; `0035_routine_run_claims.sql` adds lease-checked trigger claims,
and the unauthenticated URL check returns the Vercel SSO `302`.

Idempotent terminal-run replay is deployed in
`dpl_2ff7iD5FukjHyuEg3n4LTvouYfAN`, built from commit `3133531`. Its protected
direct URL is `https://town-clear-current-6orqnhp0q-123oqwes-projects.vercel.app`,
state `READY`; `0036_routine_run_replays.sql` creates new queued runs linked to
their source, and the unauthenticated URL check returns the Vercel SSO `302`.

Unified manual/email/calendar trigger submission is deployed in
`dpl_5Z5eRkXwqLsu4S54KFAA7cbssfiq`, built from commit `9df9d16`. Its protected
direct URL is `https://town-clear-current-cdt2gos38-123oqwes-projects.vercel.app`,
state `READY`; `0037_routine_trigger_idempotency.sql` protects typed trigger
keys, and the unauthenticated URL check returns the Vercel SSO `302`.

Routine run result replay/audit detail is deployed in
`dpl_4GGaU4p5GtyGeQDYZ6nYkiweYteA`, built from commit `14cded8`. Its protected
direct URL is `https://town-clear-current-qbb88jz91-123oqwes-projects.vercel.app`,
state `READY`; `GET /v1/routine-runs/:runId` returns the owner-scoped trigger
record and linked `RoutineResult`, and an unauthenticated curl receives the
Vercel SSO `302` protection redirect.

Authenticated Google Gmail routine ingestion is deployed in
`dpl_KadHEXdkhHzGfFSJisfbkZf53nmu`, built from commit `55013ff`. Its protected
direct URL is `https://town-clear-current-73t2ym70o-123oqwes-projects.vercel.app`,
state `READY`; the build includes the real Gmail search/fetch to
`POST /v1/routines/:routineId/ingest/email`, and an unauthenticated curl
receives the Vercel SSO `302` protection redirect.

Bounded Gmail connector polling is deployed in
`dpl_WesqgsLUbMJJgrP9cLuD7UoF6zyc`, built from commit `e9cb731`. Its protected
direct URL is `https://town-clear-current-3nl0c4wfs-123oqwes-projects.vercel.app`,
state `READY`; the local worker and protected internal worker tick now poll
enabled Gmail triggers with the same message-id idempotency key, and an
unauthenticated curl receives the Vercel SSO `302` protection redirect.

Google Calendar Events ingestion and polling is deployed in
`dpl_U8KaoqAvRHfshFiNpUWyryLN9bNL`, built from commit `bc46bc5`. Its protected
direct URL is `https://town-clear-current-1l4c6vf4s-123oqwes-projects.vercel.app`,
state `READY`; Calendar event windows and provider `updated` versions are
queued through the durable calendar trigger path, and an unauthenticated curl
receives the Vercel SSO `302` protection redirect.

Routine result notification association is deployed in
`dpl_4TePvSDqiNQ6CGXp4cgefkEuSb3e`, built from commit `a9f732f`. Its protected
direct URL is `https://town-clear-current-g4ojisa30-123oqwes-projects.vercel.app`,
state `READY`; explicitly configured `outgoing_email` triggers now enqueue and
link idempotent notification outbox records, while an unauthenticated curl
receives the Vercel SSO `302` protection redirect.

The command-center UI result-trace and replay surface is deployed in
`dpl_7DUw77UgUsmkREa5ekjxGhfsB55x`, built from commit `774efeb`. Its protected
direct URL is `https://town-clear-current-klu0uyk9y-123oqwes-projects.vercel.app`,
state `READY`; selected routines now show server-backed run/result history and
terminal replay actions, and an unauthenticated curl receives the Vercel SSO
`302` protection redirect.

The command-center signal-state/browser smoke-test fix is deployed in
`dpl_2NBkKpVntDiUtSNh2nA4sanKokYh`, built from commit `3f0fd87`. Its protected
direct URL is `https://town-clear-current-jd2jpbxty-123oqwes-projects.vercel.app`,
state `READY`; desktop and mobile Chromium smoke tests now load without page
errors, and an unauthenticated curl receives the Vercel SSO `302` protection
redirect.

The Vercel API entrypoint/build-entrypoint hardening is deployed in
`dpl_AXVK6TxongC6yFdgkbKM26Le9uJ1`, built from commit `c254980`. Its protected
direct URL is `https://town-clear-current-ihq3o4nds-123oqwes-projects.vercel.app`,
state `READY`; the entrypoint now returns a structured `503 API_NOT_CONFIGURED`
response when required infrastructure secrets are absent, and the build checks
that every workspace package `main` export exists after compilation. An
unauthenticated curl receives the Vercel SSO `302` protection redirect.

Routine email outbox delivery through the real Gmail API is deployed in
`dpl_AHUPuHbQNAk7G62nzxKDkapMk6BT`, built from commit `e91f3f0`. Its protected
direct URL is `https://town-clear-current-m824er7rx-123oqwes-projects.vercel.app`,
state `READY`; email channels require an explicit connected Google account and
the worker calls Gmail `messages/send`, while missing provider configuration is
recorded as a retryable delivery failure. An unauthenticated curl receives the
Vercel SSO `302` protection redirect.

Credential-backed Telegram, WhatsApp Cloud API, and Slack channel delivery is
deployed in `dpl_mkMwTVXZcrupwXKzy7ZqwkYYVdG6`, built from commit `d72e9df`.
Its protected direct URL is
`https://town-clear-current-8ynuzrk1y-123oqwes-projects.vercel.app`, state
`READY`; provider secrets are resolved from the deployment's
`CHANNEL_CREDENTIALS_JSON` map and are never stored in channel rows. An
unauthenticated curl receives the Vercel SSO `302` protection redirect.

The reconnectable runtime event stream is deployed in
`dpl_gTd62K77pNWSwdsSNwigqj8nThsS`, built from commit `0cc7920`. Its protected
direct URL is
`https://town-clear-current-ohr4l9gsh-123oqwes-projects.vercel.app`, state
`READY`; authenticated clients can consume bounded owner-scoped SSE windows
with cursor replay and heartbeats, while an unauthenticated curl receives the
Vercel SSO `302` protection redirect.

Extended durable Routine trigger types are deployed in
`dpl_3R11qvELidkMSFHAqwVU5m2ZV1Mk`, built from commit `4c9e2df`. Its protected
direct URL is
`https://town-clear-current-ll4yxoo98-123oqwes-projects.vercel.app`, state
`READY`; `voice_transcribed`, `slack_mention`, and `webhook` now pass the same
owner-scoped idempotent queue and database constraint path as manual, email,
and calendar triggers. An unauthenticated curl receives the Vercel SSO `302`
protection redirect.

The channel credential/account configuration UI is deployed in
`dpl_7Un8xSa93ZykLfPmjXNJGKt3C5Fn`, built from commit `6a53822`. Its protected
direct URL is
`https://town-clear-current-kd3zxmk4b-123oqwes-projects.vercel.app`, state
`READY`; the UI exposes only public account/reference fields and never asks for
provider secrets. An unauthenticated curl receives the Vercel SSO `302`
protection redirect.

Authoritative access-allowlist synchronization is deployed in
`dpl_ABzxvVaPFtQaVZ9sZXWKnUbxnhvn`, built from commit `1f886cd`. Its protected
direct URL is
`https://town-clear-current-kirf2zlcc-123oqwes-projects.vercel.app`, state
`READY`; removed addresses are transactionally disabled so old sessions cannot
authenticate against a stale allowlist. An unauthenticated curl receives the
Vercel SSO `302` protection redirect.

Authenticated session revocation is deployed in
`dpl_EW8GLYkffgir8Gprw9YjD6F67ECG`, built from commit `f880267`. Its protected
direct URL is
`https://town-clear-current-ij0a24p2l-123oqwes-projects.vercel.app`, state
`READY`; `DELETE /v1/me/session` revokes the current bearer session and the UI
exposes the same action. An unauthenticated curl receives the Vercel SSO `302`
protection redirect.

The Google OAuth callback redirect-state fix is deployed in
`dpl_766eUTeEsZJwxc9EQjyGFi9YXDnL`, built from commit `4f46413`. Its protected
direct URL is
`https://town-clear-current-1xlzalyjq-123oqwes-projects.vercel.app`, state
`READY`; the callback consumes PKCE state once, exchanges the code using the
stored redirect URI, and persists the connected account through the encrypted
account repository. An unauthenticated curl receives the Vercel SSO `302`
protection redirect.

Empty external channel credentials are rejected and isolated as retryable
delivery failures in deployment `dpl_CfpgFCBDzkDqM4iqa2zhfxB5pKiL`, built from
commit `e2a555b`. Its protected direct URL is
`https://town-clear-current-dbgcxm1dg-123oqwes-projects.vercel.app`, state
`READY`; an unauthenticated curl receives the Vercel SSO `302` protection
redirect.

Notification delivery retries are bounded at ten attempts in deployment
`dpl_6KhGezLKmFnNSzjWGVrppxYTjPLG`, built from commit `047e3fe`. Its protected
direct URL is
`https://town-clear-current-1km8bk7dq-123oqwes-projects.vercel.app`, state
`READY`; exhausted deliveries remain failed without a future retry timestamp.
An unauthenticated curl receives the Vercel SSO `302` protection redirect.

Permanent provider failures (for example HTTP 401) are now classified as
non-retryable in deployment `dpl_BxbvFnNGqAYyPJuFrG5wx7nXUmEK`, built from
commit `dcf3e80`. Its protected direct URL is
`https://town-clear-current-3fsc8fhvp-123oqwes-projects.vercel.app`, state
`READY`; transient 408/425/429/5xx responses and network errors remain
retryable. An unauthenticated curl receives the Vercel SSO `302` protection
redirect.

Owner-scoped notification delivery observability is deployed in
`dpl_A5o32KqcQXdJRNFYQx1YJVqXSBbF`, built from commit `a546f41`. Its protected
direct URL is
`https://town-clear-current-l2c4ri0jr-123oqwes-projects.vercel.app`, state
`READY`; `GET /v1/notification-deliveries` exposes status, attempts, lastError,
retry time, and sent time with optional status/limit filters. An unauthenticated
curl receives the Vercel SSO `302` protection redirect.

The operations summary now includes an owner-scoped `failedDeliveries` backlog
metric in deployment `dpl_6XsXjeP9F3ASaWv2ZvM7w2ckaoyp`, built from commit
`e9f291a`. Its protected direct URL is
`https://town-clear-current-nvdoyqbxo-123oqwes-projects.vercel.app`, state
`READY`; this metric is separate from queued work so permanent provider
failures can drive an alert without being mistaken for active queue depth. An
unauthenticated curl receives the Vercel SSO `302` protection redirect.

Delivery outcomes are now linked to the operations audit stream in deployment
`dpl_EPXvtSnFm9Ed5yKAQB3c24Uj7Zbf`, built from commit `520c569`. Its protected
direct URL is
`https://town-clear-current-k3rekbie5-123oqwes-projects.vercel.app`, state
`READY`; each committed delivery outcome records its delivery/channel IDs,
event type, attempts, result, and sanitized error metadata. Audit write
failures do not change the committed delivery state. An unauthenticated curl
receives the Vercel SSO `302` protection redirect.

The unified delivery/audit timeline is deployed in
`dpl_2mDWP9yn5kyBgt3tc9eWwie85LYg`, built from commit `a018e16`. Its protected
direct URL is
`https://town-clear-current-ghe104m1w-123oqwes-projects.vercel.app`, state
`READY`; `GET /v1/notification-timeline?limit=N` merges owner-scoped delivery
and audit items by their persisted creation time. An unauthenticated curl
receives the Vercel SSO `302` protection redirect.

The timeline now uses a database-level union and stable cursor pagination in
deployment `dpl_8Qgas976NJSgUvEE3m2UxdoUbGzt`, built from commit `bbfbdcb`. Its
protected direct URL is
`https://town-clear-current-kift6x6fw-123oqwes-projects.vercel.app`, state
`READY`; the endpoint returns `nextCursor` based on `(created_at,id)` across both
tables, rather than approximating pagination in application memory. An
unauthenticated curl receives the Vercel SSO `302` protection redirect.

The Notifications UI now renders the server-truth delivery/audit timeline in
deployment `dpl_94f2M1GWdEJzjXvfbJeaxeyhhiuT`, built from commit `4d33270`. Its
protected direct URL is
`https://town-clear-current-953bgiapm-123oqwes-projects.vercel.app`, state
`READY`; the panel shows persisted status, attempts, errors, and timestamps,
and renders explicit empty/unavailable states. An unauthenticated curl receives
the Vercel SSO `302` protection redirect.

Timeline pagination is now exposed in the UI via the server-provided cursor in
deployment `dpl_9iAyaKJP7P8K6xaVvYv7vR7LrsM3`, built from commit `a690a82`. Its
protected direct URL is
`https://town-clear-current-cacdc46ip-123oqwes-projects.vercel.app`, state
`READY`; `Load more` requests the next persisted cursor page and appends it
without client-side reordering. An unauthenticated curl receives the Vercel SSO
`302` protection redirect.

Channel and timeline loading now fail independently in deployment
`dpl_EEZm5rJwG41KtnHCt1gEAef2rF5u`, built from commit `0cdcecf`. Its protected
direct URL is
`https://town-clear-current-j67arxp1r-123oqwes-projects.vercel.app`, state
`READY`; a timeline outage no longer hides a healthy channel list, and each
surface renders its own explicit error state. An unauthenticated curl receives
the Vercel SSO `302` protection redirect.

The Vercel project ID and team are now known. The two owner preview aliases
return `302` to Vercel SSO, while the default project alias currently returns
`404`; the source-controlled project-settings patch was attempted with the
provided token but Vercel returned `404 Project not found`. Therefore the
project-level `ssoProtection` mutation remains unverified rather than being
claimed as complete. A token with access to this exact team/project can run:

```sh
VERCEL_TOKEN="$YOUR_TOKEN" \
VERCEL_PROJECT_ID="$YOUR_PROJECT_ID" \
VERCEL_TEAM_ID="$YOUR_TEAM_ID" \
pnpm vercel:protect
```
