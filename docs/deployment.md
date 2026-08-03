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
`20b8d76`, including the Harness, Knowledge, People, Memory, Task, Routine,
Connected Accounts, Channels, Billing, Suggestions, Squares, and the built Vercel API entrypoint. A fresh unauthenticated check still
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

- Deployment: `dpl_7nBEQxdEVixr39eDtC7s61Zi2HWS`
- Protected direct URL: `https://town-clear-current-4wx1yih1r-123oqwes-projects.vercel.app`
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

Once the owner-visible Vercel project ID is available, protection is applied
with the source-controlled command below. It sends only the documented project
settings patch and reads credentials from the shell environment:

```sh
VERCEL_TOKEN="$YOUR_TOKEN" \
VERCEL_PROJECT_ID="$YOUR_PROJECT_ID" \
VERCEL_TEAM_ID="$YOUR_TEAM_ID" \
pnpm vercel:protect
```
