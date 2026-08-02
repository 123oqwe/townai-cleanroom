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

The API entrypoint now exports the Hono app as the default from
`apps/api/src/index.ts` when `VERCEL=1`; local development still uses the Node
server listener. This keeps serverless invocation separate from local process
shutdown and does not weaken the API's database or authentication requirements.
