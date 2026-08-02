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

import { newId, type Id } from "@town/contracts";
import { runMigrations } from "@town/db";

import { createAgentRepository } from "../src/agent-repository.js";
import { createInputRequestRepository } from "../src/input-request-repository.js";
import { createTaskRepository } from "../src/task-repository.js";
import { createThreadRepository } from "../src/thread-repository.js";
import { createTurnRepository } from "../src/turn-repository.js";

let sql: Sql;
let ownerId: Id<"user">;
let otherOwnerId: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 6 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  otherOwnerId = newId<"user">();
  await sql`
    insert into users (id, email, timezone)
    values
      (${ownerId}, 'task-owner@example.invalid', 'UTC'),
      (${otherOwnerId}, 'task-other@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

async function fixture(owner: Id<"user">) {
  const agent = await createAgentRepository(sql).createPersonal({
    ownerId: owner,
    displayName: "Task Test Assistant",
    instructions: "Use only synthetic task fixtures.",
    defaultApprovalMode: "respect_tool_setting",
  });
  const sourceThread = await createThreadRepository(sql).createAssistant({
    ownerId: owner,
    agentId: agent.id,
    title: "Synthetic source",
    approvalMode: "respect_tool_setting",
  });
  return { agent, sourceThread };
}

describe("Task repository", () => {
  it("atomically creates a Task, linked Thread, read state, and source context", async () => {
    const { agent, sourceThread } = await fixture(ownerId);
    const tasks = createTaskRepository(sql);
    const created = await tasks.create({
      ownerId,
      agentId: agent.id,
      title: "Synthetic follow-up task",
      description: "Track a non-production follow-up.",
      approvalMode: "respect_tool_setting",
      scheduledFor: new Date("2099-01-01T09:00:00.000Z"),
      sourceThreads: [sourceThread.id],
    });

    expect(created).toMatchObject({
      task: { status: "open", revision: 1, unread: false },
      thread: { kind: "task", revision: 1 },
      sources: [{ sourceType: "thread", sourceRef: sourceThread.id }],
    });

    const invalidSource = newId<"thread">();
    await expect(
      tasks.create({
        ownerId,
        agentId: agent.id,
        title: "Must roll back",
        description: "Invalid child reference.",
        approvalMode: "respect_tool_setting",
        sourceThreads: [invalidSource],
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
    const [counts] = await sql<{ tasks: number; task_threads: number }[]>`
      select
        (select count(*)::int from tasks) as tasks,
        (select count(*)::int from threads where kind = 'task') as task_threads
    `;
    expect(counts).toEqual({ tasks: 1, task_threads: 1 });

    await expect(
      tasks.create({
        ownerId,
        agentId: agent.id,
        title: "Invalid public source",
        description: "Public callers cannot choose provider source types.",
        approvalMode: "respect_tool_setting",
        sourceThreads: [],
        sources: [{ sourceType: "email", sourceRef: "forged" }],
      } as never),
    ).rejects.toThrow();
    await expect(
      tasks.create({
        ownerId,
        agentId: agent.id,
        title: "Past schedule",
        description: "Must be rejected.",
        approvalMode: "respect_tool_setting",
        scheduledFor: new Date("2000-01-01T00:00:00.000Z"),
        sourceThreads: [],
      }),
    ).rejects.toThrow();
  });

  it("edits, completes, reopens, reschedules, and deletes Task and Thread jointly", async () => {
    const { agent } = await fixture(ownerId);
    const tasks = createTaskRepository(sql);
    const created = await tasks.create({
      ownerId,
      agentId: agent.id,
      title: "Lifecycle task",
      description: "Initial description.",
      approvalMode: "require_approval",
      scheduledFor: new Date("2099-01-01T00:00:00.000Z"),
      sourceThreads: [],
    });
    const completed = await tasks.update({
      ownerId,
      taskId: created.task.id,
      expectedRevision: 1,
      title: "Completed task",
      description: "Completed description.",
      status: "completed",
      scheduledFor: null,
    });
    expect(completed.task).toMatchObject({
      revision: 2,
      status: "completed",
      scheduledFor: null,
    });
    expect(completed.task.completedAt).toBeInstanceOf(Date);

    const reopened = await tasks.update({
      ownerId,
      taskId: created.task.id,
      expectedRevision: 2,
      title: "Reopened task",
      description: "Needs more work.",
      status: "open",
      scheduledFor: new Date("2099-02-01T00:00:00.000Z"),
    });
    expect(reopened.task).toMatchObject({ revision: 3, status: "open" });
    expect(reopened.task.completedAt).toBeNull();

    await expect(
      tasks.update({
        ownerId,
        taskId: created.task.id,
        expectedRevision: 2,
        title: "Stale update",
        description: "Must not apply.",
        status: "open",
        scheduledFor: null,
      }),
    ).rejects.toMatchObject({ code: "TASK_REVISION_CONFLICT" });

    await tasks.remove({
      ownerId,
      taskId: created.task.id,
      expectedRevision: 3,
    });
    await expect(tasks.get(ownerId, created.task.id)).rejects.toMatchObject({
      code: "TASK_NOT_FOUND",
    });
    await expect(
      createThreadRepository(sql).get(ownerId, created.thread.id),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
    await expect(
      tasks.update({
        ownerId,
        taskId: created.task.id,
        expectedRevision: 4,
        title: "Deleted is terminal",
        description: "Must not reopen.",
        status: "open",
        scheduledFor: null,
      }),
    ).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
  });

  it("validates owner-bound internal source and account references", async () => {
    const { agent } = await fixture(ownerId);
    const { sourceThread: otherThread } = await fixture(otherOwnerId);
    const tasks = createTaskRepository(sql);
    const accountId = newId<"connected-account">();
    const ownerAccountId = newId<"connected-account">();
    await sql`
      insert into connected_accounts (
        id, owner_id, provider, provider_user_id, email, capabilities
      ) values
        (
          ${accountId}, ${otherOwnerId}, 'google', 'other-task-account',
          'other-account@example.invalid', '{}'::jsonb
        ),
        (
          ${ownerAccountId}, ${ownerId}, 'google', 'owner-task-account',
          'owner-account@example.invalid', '{}'::jsonb
        )
    `;

    await expect(
      tasks.create({
        ownerId,
        agentId: agent.id,
        title: "Cross-owner source",
        description: "Must not bind.",
        approvalMode: "respect_tool_setting",
        sourceThreads: [otherThread.id],
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
    await expect(
      tasks.createInternal({
        ownerId,
        agentId: agent.id,
        title: "Cross-owner account",
        description: "Must not bind.",
        approvalMode: "respect_tool_setting",
        sources: [
          {
            sourceType: "email",
            sourceRef: "opaque-message-reference",
            accountId,
            sourceLabel: "Synthetic email",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "REFERENCE_UNAVAILABLE" });

    const internal = await tasks.createInternal({
      ownerId,
      agentId: agent.id,
      title: "Account-backed context",
      description: "Stores only an opaque provider reference.",
      approvalMode: "respect_tool_setting",
      sources: [
        {
          sourceType: "email",
          sourceRef: "opaque-message-reference",
          accountId: ownerAccountId,
          sourceLabel: "Synthetic email",
        },
      ],
    });
    expect(internal.sources).toMatchObject([
      {
        sourceType: "email",
        sourceRef: "opaque-message-reference",
        accountId: ownerAccountId,
      },
    ]);

    await expect(
      tasks.get(otherOwnerId, newId<"task">()),
    ).rejects.toMatchObject({
      code: "TASK_NOT_FOUND",
    });
  });

  it("derives unread from the linked Thread and paginates filtered schedules", async () => {
    const { agent } = await fixture(ownerId);
    const tasks = createTaskRepository(sql);
    const dates = [
      new Date("2099-03-01T00:00:00.000Z"),
      new Date("2099-01-01T00:00:00.000Z"),
      new Date("2099-02-01T00:00:00.000Z"),
    ];
    const created = [];
    for (const [index, scheduledFor] of dates.entries()) {
      created.push(
        await tasks.create({
          ownerId,
          agentId: agent.id,
          title: `Scheduled ${index + 1}`,
          description: "Synthetic pagination fixture.",
          approvalMode: "respect_tool_setting",
          scheduledFor,
          sourceThreads: [],
        }),
      );
    }
    await createTurnRepository(sql).appendRuntime({
      ownerId,
      threadId: created[2]!.thread.id,
      role: "assistant",
      text: "Task requires attention.",
      sourceRef: "synthetic-task-session",
      mentions: [],
    });

    const unread = await tasks.list({ ownerId, unread: true, limit: 10 });
    expect(unread.items.map(({ task }) => task.id)).toEqual([
      created[2]!.task.id,
    ]);
    const page1 = await tasks.list({ ownerId, statuses: ["open"], limit: 2 });
    expect(
      page1.items.map(({ task }) => task.scheduledFor?.toISOString()),
    ).toEqual([dates[1]!.toISOString(), dates[2]!.toISOString()]);
    if (page1.nextCursor === null) throw new Error("Expected a cursor.");
    const page2 = await tasks.list({
      ownerId,
      statuses: ["open"],
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(
      page2.items.map(({ task }) => task.scheduledFor?.toISOString()),
    ).toEqual([dates[0]!.toISOString()]);
    await tasks.markRead({ ownerId, taskId: created[2]!.task.id });
    await expect(
      tasks.get(ownerId, created[2]!.task.id),
    ).resolves.toMatchObject({ task: { unread: false } });
  });
});

describe("Task InputRequest repository", () => {
  it("answers once and cancels pending requests on Task deletion", async () => {
    const { agent } = await fixture(ownerId);
    const tasks = createTaskRepository(sql);
    const created = await tasks.create({
      ownerId,
      agentId: agent.id,
      title: "Needs input",
      description: "Synthetic decision flow.",
      approvalMode: "require_approval",
      sourceThreads: [],
    });
    const inputRequests = createInputRequestRepository(sql);
    const request = await inputRequests.createInternal({
      ownerId,
      taskId: created.task.id,
      prompt: "Provide a synthetic decision.",
    });
    const answered = await inputRequests.answer({
      ownerId,
      taskId: created.task.id,
      requestId: request.id,
      response: "Proceed",
    });
    expect(answered).toMatchObject({ status: "answered", response: "Proceed" });
    await expect(
      inputRequests.answer({
        ownerId,
        taskId: created.task.id,
        requestId: request.id,
        response: "Again",
      }),
    ).rejects.toMatchObject({ code: "INPUT_REQUEST_ALREADY_RESOLVED" });

    const cancelledDirectly = await inputRequests.createInternal({
      ownerId,
      taskId: created.task.id,
      prompt: "Pending input.",
    });
    await expect(
      inputRequests.cancel({
        ownerId,
        taskId: created.task.id,
        requestId: cancelledDirectly.id,
      }),
    ).resolves.toMatchObject({ status: "cancelled" });
    await expect(
      inputRequests.cancel({
        ownerId,
        taskId: created.task.id,
        requestId: cancelledDirectly.id,
      }),
    ).rejects.toMatchObject({ code: "INPUT_REQUEST_ALREADY_RESOLVED" });
    const pending = await inputRequests.createInternal({
      ownerId,
      taskId: created.task.id,
      prompt: "Cancel with Task deletion.",
    });
    await expect(
      inputRequests.list({ ownerId, taskId: created.task.id }),
    ).resolves.toHaveLength(3);
    await tasks.remove({
      ownerId,
      taskId: created.task.id,
      expectedRevision: 1,
    });
    const [cancelled] = await sql<{ status: string }[]>`
      select status from task_input_requests where id = ${pending.id}
    `;
    expect(cancelled?.status).toBe("cancelled");
    await expect(
      inputRequests.answer({
        ownerId,
        taskId: created.task.id,
        requestId: pending.id,
        response: "Too late",
      }),
    ).rejects.toMatchObject({ code: "INPUT_REQUEST_NOT_FOUND" });
  });
});
