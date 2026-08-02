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
import { newId, type Id } from "@town/contracts";
import { runMigrations } from "@town/db";
import {
  createRuntimeQueueRepository,
  createRuntimeTransitionService,
  createSessionRepository,
} from "@town/runtime";

import {
  createToolExecutionRepository,
  createToolRegistryRepository,
} from "../src/index.js";

let sql: Sql;
let ownerId: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 8 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  await sql`
    insert into users (id, email, timezone)
    values (${ownerId}, 'execution-owner@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

async function fixture() {
  const agent = await createAgentRepository(sql).createPersonal({
    ownerId,
    displayName: "Tool Execution Fixture",
    instructions: "Use only explicit tool fixtures.",
    defaultApprovalMode: "require_approval",
  });
  const thread = await createThreadRepository(sql).createAssistant({
    ownerId,
    agentId: agent.id,
    title: "Tool execution fixture",
    approvalMode: "require_approval",
  });
  const submission = await createSessionRepository(sql).submitMessage({
    ownerId,
    threadId: thread.id,
    idempotencyKey: "tool-execution-input",
    text: "Propose the explicit tool call.",
    mentions: [],
  });
  const lease = await createRuntimeQueueRepository(sql).claim({
    workerId: "tools-test-worker",
    leaseMs: 60_000,
  });
  if (lease === null) throw new Error("Expected a runtime lease.");
  await createRuntimeTransitionService(sql).start({
    runId: lease.runId,
    leaseToken: lease.leaseToken,
  });
  const tool = await createToolRegistryRepository(sql).create({
    ownerId,
    name: "send_external",
    description: "Send an external message.",
    inputSchema: { type: "object" },
    outputSchema: null,
    sideEffect: "external_write",
    dataSensitivity: "private",
    accountBinding: "required",
  });
  await createToolRegistryRepository(sql).bind({
    ownerId,
    agentVersionId: agent.activeVersion.id,
    toolDefinitionId: tool.id,
  });
  return { agent, submission, tool };
}

describe("durable ToolCall proposals and approvals", () => {
  it("freezes normalized arguments, persists policy, and requires approval", async () => {
    const seeded = await fixture();
    const execution = createToolExecutionRepository(sql);
    const proposed = await execution.propose({
      ownerId,
      sessionId: seeded.submission.session.id,
      runId: seeded.submission.run.id,
      agentVersionId: seeded.agent.activeVersion.id,
      toolDefinitionId: seeded.tool.id,
      stepKey: "send-step",
      idempotencyKey: "send-1",
      arguments: { recipient: "external@example.invalid", body: "Frozen body" },
      policy: {
        sessionMode: "allow_all",
        routineMode: "autonomous",
        perToolOverride: null,
        sideEffect: "external_write",
        dataSensitivity: "private",
        inputTrust: "untrusted_data",
        targetIsSelf: false,
        targetIsTrusted: false,
        accountBound: true,
      },
    });
    expect(proposed).toMatchObject({
      replayed: false,
      toolCall: {
        status: "waiting_approval",
        arguments: { body: "Frozen body" },
      },
      approval: {
        state: "pending",
        revision: 1,
        arguments: { recipient: "external@example.invalid" },
      },
    });
    const events = await sql<{ kind: string }[]>`
      select kind from session_events where session_id = ${seeded.submission.session.id}
      order by sequence
    `;
    expect(events.map(({ kind }) => kind).slice(-3)).toEqual([
      "tool_call_proposed",
      "policy_decided",
      "approval_requested",
    ]);
    const replay = await execution.propose({
      ownerId,
      sessionId: seeded.submission.session.id,
      runId: seeded.submission.run.id,
      agentVersionId: seeded.agent.activeVersion.id,
      toolDefinitionId: seeded.tool.id,
      stepKey: "send-step",
      idempotencyKey: "send-1",
      arguments: { body: "Frozen body", recipient: "external@example.invalid" },
      policy: {
        sessionMode: "allow_all",
        routineMode: "autonomous",
        perToolOverride: null,
        sideEffect: "external_write",
        dataSensitivity: "private",
        inputTrust: "untrusted_data",
        targetIsSelf: false,
        targetIsTrusted: false,
        accountBound: true,
      },
    });
    expect(replay.replayed).toBe(true);
    await expect(
      execution.propose({
        ownerId,
        sessionId: seeded.submission.session.id,
        runId: seeded.submission.run.id,
        agentVersionId: seeded.agent.activeVersion.id,
        toolDefinitionId: seeded.tool.id,
        stepKey: "send-step",
        idempotencyKey: "send-1",
        arguments: { body: "changed" },
        policy: {
          sessionMode: "allow_all",
          routineMode: "autonomous",
          perToolOverride: null,
          sideEffect: "external_write",
          dataSensitivity: "private",
          inputTrust: "untrusted_data",
          targetIsSelf: false,
          targetIsTrusted: false,
          accountBound: true,
        },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("approves the frozen action with CAS and rejects stale decisions", async () => {
    const seeded = await fixture();
    const execution = createToolExecutionRepository(sql);
    const proposed = await execution.propose({
      ownerId,
      sessionId: seeded.submission.session.id,
      runId: seeded.submission.run.id,
      agentVersionId: seeded.agent.activeVersion.id,
      toolDefinitionId: seeded.tool.id,
      stepKey: "approve-step",
      idempotencyKey: "approve-1",
      arguments: { body: "Keep this" },
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
    if (proposed.approval === null)
      throw new Error("Expected approval request.");
    const approved = await execution.decideApproval({
      ownerId,
      approvalId: proposed.approval.id,
      expectedRevision: 1,
      decidedBy: ownerId,
      decision: "approve",
      note: "Approved in fixture",
    });
    expect(approved).toMatchObject({
      approval: {
        state: "approved",
        revision: 2,
        arguments: { body: "Keep this" },
      },
      toolCall: { status: "approved" },
    });
    await expect(
      execution.decideApproval({
        ownerId,
        approvalId: proposed.approval.id,
        expectedRevision: 1,
        decidedBy: ownerId,
        decision: "reject",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REVISION_CONFLICT" });
  });

  it("rejects semantic idempotency reuse and expired approval", async () => {
    const seeded = await fixture();
    const registry = createToolRegistryRepository(sql);
    const secondTool = await registry.create({
      ownerId,
      name: "another_external_send",
      description: "A distinct external tool.",
      inputSchema: { type: "object" },
      outputSchema: null,
      sideEffect: "external_write",
      dataSensitivity: "private",
      accountBinding: "required",
    });
    await registry.bind({
      ownerId,
      agentVersionId: seeded.agent.activeVersion.id,
      toolDefinitionId: secondTool.id,
    });
    const execution = createToolExecutionRepository(sql);
    const first = await execution.propose({
      ownerId,
      sessionId: seeded.submission.session.id,
      runId: seeded.submission.run.id,
      agentVersionId: seeded.agent.activeVersion.id,
      toolDefinitionId: seeded.tool.id,
      stepKey: "semantic-step",
      idempotencyKey: "semantic-key",
      arguments: { body: "same" },
      policy: {
        sessionMode: "ask_before_changes",
        routineMode: "autonomous",
        perToolOverride: null,
        sideEffect: "read",
        dataSensitivity: "public",
        inputTrust: "trusted_instruction",
        targetIsSelf: true,
        targetIsTrusted: true,
        accountBound: false,
      },
    });
    await expect(
      execution.propose({
        ownerId,
        sessionId: seeded.submission.session.id,
        runId: seeded.submission.run.id,
        agentVersionId: seeded.agent.activeVersion.id,
        toolDefinitionId: secondTool.id,
        stepKey: "semantic-step",
        idempotencyKey: "semantic-key",
        arguments: { body: "same" },
        policy: {
          sessionMode: "ask_before_changes",
          routineMode: "autonomous",
          perToolOverride: null,
          sideEffect: "read",
          dataSensitivity: "public",
          inputTrust: "trusted_instruction",
          targetIsSelf: true,
          targetIsTrusted: true,
          accountBound: false,
        },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    if (first.approval === null) throw new Error("Expected approval request.");
    const newerAgent = await createAgentRepository(sql).publishPersonal({
      ownerId,
      expectedRevision: 1,
      displayName: "Updated Tool Execution Fixture",
      instructions: "The Session must retain its original AgentVersion.",
      defaultApprovalMode: "autonomous",
      changeReason: "Pinned-version test",
    });
    await registry.bind({
      ownerId,
      agentVersionId: newerAgent.activeVersion.id,
      toolDefinitionId: secondTool.id,
    });
    await expect(
      execution.propose({
        ownerId,
        sessionId: seeded.submission.session.id,
        runId: seeded.submission.run.id,
        agentVersionId: newerAgent.activeVersion.id,
        toolDefinitionId: secondTool.id,
        stepKey: "pinned-version-step",
        idempotencyKey: "pinned-version-key",
        arguments: { body: "must reject" },
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
      }),
    ).rejects.toMatchObject({ code: "TOOL_BINDING_NOT_FOUND" });
    const expired = await execution.propose({
      ownerId,
      sessionId: seeded.submission.session.id,
      runId: seeded.submission.run.id,
      agentVersionId: seeded.agent.activeVersion.id,
      toolDefinitionId: seeded.tool.id,
      stepKey: "expired-step",
      idempotencyKey: "expired-key",
      arguments: { body: "expired" },
      approvalExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
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
    if (expired.approval === null)
      throw new Error("Expected expired approval request.");
    await expect(
      execution.decideApproval({
        ownerId,
        approvalId: expired.approval.id,
        expectedRevision: 1,
        decidedBy: ownerId,
        decision: "approve",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_STATE_CONFLICT" });
    await expect(
      execution.getApproval(ownerId, expired.approval.id),
    ).resolves.toMatchObject({
      state: "expired",
      revision: 2,
    });
  });
});
