import { serve } from "@hono/node-server";
import { z } from "zod";

import { createDatabase, runMigrations } from "@town/db";
import {
  createAccountRepository,
  createCredentialCipher,
  createIdentityService,
} from "@town/identity";

import { createApp } from "./app.js";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  CREDENTIAL_MASTER_KEY_BASE64URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
});

const environment = environmentSchema.parse(process.env);
const { sql } = createDatabase(environment.DATABASE_URL);
await runMigrations(sql);

const credentialCipher = createCredentialCipher(
  environment.CREDENTIAL_MASTER_KEY_BASE64URL,
);
const identityService = createIdentityService(sql);
const accountRepository = createAccountRepository(sql, credentialCipher);

const server = serve({
  fetch: createApp({ identityService, accountRepository }).fetch,
  port: environment.PORT,
});

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;

  server.close(() => {
    void sql.end().finally(() => process.exit(0));
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
