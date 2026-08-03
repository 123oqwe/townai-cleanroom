import { serve } from "@hono/node-server";
import { createHash, timingSafeEqual } from "node:crypto";
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
  createMcpRepository,
} from "@town/tools";

import { createApp } from "./app.js";
import {
  createTownMemoryAddHarnessBinding,
  createInvokeRoutineHarnessBinding,
  createRegistryHarnessBindings,
  createMcpHarnessBindings,
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
import { createMcpClient, type McpRemoteTool } from "@town/tools";

function mcpToolDefinitionVersion(tool: McpRemoteTool): number {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(tool))
    .digest()
    .readUInt32BE(0);
  return (fingerprint % 2_000_000_000) + 1;
}

function mcpHarnessToolName(serverName: string, toolName: string): string {
  const safeServer = serverName.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 60);
  const safeTool = toolName.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 120);
  return `mcp_${safeServer}_${safeTool}`;
}

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  CREDENTIAL_MASTER_KEY_BASE64URL: z.string().min(1),
  ACCESS_ALLOWLIST_EMAILS: z.string().default(""),
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
  CRON_SECRET: z.string().min(1).optional(),
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
const configuredAllowlist = environment.ACCESS_ALLOWLIST_EMAILS.split(",")
  .map((email) => email.trim())
  .filter(Boolean);
if (configuredAllowlist.length > 0)
  await identityService.syncAllowlist(configuredAllowlist);
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
const mcpRepository = createMcpRepository(sql);

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
        const mcpByVersion = new Map<
          string,
          ReturnType<typeof createMcpHarnessBindings>
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
        await Promise.all(
          activeAgents.map(async (agent) => {
            const configured = await mcpRepository.listForAgentVersion({
              ownerId: typedOwnerId,
              agentVersionId: agent.activeVersion.id,
            });
            const discovered = (
              await Promise.all(
                configured.map(async (entry) => {
                  // authRef is intentionally not treated as a secret. Until a
                  // credential resolver is injected, authenticated MCP
                  // servers remain explicitly unavailable rather than being
                  // called with fabricated credentials.
                  if (entry.authRef !== null) return [];
                  try {
                    const client = createMcpClient(entry, {
                      timeoutMs: 10_000,
                    });
                    await client.initialize();
                    const tools: McpRemoteTool[] = [];
                    let cursor: string | undefined;
                    for (let page = 0; page < 10; page += 1) {
                      const result = await client.listTools(cursor);
                      tools.push(...result.tools);
                      if (result.nextCursor === null) break;
                      cursor = result.nextCursor;
                    }
                    for (const tool of tools) {
                      const definition = await toolRegistryRepository.ensure({
                        ownerId: typedOwnerId,
                        version: mcpToolDefinitionVersion(tool),
                        name: mcpHarnessToolName(entry.name, tool.name),
                        description:
                          tool.description ?? `MCP tool ${tool.name}`,
                        inputSchema: z
                          .record(z.string(), z.json())
                          .parse(tool.inputSchema),
                        outputSchema:
                          tool.outputSchema === undefined
                            ? null
                            : z
                                .record(z.string(), z.json())
                                .parse(tool.outputSchema),
                        sideEffect:
                          tool.annotations?.["readOnlyHint"] === true
                            ? "read"
                            : "external_write",
                        dataSensitivity: "private",
                        accountBinding: "optional",
                      });
                      await toolRegistryRepository.ensureBinding({
                        ownerId: typedOwnerId,
                        agentVersionId: agent.activeVersion.id,
                        toolDefinitionId: definition.id,
                        modeOverride: entry.binding.modeOverride,
                        accountScope: entry.binding.accountScope,
                      });
                    }
                    return createMcpHarnessBindings({
                      client,
                      serverName: entry.name,
                      tools,
                      modeOverride: entry.binding.modeOverride,
                    });
                  } catch {
                    return [];
                  }
                }),
              )
            ).flat();
            mcpByVersion.set(agent.activeVersion.id, discovered);
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
              const mcpBindings = (
                mcpByVersion.get(agentVersionId ?? "") ?? []
              ).filter(
                ({ definition }) =>
                  !registryNames.has(definition.name) &&
                  !builtIns.some(
                    (builtIn) => builtIn.definition.name === definition.name,
                  ),
              );
              return [
                ...registryBindings,
                ...mcpBindings,
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
  mcpRepository,
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

// Vercel Cron sends its configured CRON_SECRET as an Authorization bearer.
// A manually managed WORKER_SECRET still takes precedence for other hosts.
const workerSecret = environment.WORKER_SECRET ?? environment.CRON_SECRET;
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
