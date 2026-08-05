# Deployment

## Architecture: API on Vercel + Worker on Fly

The cleanroom uses a dual-host topology:

- **API** runs on Vercel serverless. It handles HTTP requests (auth,
  threads, sessions, SSE) and writes `session_runs` rows to PostgreSQL.
  The API process never runs the Codex CLI binary — it uses the Responses
  API as the default harness path.

- **Worker** runs as a long-lived process on Fly.io (or any container host).
  It polls `session_runs` via the cross-process-safe lease mechanism
  (`FOR UPDATE SKIP LOCKED`), executes durable routines through the
  Responses API (or Codex if enabled), and delivers channel notifications.
  Multiple worker instances can run concurrently without double-processing.

Both processes share the same PostgreSQL database and credential
configuration. The lease mechanism (`runtime_jobs` table with
`lease_token_hash`, `leased_by`, `lease_expires_at`) guarantees that
only one worker claims a given run at a time, even across processes.

```
                +-----------+
  HTTP/SSE  ---> |  Vercel   |  --writes--> PostgreSQL <--polls-- Fly Worker
                |  API      |                 |
                +-----------+          +------+------+
                                       | session_runs |
                                       | runtime_jobs |
                                       +-------------+
```

### Vercel deployment

The project deploys to Vercel as a monorepo:

- `vercel.json` builds the workspace and serves `apps/web` as static assets
- `api/index.js` is the serverless entrypoint that re-exports the built Hono app
- The `/v1/(.*)` rewrite rule routes all API paths to the serverless function

Production URL: `https://townai-cleanroom.vercel.app`

### Required environment variables (API on Vercel)

| Variable                          | Required | Notes                                   |
| --------------------------------- | -------- | --------------------------------------- |
| `DATABASE_URL`                    | Yes      | PostgreSQL 16+ connection string        |
| `CREDENTIAL_MASTER_KEY_BASE64URL` | Yes      | 32-byte base64url encryption key        |
| `ACCESS_ALLOWLIST_EMAILS`         | Yes      | Comma-separated approved emails         |
| `WEB_ORIGIN`                      | Yes      | Your production URL                     |
| `RESPONSES_API_KEY`               | No       | Set for Responses API harness (default) |
| `CODEX_EXEC_ENABLED`              | No       | Do NOT set on Vercel; worker-only       |
| `CRON_SECRET`                     | No       | Fallback wakeup cron (see below)        |
| `GOOGLE_OAUTH_*`                  | No       | Google Workspace integration            |
| `MICROSOFT_OAUTH_*`               | No       | Microsoft integration                   |

### Deployment protection

Enable "All Deployments" protection in Vercel project settings. The API
returns `503 API_NOT_CONFIGURED` when required settings are missing — it never
falls back to placeholder credentials.

### Worker on Fly.io

The durable worker is a standalone Node.js process that reuses the same
runtime composition as the API (`composeRuntime`) but runs only the worker
loop without an HTTP listener.

**Build artifacts**: `deploy/worker-fly/Dockerfile` and
`deploy/worker-fly/fly.toml`.

**Deploy**:

```bash
cd deploy/worker-fly
fly deploy --config fly.toml --dockerfile Dockerfile
```

**Worker environment variables** (must match the API's database and
credential configuration):

| Variable                          | Required | Notes                                   |
| --------------------------------- | -------- | --------------------------------------- |
| `DATABASE_URL`                    | Yes      | Same PostgreSQL as the API              |
| `CREDENTIAL_MASTER_KEY_BASE64URL` | Yes      | Same encryption key as the API          |
| `RESPONSES_API_KEY`               | Yes      | Responses API key for harness execution |
| `RESPONSES_API_ENDPOINT`          | No       | Defaults to OpenAI Responses endpoint   |
| `RESPONSES_MODEL`                 | No       | Defaults to gpt-5                       |
| `CODEX_EXEC_ENABLED`              | No       | Set to `true` for Codex harness         |
| `CODEX_CLI_PATH`                  | No       | Explicit Codex binary path              |
| `CODEX_MODEL`                     | No       | Codex model override                    |
| `CODEX_SANDBOX_MODE`              | No       | read-only / workspace-write / danger    |
| `E2B_API_KEY`                     | No       | Code runner sandbox                     |
| `WORKSPACE_ROOT`                  | No       | Workspace tools root directory          |
| `WORKER_BATCH_SIZE`               | No       | Defaults to 10                          |
| `WORKER_RETRY_MAX_ATTEMPTS`       | No       | 2-10 retry attempts                     |
| `WORKER_RETRY_BASE_DELAY_MS`      | No       | Exponential backoff base delay          |
| `GOOGLE_OAUTH_CLIENT_ID`          | No       | Google integration                      |
| `GOOGLE_OAUTH_CLIENT_SECRET`      | No       | Google integration                      |
| `CHANNEL_CREDENTIALS_JSON`        | No       | Channel delivery credentials            |
| `CONTENT_STORAGE_*`               | No       | Content storage configuration           |

The worker sets `TOWN_PROCESS_ROLE=worker` automatically via the Dockerfile
`ENV` directive. This enables Codex harness detection on the worker side
while keeping the API process Codex-free.

### Vercel cron as fallback wakeup

`vercel.json` schedules `POST /v1/internal/worker` hourly with
`CRON_SECRET` as the Bearer token. This serves as a fallback wakeup
mechanism: if the Fly worker is down or slow, the cron triggers a single
batch on the Vercel API process. The primary execution path is always the
Fly worker.

## Local development

```bash
pnpm install
cp .env.example .env
# Configure DATABASE_URL and CREDENTIAL_MASTER_KEY_BASE64URL
pnpm verify          # typecheck + test + build
pnpm --filter @town/api build
node apps/api/dist/index.js
```

The API applies pending migrations on startup. Set `WORKER_ENABLED=true`
for local single-process development (API + inline worker).

### Local dual-process verification

To test the API + worker split locally:

```bash
# Terminal 1: API only (no inline worker)
TOWN_PROCESS_ROLE=api WORKER_ENABLED=false \
  DATABASE_URL=postgres://... \
  CREDENTIAL_MASTER_KEY_BASE64URL=... \
  RESPONSES_API_KEY=... \
  node apps/api/dist/index.js

# Terminal 2: Standalone worker
TOWN_PROCESS_ROLE=worker WORKER_ENABLED=true \
  DATABASE_URL=postgres://... \
  CREDENTIAL_MASTER_KEY_BASE64URL=... \
  RESPONSES_API_KEY=... \
  node apps/worker/dist/index.js
```

Both processes connect to the same local PostgreSQL. The API handles HTTP
requests and writes `session_runs`; the worker polls and executes them.

## Configuration checks

```bash
pnpm check:runtime-config          # reports variable names and states
pnpm check:runtime-config --strict # fails on missing required config
pnpm check:source-only             # verifies no reports/credentials in repo
pnpm check:build-entries           # verifies all build exports exist
```
