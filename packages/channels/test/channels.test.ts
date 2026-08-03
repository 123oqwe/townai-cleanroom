import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
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
  it("accepts every verified multi-channel destination kind", async () => {
    const repository = createChannelRepository(sql);
    const kinds = [
      "email",
      "webhook",
      "telegram",
      "whatsapp",
      "slack",
      "imessage",
    ] as const;
    const channels = [];
    for (const kind of kinds) {
      channels.push(
        await repository.create({
          ownerId,
          kind,
          address: `${kind}:destination`,
          ...(kind === "webhook"
            ? { config: { headers: {} } }
            : kind === "telegram" ||
                kind === "whatsapp" ||
                kind === "slack" ||
                kind === "imessage"
              ? { config: { chatId: `${kind}-chat` } }
              : {}),
        }),
      );
    }
    expect(channels.map(({ kind }) => kind)).toEqual(kinds);
    expect(channels.every(({ status }) => status === "active")).toBe(true);
  });

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

  it("executes webhook outbox deliveries and records provider failures for retry", async () => {
    const repository = createChannelRepository(sql);
    const channel = await repository.create({
      ownerId,
      kind: "webhook",
      address: "https://example.invalid/town-hook",
      config: { headers: {} },
    });
    await repository.enqueue({
      ownerId,
      channelId: channel.id,
      eventType: "routine.completed",
      idempotencyKey: "delivery-success",
      payload: { runId: "run-success" },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) => {
      expect(options?.method).toBe("POST");
      expect(JSON.parse(String(options?.body))).toMatchObject({
        eventType: "routine.completed",
      });
      return new Response(null, { status: 202 });
    });
    await expect(
      repository.deliverNext({ workerId: "delivery-worker", fetch }),
    ).resolves.toMatchObject({
      claimed: true,
      delivery: { status: "succeeded" },
    });
    expect(fetch).toHaveBeenCalledOnce();

    const failed = await repository.enqueue({
      ownerId,
      channelId: channel.id,
      eventType: "routine.failed",
      idempotencyKey: "delivery-failure",
      payload: { runId: "run-failure" },
    });
    await expect(
      repository.deliverNext({
        workerId: "delivery-worker",
        fetch: vi.fn(async () => new Response("no", { status: 503 })),
      }),
    ).resolves.toMatchObject({
      claimed: true,
      delivery: {
        id: failed.id,
        status: "failed",
        lastError: "CHANNEL_HTTP_503",
        nextAttemptAt: expect.any(Date),
      },
    });
  });

  it("sends email deliveries through an explicitly selected connected account", async () => {
    const repository = createChannelRepository(sql);
    const channel = await repository.create({
      ownerId,
      kind: "email",
      address: "recipient@example.invalid",
      config: { accountId: ownerId },
    });
    await repository.enqueue({
      ownerId,
      channelId: channel.id,
      eventType: "routine.result",
      idempotencyKey: "delivery-email",
      payload: { subject: "Weekly brief", body: "The brief is ready." },
    });
    const sendEmail = vi.fn(
      async (value: {
        ownerId: Id<"user">;
        accountId: Id<"connected-account">;
        to: string;
        subject: string;
        body: string;
      }) => {
        expect(value).toMatchObject({
          to: "recipient@example.invalid",
          subject: "Weekly brief",
          body: "The brief is ready.",
        });
      },
    );
    await expect(
      repository.deliverNext({ workerId: "email-worker", sendEmail }),
    ).resolves.toMatchObject({
      claimed: true,
      delivery: { status: "succeeded" },
    });
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("delivers Telegram, WhatsApp, and Slack payloads through credential references", async () => {
    const repository = createChannelRepository(sql);
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, options) => {
      expect(options?.method).toBe("POST");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const resolveCredential = vi.fn(
      async ({ credentialRef }: { credentialRef: string }) => {
        return (
          {
            telegram: "bot-token",
            whatsapp: "wa-token",
            slack: "https://hooks.slack.test/secret",
          }[credentialRef] ?? ""
        );
      },
    );
    const cases = [
      {
        kind: "telegram" as const,
        address: "123",
        config: { credentialRef: "telegram" },
      },
      {
        kind: "whatsapp" as const,
        address: "15551234567",
        config: { credentialRef: "whatsapp", phoneNumberId: "phone-1" },
      },
      {
        kind: "slack" as const,
        address: "#town",
        config: { credentialRef: "slack" },
      },
    ];
    for (const [index, value] of cases.entries()) {
      const channel = await repository.create({ ownerId, ...value });
      await repository.enqueue({
        ownerId,
        channelId: channel.id,
        eventType: "routine.result",
        idempotencyKey: `delivery-chat-${index}`,
        payload: { body: "A result is ready." },
      });
      await expect(
        repository.deliverNext({
          workerId: `chat-worker-${index}`,
          fetch,
          resolveCredential,
        }),
      ).resolves.toMatchObject({
        claimed: true,
        delivery: { status: "succeeded" },
      });
    }
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(resolveCredential).toHaveBeenCalledTimes(3);
  });

  it("isolates an empty provider credential as a retryable delivery failure", async () => {
    const repository = createChannelRepository(sql);
    const channel = await repository.create({
      ownerId,
      kind: "telegram",
      address: "123",
      config: { credentialRef: "missing" },
    });
    await repository.enqueue({
      ownerId,
      channelId: channel.id,
      eventType: "routine.result",
      idempotencyKey: "delivery-empty-credential",
      payload: { body: "A result is ready." },
    });

    await expect(
      repository.deliverNext({
        workerId: "empty-credential-worker",
        fetch: vi.fn(),
        resolveCredential: async () => "   ",
      }),
    ).resolves.toMatchObject({
      claimed: true,
      delivery: {
        status: "failed",
        lastError: expect.stringContaining("CHANNEL_CREDENTIAL_EMPTY"),
        nextAttemptAt: expect.any(Date),
      },
    });
  });

  it("stops retrying after the bounded delivery attempt budget", async () => {
    const repository = createChannelRepository(sql);
    const channel = await repository.create({
      ownerId,
      kind: "webhook",
      address: "https://example.invalid/exhausted",
      config: { headers: {} },
    });
    const queued = await repository.enqueue({
      ownerId,
      channelId: channel.id,
      eventType: "routine.failed",
      idempotencyKey: "delivery-exhausted",
      payload: { runId: "run-exhausted" },
    });
    await sql`
      update notification_deliveries
      set attempts=9
      where owner_id=${ownerId} and id=${queued.id}
    `;

    await expect(
      repository.deliverNext({
        workerId: "exhausted-worker",
        fetch: vi.fn(async () => new Response("no", { status: 503 })),
      }),
    ).resolves.toMatchObject({
      claimed: true,
      delivery: {
        attempts: 10,
        status: "failed",
        nextAttemptAt: null,
        lastError: "CHANNEL_HTTP_503",
      },
    });
    await expect(repository.claimNext("after-exhaustion-worker")).resolves.toBe(
      null,
    );
  });
});
