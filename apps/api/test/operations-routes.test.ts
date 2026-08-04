import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import { OperationsError, type OperationsRepository } from "@town/operations";
import type { AuthVariables } from "../src/auth.js";
import {
  registerOperationsRoutes,
  registerPublicAnalyticsRoutes,
} from "../src/operations-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");

function withErrorMapping(app: Hono<{ Variables: AuthVariables }>) {
  app.onError((error, context) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return context.json({ code: "INVALID_REQUEST" }, 400);
    if (error instanceof OperationsError) {
      const status =
        error.code === "AUDIT_CONFLICT"
          ? 409
          : error.code === "RATE_LIMITED"
            ? 429
            : 400;
      return context.json({ code: error.code, detail: error.message }, status);
    }
    return context.json({ code: "INTERNAL_ERROR", detail: error.message }, 500);
  });
}

function withAuth(app: Hono<{ Variables: AuthVariables }>) {
  app.use("*", async (context, next) => {
    context.set("identity", { user: { id: ownerId } });
    await next();
  });
}

function authenticatedApp(repository: OperationsRepository) {
  const app = new Hono<{ Variables: AuthVariables }>();
  withErrorMapping(app);
  withAuth(app);
  registerOperationsRoutes(app, { repository });
  return app;
}

function anonymousPublicApp(repository: OperationsRepository) {
  const app = new Hono<{ Variables: AuthVariables }>();
  withErrorMapping(app);
  registerPublicAnalyticsRoutes(app, { repository });
  return app;
}

