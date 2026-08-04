import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import type { AuthVariables } from "../src/auth.js";
import { registerChannelRoutes } from "../src/channel-routes.js";
import { ChannelError, type ChannelRepository } from "@town/channels";
import type { OperationsRepository } from "@town/operations";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");

describe("channel routes", () => {
  function withErrorMapping(app: Hono<{ Variables: AuthVariables }>) {
    app.onError((error, context) => {
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return context.json({ code: "INVALID_REQUEST" }, 400);
      if (error instanceof ChannelError) {
        if (error.code === "FORBIDDEN")
          return context.json({ code: error.code }, 403);
        if (error.code === "INVALID_CHANNEL_CONFIG") {
          return context.json({ code: error.code, detail: error.message }, 400);
        }
        if (error.code === "CHANNEL_NOT_FOUND") {
          return context.json({ code: error.code }, 404);
        }
        if (
          error.code === "CHANNEL_DISABLED" ||
          error.code === "DELIVERY_CONFLICT" ||
          error.code === "DELIVERY_NOT_REPLAYABLE" ||
          error.code === "DELIVERY_NOT_FOUND"
        ) {
          return context.json({ code: error.code }, 409);
        }
      }
      return context.json(
        { code: "INTERNAL_ERROR", detail: error.message },
        500,
      );
    });
  }

  function appWith(
    repository: ChannelRepository,
    audit?: OperationsRepository,
  ) {
    const app = new Hono<{ Variables: AuthVariables }>();
    withErrorMapping(app);
    app.use("*", async (context, next) => {
      context.set("identity", {
        user: { id: ownerId },
      } as AuthVariables["identity"]);
      await next();
    });
    registerChannelRoutes(app, {
      repository,
      ...(audit === undefined ? {} : { audit }),
    });
    return app;
  }

  it("lists, creates, disables, enqueues, replays and filters notification deliveries", async () => {
    const channelId = asId<"notification-channel">(
      "01900000-0000-7000-8000-000000000010",
    );
    const deliveryId = asId<"notification-delivery">(
      "01900000-0000-7000-8000-000000000011",
    );
    const replayId = asId<"notification-delivery">(
      "01900000-0000-7000-8000-000000000012",
    );
    const list = vi.fn().mockResolvedValue([
      {
        id: channelId,
        ownerId,
        kind: "webhook",
        address: "https://example.invalid/hook",
        config: {},
        status: "active",
        verifiedAt: null,
        createdAt: new Date("2026-08-03T00:00:00.000Z"),
        updatedAt: new Date("2026-08-03T00:00:00.000Z"),
      },
    ]);
    const create = vi.fn().mockResolvedValue({
      id: channelId,
      ownerId,
      kind: "webhook",
      address: "https://example.invalid/webhook",
      config: {},
      status: "active",
      verifiedAt: null,
      createdAt: new Date("2026-08-03T01:00:00.000Z"),
      updatedAt: new Date("2026-08-03T01:00:00.000Z"),
    });
    const disable = vi.fn().mockResolvedValue({
      id: channelId,
      ownerId,
      kind: "webhook",
      address: "https://example.invalid/webhook",
      config: {},
      status: "disabled",
      verifiedAt: null,
      createdAt: new Date("2026-08-03T01:00:00.000Z"),
      updatedAt: new Date("2026-08-03T01:00:01.000Z"),
    });
    const enqueue = vi.fn().mockResolvedValue({
      id: deliveryId,
      ownerId,
      channelId,
      eventType: "routine.completed",
      idempotencyKey: "run-1",
      payload: { runId: "run-1" },
      status: "queued",
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      replayOfDeliveryId: null,
      sentAt: null,
      createdAt: new Date("2026-08-03T02:00:00.000Z"),
      updatedAt: new Date("2026-08-03T02:00:00.000Z"),
    });
    const replay = vi.fn().mockResolvedValue({
      id: replayId,
      ownerId,
      channelId,
      eventType: "routine.completed",
      idempotencyKey: "run-1-replay",
      payload: { runId: "run-1" },
      status: "queued",
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      replayOfDeliveryId: deliveryId,
      sentAt: null,
      createdAt: new Date("2026-08-03T02:00:30.000Z"),
      updatedAt: new Date("2026-08-03T02:00:30.000Z"),
    });
    const listDeliveries = vi.fn().mockResolvedValue([
      {
        id: deliveryId,
        ownerId,
        channelId,
        eventType: "routine.completed",
        idempotencyKey: "run-1",
        payload: { runId: "run-1" },
        status: "queued",
        attempts: 1,
        nextAttemptAt: null,
        lastError: null,
        replayOfDeliveryId: null,
        sentAt: null,
        createdAt: new Date("2026-08-03T02:00:10.000Z"),
        updatedAt: new Date("2026-08-03T02:00:10.000Z"),
      },
    ]);
    const repository = {
      list,
      create,
      disable,
      enqueue,
      replay,
      listDeliveries,
      claimNext: vi.fn(),
      complete: vi.fn(),
      deliverNext: vi.fn(),
    } as unknown as ChannelRepository;

    const app = appWith(repository);
    const channels = await app.request("/v1/channels");
    const created = await app.request("/v1/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "webhook",
        address: "https://example.invalid/webhook",
        config: {},
      }),
    });
    const disabled = await app.request(`/v1/channels/${channelId}`, {
      method: "DELETE",
    });
    const delivery = await app.request("/v1/notification-deliveries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channelId,
        eventType: "routine.completed",
        idempotencyKey: "run-1",
        payload: { runId: "run-1" },
      }),
    });
    const replayResponse = await app.request(
      `/v1/notification-deliveries/${deliveryId}/replay`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "run-1-replay" }),
      },
    );
    const deliveries = await app.request(
      "/v1/notification-deliveries?status=queued&limit=5",
    );

    expect(channels.status).toBe(200);
    expect(created.status).toBe(201);
    expect(disabled.status).toBe(200);
    expect(delivery.status).toBe(201);
    expect(replayResponse.status).toBe(201);
    expect(deliveries.status).toBe(200);
    expect(await channels.json()).toMatchObject({
      channels: [{ id: channelId, kind: "webhook" }],
    });
    expect(await created.json()).toMatchObject({
      channel: { kind: "webhook" },
    });
    expect(await disabled.json()).toMatchObject({
      channel: { id: channelId, status: "disabled" },
    });
    expect(await delivery.json()).toMatchObject({
      delivery: { id: deliveryId },
    });
    expect(await replayResponse.json()).toMatchObject({
      delivery: { id: replayId },
    });
    expect(await deliveries.json()).toMatchObject({
      deliveries: [{ id: deliveryId, status: "queued" }],
    });
    expect(list).toHaveBeenCalledWith(ownerId);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId, kind: "webhook" }),
    );
    expect(disable).toHaveBeenCalledWith(ownerId, channelId);
    expect(enqueue).toHaveBeenCalledWith({
      ownerId,
      channelId,
      eventType: "routine.completed",
      idempotencyKey: "run-1",
      payload: { runId: "run-1" },
    });
    expect(replay).toHaveBeenCalledWith({
      ownerId,
      deliveryId,
      idempotencyKey: "run-1-replay",
    });
  });

  it("requires an audit dependency for timeline and routes malformed delivery status queries", async () => {
    const repository = {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      disable: vi.fn(),
      enqueue: vi.fn(),
      replay: vi.fn(),
      listDeliveries: vi.fn(),
      claimNext: vi.fn(),
      complete: vi.fn(),
      deliverNext: vi.fn(),
    } as unknown as ChannelRepository;
    const app = appWith(repository);
    const noAudit = await app.request("/v1/notification-timeline");
    const badStatus = await app.request(
      "/v1/notification-deliveries?status=bogus",
    );

    expect(noAudit.status).toBe(503);
    expect(await noAudit.json()).toMatchObject({
      code: "AUDIT_NOT_CONFIGURED",
    });
    expect(badStatus.status).toBe(400);
  });

  it("writes audit trail when replays are performed", async () => {
    const channelId = asId<"notification-channel">(
      "01900000-0000-7000-8000-000000000020",
    );
    const deliveryId = asId<"notification-delivery">(
      "01900000-0000-7000-8000-000000000021",
    );
    const replayed = asId<"notification-delivery">(
      "01900000-0000-7000-8000-000000000022",
    );
    const sourceId = asId<"notification-delivery">(
      "01900000-0000-7000-8000-000000000023",
    );
    const repository = {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      disable: vi.fn(),
      enqueue: vi.fn().mockResolvedValue({
        id: deliveryId,
        ownerId,
        channelId,
        eventType: "routine.completed",
        idempotencyKey: "run-2",
        payload: { runId: "run-2" },
        status: "queued",
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        replayOfDeliveryId: sourceId,
        sentAt: null,
        createdAt: new Date("2026-08-03T03:00:00.000Z"),
        updatedAt: new Date("2026-08-03T03:00:00.000Z"),
      }),
      replay: vi.fn().mockResolvedValue({
        id: replayed,
        ownerId,
        channelId,
        eventType: "routine.completed",
        idempotencyKey: "run-2-replay",
        payload: { runId: "run-2" },
        status: "queued",
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        replayOfDeliveryId: sourceId,
        sentAt: null,
        createdAt: new Date("2026-08-03T03:00:30.000Z"),
        updatedAt: new Date("2026-08-03T03:00:30.000Z"),
      }),
      listDeliveries: vi.fn(),
      claimNext: vi.fn(),
      complete: vi.fn(),
      deliverNext: vi.fn(),
      claimReplayCandidates: vi.fn(),
    } as unknown as ChannelRepository;
    const append = vi.fn().mockResolvedValue({
      id: "01900000-0000-7000-8000-000000000024",
      ownerId,
      actorId: ownerId,
      action: "notification.delivery.replay",
      resourceType: "notification-delivery",
      resourceId: replayed,
      outcome: "succeeded",
      requestId: null,
      metadata: {
        sourceDeliveryId: sourceId,
        replayDeliveryId: replayed,
      },
      createdAt: new Date("2026-08-03T03:00:30.000Z"),
    });
    const audit: OperationsRepository = {
      append,
      timeline: vi.fn(),
      list: vi.fn(),
      summary: vi.fn(),
      appendAnalytics: vi.fn(),
      listAnalytics: vi.fn(),
      appendPublicAnalytics: vi.fn(),
      heartbeatPresence: vi.fn(),
      listPresence: vi.fn(),
    };
    const app = appWith(repository, audit);

    const response = await app.request(
      `/v1/notification-deliveries/${deliveryId}/replay`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "run-2-replay" }),
      },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ delivery: { id: replayed } });
    expect(audit.append).toHaveBeenCalledWith({
      ownerId,
      actorId: ownerId,
      action: "notification.delivery.replay",
      resourceType: "notification-delivery",
      resourceId: replayed,
      dedupeKey: "notification-replay:01900000-0000-7000-8000-000000000022",
      metadata: {
        sourceDeliveryId: sourceId,
        replayDeliveryId: replayed,
      },
    });
  });

  it("maps channel errors to correct ownership/conflict contracts", async () => {
    const replay = vi
      .fn()
      .mockRejectedValue(
        new ChannelError("DELIVERY_NOT_REPLAYABLE", "cannot replay"),
      );
    const repository = {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      disable: vi.fn(),
      enqueue: vi.fn(),
      replay,
      listDeliveries: vi.fn(),
      claimNext: vi.fn(),
      complete: vi.fn(),
      deliverNext: vi.fn(),
    } as unknown as ChannelRepository;
    const app = appWith(repository);
    const response = await app.request(
      `/v1/notification-deliveries/01900000-0000-7000-8000-000000000030/replay`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "again" }),
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "DELIVERY_NOT_REPLAYABLE",
    });
  });
});
