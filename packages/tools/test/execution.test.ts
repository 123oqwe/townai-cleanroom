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
import { createSessionRepository } from "@town/runtime";

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
});
