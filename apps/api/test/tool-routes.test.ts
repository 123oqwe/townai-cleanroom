import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import * as tools from "@town/tools";
import type {
  ToolRegistryRepository,
  ToolExecutionRepository,
} from "@town/tools";
import type { AuthVariables } from "../src/auth.js";
import { registerToolRoutes } from "../src/tool-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const toolCallId = asId<"tool-call">("01900000-0000-7000-8000-000000000002");
const approvalId = asId<"approval-request">(
  "01900000-0000-7000-8000-000000000003",
);
const toolDefinitionId = asId<"tool-definition">(
  "01900000-0000-7000-8000-000000000004",
);

function withErrorMapping(app: Hono<{ Variables: AuthVariables }>) {
  app.onError((error, context) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return context.json({ code: "INVALID_REQUEST" }, 400);
    return context.json({ code: "INTERNAL_ERROR" }, 500);
  });
}

function withIdentity(app: Hono<{ Variables: AuthVariables }>) {
  app.use("*", async (context, next) => {
    context.set("identity", { user: { id: ownerId, email: "owner@example.invalid" } });
    await next();
  });
}

function buildToolApp(
  registry: ToolRegistryRepository,
  execution: ToolExecutionRepository,
) {
  const app = new Hono<{ Variables: AuthVariables }>();
  withErrorMapping(app);
  withIdentity(app);
  registerToolRoutes(app, { registry, execution });
  return app;
}