describe("operations routes", () => {
  it("streams audit, summary, analytics and presence on the authenticated surface", async () => {
    const list = vi.fn().mockResolvedValue({
      items: [
        {
          id: asId<"operation-audit-event">("01900000-0000-7000-8000-000000000010"),
          ownerId,
          actorId: ownerId,
          action: "runtime.run.completed",
          resourceType: "session-run",
          resourceId: "run-1",
          outcome: "succeeded",
          requestId: "request-1",
          metadata: { latencyMs: 12 },
          createdAt: new Date("2026-08-03T08:00:00.000Z"),
        },
      ],
      nextCursor: null,
    });
    const summary = vi.fn().mockResolvedValue({
      activeSessions: 1,
      queuedRuns: 2,
      failedRuns: 0,
      pendingApprovals: 3,
      queuedDeliveries: 4,
      failedDeliveries: 5,
    });
    const appendAnalytics = vi.fn().mockResolvedValue({
      id: asId<"operation-analytics-event">(
        "01900000-0000-7000-8000-000000000011",
      ),
      ownerId,
      eventName: "web_vital_recorded",
      metadata: { metric: "LCP", value: 980 },
      dedupeKey: "vital-1",
      createdAt: new Date("2026-08-03T09:00:00.000Z"),
    });
    const listAnalytics = vi.fn().mockResolvedValue({
      items: [
        {
          id: asId<"operation-analytics-event">(
            "01900000-0000-7000-8000-000000000012",
          ),
          ownerId,
          eventName: "web_vital_recorded",
          metadata: { metric: "LCP", value: 980 },
          dedupeKey: null,
          createdAt: new Date("2026-08-03T09:05:00.000Z"),
        },
      ],
      nextCursor: null,
    });
    const heartbeatPresence = vi.fn().mockResolvedValue({
      id: asId<"presence-session">("01900000-0000-7000-8000-000000000013"),
      ownerId,
      sessionId: "browser-session-1",
      surface: "web",
      clientSha: "sha-1",
      deploymentTime: null,
      userAgent: "TownCleanroom/1.0",
      lastSeenAt: new Date("2026-08-03T09:00:00.000Z"),
      expiresAt: new Date("2026-08-03T09:01:00.000Z"),
      createdAt: new Date("2026-08-03T09:00:00.000Z"),
    });
    const listPresence = vi.fn().mockResolvedValue([
      {
        id: asId<"presence-session">("01900000-0000-7000-8000-000000000013"),
        ownerId,
        sessionId: "browser-session-1",
        surface: "web",
        clientSha: "sha-1",
        deploymentTime: null,
        userAgent: "TownCleanroom/1.0",
        lastSeenAt: new Date("2026-08-03T09:00:00.000Z"),
        expiresAt: new Date("2026-08-03T09:01:00.000Z"),
        createdAt: new Date("2026-08-03T09:00:00.000Z"),
      },
    ]);
    const repository = {
      list,
      summary,
      appendAnalytics,
      listAnalytics,
      heartbeatPresence,
      listPresence,
      append: vi.fn(),
      appendPublicAnalytics: vi.fn(),
      timeline: vi.fn(),
    } as unknown as OperationsRepository;

    const app = authenticatedApp(repository);
    const audit = await app.request(
      "/v1/operations/audit?action=runtime.run.completed&outcome=succeeded&limit=1&cursor=cursor-1",
    );
    const summaryResponse = await app.request("/v1/operations/summary");
    const posted = await app.request("/v1/analytics/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventName: "web_vital_recorded",
        dedupeKey: "vital-1",
        metadata: { metric: "LCP", value: 980 },
      }),
    });
    const events = await app.request(
      "/v1/analytics/events?eventName=web_vital_recorded&limit=1&cursor=cursor-2",
    );
    const presenceHeartbeat = await app.request("/v1/presence/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "browser-session-1",
        surface: "web",
        clientSha: "sha-1",
        intervalSeconds: 30,
      }),
    });
    const presence = await app.request("/v1/presence");

    expect(audit.status).toBe(200);
    expect(summaryResponse.status).toBe(200);
    expect(posted.status).toBe(201);
    expect(events.status).toBe(200);
    expect(presenceHeartbeat.status).toBe(200);
    expect(presence.status).toBe(200);
    expect(await audit.json()).toMatchObject({
      audit: {
        items: [
          {
            action: "runtime.run.completed",
          },
        ],
      },
    });
    expect(await summaryResponse.json()).toMatchObject({
      summary: { activeSessions: 1, queuedRuns: 2 },
    });
    expect(await posted.json()).toMatchObject({
      event: { eventName: "web_vital_recorded" },
    });
    expect(await events.json()).toMatchObject({
      events: { items: [{ eventName: "web_vital_recorded" }] },
    });
    expect(await presenceHeartbeat.json()).toMatchObject({
      presence: {
        sessionId: "browser-session-1",
      },
    });
    expect(await presence.json()).toMatchObject({
      presence: [{ sessionId: "browser-session-1" }],
    });
    expect(list).toHaveBeenCalledWith({
      ownerId,
      action: "runtime.run.completed",
      outcome: "succeeded",
      cursor: "cursor-1",
      limit: 1,
    });
    expect(appendAnalytics).toHaveBeenCalledWith({
      ownerId,
      eventName: "web_vital_recorded",
      dedupeKey: "vital-1",
      metadata: { metric: "LCP", value: 980 },
    });
    expect(listAnalytics).toHaveBeenCalledWith({
      ownerId,
      eventName: "web_vital_recorded",
      limit: 1,
      cursor: "cursor-2",
    });
    expect(heartbeatPresence).toHaveBeenCalledWith({
      ownerId,
      sessionId: "browser-session-1",
      surface: "web",
      clientSha: "sha-1",
      intervalSeconds: 30,
    });
    expect(listPresence).toHaveBeenCalledWith(ownerId);
  });

  it("accepts anonymous public analytics events and validates request contracts", async () => {
    const appendPublicAnalytics = vi.fn()
      .mockResolvedValueOnce({ accepted: true, replayed: false })
      .mockRejectedValueOnce(
        new OperationsError("INVALID_METADATA", "The analytics payload is invalid."),
      );
    const repository = {
      appendPublicAnalytics,
      append: vi.fn(),
      list: vi.fn(),
      summary: vi.fn(),
      appendAnalytics: vi.fn(),
      listAnalytics: vi.fn(),
      heartbeatPresence: vi.fn(),
      listPresence: vi.fn(),
      timeline: vi.fn(),
    } as unknown as OperationsRepository;
    const app = anonymousPublicApp(repository);
    const accepted = await app.request("/v1/analytics/public/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionKey: "session-key-abcdefghijklmnopqrstuvwxyz",
        eventName: "web_vital_recorded",
        metadata: { metric: "INP", value: 88 },
        dedupeKey: "public-1",
      }),
    });
    const invalid = await app.request("/v1/analytics/public/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionKey: "too-short",
        eventName: "web_vital_recorded",
        metadata: { metric: "INP", value: 88 },
      }),
    });

    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({
      receipt: { accepted: true, replayed: false },
    });
    expect(invalid.status).toBe(400);
  });

  it("maps repository failures to mapped invalid-request status", async () => {
    const appendAnalytics = vi
      .fn<Promise<never>, Parameters<OperationsRepository["appendAnalytics"]>>()
      .mockRejectedValue(
        new OperationsError(
          "INVALID_METADATA",
          "The analytics event metadata is invalid.",
        ),
      );
    const repository = {
      appendAnalytics,
      append: vi.fn(),
      list: vi.fn(),
      summary: vi.fn(),
      listAnalytics: vi.fn(),
      heartbeatPresence: vi.fn(),
      listPresence: vi.fn(),
      appendPublicAnalytics: vi.fn(),
      timeline: vi.fn(),
    } as unknown as OperationsRepository;
    const app = authenticatedApp(repository);

    const repositoryError = await app.request("/v1/analytics/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventName: "web_vital_recorded",
        dedupeKey: "dup",
      }),
    });
    const invalidPayload = await app.request("/v1/analytics/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventName: "",
        metadata: {},
      }),
    });

    expect(repositoryError.status).toBe(400);
    expect(invalidPayload.status).toBe(400);
    expect(await repositoryError.json()).toMatchObject({
      code: "INVALID_METADATA",
    });
    expect(await invalidPayload.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });
  });
});
