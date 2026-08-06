# @town/web-next

Next.js 15 App Router + React 19 + TypeScript + Tailwind v4 frontend for the
Town platform. This is the production frontend, served from `/new/*` via
Vercel (`vercel.json` `outputDirectory` = `apps/web-next`). The legacy vanilla
JS app (`apps/web`) has been removed.

## What is implemented

All pages are behind route protection (`middleware.ts`).

### Threads & realtime (Stage 1)

- `/new/login` - email sign-in. Submits to `POST /v1/auth/session`, stores the
  bearer token in a `town-token` cookie, redirects to `/new/threads`. Shows
  allowlist (403) and rate-limit (429) errors.
- `/new/threads` - thread list via SWR (`client.threads.list`). Empty, loading,
  and error states. "New thread" button calls `client.threads.create` and jumps
  into the thread.
- `/new/threads/[id]` - single thread. Renders thread metadata + the turn
  transcript (`client.threads.turns`). Submits a message
  (`client.sessions.create`) and opens an SSE stream
  (`client.sessions.eventsStream`) that renders live runtime events. The stream
  uses an `AbortController`, is aborted on unmount, and retries with exponential
  backoff (up to 3 attempts) on 5xx.

### Knowledge domain (Stage 2a)

Seven knowledge pages under `/new/knowledge/*`, powered by the
`client.knowledge.*` namespace (`@town/web-client`). Each uses SWR for data
fetching with loading/error/empty states, controlled forms, and SWR cache
mutation after writes:

- `/new/knowledge/profile` - profile JSON editor with create (POST) and update
  (PUT) using optimistic-revision concurrency; 404 means no profile yet.
  Collapsible revision history from `GET /v1/profile/history`.
- `/new/knowledge/memories` - active memory list. Edit (Drawer) calls
  `memories.update` (PUT); retire (ConfirmDialog) calls `memories.delete`
  (DELETE with `expectedRevision` query).
- `/new/knowledge/people` - contact list with an add-person Drawer
  (`people.create`). Each card links to the detail page.
- `/new/knowledge/people/[id]` - single contact with edit Drawer and a
  relationships panel (list + add + archive). Relationship create uses
  `people.addRelationship`; archive uses `people.deleteRelationship`.
- `/new/knowledge/wiki` - wiki page list. New page and edit via Drawers
  (`wiki.create` / `wiki.update`). Per-document revision history via a Drawer
  loading `wiki.history` (`GET /v1/wiki/:id/revisions`).
- `/new/knowledge/search` - federated knowledge search
  (`knowledge.search.search`) rendered in a `DataTable`; supports `limit` and
  `cursor` pagination params.
- `/new/knowledge/conflicts` - pending knowledge conflicts with accept/reject
  (`conflicts.resolve`, POST `/v1/knowledge/conflicts/:id/resolve`).

### Shared components (`apps/web-next/components/`)

- `DataTable` - generic table with column config and empty-state fallback.
- `Drawer` - right-side sliding panel for edit/create forms (Esc to close).
- `ConfirmDialog` - modal confirmation for destructive actions.
- `ErrorBoundary` - class-based page-level error boundary.
- `EmptyState` / `LoadingState` - three-state rendering helpers.

## Architecture

- `app/api-client.tsx` - `ApiClientProvider` + `useApiClient()` hook; builds a
  `TownClient` from `@town/web-client` pointed at the same-origin `/v1` path.
- `middleware.ts` - gates `/new/*` (except `/new/login`): no `town-token`
  cookie redirects to `/new/login`; authenticated users hitting `/new/login`
  bounce to `/new/threads`.
- `next.config.ts` - `rewrites` proxy `/v1/*` to the API
  (`NEXT_PUBLIC_API_BASE_URL`, default `http://localhost:3000`) and
  `transpilePackages` for `@town/web-client` (the workspace client ships
  compiled, self-contained `dist` under its `import` export condition).
- No Convex. Realtime is SWR polling + SSE over the existing `/v1` REST backend.

## Local verification

1. Start the API (separate terminal):

   ```sh
   pnpm --filter @town/api dev
   # or: DATABASE_URL=... pnpm --filter @town/api start
   ```

   Ensure `ACCESS_ALLOWLIST_EMAILS` includes the email you will sign in with.

2. Start the Next.js dev server:

   ```sh
   pnpm dev:web
   # -> http://localhost:3001/new/login
   ```

3. Open `http://localhost:3001/new/login`, enter an allowlisted email, sign in.
   You should be redirected to `/new/threads`.

4. `/new/threads` lists threads (or shows the empty state). Click "New thread"
   to create one and land on `/new/threads/<id>`.

5. On the thread page, type a message and Send. The transcript shows your turn,
   and the "Live events" panel renders SSE events as the run progresses; on
   completion the transcript refreshes with the assistant turn.

### Knowledge pages

1. With the API and dev server running (steps 1-2 above), sign in.

2. The sidebar has a **Knowledge** group with links to Profile, Memories,
   People, Wiki, Search, and Conflicts.

3. Verify list + create/update against the local API for at least:
   - **Profile** (`/new/knowledge/profile`): edit the JSON, Save. If no profile
     exists yet the page shows "New profile" and Save creates it; otherwise it
     updates with the current revision. Reload to confirm persistence.
   - **Memories** (`/new/knowledge/memories`): the list loads from
     `GET /v1/memories`. Use the legacy app or API to create one, then verify it
     appears. Edit a memory (Edit drawer) and Retire it (confirm dialog).
   - **People** (`/new/knowledge/people`): click "Add person", fill the form,
     Save. The new contact appears in the list. Click into it to edit and add a
     relationship.

4. The remaining pages (Wiki, Search, Conflicts) render their loading/empty
   states and exercise the matching `client.knowledge.*` methods; verify they
   load without errors and that wiki create/edit and conflict resolve work.

