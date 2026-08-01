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

Knowledge search uses PostgreSQL full-text ranking and opaque keyset cursors. Its
responses identify the source as `local_postgresql` with algorithm
`postgres_full_text_v1`. This is a documented clean-room implementation choice;
it is not represented as Town's private ranking system or as live federated
search across unconfigured external accounts.

Authenticated knowledge resources are available under `/v1/profile`,
`/v1/memories`, `/v1/people`, `/v1/wiki`, and `/v1/knowledge`. Public API writes
are recorded as user-authored citations; assistant and system provenance can
only be written by internal runtime code.

The current product objective is recorded in [GOAL.md](./GOAL.md).
