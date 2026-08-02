import { serve } from "@hono/node-server";
import { z } from "zod";

import {
  createAgentRepository,
  createInputRequestRepository,
  createTaskRepository,
  createThreadRepository,
  createTurnRepository,
} from "@town/agents";
import { createDatabase, runMigrations } from "@town/db";
import {
  createAccountRepository,
  createCredentialCipher,
  createIdentityService,
} from "@town/identity";
import {
  createKnowledgeConflictService,
  createKnowledgeSearchRepository,
  createMemoryRepository,
  createPeopleRepository,
  createProfileRepository,
  createRevisionRepository,
  createWikiRepository,
} from "@town/knowledge";
import {
  createRuntimeTransitionService,
  createSessionRepository,
} from "@town/runtime";

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
const profileRepository = createProfileRepository(sql);
const memoryRepository = createMemoryRepository(sql);
const peopleRepository = createPeopleRepository(sql);
const wikiRepository = createWikiRepository(sql);
const revisionRepository = createRevisionRepository(sql);
const knowledgeSearchRepository = createKnowledgeSearchRepository(sql);
const knowledgeConflictService = createKnowledgeConflictService(sql);
const agentRepository = createAgentRepository(sql);
const threadRepository = createThreadRepository(sql);
const turnRepository = createTurnRepository(sql);
const taskRepository = createTaskRepository(sql);
const inputRequestRepository = createInputRequestRepository(sql);
const sessionRepository = createSessionRepository(sql);
const runtimeTransitionService = createRuntimeTransitionService(sql);

const server = serve({
  fetch: createApp({
    identityService,
    accountRepository,
    profileRepository,
    memoryRepository,
    peopleRepository,
    wikiRepository,
    revisionRepository,
    knowledgeSearchRepository,
    knowledgeConflictService,
    agentRepository,
    threadRepository,
    turnRepository,
    taskRepository,
    inputRequestRepository,
    sessionRepository,
    runtimeTransitionService,
  }).fetch,
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
