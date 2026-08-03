import { serve } from "@hono/node-server";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { asId, type Id } from "@town/contracts";
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
  createKnowledgeContextBuilder,
  createKnowledgeSearchRepository,
  createWikiUpkeepScanner,
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
import {
  createRoutineRepository,
  createRoutineResultRepository,
} from "@town/routines";
import {
  createToolExecutionRepository,
  createToolRegistryRepository,
  createMcpRepository,
} from "@town/tools";

import { createApp } from "./app.js";
import { createGoogleRoutinePoller } from "./google-routine-poller.js";
import { createGoogleCalendarPoller } from "./google-calendar-poller.js";
import {
  createTownMemoryAddHarnessBinding,
  createInvokeRoutineHarnessBinding,
  createRegistryHarnessBindings,
  createMcpHarnessBindings,
  createTownContextHarnessBinding,
  createTownWebFetchHarnessBinding,
  createTownVoiceSpeakHarnessBinding,
  createTownSearchHarnessBinding,
  createGoogleGmailSearchHarnessBinding,
  createGoogleGmailGetMessageHarnessBinding,
  createGoogleGmailSendHarnessBinding,
  createGoogleCalendarFreeBusyHarnessBinding,
  createGoogleCalendarCreateEventHarnessBinding,
} from "./harness-tools.js";
import {
  createHarnessRuntimeAdapter,
  type HarnessExecutionContext,
} from "./harness-runtime-adapter.js";
import { createRoutineScheduler } from "./routine-scheduler.js";
import { finalizeRoutineRun } from "./routine-finalizer.js";
import { createSuggestionRepository } from "@town/suggestions";
import { createA2ARepository } from "@town/a2a";
import { createGoogleApiClient } from "@town/google";
import { createMcpClient, type McpRemoteTool } from "@town/tools";
import { createElevenLabsVoiceProvider } from "./elevenlabs-voice.js";

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
  ADMIN_ALLOWLIST_EMAILS: z.string().default(""),
  RESPONSES_API_ENDPOINT: z
    .string()
    .url()
    .default("https://api.openai.com/v1/responses"),
  RESPONSES_MODEL: z.string().min(1).default("gpt-5"),
  RESPONSES_API_KEY: z.string().min(1).optional(),
  WEB_ORIGIN: z.string().url().default("http://localhost:4173"),
  CHANNEL_CREDENTIALS_JSON: z.string().default("{}"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  WORKER_SECRET: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(1).optional(),
  SLACK_SIGNING_SECRET: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_VOICE_ID: z.string().min(1).optional(),
  ELEVENLABS_MODEL_ID: z.string().min(1).default("eleven_multilingual_v2"),
  VAPI_WEBHOOK_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
});

const environment = environmentSchema.parse(process.env);
const channelCredentials = z
  .record(z.string().trim().min(1), z.string().min(1))
  .parse(JSON.parse(environment.CHANNEL_CREDENTIALS_JSON));
const voiceProvider =
  environment.ELEVENLABS_API_KEY === undefined ||
  environment.ELEVENLABS_VOICE_ID === undefined
    ? undefined
    : createElevenLabsVoiceProvider({
        apiKey: environment.ELEVENLABS_API_KEY,
        voiceId: environment.ELEVENLABS_VOICE_ID,
        modelId: environment.ELEVENLABS_MODEL_ID,
      });
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
const configuredAdminAllowlist = environment.ADMIN_ALLOWLIST_EMAILS.split(",")
  .map((email) => email.trim())
  .filter(Boolean);
