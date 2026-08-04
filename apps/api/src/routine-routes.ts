import type { Hono } from "hono";
import type { Sql } from "postgres";
import { z } from "zod";

import { asId, newId } from "@town/contracts";
import type { AgentRepository } from "@town/agents";
import type { SessionRepository } from "@town/runtime";
import type { ThreadRepository } from "@town/agents";
import type { GoogleApiClient } from "@town/google";
import {
  getRoutineTemplate,
  listRoutineTemplates,
  RoutineError,
  routineTriggerKindSchema,
  type RoutineRepository,
  type RoutineResultRepository,
} from "@town/routines";
import type { AuthVariables } from "./auth.js";
import { acceptsHtml, routineShareHtml } from "./public-share-html.js";

export interface RoutineDependencies {
  repository: RoutineRepository;
  sql?: Sql;
  results?: RoutineResultRepository;
  google?: GoogleApiClient;
  agents?: AgentRepository;
  threads?: ThreadRepository;
  sessions?: SessionRepository;
}

const createRoutineSchema = z
  .object({
    agentId: z.uuidv7(),
    agentVersionId: z.uuidv7(),
    name: z.string().trim().min(1).max(120),
    cron: z.string().trim().min(1),
    timezone: z.string().trim().min(1).max(100).default("UTC"),
    nextRunAt: z.iso.datetime(),
    enabled: z.boolean().default(true),
  })
  .strict();
const updateRoutineSchema = createRoutineSchema
  .extend({ expectedRevision: z.number().int().positive() })
  .strict();
const triggerRoutineSchema = z
  .object({ input: z.string().trim().min(1).max(50_000) })
  .strict();
const externalTriggerSchema = z
  .object({
    kind: z.enum([
      "incoming_email",
      "calendar",
      "voice_transcribed",
      "slack_mention",
      "webhook",
    ]),
    data: z.record(z.string(), z.json()),
  })
  .strict();
const installRoutineSchema = z
  .object({
    token: z.string().startsWith("rtnshare_").min(20),
    name: z.string().trim().min(1).max(120).optional(),
    nextRunAt: z.iso.datetime(),
    enabled: z.boolean().default(true),
  })
  .strict();
const installTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    cron: z.string().trim().min(1).max(200),
    timezone: z.string().trim().min(1).max(100).default("UTC"),
    nextRunAt: z.iso.datetime(),
    enabled: z.boolean().default(true),
  })
  .strict();
const triggerCreateSchema = z
  .object({
    kind: routineTriggerKindSchema,
    config: z.record(z.string(), z.json()).default({}),
    enabled: z.boolean().default(true),
  })
  .strict();
const gmailIngestSchema = z
  .object({
    accountId: z.uuidv7(),
    query: z.string().trim().min(1).max(500).optional(),
    maxResults: z.number().int().min(1).max(100).default(10),
  })
  .strict();

