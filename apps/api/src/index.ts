import { serve } from "@hono/node-server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { asId } from "@town/contracts";
import { createChannelRepository } from "@town/channels";
import { createBillingRepository } from "@town/billing";
import { createOperationsRepository } from "@town/operations";
import { createContentRepository } from "@town/content";
import {
  createSharedAccountRepository,
  createSquareRepository,
} from "@town/teams";

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
  createGoogleTokenRefresher,
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
  createRuntimeQueueRepository,
  createRuntimeWorker,
  createApprovalDecisionRepository,
} from "@town/runtime";
import { createRoutineRepository } from "@town/routines";
import {
  createToolExecutionRepository,
  createToolRegistryRepository,
} from "@town/tools";

import { createApp } from "./app.js";
import {
  createTownMemoryAddHarnessBinding,
  createInvokeRoutineHarnessBinding,
  createRegistryHarnessBindings,
  createTownSearchHarnessBinding,
  createGoogleGmailSearchHarnessBinding,
  createGoogleGmailGetMessageHarnessBinding,
  createGoogleGmailSendHarnessBinding,
  createGoogleCalendarFreeBusyHarnessBinding,
  createGoogleCalendarCreateEventHarnessBinding,
} from "./harness-tools.js";
import { createHarnessRuntimeAdapter } from "./harness-runtime-adapter.js";
import { createRoutineScheduler } from "./routine-scheduler.js";
import { createSuggestionRepository } from "@town/suggestions";
import { createA2ARepository } from "@town/a2a";
import { createGoogleApiClient } from "@town/google";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  CREDENTIAL_MASTER_KEY_BASE64URL: z.string().min(1),
  RESPONSES_API_ENDPOINT: z
    .string()
    .url()
    .default("https://api.openai.com/v1/responses"),
  RESPONSES_MODEL: z.string().min(1).default("gpt-5"),
  RESPONSES_API_KEY: z.string().min(1).optional(),
  WEB_ORIGIN: z.string().url().default("http://localhost:4173"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WORKER_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
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
const approvalDecisions = createApprovalDecisionRepository(sql);
const routineRepository = createRoutineRepository(sql);
const suggestionRepository = createSuggestionRepository(sql);
const a2aRepository = createA2ARepository(sql);
const googleTokenRefresher = createGoogleTokenRefresher({
  accounts: accountRepository,
  ...(environment.GOOGLE_OAUTH_CLIENT_ID === undefined
    ? {}
    : { clientId: environment.GOOGLE_OAUTH_CLIENT_ID }),
  ...(environment.GOOGLE_OAUTH_CLIENT_SECRET === undefined
    ? {}
    : { clientSecret: environment.GOOGLE_OAUTH_CLIENT_SECRET }),
});
const googleApi = createGoogleApiClient({
  accounts: accountRepository,
  refresher: googleTokenRefresher,
});
const toolRegistryRepository = createToolRegistryRepository(sql);
const toolExecutionRepository = createToolExecutionRepository(sql);
const contentRepository = createContentRepository(sql);
const squareRepository = createSquareRepository(sql);
const sharedAccountRepository = createSharedAccountRepository(sql);
const channelRepository = createChannelRepository(sql);
const billingRepository = createBillingRepository(sql);
const operationsRepository = createOperationsRepository(sql);

const harnessServerFactory =
  environment.RESPONSES_API_KEY === undefined
    ? undefined
    : async (ownerId: string) => {
        const typedOwnerId = asId<"user">(ownerId);
        const personalAgent = await agentRepository
          .getPersonal(typedOwnerId)
          .catch(() => undefined);
        const routineAgents = await agentRepository.listRoutines(typedOwnerId);
        const activeAgents = [personalAgent, ...routineAgents].filter(
          (agent) => agent !== undefined,
        );
        const versions = new Map(
          activeAgents.map(
            (agent) =>
              [
                String(agent.activeVersion.id),
                agent.activeVersion.snapshot,
              ] as const,
          ),
        );
        const registryByVersion = new Map<
          string,
          Awaited<ReturnType<typeof toolRegistryRepository.listForAgentVersion>>
        >();
        await Promise.all(
          activeAgents.map(async (agent) => {
            registryByVersion.set(
              agent.activeVersion.id,
              await toolRegistryRepository.listForAgentVersion({
                ownerId: typedOwnerId,
                agentVersionId: agent.activeVersion.id,
              }),
            );
          }),
        );
        return createAppServer({
          store: createHarnessThreadStore(database.db, ownerId),
          createAgent: createResponsesAgentFactory({
            endpoint: environment.RESPONSES_API_ENDPOINT,
            model: environment.RESPONSES_MODEL,
            agentVersionForThread: (agentVersionId) =>
              agentVersionId === undefined
                ? undefined
                : versions.get(agentVersionId),
            apiKey: async () => environment.RESPONSES_API_KEY as string,
            tools: (threadId, agentVersionId) => {
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
                createInvokeRoutineHarnessBinding({
                  ownerId: typedOwnerId,
                  threadId,
                  agents: agentRepository,
                  threads: threadRepository,
                  sessions: sessionRepository,
                }),
                createGoogleGmailSearchHarnessBinding(typedOwnerId, googleApi),
                createGoogleGmailGetMessageHarnessBinding(
                  typedOwnerId,
                  googleApi,
                ),
                createGoogleGmailSendHarnessBinding(typedOwnerId, googleApi),
                createGoogleCalendarFreeBusyHarnessBinding(
                  typedOwnerId,
                  googleApi,
                ),
                createGoogleCalendarCreateEventHarnessBinding(
                  typedOwnerId,
                  googleApi,
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
                definitions: registryByVersion.get(agentVersionId ?? "") ?? [],
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

const app = createApp({
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
  approvalDecisions,
  toolRegistryRepository,
  toolExecutionRepository,
  contentRepository,
  squareRepository,
  sharedAccountRepository,
  channelRepository,
  billingRepository,
  operationsRepository,
  routineRepository,
  suggestionRepository,
  a2aRepository,
  googleOAuth: {
    sql,
    accounts: accountRepository,
    webOrigin: environment.WEB_ORIGIN,
    ...(environment.GOOGLE_OAUTH_CLIENT_ID === undefined
      ? {}
      : { clientId: environment.GOOGLE_OAUTH_CLIENT_ID }),
    ...(environment.GOOGLE_OAUTH_CLIENT_SECRET === undefined
      ? {}
      : { clientSecret: environment.GOOGLE_OAUTH_CLIENT_SECRET }),
    ...(environment.GOOGLE_OAUTH_REDIRECT_URI === undefined
      ? {}
      : { redirectUri: environment.GOOGLE_OAUTH_REDIRECT_URI }),
  },
  googleTokenRefresher,
  webOrigin: environment.WEB_ORIGIN,
  ...(harnessServerFactory === undefined ? {} : { harnessServerFactory }),
});

const runtimeWorker =
  (environment.WORKER_ENABLED || process.env["VERCEL"] === "1") &&
  harnessServerFactory !== undefined
    ? createRuntimeWorker(
        {
          queue: createRuntimeQueueRepository(sql),
          sessions: sessionRepository,
          transitions: runtimeTransitionService,
          adapter: createHarnessRuntimeAdapter({
            createServer: harnessServerFactory,
            createStore: (ownerId) =>
              createHarnessThreadStore(database.db, ownerId),
            turns: turnRepository,
            approvalDecisions,
          }),
        },
        {
          workerId: process.env["WORKER_ID"] ?? `town-worker-${process.pid}`,
          onFinished: ({ ownerId, runId, state, errorCode }) =>
            routineRepository
              .reconcileRuntimeRun({
                ownerId,
                runtimeRunId: runId,
                status: state,
                ...(errorCode === undefined ? {} : { errorCode }),
              })
              .then(() => undefined),
        },
      )
    : undefined;
const routineScheduler =
  harnessServerFactory === undefined
    ? undefined
    : createRoutineScheduler({
        sql,
        routines: routineRepository,
        agents: agentRepository,
        threads: threadRepository,
        sessions: sessionRepository,
      });

const workerSecret = environment.WORKER_SECRET;
const workerId = process.env["WORKER_ID"] ?? `town-worker-${process.pid}`;
if (workerSecret !== undefined) {
  app.post("/v1/internal/worker", async (context) => {
    const supplied = context.req
      .header("Authorization")
      ?.match(/^Bearer ([^\s,]+)$/)?.[1];
    if (supplied === undefined)
      return context.json({ code: "UNAUTHORIZED" }, 401);
    const expected = Buffer.from(workerSecret);
    const actual = Buffer.from(supplied);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return context.json({ code: "UNAUTHORIZED" }, 401);
    const schedule =
      routineScheduler === undefined ? undefined : await routineScheduler();
    return context.json({
      schedule,
      runtime:
        runtimeWorker === undefined ? undefined : await runtimeWorker.runOnce(),
      channel: await channelRepository.deliverNext({ workerId }),
    });
  });
}

export default app;

if (process.env["VERCEL"] !== "1") {
  let workerTimer: ReturnType<typeof setTimeout> | undefined;
  const runWorker = async (): Promise<void> => {
    if (routineScheduler !== undefined) await routineScheduler();
    if (runtimeWorker !== undefined) await runtimeWorker.runOnce();
    await channelRepository.deliverNext({ workerId });
    workerTimer = setTimeout(() => void runWorker(), 250);
    workerTimer.unref?.();
  };
  void runWorker();

  const server = serve({
    fetch: app.fetch,
    port: environment.PORT,
  });
  let shuttingDown = false;

  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    if (workerTimer !== undefined) clearTimeout(workerTimer);

    server.close(() => {
      void sql.end().finally(() => process.exit(0));
    });
  }

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
