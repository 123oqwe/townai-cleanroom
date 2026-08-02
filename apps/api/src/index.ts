import { serve } from "@hono/node-server";
import { z } from "zod";
import { asId } from "@town/contracts";

import {
  createAgentRepository,
  createInputRequestRepository,
  createTaskRepository,
  createThreadRepository,
  createTurnRepository,
} from "@town/agents";
import {
  createDatabase,
  createHarnessThreadStore,
  runMigrations,
} from "@town/db";
import { createAppServer, createResponsesAgentFactory } from "@town/harness";
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
import {
  createToolExecutionRepository,
  createToolRegistryRepository,
} from "@town/tools";

import { createApp } from "./app.js";
import { createTownSearchHarnessBinding } from "./harness-tools.js";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  CREDENTIAL_MASTER_KEY_BASE64URL: z.string().min(1),
  RESPONSES_API_ENDPOINT: z
    .string()
    .url()
    .default("https://api.openai.com/v1/responses"),
  RESPONSES_MODEL: z.string().min(1).default("gpt-5"),
  RESPONSES_API_KEY: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
});

const environment = environmentSchema.parse(process.env);
const database = createDatabase(environment.DATABASE_URL);
const { sql } = database;
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
const toolRegistryRepository = createToolRegistryRepository(sql);
const toolExecutionRepository = createToolExecutionRepository(sql);

const harnessServerFactory =
  environment.RESPONSES_API_KEY === undefined
    ? undefined
    : (ownerId: string) =>
        createAppServer({
          store: createHarnessThreadStore(database.db, ownerId),
          createAgent: createResponsesAgentFactory({
            endpoint: environment.RESPONSES_API_ENDPOINT,
            model: environment.RESPONSES_MODEL,
            apiKey: async () => environment.RESPONSES_API_KEY as string,
            tools: () => [
              createTownSearchHarnessBinding(
                asId<"user">(ownerId),
                knowledgeSearchRepository,
              ),
            ],
          }),
        });

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
    toolRegistryRepository,
    toolExecutionRepository,
    ...(harnessServerFactory === undefined ? {} : { harnessServerFactory }),
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