export function registerRoutineRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: RoutineDependencies,
): void {
  const resultRepository = dependencies.results;
  if (resultRepository !== undefined) {
    app.get("/v1/routine-results", async (context) => {
      const ownerId = context.get("identity").user.id;
      const query = z
        .object({
          sessionId: z.uuidv7(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .strict()
        .parse(context.req.query());
      return context.json({
        results: await resultRepository.listForSession(
          ownerId,
          asId<"runtime-session">(query.sessionId),
          query.limit,
        ),
      });
    });
  }

  app.get("/v1/routines", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      routines: await dependencies.repository.list(ownerId),
    });
  });

  app.get("/v1/routines/:routineId/versions", async (context) => {
    if (dependencies.agents === undefined)
      return context.json({ error: "AGENTS_NOT_CONFIGURED" }, 503);
    const ownerId = context.get("identity").user.id;
    const routine = await dependencies.repository.get(
      ownerId,
      asId<"routine-schedule">(
        z.uuidv7().parse(context.req.param("routineId")),
      ),
    );
    const query = z
      .object({
        cursor: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .strict()
      .parse(context.req.query());
    return context.json(
      await dependencies.agents.listVersions({
        ownerId,
        agentId: routine.agentId,
        kind: "routine",
        ...query,
      }),
    );
  });

  app.get("/v1/routine-templates", (context) =>
    context.json({ templates: listRoutineTemplates() }),
  );

  app.post("/v1/routine-templates/:templateId/install", async (context) => {
    const ownerId = context.get("identity").user.id;
    const template = getRoutineTemplate(context.req.param("templateId"));
    if (template === undefined)
      return context.json({ error: "ROUTINE_TEMPLATE_NOT_FOUND" }, 404);
    if (dependencies.sql === undefined || dependencies.agents === undefined)
      return context.json({ error: "ROUTINE_INSTALL_NOT_CONFIGURED" }, 503);
    const input = installTemplateSchema.parse(await context.req.json());
    const name = input.name ?? template.name;
    const agentId = newId<"agent">();
    const versionId = newId<"agent-version">();
    const scheduleId = newId<"routine-schedule">();
    const snapshot = {
      displayName: template.name,
      instructions: template.setupPrompt,
      defaultApprovalMode: template.defaultApprovalMode,
      callableRoutineIds: [],
    } as const;
    await dependencies.sql.begin(async (transaction) => {
      const [duplicate] = await transaction<{ id: string }[]>`
        select id from routine_schedules
        where owner_id=${ownerId} and lower(name)=lower(${name})
        limit 1
      `;
      if (duplicate !== undefined)
        throw new RoutineError(
          "ROUTINE_CONFLICT",
          "A routine with this name already exists.",
        );
      await transaction`
        insert into agents (id, owner_id, kind, revision, status)
        values (${agentId}, ${ownerId}, 'routine', 1, 'active')
      `;
      await transaction`
        insert into agent_versions
          (id, owner_id, agent_id, version, snapshot, created_by)
        values
          (${versionId}, ${ownerId}, ${agentId}, 1,
           ${transaction.json(snapshot)}, 'system')
      `;
      await transaction`
        update agents set active_version_id=${versionId}
        where owner_id=${ownerId} and id=${agentId}
      `;
      await transaction`
        insert into routine_schedules
          (id, owner_id, agent_id, agent_version_id, name, cron, timezone,
           next_run_at, enabled)
        values
          (${scheduleId}, ${ownerId}, ${agentId}, ${versionId}, ${name},
           ${input.cron}, ${input.timezone}, ${new Date(input.nextRunAt)},
           ${input.enabled})
      `;
    });
    return context.json(
      {
        template,
        agent: await dependencies.agents.getRoutine(ownerId, agentId),
        routine: await dependencies.repository.get(ownerId, scheduleId),
      },
      201,
    );
  });

  app.post("/v1/routine-runs/:runId/replay", async (context) => {
    const ownerId = context.get("identity").user.id;
    const idempotencyKey = z
      .string()
      .trim()
      .min(1)
      .max(500)
      .parse(context.req.header("Idempotency-Key"));
    const run = await dependencies.repository.replayRun(
      ownerId,
      asId<"integration-sync-run">(
        z.uuidv7().parse(context.req.param("runId")),
      ),
      idempotencyKey,
    );
    return context.json({ run }, 202);
  });

  app.get("/v1/routine-runs/:runId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const run = await dependencies.repository.getRun(
      ownerId,
      asId<"integration-sync-run">(
        z.uuidv7().parse(context.req.param("runId")),
      ),
    );
    if (run === null) return context.json({ error: "RUN_NOT_FOUND" }, 404);
    const result =
      resultRepository !== undefined && run.runtimeRunId !== null
        ? await resultRepository.getForRun(ownerId, run.runtimeRunId)
        : null;
    return context.json({ run, result });
  });

  app.get("/v1/routines/:routineId/runs", async (context) => {
    const ownerId = context.get("identity").user.id;
    const routineId = asRoutineId(context.req.param("routineId"));
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
      .strict()
      .parse(context.req.query());
    if (!(await dependencies.repository.ownsSchedule(ownerId, routineId)))
      return context.json({ error: "ROUTINE_NOT_FOUND" }, 404);
    return context.json({
      runs: await dependencies.repository.listRuns(
        ownerId,
        routineId,
        query.limit,
      ),
    });
  });

  app.get("/v1/routines/:routineId/triggers", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      triggers: await dependencies.repository.listTriggers(
        ownerId,
        asRoutineId(context.req.param("routineId")),
      ),
    });
  });

  app.post("/v1/routines/:routineId/ingest/email", async (context) => {
    if (dependencies.google === undefined)
      return context.json({ error: "GOOGLE_CONNECTOR_NOT_CONFIGURED" }, 503);
    const ownerId = context.get("identity").user.id;
    const routineId = asRoutineId(context.req.param("routineId"));
    const body = gmailIngestSchema.parse(await context.req.json());
    const trigger = (
      await dependencies.repository.listTriggers(ownerId, routineId)
    ).find(
      (candidate) =>
        candidate.enabled &&
        (candidate.kind === "incoming_email" ||
          candidate.kind === "email_to_assistant"),
    );
    if (trigger === undefined)
      return context.json({ error: "EMAIL_TRIGGER_NOT_CONFIGURED" }, 409);
    const configuredQuery = trigger.config["query"];
    const query =
      body.query ??
      (typeof configuredQuery === "string"
        ? configuredQuery
        : "in:anywhere newer_than:1d");
    const accountId = asId<"connected-account">(body.accountId);
    const found = await dependencies.google.gmailSearch({
      ownerId,
      accountId,
      query,
      maxResults: body.maxResults,
    });
    const runs = [];
    for (const message of found.messages) {
      const detail = await dependencies.google.gmailGetMessage({
        ownerId,
        accountId,
        messageId: message.id,
      });
      const detailLabels = detail["labelIds"] ?? message["labelIds"] ?? [];
      runs.push(
        await dependencies.repository.queueTrigger(
          ownerId,
          routineId,
          "incoming_email",
          {
            provider: "google_gmail",
            accountId,
            messageId: message.id,
            threadId: message.threadId,
            labels: detailLabels,
            payload: detail.payload ?? null,
          },
          `gmail:${accountId}:${message.id}`,
          accountId,
        ),
      );
    }
    return context.json(
      { query, runs, nextPageToken: found.nextPageToken },
      202,
    );
  });

  app.post("/v1/routines/:routineId/triggers", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = triggerCreateSchema.parse(await context.req.json());
    return context.json(
      {
        trigger: await dependencies.repository.createTrigger({
          ownerId,
          routineScheduleId: asRoutineId(context.req.param("routineId")),
          ...body,
        }),
      },
      201,
    );
  });

  app.patch("/v1/routine-triggers/:triggerId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = z
      .object({
        expectedRevision: z.number().int().positive(),
        config: z.record(z.string(), z.json()).default({}),
        enabled: z.boolean(),
      })
      .strict()
      .parse(await context.req.json());
    return context.json({
      trigger: await dependencies.repository.updateTrigger({
        ownerId,
        triggerId: asId<"routine-trigger">(
          z.uuidv7().parse(context.req.param("triggerId")),
        ),
        ...body,
      }),
    });
  });

  app.delete("/v1/routine-triggers/:triggerId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = z
      .object({ expectedRevision: z.coerce.number().int().positive() })
      .strict()
      .parse(context.req.query());
    await dependencies.repository.removeTrigger(
      ownerId,
      asId<"routine-trigger">(z.uuidv7().parse(context.req.param("triggerId"))),
      query.expectedRevision,
    );
    return context.body(null, 204);
  });

  app.post("/v1/routines", async (context) => {
    const ownerId = context.get("identity").user.id;
    const input = createRoutineSchema.parse(await context.req.json());
    const routine = await dependencies.repository.create({
      ...input,
      ownerId,
      nextRunAt: new Date(input.nextRunAt),
    });
    return context.json({ routine }, 201);
  });

  app.post("/v1/routines/install", async (context) => {
    const ownerId = context.get("identity").user.id;
    const input = installRoutineSchema.parse(await context.req.json());
    const installed = await dependencies.repository.installShare({
      ownerId,
      token: input.token,
      ...(input.name === undefined ? {} : { name: input.name }),
      nextRunAt: new Date(input.nextRunAt),
      enabled: input.enabled,
    });
    return context.json(installed, 201);
  });

  app.post("/v1/routines/:routineId/run", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = triggerRoutineSchema.parse(await context.req.json());
    if (typeof dependencies.repository.queueTrigger === "function") {
      const routineId = asRoutineId(context.req.param("routineId"));
      const idempotencyKey =
        context.req.header("Idempotency-Key") ??
        `manual:${routineId}:${newId<"integration-sync-run">()}`;
      return context.json(
        {
          run: await dependencies.repository.queueTrigger(
            ownerId,
            routineId,
            "manual",
            { input: body.input },
            idempotencyKey,
          ),
        },
        202,
      );
    }
    if (
      dependencies.agents === undefined ||
      dependencies.threads === undefined ||
      dependencies.sessions === undefined
    )
      return context.json({ error: "RUNTIME_NOT_CONFIGURED" }, 503);
    const routine = await dependencies.repository.get(
      ownerId,
      asRoutineId(context.req.param("routineId")),
    );
    const agent = await dependencies.agents.getRoutine(
      ownerId,
      routine.agentId,
    );
    const thread = await dependencies.threads.createTask({
      ownerId,
      agentId: agent.id,
      title: routine.name,
      approvalMode: agent.activeVersion.snapshot.defaultApprovalMode,
    });
    const idempotencyKey =
      context.req.header("Idempotency-Key") ??
      `routine:${routine.id}:${newId<"session-run">()}`;
    return context.json(
      await dependencies.sessions.submitMessage({
        ownerId,
        threadId: thread.id,
        idempotencyKey,
        text: body.input,
        mentions: [],
      }),
      202,
    );
  });

  app.post("/v1/routines/:routineId/trigger", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = externalTriggerSchema.parse(await context.req.json());
    const idempotencyKey = z
      .string()
      .trim()
      .min(1)
      .max(500)
      .parse(context.req.header("Idempotency-Key"));
    if (typeof dependencies.repository.queueTrigger !== "function")
      return context.json({ error: "TRIGGER_QUEUE_NOT_CONFIGURED" }, 503);
    return context.json(
      {
        run: await dependencies.repository.queueTrigger(
          ownerId,
          asRoutineId(context.req.param("routineId")),
          body.kind,
          body.data,
          idempotencyKey,
        ),
      },
      202,
    );
  });

  app.patch("/v1/routines/:routineId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const input = updateRoutineSchema.parse(await context.req.json());
    const routine = await dependencies.repository.update({
      ...input,
      id: context.req.param("routineId"),
      ownerId,
      nextRunAt: new Date(input.nextRunAt),
    });
    return context.json({ routine });
  });

  app.delete("/v1/routines/:routineId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = z
      .object({ expectedRevision: z.coerce.number().int().positive() })
      .strict()
      .parse(context.req.query());
    await dependencies.repository.remove(
      ownerId,
      asRoutineId(context.req.param("routineId")),
      query.expectedRevision,
    );
    return context.body(null, 204);
  });

  app.get("/v1/routines/:routineId/webhook", async (context) => {
    const ownerId = context.get("identity").user.id;
    const webhook = await dependencies.repository.getWebhook(
      ownerId,
      asRoutineId(context.req.param("routineId")),
    );
    return webhook
      ? context.json({ webhook })
      : context.json({ error: "WEBHOOK_NOT_FOUND" }, 404);
  });

  app.post("/v1/routines/:routineId/webhook", async (context) => {
    const ownerId = context.get("identity").user.id;
    const result = await dependencies.repository.createWebhook(
      ownerId,
      asRoutineId(context.req.param("routineId")),
    );
    return context.json(result, 201);
  });

  app.patch("/v1/routines/:routineId/webhook", async (context) => {
    const ownerId = context.get("identity").user.id;
    const input = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(await context.req.json());
    return context.json({
      webhook: await dependencies.repository.setWebhookEnabled(
        ownerId,
        asRoutineId(context.req.param("routineId")),
        input.enabled,
      ),
    });
  });

  app.post("/v1/routines/:routineId/shares", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = z
      .object({ expiresAt: z.iso.datetime().nullable().optional() })
      .strict()
      .parse(await context.req.json());
    const result = await dependencies.repository.createShare({
      ownerId,
      routineScheduleId: asRoutineId(context.req.param("routineId")),
      ...(body.expiresAt === undefined
        ? {}
        : {
            expiresAt:
              body.expiresAt === null ? null : new Date(body.expiresAt),
          }),
    });
    return context.json(result, 201);
  });

  app.delete("/v1/routines/shares/:shareId", async (context) => {
    await dependencies.repository.revokeShare(
      context.get("identity").user.id,
      asId<"routine-share">(z.uuidv7().parse(context.req.param("shareId"))),
    );
    return context.body(null, 204);
  });
}

