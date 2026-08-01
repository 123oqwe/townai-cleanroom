# Goal

Build a complete, real, runnable clean-room implementation of the Town personal AI platform from verified external behavior and current public documentation.

The finished source must implement identity and connected accounts, personal knowledge, versioned agents, threads and tasks, durable sessions, tools and approval policy, routines and triggers, content, teams, channels, billing, operations, the Codex execution harness, and the final product UI.

## Non-negotiable constraints

1. Never claim access to Town's private server source, database internals, system prompts, model-routing weights, or secrets.
2. Never disguise an engineering inference as an observed Town fact.
3. Never ship fabricated product data or a fake external integration. Missing credentials produce an explicit `not_configured` state.
4. Integrate the official Codex harness only behind the stable Town runtime boundary, after Session, Tool, Policy, and Routine contracts exist.
5. Verify every module with fresh tests, type checks, migrations, integration checks, and security gates before pushing it.
6. Keep the private GitHub repository source-only. Never commit reports, captures, local evidence notes, credentials, access tokens, or personal data.
7. Complete the project with a minimal Vercel deployment protected by an explicit user allowlist.
