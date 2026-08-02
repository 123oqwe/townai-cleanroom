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
