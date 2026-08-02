import { serve } from "@hono/node-server";
import { z } from "zod";
import { asId } from "@town/contracts";
import { createChannelRepository } from "@town/channels";
import { createContentRepository } from "@town/content";
import {
  createSharedAccountRepository,
  createSquareRepository,
} from "@town/teams";

import {
  AgentError,
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
import { createRoutineRepository } from "@town/routines";
import {
  createToolExecutionRepository,
  createToolRegistryRepository,
} from "@town/tools";

import { createApp } from "./app.js";
import {
  createTownMemoryAddHarnessBinding,
  createRegistryHarnessBindings,
  createTownSearchHarnessBinding,
} from "./harness-tools.js";

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
const routineRepository = createRoutineRepository(sql);
const toolRegistryRepository = createToolRegistryRepository(sql);
const toolExecutionRepository = createToolExecutionRepository(sql);
const contentRepository = createContentRepository(sql);
const squareRepository = createSquareRepository(sql);
const sharedAccountRepository = createSharedAccountRepository(sql);
const channelRepository = createChannelRepository(sql);

const harnessServerFactory =
  environment.RESPONSES_API_KEY === undefined
    ? undefined
    : async (ownerId: string) => {
        const typedOwnerId = asId<"user">(ownerId);
        let registryDefinitions = [] as Awaited<
          ReturnType<typeof toolRegistryRepository.listForAgentVersion>
        >;
        try {
          const personalAgent = await agentRepository.getPersonal(typedOwnerId);
          registryDefinitions =
            await toolRegistryRepository.listForAgentVersion({
              ownerId: typedOwnerId,
              agentVersionId: personalAgent.activeVersion.id,
            });
        } catch (error) {
          if (
            !(error instanceof AgentError) ||
            error.code !== "AGENT_NOT_FOUND"
          )
            throw error;
        }
        return createAppServer({
          store: createHarnessThreadStore(database.db, ownerId),
          createAgent: createResponsesAgentFactory({
            endpoint: environment.RESPONSES_API_ENDPOINT,
            model: environment.RESPONSES_MODEL,
            apiKey: async () => environment.RESPONSES_API_KEY as string,
            tools: (threadId) => {
              const builtIns = [
                createTownSearchHarnessBinding(
                  typedOwnerId,
                  knowledgeSearchRepository,
                ),
                createTownMemoryAddHarnessBinding(
                  typedOwnerId,
                  memoryRepository,
                  threadId,
                  (owner, routineScheduleId) =>
                    routineRepository.ownsSchedule(owner, routineScheduleId),
                ),
              ];
              const handlers = new Map(
                builtIns.map(({ definition, port }) => [
                  definition.name,
                  port.execute.bind(port),
                ]),
              );
              const registryBindings = createRegistryHarnessBindings({
                ownerId: typedOwnerId,
                threadId,
                definitions: registryDefinitions,
                handlers,
              });
              const registryNames = new Set(
                registryBindings.map(({ definition }) => definition.name),
              );
              return [
                ...registryBindings,
                ...builtIns.filter(
                  ({ definition }) => !registryNames.has(definition.name),
                ),
              ];
            },
          }),
        });
      };

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
    contentRepository,
    squareRepository,
    sharedAccountRepository,
    channelRepository,
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
