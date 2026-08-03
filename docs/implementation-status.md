# Implementation status

This is the evidence ledger for the clean-room Town implementation. It keeps
observed behavior, engineering choices, and deployment state separate. A green
source row does not imply that an external provider is configured.

| Area                                   | Source status                 | Evidence                                                       | Honest boundary                                                                                   |
| -------------------------------------- | ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Identity and bearer sessions           | Implemented                   | `packages/identity`, API auth tests                            | Requires a real database and session token at runtime                                             |
| Connected accounts and Google OAuth    | Implemented                   | `packages/identity`, OAuth route tests, Connected Accounts UI  | Provider credentials and redirect URI remain deployment configuration                             |
| Profile, Memory, People, Wiki          | Implemented                   | `packages/knowledge`, authenticated route tests, web editors   | No external knowledge provider is invented                                                        |
| Agents, Threads, Tasks                 | Implemented                   | `packages/agents`, task/thread tests, web surfaces             | Assistant content is not fabricated when no worker is configured                                  |
| Durable Sessions and Runs              | Implemented                   | `packages/runtime`, migration/transition/worker tests          | Queue execution still needs a running worker and provider adapter                                 |
| Codex-compatible Harness               | Implemented                   | `packages/harness`, adapter tests, durable approval recovery   | Private Town prompts/model routing are not claimed                                                |
| Tool policy and approvals              | Implemented                   | `packages/tools`, approval repository/tests, approval UI       | External side effects remain approval-gated                                                       |
| Google Gmail/Calendar                  | Implemented                   | `packages/google`, API integration tests                       | `OAUTH_NOT_CONFIGURED` is expected without deployment credentials                                 |
| Content, Channels, Billing, Operations | Implemented                   | package repositories and API tests                             | Provider-backed state is explicit when not configured                                             |
| Routines and triggers                  | Implemented                   | `packages/routines`, scheduler/trigger tests, Routine UI       | A schedule only reports server-returned queued state                                              |
| Current web product surface            | Implemented                   | `apps/web`, `pnpm check:web`, browser-source deployment        | API base URL and bearer token must be supplied by the user                                        |
| Current Vercel UI artifact             | Verified protected direct URL | `docs/deployment.md`, unauthenticated `302` SSO check          | Generated project aliases currently remain public                                                 |
| Production API deployment              | Pending infrastructure        | `apps/api/src/index.ts` exports Vercel app and worker endpoint | Requires real PostgreSQL, encryption key, worker secret, web origin, and project-level protection |

## Verification snapshot

At the last full verification, the repository passed source-only policy,
formatting, lint, typecheck, all 56 test files (238 tests), and all workspace
builds. The current protected UI deployment is recorded in
[`deployment.md`](./deployment.md). This ledger intentionally does not mark
the overall product goal complete while the production API and project-level
deployment protection remain unverified.
