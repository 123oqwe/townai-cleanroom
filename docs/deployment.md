# Deployment

## Vercel deployment

The project deploys to Vercel as a monorepo:

- `vercel.json` builds the workspace and serves `apps/web` as static assets
- `api/index.js` is the serverless entrypoint that re-exports the built Hono app
- The `/v1/(.*)` rewrite rule routes all API paths to the serverless function

Production URL: `https://townai-cleanroom.vercel.app`

### Required environment variables

Set these in the Vercel project settings (Settings > Environment Variables):

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | PostgreSQL 16+ connection string |
| `CREDENTIAL_MASTER_KEY_BASE64URL` | Yes | 32-byte base64url encryption key |
| `ACCESS_ALLOWLIST_EMAILS` | Yes | Comma-separated approved emails |
| `WEB_ORIGIN` | Yes | Your production URL |
| `CODEX_EXEC_ENABLED` | No | Set to `true` for Codex harness |
| `RESPONSES_API_KEY` | No | Set for Responses API fallback |
| `GOOGLE_OAUTH_*` | No | Google Workspace integration |
| `MICROSOFT_OAUTH_*` | No | Microsoft integration |

### Deployment protection

Enable "All Deployments" protection in Vercel project settings. The API
returns `503 API_NOT_CONFIGURED` when required settings are missing — it never
falls back to placeholder credentials.

### Worker on Vercel

Vercel serverless functions have execution time limits. For durable execution:

- Set `CRON_SECRET` — `vercel.json` schedules `POST /v1/internal/worker`
  hourly with the secret as Bearer token
- Alternatively, set `WORKER_SECRET` and invoke the same endpoint from any
  external scheduler
- For long-running hosts, set `WORKER_ENABLED=true` to run the worker loop
  alongside the HTTP listener

## Local development

```bash
pnpm install
cp .env.example .env
# Configure DATABASE_URL and CREDENTIAL_MASTER_KEY_BASE64URL
pnpm verify          # typecheck + test + build
pnpm --filter @town/api build
node apps/api/dist/index.js
```

The API applies pending migrations on startup. Set `WORKER_ENABLED=true` for
local durable execution.

## Configuration checks

```bash
pnpm check:runtime-config          # reports variable names and states
pnpm check:runtime-config --strict # fails on missing required config
pnpm check:source-only             # verifies no reports/credentials in repo
pnpm check:build-entries           # verifies all build exports exist
```
