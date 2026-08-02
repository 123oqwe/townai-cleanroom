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
import { createChannelRepository } from "../src/index.js";

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
  await sql`insert into users (id,email) values (${ownerId},'channels-owner@example.invalid'),(${otherId},'channels-other@example.invalid')`;
});
afterAll(async () => {
  await sql.end();
});

describe("notification channels", () => {
  it("keeps channel ownership, idempotent outbox delivery, and completion state", async () => {
    const repository = createChannelRepository(sql);
    const channel = await repository.create({
      ownerId,
      kind: "webhook",
      address: "https://example.invalid/town-hook",
      config: { headers: {} },
    });
    expect(channel).toMatchObject({
      ownerId,
      kind: "webhook",
      status: "active",
    });
    await expect(
      repository.create({
        ownerId,
        kind: "webhook",
        address: "https://example.invalid/unsafe",
        config: { headers: { Authorization: "secret" } },
      }),
    ).rejects.toMatchObject({ code: "INVALID_CHANNEL_CONFIG" });
    await expect(repository.list(otherId)).resolves.toEqual([]);

    const first = await repository.enqueue({
      ownerId,
      channelId: channel.id,
      eventType: "routine.completed",
      idempotencyKey: "routine-run-1",
      payload: { runId: "run-1" },
    });
    const repeated = await repository.enqueue({
      ownerId,
      channelId: channel.id,
      eventType: "routine.completed",
      idempotencyKey: "routine-run-1",
      payload: { runId: "run-1" },
    });
    expect(repeated.id).toBe(first.id);
    expect(repeated).not.toHaveProperty("claimToken");
    await expect(
      repository.enqueue({
        ownerId,
        channelId: channel.id,
        eventType: "routine.completed",
        idempotencyKey: "routine-run-1",
        payload: { runId: "changed" },
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_CONFLICT" });
    const secondChannel = await repository.create({
      ownerId,
      kind: "email",
      address: "second@example.invalid",
    });
    await expect(
      repository.enqueue({
        ownerId,
        channelId: secondChannel.id,
        eventType: "routine.completed",
        idempotencyKey: "routine-run-1",
        payload: { runId: "run-1" },
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_CONFLICT" });
    const claimed = await repository.claimNext("worker-a");
    expect(claimed).toMatchObject({
      id: first.id,
      status: "attempting",
      attempts: 1,
    });
    await expect(
      repository.complete({
        ownerId,
        deliveryId: first.id,
        workerId: "worker-b",
        claimToken:
          claimed?.claimToken ?? "01900000-0000-7000-8000-000000000000",
        success: true,
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_CONFLICT" });
    await expect(
      repository.complete({
        ownerId,
        deliveryId: first.id,
        workerId: "worker-a",
        claimToken:
          claimed?.claimToken ?? "01900000-0000-7000-8000-000000000000",
        success: true,
      }),
    ).resolves.toMatchObject({ status: "succeeded", sentAt: expect.any(Date) });
  });

  it("stops enqueueing after disable and prevents cross-owner access", async () => {
    const repository = createChannelRepository(sql);
    const channel = await repository.create({
      ownerId,
      kind: "email",
      address: "alerts@example.invalid",
    });
    await expect(repository.disable(otherId, channel.id)).rejects.toMatchObject(
      {
        code: "CHANNEL_NOT_FOUND",
      },
    );
    await repository.disable(ownerId, channel.id);
    await expect(
      repository.enqueue({
        ownerId,
        channelId: channel.id,
        eventType: "routine.failed",
        idempotencyKey: "routine-run-2",
        payload: { runId: "run-2" },
      }),
    ).rejects.toMatchObject({ code: "CHANNEL_DISABLED" });
  });

  it("reclaims an expired worker lease", async () => {
    const repository = createChannelRepository(sql);
    const channel = await repository.create({
      ownerId,
      kind: "email",
      address: "lease@example.invalid",
    });
    const delivery = await repository.enqueue({
      ownerId,
      channelId: channel.id,
      eventType: "routine.completed",
      idempotencyKey: "lease-run",
      payload: { runId: "lease-run" },
    });
    await expect(
      repository.claimNext("worker-a", 1_000),
    ).resolves.toMatchObject({
      id: delivery.id,
      attempts: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(
      repository.claimNext("worker-b", 1_000),
    ).resolves.toMatchObject({
      id: delivery.id,
      attempts: 2,
    });
  });
});
