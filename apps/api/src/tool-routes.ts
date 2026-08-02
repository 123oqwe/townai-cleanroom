import type { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import {
  type ToolExecutionRepository,
  type ToolRegistryRepository,
} from "@town/tools";

import type { AuthVariables } from "./auth.js";

export interface ToolDependencies {
  registry: ToolRegistryRepository;
  execution: ToolExecutionRepository;
}

const jsonObjectSchema = z.record(z.string(), z.json());
const toolProposalSchema = z
  .object({
    sessionId: z.uuidv7(),
    runId: z.uuidv7(),
    agentVersionId: z.uuidv7(),
    toolDefinitionId: z.uuidv7(),
    stepKey: z.string().trim().min(1).max(200),
    idempotencyKey: z.string().trim().min(1).max(500),
    arguments: jsonObjectSchema,
    policy: z
      .object({
        sessionMode: z.enum([
          "ask_before_changes",
          "allow_safe_actions",
          "allow_all",
        ]),
        routineMode: z.enum(["read_only", "approval_required", "autonomous"]),
        perToolOverride: z
          .enum(["read_only", "approval_required", "autonomous"])
          .nullable(),
        sideEffect: z.enum([
          "read",
          "private_write",
          "external_write",
          "destructive",
        ]),
        dataSensitivity: z.enum(["public", "private", "restricted"]),
        inputTrust: z.enum([
          "trusted_instruction",
          "trusted_data",
          "untrusted_data",
        ]),
        targetIsSelf: z.boolean(),
        targetIsTrusted: z.boolean(),
        accountBound: z.boolean(),
      })
      .strict(),
    approvalExpiresAt: z.iso.datetime().nullable().optional(),
  })
  .strict();

const decisionSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(2_000).optional(),
  })
  .strict();

export function registerToolRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: ToolDependencies,
): void {
  app.get("/v1/tools", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({ tools: await dependencies.registry.list(ownerId) });
  });

  app.get("/v1/tool-calls/:toolCallId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const toolCallId = asId<"tool-call">(context.req.param("toolCallId"));
    return context.json({
      toolCall: await dependencies.execution.getCall(ownerId, toolCallId),
    });
  });

  app.post("/v1/tool-calls", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = toolProposalSchema.parse(await context.req.json());
    const result = await dependencies.execution.propose({
      ...body,
      ownerId,
      sessionId: asId<"runtime-session">(body.sessionId),
      runId: asId<"session-run">(body.runId),
      agentVersionId: asId<"agent-version">(body.agentVersionId),
      toolDefinitionId: asId<"tool-definition">(body.toolDefinitionId),
      approvalExpiresAt:
        body.approvalExpiresAt === undefined || body.approvalExpiresAt === null
          ? (body.approvalExpiresAt ?? null)
          : new Date(body.approvalExpiresAt),
    });
    return context.json(result, 202);
  });

  app.get("/v1/approvals/:approvalId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const approvalId = asId<"approval-request">(
      context.req.param("approvalId"),
    );
    return context.json({
      approval: await dependencies.execution.getApproval(ownerId, approvalId),
    });
  });

  app.post("/v1/approvals/:approvalId/decision", async (context) => {
    const ownerId = context.get("identity").user.id;
    const approvalId = asId<"approval-request">(
      context.req.param("approvalId"),
    );
    const body = decisionSchema.parse(await context.req.json());
    return context.json({
      result: await dependencies.execution.decideApproval({
        ownerId,
        approvalId,
        decidedBy: ownerId,
        expectedRevision: body.expectedRevision,
        decision: body.decision,
        ...(body.note === undefined ? {} : { note: body.note }),
      }),
    });
  });
}
