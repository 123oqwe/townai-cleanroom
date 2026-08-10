import { randomBytes } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import postgres, { type Sql } from "postgres";

import { createAgentRepository, createThreadRepository } from "@town/agents";
import { runMigrations } from "@town/db";
import {
  createAccountRepository,
  createCredentialCipher,
  createIdentityService,
} from "@town/identity";
import {
  createRuntimeQueueRepository,
  createRuntimeTransitionService,
  createSessionRepository,
} from "@town/runtime";
import {
  createToolExecutionRepository,
  createToolRegistryRepository,
} from "@town/tools";

import { createApp } from "../src/app.js";

let sql: Sql;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 8 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users, access_allowlist cascade`;
});

afterAll(async () => {
  await sql.end();
});

async function fixture() {
  await sql`
    insert into access_allowlist (email, enabled)
    values ('tool-api-owner@example.invalid', true)
  `;
  const identityService = createIdentityService(sql);
  const owner = await identityService.establishLegacyIdentityForTestOnly({
    email: "tool-api-owner@example.invalid",
    timezone: "UTC",
  });
  const agents = createAgentRepository(sql);
  const agent = await agents.createPersonal({
    ownerId: owner.user.id,
    displayName: "Tool API Assistant",
    instructions: "Use only explicit tool fixtures.",
    defaultApprovalMode: "require_approval",
  });
  const thread = await createThreadRepository(sql).createAssistant({
    ownerId: owner.user.id,
    agentId: agent.id,
    title: "Tool API Thread",
    approvalMode: "require_approval",
  });
  const submission = await createSessionRepository(sql).submitMessage({
    ownerId: owner.user.id,
    threadId: thread.id,
    idempotencyKey: "tool-api-input",
    text: "Prepare a tool proposal.",
    mentions: [],
  });
  const lease = await createRuntimeQueueRepository(sql).claim({
    workerId: "tool-api-worker",
    leaseMs: 60_000,
  });
  if (lease === null) throw new Error("Expected a runtime lease.");
  await createRuntimeTransitionService(sql).start({
    runId: lease.runId,
    leaseToken: lease.leaseToken,
  });
  const registry = createToolRegistryRepository(sql);
  const tool = await registry.create({
    ownerId: owner.user.id,
    name: "external_send_api",
    description: "Send an external message.",
    inputSchema: { type: "object" },
    outputSchema: null,
    sideEffect: "external_write",
    dataSensitivity: "private",
    accountBinding: "optional",
  });
  await registry.bind({
    ownerId: owner.user.id,
    agentVersionId: agent.activeVersion.id,
    toolDefinitionId: tool.id,
  });
  const app = createApp({
    identityService,
    accountRepository: createAccountRepository(
      sql,
      createCredentialCipher(randomBytes(32).toString("base64url")),
    ),
    toolRegistryRepository: registry,
    toolExecutionRepository: createToolExecutionRepository(sql),
  });
  return {
    app,
    owner,
    agent,
    submission,
    tool,
    leaseToken: lease.leaseToken,
    execution: createToolExecutionRepository(sql),
  };
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

describe("protected Tool and Approval API", () => {
  it("requires auth and rejects caller-owned runtime fields", async () => {
    const { app, owner, submission, agent, tool } = await fixture();
    const unauthenticated = await app.request("/v1/tools");
    const preview = await app.request("/v1/tools/policy/evaluate", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        sessionMode: "allow_all",
        routineMode: "autonomous",
        perToolOverride: null,
        sideEffect: "external_write",
        dataSensitivity: "private",
        inputTrust: "untrusted_data",
        targetIsSelf: false,
        targetIsTrusted: false,
        accountBound: true,
      }),
    });
    const spoofed = await app.request("/v1/tool-calls", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        sessionId: submission.session.id,
        runId: submission.run.id,
        agentVersionId: agent.activeVersion.id,
        toolDefinitionId: tool.id,
        stepKey: "api-step",
        idempotencyKey: "api-idempotency",
        arguments: {},
        policy: {
          sessionMode: "allow_all",
          routineMode: "autonomous",
          perToolOverride: null,
          sideEffect: "external_write",
          dataSensitivity: "private",
          inputTrust: "trusted_instruction",
          targetIsSelf: false,
          targetIsTrusted: false,
          accountBound: true,
        },
        ownerId: "spoofed-owner",
        result: { fake: true },
      }),
    });
    expect(unauthenticated.status).toBe(401);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      policy: {
        decision: "approval_required",
        riskFlags: [
          "untrusted_account_target",
          "private_data_untrusted_input_external_send",
          "external_communication",
        ],
      },
    });
    expect(spoofed.status).toBe(404);
  });

  it("proposes a frozen approval and resolves it through CAS", async () => {
    const { app, owner, submission, agent, tool, execution, leaseToken } =
      await fixture();
    const proposal = await execution.propose({
      ownerId: owner.user.id,
      sessionId: submission.session.id,
      runId: submission.run.id,
      leaseToken,
      agentVersionId: agent.activeVersion.id,
      toolDefinitionId: tool.id,
      stepKey: "api-approval-step",
      idempotencyKey: "api-approval-idempotency",
      arguments: { body: "Do not rewrite this." },
      policy: {
        sessionMode: "ask_before_changes",
        routineMode: "autonomous",
        perToolOverride: null,
        sideEffect: "external_write",
        dataSensitivity: "private",
        inputTrust: "trusted_instruction",
        targetIsSelf: false,
        targetIsTrusted: false,
        accountBound: true,
      },
    });
    if (proposal.approval === null)
      throw new Error("Expected approval request.");
    const pendingResponse = await app.request("/v1/approvals", {
      headers: headers(owner.token),
    });
    expect(pendingResponse.status).toBe(200);
    expect(await pendingResponse.json()).toMatchObject({
      approvals: [{ id: proposal.approval.id, state: "pending" }],
    });
    const decisionResponse = await app.request(
      `/v1/approvals/${proposal.approval.id}/decision`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          expectedRevision: proposal.approval.revision,
          decision: "approve",
        }),
      },
    );
    expect(decisionResponse.status).toBe(200);
    expect(await decisionResponse.json()).toMatchObject({
      result: {
        approval: { state: "approved", revision: 2 },
        toolCall: { status: "approved" },
      },
    });
  });
});