export function registerRoutineShareRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: Pick<RoutineDependencies, "repository">,
): void {
  app.get("/v1/routine-shares/:token", async (context) => {
    const share = await dependencies.repository.getPublicShare(
      context.req.param("token"),
    );
    return share
      ? acceptsHtml(context.req.raw)
      ? context.html(routineShareHtml(share))
      : context.json({ share })
      : context.json({ error: "SHARE_NOT_FOUND" }, 404);
  });
  app.get("/content/routines/shared/:token", async (context) => {
    const share = await dependencies.repository.getPublicShare(
      context.req.param("token"),
    );
    return share
      ? acceptsHtml(context.req.raw)
        ? context.html(routineShareHtml(share))
        : context.json({ share })
      : context.json({ error: "SHARE_NOT_FOUND" }, 404);
  });
}

export function registerRoutineWebhookRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: RoutineDependencies,
): void {
  app.post("/v1/routine-webhooks/:routineId", async (context) => {
    const contentType = context.req.header("content-type")?.split(";", 1)[0];
    if (contentType !== "application/json" && contentType !== "text/plain")
      return context.json({ error: "UNSUPPORTED_CONTENT_TYPE" }, 415);
    const authorization = context.req.header("Authorization");
    const secret = authorization?.match(/^Bearer ([^\s,]+)$/)?.[1];
    const idempotencyKey = context.req.header("X-Town-Idempotency-Key");
    if (!secret || !idempotencyKey)
      return context.json({ error: "NOT_FOUND" }, 404);
    const raw = await context.req.text();
    if (Buffer.byteLength(raw, "utf8") > 256_000)
      return context.json({ error: "PAYLOAD_TOO_LARGE" }, 413);
    let payload: Record<string, unknown>;
    if (contentType === "application/json") {
      try {
        const parsed: unknown = JSON.parse(raw);
        payload = z.record(z.string(), z.unknown()).parse(parsed);
      } catch {
        return context.json({ error: "INVALID_JSON" }, 400);
      }
    } else {
      payload = { text: raw };
    }
    const delivery = await dependencies.repository.deliverWebhook(
      asRoutineId(context.req.param("routineId")),
      secret,
      idempotencyKey,
      payload,
    );
    if (!delivery) return context.json({ error: "NOT_FOUND" }, 404);
    return context.json(
      { runId: delivery.runId, duplicate: delivery.duplicate },
      202,
    );
  });
}

function asRoutineId(value: string) {
  return asId<"routine-schedule">(z.uuidv7().parse(value));
}
