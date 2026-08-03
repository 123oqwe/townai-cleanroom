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
import { createOperationsRepository } from "../src/index.js";

let sql: Sql;
let ownerId: Id<"user">;
let otherId: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 1 });
  await runMigrations(sql);
});
beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  otherId = newId<"user">();
  await sql`insert into users (id,email) values (${ownerId},'ops-owner@example.invalid'),(${otherId},'ops-other@example.invalid')`;
});
afterAll(async () => {
  await sql.end();
});

describe("operations audit and summary", () => {
  it("stores idempotent owner-scoped audit events and paginates", async () => {
    const repository = createOperationsRepository(sql);
    const first = await repository.append({
      ownerId,
      actorId: ownerId,
      action: "runtime.run.completed",
      resourceType: "session-run",
      resourceId: "run-1",
      requestId: "request-1",
      dedupeKey: "event-1",
      metadata: { latencyMs: 12 },
    });
    await expect(
      repository.append({
        ownerId,
        action: "different",
        resourceType: "other",
        dedupeKey: "event-1",
      }),
    ).rejects.toMatchObject({ code: "AUDIT_CONFLICT" });
    await expect(
      repository.append({
        ownerId,
        action: first.action,
        actorId: ownerId,
        resourceType: first.resourceType,
        resourceId: first.resourceId,
        requestId: first.requestId,
        dedupeKey: "event-1",
        metadata: { latencyMs: 12 },
      }),
    ).resolves.toMatchObject({ id: first.id });
    await expect(
      repository.append({
        ownerId,
        action: first.action,
        actorId: ownerId,
        resourceType: first.resourceType,
        resourceId: first.resourceId,
        requestId: first.requestId,
        dedupeKey: "event-1",
        metadata: { token: "should-not-persist" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_METADATA" });
    await repository.append({
      ownerId,
      action: "runtime.run.failed",
      resourceType: "session-run",
      outcome: "failed",
      dedupeKey: "event-2",
    });
    await repository.append({
      ownerId: otherId,
      action: "private.event",
      resourceType: "session-run",
    });
    const page = await repository.list({ ownerId, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.ownerId).toBe(ownerId);
    expect(page.nextCursor).not.toBeNull();
    await expect(
      repository.list({ ownerId, cursor: "not-a-cursor" }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("reports owner-scoped operational backlog", async () => {
    const repository = createOperationsRepository(sql);
    await repository.append({
      ownerId,
      action: "notification.delivery.failed",
      resourceType: "notification-delivery",
      resourceId: "audit-before-timeline",
      outcome: "failed",
      dedupeKey: "audit-before-timeline",
      metadata: { attempts: 1 },
    });
    await repository.append({
      ownerId: otherId,
      action: "private.notification.delivery.failed",
      resourceType: "notification-delivery",
      outcome: "failed",
      dedupeKey: "other-owner-timeline",
      metadata: { attempts: 1 },
    });
    const channelId = newId<"notification-channel">();
    await sql`
      insert into notification_channels (id, owner_id, kind, address, config)
      values (${channelId}, ${ownerId}, 'webhook', 'https://example.invalid/timeline', ${sql.json({ headers: {} })})
    `;
    await sql`
      insert into notification_deliveries (id, owner_id, channel_id, event_type, idempotency_key, payload, fingerprint)
      values (${newId<"notification-delivery">()}, ${ownerId}, ${channelId}, 'routine.failed', 'timeline-delivery', ${sql.json({ runId: "timeline" })}, 'timeline-fingerprint')
    `;
    const summary = await repository.summary(ownerId);
    expect(summary).toEqual({
      activeSessions: 0,
      queuedRuns: 0,
      failedRuns: 0,
      pendingApprovals: 0,
      queuedDeliveries: 1,
      failedDeliveries: 0,
    });
    const first = await repository.timeline({ ownerId, limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.kind).toBe("delivery");
    expect(first.nextCursor).not.toBeNull();
    const second = await repository.timeline({
      ownerId,
      limit: 10,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.some((item) => item.kind === "audit")).toBe(true);
    expect(second.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.items[0]?.id }),
      ]),
    );
    expect(
      second.items.some(
        (item) =>
          item.data["action"] === "private.notification.delivery.failed",
      ),
    ).toBe(false);
    const replay = await repository.timeline({
      ownerId,
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    expect(replay.items.map((item) => item.id)).toEqual(
      second.items.slice(0, 1).map((item) => item.id),
    );
  });
});