describe("tool routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists tools, evaluates policy, and resolves tool-call/approval resources", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const toolsList = [
      {
        id: toolDefinitionId,
        ownerId,
        name: "weather.get",
        version: 1,
        description: "Get weather",
        inputSchema: { location: "string" },
        outputSchema: { temp: "number" },
        sideEffect: "read" as const,
        dataSensitivity: "public" as const,
        accountBinding: "none" as const,
        enabled: true,
        createdAt: now,
      },
    ];
    const toolCall = {
      id: toolCallId,
      ownerId,
      sessionId: asId<"runtime-session">(
        "01900000-0000-7000-8000-000000000005",
      ),
      runId: asId<"session-run">("01900000-0000-7000-8000-000000000006"),
      agentVersionId: asId<"agent-version">(
        "01900000-0000-7000-8000-000000000007",
      ),
      toolDefinitionId,
      policyDecisionId: asId<"policy-decision">(
        "01900000-0000-7000-8000-000000000008",
      ),
      stepKey: "step-1",
      argumentHash: "a1",
      arguments: { city: "Tokyo" },
      status: "proposed" as const,
      approvalRequestId: null,
      result: null,
      errorCode: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
    };
    const approval = {
      id: approvalId,
      ownerId,
      sessionId: asId<"runtime-session">(
        "01900000-0000-7000-8000-000000000009",
      ),
      runId: asId<"session-run">("01900000-0000-7000-8000-000000000006"),
      toolCallId,
      argumentHash: "a1",
      arguments: { city: "Tokyo" },
      state: "pending" as const,
      revision: 1,
      expiresAt: null,
      decidedAt: null,
      decidedBy: null,
      decisionNote: null,
    };
    const approvals = [approval];
    const decision = { approvalId, sessionId: approval.sessionId, status: "decided" };
    const registry = {
      list: vi.fn(async () => toolsList),
    } as unknown as ToolRegistryRepository;
    const execution = {
      getCall: vi.fn(async () => toolCall),
      getApproval: vi.fn(async () => approval),
      listApprovals: vi.fn(async () => approvals),
      decideApproval: vi.fn(async () => decision),
    } as unknown as ToolExecutionRepository;

    const evaluatePolicySpy = vi
      .spyOn(tools, "evaluatePolicy")
      .mockReturnValue({
        decision: "allow",
        riskFlags: [],
        rationale: "automated policy",
      });

    const app = buildToolApp(registry, execution);

    const toolsResponse = await app.request("http://town.test/v1/tools");
    expect(toolsResponse.status).toBe(200);
    expect(await toolsResponse.json()).toMatchObject({
      tools: [
        {
          ...toolsList[0],
          createdAt: now.toISOString(),
        },
      ],
    });
    expect(registry.list).toHaveBeenCalledWith(ownerId);

    const policy = await app.request("http://town.test/v1/tools/policy/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionMode: "ask_before_changes",
        routineMode: "read_only",
        perToolOverride: null,
        sideEffect: "read",
        dataSensitivity: "public",
        inputTrust: "trusted_instruction",
        targetIsSelf: true,
        targetIsTrusted: false,
        accountBound: false,
      }),
    });
    expect(policy.status).toBe(200);
    expect(await policy.json()).toMatchObject({
      policy: {
        decision: "allow",
        riskFlags: [],
        rationale: "automated policy",
      },
    });
    expect(evaluatePolicySpy).toHaveBeenCalledWith({
      sessionMode: "ask_before_changes",
      routineMode: "read_only",
      perToolOverride: null,
      sideEffect: "read",
      dataSensitivity: "public",
      inputTrust: "trusted_instruction",
      targetIsSelf: true,
      targetIsTrusted: false,
      accountBound: false,
    });

    const toolCallResponse = await app.request(
      `http://town.test/v1/tool-calls/${toolCallId}`,
    );
    expect(toolCallResponse.status).toBe(200);
    expect(await toolCallResponse.json()).toMatchObject({
      toolCall: {
        ...toolCall,
        createdAt: now.toISOString(),
      },
    });
    expect(execution.getCall).toHaveBeenCalledWith(ownerId, toolCallId);

    const getApprovalResponse = await app.request(
      `http://town.test/v1/approvals/${approvalId}`,
    );
    expect(getApprovalResponse.status).toBe(200);
    expect(await getApprovalResponse.json()).toMatchObject({
      approval: { ...approval, decidedAt: null, decidedBy: null },
    });
    expect(execution.getApproval).toHaveBeenCalledWith(ownerId, approvalId);

    const listPending = await app.request("http://town.test/v1/approvals");
    const listApproved = await app.request(
      "http://town.test/v1/approvals?state=approved",
    );
    expect(listPending.status).toBe(200);
    expect(await listPending.json()).toMatchObject({ approvals: approvals });
    expect(listApproved.status).toBe(200);
    expect(await listApproved.json()).toMatchObject({ approvals: approvals });
    expect(execution.listApprovals).toHaveBeenCalledWith(ownerId, "pending");
    expect(execution.listApprovals).toHaveBeenCalledWith(ownerId, "approved");

    const decide = await app.request(
      `http://town.test/v1/approvals/${approvalId}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          decision: "approve",
          note: "Looks safe.",
        }),
      },
    );
    expect(decide.status).toBe(200);
    expect(await decide.json()).toMatchObject({ result: decision });
    expect(execution.decideApproval).toHaveBeenCalledWith({
      ownerId,
      approvalId,
      decidedBy: ownerId,
      expectedRevision: 1,
      decision: "approve",
      note: "Looks safe.",
    });
  });

  it("rejects malformed tool route requests", async () => {
    const registry = {
      list: vi.fn(async () => []),
    } as unknown as ToolRegistryRepository;
    const execution = {
      getCall: vi.fn(async () => ({})),
      getApproval: vi.fn(async () => ({})),
      listApprovals: vi.fn(async () => []),
      decideApproval: vi.fn(async () => ({})),
    } as unknown as ToolExecutionRepository;
    const app = buildToolApp(registry, execution);

    const badPolicy = await app.request(
      "http://town.test/v1/tools/policy/evaluate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionMode: "ask_before_changes" }),
      },
    );
    const badDecision = await app.request(
      `http://town.test/v1/approvals/${approvalId}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: 1, decision: "maybe" }),
      },
    );
    const badListApprovals = await app.request(
      "http://town.test/v1/approvals?state=weird",
    );

    expect(await badPolicy.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await badDecision.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await badListApprovals.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
  });
});
