import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import type { BillingRepository, UsageCategory } from "@town/billing";
import type { AuthVariables } from "../src/auth.js";
import { registerBillingRoutes } from "../src/billing-routes.js";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");

function withErrorMapping(app: Hono<{ Variables: AuthVariables }>) {
  app.onError((error, context) => {
    if (error instanceof z.ZodError) return context.json({ code: "INVALID_REQUEST" }, 400);
    return context.json({ code: "INTERNAL_ERROR", detail: String(error) }, 500);
  });
}

function withIdentity(app: Hono<{ Variables: AuthVariables }>) {
  app.use("*", async (context, next) => {
    context.set("identity", { user: { id: ownerId, email: "owner@example.test" } });
    await next();
  });
}

function buildBillingApp(repository: BillingRepository) {
  const app = new Hono<{ Variables: AuthVariables }>();
  withErrorMapping(app);
  withIdentity(app);
  registerBillingRoutes(app, { repository });
  return app;
}

describe("billing routes", () => {
  it("returns configured billing and default period", async () => {
    const get = vi.fn().mockResolvedValue({
      ownerId,
      planName: "Cleanroom",
      isBlocked: false,
      isTrial: false,
      isEnterprise: false,
      creditBand: "healthy" as const,
      creditBanners: [],
      periodStart: null,
      periodEnd: null,
      revision: 8,
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    const summarize = vi
      .fn()
      .mockResolvedValue([
        {
          category: "model" as UsageCategory,
          quantity: "42",
          unit: "credits",
          occurredAt: new Date("2026-08-01T12:00:00.000Z"),
        },
      ]);
    const repository = { get, summarize } as unknown as BillingRepository;

    const app = buildBillingApp(repository);
    const response = await app.request("/v1/billing");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: "configured",
      billing: {
        planName: "Cleanroom",
        ownerId,
      },
      usage: [{ category: "model", quantity: "42", unit: "credits" }],
      period: {
        start: expect.any(String),
        end: expect.any(String),
      },
    });
    expect(summarize).toHaveBeenCalledWith(
      ownerId,
      expect.any(Date),
      expect.any(Date),
    );
    const [calledStart, calledEnd] = summarize.mock.calls[0]!.slice(1) as [Date, Date];
    expect(calledEnd.getTime()).toBeGreaterThan(calledStart.getTime());
    expect(calledEnd.getTime() - calledStart.getTime()).toBeLessThanOrEqual(366 * 24 * 60 * 60 * 1_000);
  });

  it("returns not_configured when no state exists", async () => {
    const repository = {
      get: vi.fn().mockResolvedValue(null),
      summarize: vi.fn(),
    } as unknown as BillingRepository;

    const app = buildBillingApp(repository);
    const response = await app.request("/v1/billing");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "not_configured" });
    expect(repository.summarize).not.toHaveBeenCalled();
  });

  it("validates explicit period range and passes parsed dates", async () => {
    const get = vi.fn().mockResolvedValue({
      ownerId,
      planName: "Cleanroom",
      isBlocked: false,
      isTrial: false,
      isEnterprise: false,
      creditBand: "warning" as const,
      creditBanners: [],
      periodStart: null,
      periodEnd: null,
      revision: 1,
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    const summarize = vi.fn().mockResolvedValue([]);
    const repository = { get, summarize } as unknown as BillingRepository;
    const app = buildBillingApp(repository);

    const response = await app.request(
      "/v1/billing?start=2026-07-01T00:00:00.000Z&end=2026-08-01T00:00:00.000Z",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "configured",
      period: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-08-01T00:00:00.000Z",
      },
    });
    expect(summarize).toHaveBeenCalledWith(
      ownerId,
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-08-01T00:00:00.000Z"),
    );
  });

  it("returns INVALID_REQUEST for invalid period windows", async () => {
    const get = vi
      .fn()
      .mockResolvedValue({
        ownerId,
        planName: "Cleanroom",
        isBlocked: false,
        isTrial: false,
        isEnterprise: false,
        creditBand: "healthy" as const,
        creditBanners: [],
        periodStart: null,
        periodEnd: null,
        revision: 1,
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      });
    const summarize = vi.fn().mockResolvedValue([]);
    const repository = { get, summarize } as unknown as BillingRepository;
    const app = buildBillingApp(repository);

    const response = await app.request(
      "/v1/billing?start=2026-08-10T00:00:00.000Z&end=2026-07-10T00:00:00.000Z",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