5. Production build check (does not require a running API):

   ```sh

   ```

pnpm --filter @town/web-next build

````

### Routines domain (Stage 2b)

Seven routines pages under `/new/routines/*`, powered by the
`client.routines.*` namespace:

- `/new/routines` - routine list with filter, status badges, and links to each
routine detail. Links to templates.
- `/new/routines/[id]` - single routine config (cron, timezone, enabled,
next run, revision). Edit form (PATCH), delete (DELETE with expectedRevision),
and "Run now" (POST /v1/routines/:id/run). Sub-tabs for Triggers, Runs,
Webhook, Versions.
- `/new/routines/[id]/triggers` - trigger management. List, add (POST), toggle
enable/disable (PATCH), remove (DELETE with expectedRevision). Config shown
as JSON in a CodeBlock.
- `/new/routines/[id]/runs` - run history via DataTable with StatusBadge
(queued/running/succeeded/failed/blocked). Replay terminal runs (POST
/v1/routine-runs/:runId/replay).
- `/new/routines/[id]/webhook` - webhook config. Create (POST, secret shown
once via SecretField), enable/disable (PATCH), rotate (create new). Webhook
URL displayed. 404 means no webhook configured (shows create CTA).
- `/new/routines/[id]/versions` - immutable version history (GET
/v1/routines/:id/versions) with snapshot details.
- `/new/routines/templates` - template library (GET /v1/routine-templates).
Install modal with cron, timezone, first-run fields (POST
/v1/routine-templates/:id/install).

### Content domain (Stage 2b)

Five content pages under `/new/content/*`, powered by the
`client.content.*` namespace:

- `/new/content` - content library list with search (delegates to
knowledge.search) and "Load more" cursor pagination (GET /v1/content). Each
item links to detail page.
- `/new/content/[id]` - single content detail with metadata, body (CodeBlock),
blob download (fetch + object URL), and archive action. Links to history.
- `/new/content/[id]/history` - revision history (GET
/v1/content/:id/revisions).
- `/new/content/collections` - collection management. Create (POST), list, and
expand to view items (DataTable) via GET /v1/content/collections/:id.
- `/new/content/shares` - share management. Select content, create share link
(POST /v1/content/:id/shares, URL shown once via SecretField), revoke
(DELETE /v1/content/shares/:id).

### Local verification for Stage 2b

1. Start the dev server:

 ```sh
 pnpm dev:web
````

2. Open `http://localhost:3001/new/login`, sign in.

3. Navigate to Routines > All (`/new/routines`): verify the routine list
   loads. Click a routine to see its config, triggers, runs, webhook, and
   versions tabs.

4. Navigate to Routines > Templates (`/new/routines/templates`): verify
   templates load. Click "Use" on a template and install it.

5. Navigate to Content > Library (`/new/content`): verify the content list
   loads with "Load more" pagination. Use the search box to search.

6. Navigate to Content > Collections (`/new/content/collections`): create a
   collection and expand it to view items.

7. Navigate to Content > Shares (`/new/content/shares`): select content,
   create a share link, copy it, then revoke.

## Stage 3: remaining domains (Tasks, Suggestions, Approvals, MCP, Tools, Channels, Accounts, Voice, Billing, Squares, Operations, Admin)

Sixteen new pages under `/new/*`, powered by the corresponding
`@town/web-client` namespaces:

- `/new/tasks` - task list with status filter, mark-read, complete, delete.
- `/new/suggestions` - suggestion inbox with refresh, dismiss, convert-to-task.
- `/new/approvals` - approval queue with inspect, approve, reject (confirm dialog).
- `/new/mcp` - MCP server management (list, create, disable/delete).
- `/new/tools` - tool catalog and policy evaluation (POST /v1/tools/policy/evaluate).
- `/new/channels` - notification channels, delivery timeline, delivery records.
- `/new/channels/[id]` - single channel configuration.
- `/new/accounts` - connected accounts list with Google OAuth connect, refresh, remove.
- `/new/accounts/[id]` - account detail with credential rotation.
- `/new/voice` - voice synthesis via POST /v1/voice/synthesize with `<audio>` playback.
- `/new/billing` - billing status, plan, credits, usage breakdown.
- `/new/squares` - team (Square) list with create.
- `/new/squares/[id]` - square detail with members, policy, shared accounts.
- `/new/operations` - audit log with cursor pagination and operations summary.
- `/new/operations/schedule` - schedule view from GET /v1/schedule.
- `/new/admin` - admin overview with report viewer (admin allowlist gated).

The sidebar navigation now includes all top-level groups: Threads, Knowledge,
Routines, Content, Tasks & Suggestions, Approvals, Integrations (MCP, Tools,
Channels, Accounts, Voice), Billing, Squares, and Operations & Admin.

## Production deployment

`vercel.json` sets `outputDirectory` to `apps/web-next` and `buildCommand`
to `pnpm build`. The `pnpm -r build` step compiles `@town/web-client` then
runs `next build`, producing the `.next` output directory that Vercel serves.

## Notes

- The token is stored in a non-httpOnly cookie set from the client because the
  API issues the token directly to the browser; `middleware.ts` reads the cookie
  server-side to gate routes.
- `@town/web-client` has no `development` export condition and its `dist` is
  self-contained (no `@town/contracts` runtime import), so Turbopack dev and
  the webpack build both consume the compiled `dist`. `dev:web` prebuilds the
  client before starting `next dev`.
- `@town/web-client` now has 18 namespaces (auth, me, threads, sessions,
  knowledge, routines, content, tasks, suggestions, approvals, tools, mcp,
  channels, accounts, voice, billing, squares, operations, admin) with 131 unit
  tests covering every public method.
