# @town/web-next (Stage 1 Next.js skeleton)

Next.js 15 App Router + React 19 + TypeScript + Tailwind v4 skeleton for the
Town frontend. This coexists with the legacy vanilla app (`apps/web`); it lives
under the `/new/*` URL prefix and does not replace the old UI.

## What is implemented

Three pages, all behind route protection:

- `/new/login` — email sign-in. Submits to `POST /v1/auth/session`, stores the
  bearer token in a `town-token` cookie, redirects to `/new/threads`. Shows
  allowlist (403) and rate-limit (429) errors.
- `/new/threads` — thread list via SWR (`client.threads.list`). Empty, loading,
  and error states. "New thread" button calls `client.threads.create` and jumps
  into the thread.
- `/new/threads/[id]` — single thread. Top half renders thread metadata + the
  turn transcript (`client.threads.turns`). Bottom half submits a message
  (`client.sessions.create`) and opens an SSE stream
  (`client.sessions.eventsStream`) that renders live runtime events
  (`run_started`, `tool_call_proposed`, `tool_succeeded`, `assistant_output`,
  `run_completed`, …). The stream uses an `AbortController`, is aborted on
  unmount, and retries with exponential backoff (up to 3 attempts) on 5xx.

## Architecture

- `app/api-client.tsx` — `ApiClientProvider` + `useApiClient()` hook; builds a
  `TownClient` from `@town/web-client` pointed at the same-origin `/v1` path.
- `middleware.ts` — gates `/new/*` (except `/new/login`): no `town-token`
  cookie → 302 to `/new/login`; authenticated users hitting `/new/login` bounce
  to `/new/threads`.
- `next.config.ts` — `rewrites` proxy `/v1/*` to the API
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

6. Production build check (does not require a running API):

   ```sh
   pnpm --filter @town/web-next build
   ```

```

## Notes

- `vercel.json` `outputDirectory` is intentionally left on `apps/web`; the
Next.js app is dev-validated only in Stage 1 and is not wired into CI `verify`
to avoid slowing the gate. Stage 3 flips the output directory.
- The token is stored in a non-httpOnly cookie set from the client because the
API issues the token directly to the browser; `middleware.ts` reads the cookie
server-side to gate routes.
- `@town/web-client` has no `development` export condition and its `dist` is
self-contained (no `@town/contracts` runtime import), so Turbopack dev and
the webpack build both consume the compiled `dist`. `dev:web` prebuilds the
client before starting `next dev`.
```
