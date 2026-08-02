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
import { createSessionRepository } from "@town/runtime";
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
  const owner = await identityService.establishIdentity({
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
  const registry = createToolRegistryRepository(sql);
  const tool = await registry.create({
    ownerId: owner.user.id,
    name: "external_send_api",
    description: "Send an external message.",
    inputSchema: { type: "object" },
    outputSchema: null,
    sideEffect: "external_write",
    dataSensitivity: "private",
    accountBinding: "required",
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
  return { app, owner, agent, submission, tool };
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
    expect(spoofed.status).toBe(400);
  });

  it("proposes a frozen approval and resolves it through CAS", async () => {
    const { app, owner, submission, agent, tool } = await fixture();
    const proposalResponse = await app.request("/v1/tool-calls", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        sessionId: submission.session.id,
        runId: submission.run.id,
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
      }),
    });
    expect(proposalResponse.status).toBe(202);
    const proposal = (await proposalResponse.json()) as {
      approval: { id: string; revision: number };
    };
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