const accountRepository = createAccountRepository(sql, credentialCipher);
const profileRepository = createProfileRepository(sql);
const memoryRepository = createMemoryRepository(sql);
const peopleRepository = createPeopleRepository(sql);
const wikiRepository = createWikiRepository(sql);
const revisionRepository = createRevisionRepository(sql);
const knowledgeSearchRepository = createKnowledgeSearchRepository(sql);
const knowledgeContextBuilder = createKnowledgeContextBuilder(
  knowledgeSearchRepository,
);
const knowledgeUpkeepScanner = createWikiUpkeepScanner(sql);
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
const routineResultRepository = createRoutineResultRepository(sql);
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
const googleRoutinePoller = createGoogleRoutinePoller({
  listTargets: async () => {
    const rows = await sql<
      {
        owner_id: string;
        routine_schedule_id: string;
        account_id: string;
        kind: "incoming_email" | "email_to_assistant";
        config: Record<string, unknown>;
      }[]
    >`
      select t.owner_id, t.routine_schedule_id, ca.id as account_id,
             t.kind, t.config
      from routine_triggers t
      join routine_schedules s
        on s.owner_id=t.owner_id and s.id=t.routine_schedule_id and s.enabled=true
      join connected_accounts ca
        on ca.owner_id=t.owner_id and ca.provider='google' and ca.is_active=true
       and (
         t.config->>'accountId'=ca.id::text
         or (t.config->>'accountId' is null and ca.is_primary=true)
       )
      where t.enabled=true and t.kind in ('incoming_email','email_to_assistant')
      order by t.updated_at, t.id limit 100
    `;
    return rows.map((row) => {
      const query = row.config["query"];
      const maxResults = row.config["maxResults"];
      return {
        ownerId: asId<"user">(row.owner_id),
        routineScheduleId: asId<"routine-schedule">(row.routine_schedule_id),
        accountId: asId<"connected-account">(row.account_id),
        triggerType: row.kind,
        ...(row.kind === "email_to_assistant" &&
        typeof row.config["assistantAddress"] === "string"
          ? { assistantAddress: row.config["assistantAddress"].trim() }
          : {}),
        ...(typeof query === "string" && query.trim().length > 0
          ? { query: query.trim() }
          : {}),
        ...(typeof maxResults === "number" && Number.isInteger(maxResults)
          ? { maxResults: Math.min(100, Math.max(1, maxResults)) }
          : {}),
      };
    });
  },
  google: googleApi,
  routines: routineRepository,
});
const googleCalendarPoller = createGoogleCalendarPoller({
  listTargets: async () => {
    const rows = await sql<
      {
        owner_id: string;
        routine_schedule_id: string;
        routine_trigger_id: string;
        account_id: string;
        config: Record<string, unknown>;
      }[]
    >`
      select t.owner_id, t.routine_schedule_id, t.id as routine_trigger_id,
             ca.id as account_id, t.config
      from routine_triggers t
      join routine_schedules s
        on s.owner_id=t.owner_id and s.id=t.routine_schedule_id and s.enabled=true
      join lateral (
        select ca.id
        from connected_accounts ca
        where ca.owner_id=t.owner_id and ca.provider='google' and ca.is_active=true
          and (
            t.config->>'accountId'=ca.id::text
            or (t.config->>'accountId' is null and ca.is_primary=true)
          )
        order by ca.is_primary desc, ca.created_at, ca.id limit 1
      ) ca on true
      where t.enabled=true and t.kind in
        ('calendar_start','calendar_end','calendar_rsvp','calendar_changed')
      order by t.updated_at, t.id limit 100
    `;
    return rows.map((row) => {
      const config = row.config;
      const numberValue = (key: string) => {
        const value = config[key];
        return typeof value === "number" && Number.isInteger(value)
          ? Math.min(10080, Math.max(0, value))
          : undefined;
      };
      const calendarId = config["calendarId"];
      const lookbackMinutes = numberValue("lookbackMinutes");
      const lookaheadMinutes = numberValue("lookaheadMinutes");
      const maxResults = numberValue("maxResults");
      return {
        ownerId: asId<"user">(row.owner_id),
        routineScheduleId: asId<"routine-schedule">(row.routine_schedule_id),
        routineTriggerId: asId<"routine-trigger">(row.routine_trigger_id),
        accountId: asId<"connected-account">(row.account_id),
        ...(typeof calendarId === "string" && calendarId.trim().length > 0
          ? { calendarId: calendarId.trim() }
          : {}),
        ...(lookbackMinutes === undefined ? {} : { lookbackMinutes }),
        ...(lookaheadMinutes === undefined ? {} : { lookaheadMinutes }),
        ...(maxResults === undefined ? {} : { maxResults }),
      };
    });
  },
  google: googleApi,
  routines: routineRepository,
});
const toolRegistryRepository = createToolRegistryRepository(sql);
const toolExecutionRepository = createToolExecutionRepository(sql);
const contentRepository = createContentRepository(sql);
const squareRepository = createSquareRepository(sql);
const sharedAccountRepository = createSharedAccountRepository(sql);
const billingRepository = createBillingRepository(sql);
const operationsRepository = createOperationsRepository(sql);
const channelRepository = createChannelRepository(sql, {
  onDeliveryOutcome: async ({ delivery, error }) => {
    await operationsRepository.append({
      ownerId: delivery.ownerId,
      action: `notification.delivery.${delivery.status}`,
      resourceType: "notification-delivery",
      resourceId: delivery.id,
      outcome: delivery.status === "succeeded" ? "succeeded" : "failed",
      dedupeKey: `${delivery.id}:${delivery.attempts}:${delivery.status}`,
      metadata: {
        channelId: delivery.channelId,
        eventType: delivery.eventType,
        attempts: delivery.attempts,
        error,
      },
    });
  },
});
const mcpRepository = createMcpRepository(sql);

const harnessServerFactory =
  environment.RESPONSES_API_KEY === undefined
    ? undefined
    : async (ownerId: string, executionContext?: HarnessExecutionContext) => {
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
                    const definitionIds = new Map<
                      string,
                      Id<"tool-definition">
                    >();
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
                      definitionIds.set(
                        mcpHarnessToolName(entry.name, tool.name),
                        definition.id,
                      );
                    }
                    return createMcpHarnessBindings({
                      client,
                      serverName: entry.name,
                      tools,
                      modeOverride: entry.binding.modeOverride,
                      ...(executionContext === undefined
                        ? {}
                        : {
                            durable: {
                              ...executionContext,
                              toolDefinitionIds: definitionIds,
                            },
                          }),
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
            onUsage: async (usage) => {
              await billingRepository.recordUsage({
                ownerId: typedOwnerId,
                idempotencyKey: `responses:${usage.responseId}`,
                category: "model",
                quantity: usage.totalTokens,
                unit: "tokens",
                metadata: {
                  model: environment.RESPONSES_MODEL,
                  responseId: usage.responseId,
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                },
              });
            },
            tools: (threadId, agentVersionId) => {
              const builtIns = [
                createTownSearchHarnessBinding(
                  typedOwnerId,
                  knowledgeSearchRepository,
                ),
                createTownContextHarnessBinding(
                  typedOwnerId,
                  knowledgeContextBuilder,
                ),
                createTownWebFetchHarnessBinding(),
                ...(voiceProvider === undefined
                  ? []
                  : [createTownVoiceSpeakHarnessBinding(voiceProvider)]),
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
  sql,
  identityService,
  accountRepository,
  profileRepository,
  memoryRepository,
  peopleRepository,
  wikiRepository,
  revisionRepository,
  knowledgeSearchRepository,
  knowledgeUpkeepScanner,
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
  adminAllowlistEmails: configuredAdminAllowlist,
  mcpRepository,
  routineRepository,
  routineResultRepository,
  googleApi,
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
  ...(environment.SLACK_SIGNING_SECRET === undefined
    ? {}
    : { slackSigningSecret: environment.SLACK_SIGNING_SECRET }),
  ...(environment.TWILIO_AUTH_TOKEN === undefined
    ? {}
    : { twilioAuthToken: environment.TWILIO_AUTH_TOKEN }),
  ...(voiceProvider === undefined ? {} : { voiceProvider }),
  ...(environment.VAPI_WEBHOOK_SECRET === undefined
    ? {}
    : { vapiWebhookSecret: environment.VAPI_WEBHOOK_SECRET }),
  workerEnabled:
    harnessServerFactory !== undefined &&
    (environment.WORKER_ENABLED ||
      (process.env["VERCEL"] === "1" &&
        (environment.WORKER_SECRET !== undefined ||
          environment.CRON_SECRET !== undefined))),
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
            toolExecution: toolExecutionRepository,
            approvalDecisions,
          }),
        },
        {
          workerId: process.env["WORKER_ID"] ?? `town-worker-${process.pid}`,
          onFinished: ({ ownerId, runId, state, errorCode }) =>
            finalizeRoutineRun({
              sql,
              routines: routineRepository,
              results: routineResultRepository,
              channels: channelRepository,
              ownerId,
              runtimeRunId: runId,
              state,
              ...(errorCode === undefined ? {} : { errorCode }),
            }),
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
      google: await googleRoutinePoller.poll(),
      calendar: await googleCalendarPoller.poll(),
      runtime:
        runtimeWorker === undefined
          ? undefined
          : await runtimeWorker.runBatch(environment.WORKER_BATCH_SIZE),
      channel: await channelRepository.deliverNext({
        workerId,
        sendEmail: async (value) => {
          await googleApi.gmailSend(value);
        },
        resolveCredential: async ({ credentialRef }) => {
          const credential = channelCredentials[credentialRef];
          if (credential === undefined)
            throw new Error("CHANNEL_CREDENTIAL_UNAVAILABLE");
          return credential;
        },
      }),
    });
  });
}

export default app;

if (process.env["VERCEL"] !== "1") {
  let workerTimer: ReturnType<typeof setTimeout> | undefined;
  const runWorker = async (): Promise<void> => {
    if (routineScheduler !== undefined) await routineScheduler();
    await googleRoutinePoller.poll();
    await googleCalendarPoller.poll();
    if (runtimeWorker !== undefined)
      await runtimeWorker.runBatch(environment.WORKER_BATCH_SIZE);
    await channelRepository.deliverNext({
      workerId,
      sendEmail: async (value) => {
        await googleApi.gmailSend(value);
      },
      resolveCredential: async ({ credentialRef }) => {
        const credential = channelCredentials[credentialRef];
        if (credential === undefined)
          throw new Error("CHANNEL_CREDENTIAL_UNAVAILABLE");
        return credential;
      },
    });
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
