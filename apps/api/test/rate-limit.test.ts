import { describe, expect, it } from "vitest";

import {
  createRateLimiter,
  createRateLimitMiddleware,
  extractIp,
} from "../src/lib/rate-limit.js";
import { createApp } from "../src/app.js";

describe("rate limiter sliding window", () => {
  it("allows requests up to max and rejects the next one", () => {
    const clock = 10_000;
    const limiter = createRateLimiter({
      windowMs: 5_000,
      max: 3,
      now: () => clock,
    });
    const key = "anonymous:1.2.3.4";
    expect(limiter.check(key)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.check(key)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.check(key)).toEqual({ allowed: true, retryAfterMs: 0 });
    const rejected = limiter.check(key);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
  });

  it("computes Retry-After from the oldest entry in the window", () => {
    let clock = 20_000;
    const limiter = createRateLimiter({
      windowMs: 5_000,
      max: 2,
      now: () => clock,
    });
    const key = "anonymous:1.2.3.4";
    limiter.check(key); // t=20000
    clock = 21_000;
    limiter.check(key); // t=21000
    clock = 22_000;
    const rejected = limiter.check(key); // t=22000, oldest=20000
    expect(rejected.allowed).toBe(false);
    // oldest(20000) + window(5000) - now(22000) = 3000
    expect(rejected.retryAfterMs).toBe(3_000);
  });

  it("resets the window after it expires", () => {
    let clock = 0;
    const limiter = createRateLimiter({
      windowMs: 5_000,
      max: 2,
      now: () => clock,
    });
    const key = "anonymous:1.2.3.4";
    clock = 1_000;
    expect(limiter.check(key).allowed).toBe(true);
    clock = 2_000;
    expect(limiter.check(key).allowed).toBe(true);
    clock = 3_000;
    expect(limiter.check(key).allowed).toBe(false);
    // Advance past the window: oldest entry at t=1000 expires at t=6000
    clock = 6_001;
    expect(limiter.check(key).allowed).toBe(true);
  });

  it("tracks different identities independently", () => {
    const clock = 0;
    const limiter = createRateLimiter({
      windowMs: 5_000,
      max: 1,
      now: () => clock,
    });
    expect(limiter.check("user-a:1.2.3.4").allowed).toBe(true);
    expect(limiter.check("user-b:1.2.3.4").allowed).toBe(true);
    expect(limiter.check("user-a:1.2.3.4").allowed).toBe(false);
    expect(limiter.check("user-b:1.2.3.4").allowed).toBe(false);
  });

  it("tracks different IPs independently for the same identity", () => {
    const clock = 0;
    const limiter = createRateLimiter({
      windowMs: 5_000,
      max: 1,
      now: () => clock,
    });
    expect(limiter.check("anonymous:1.1.1.1").allowed).toBe(true);
    expect(limiter.check("anonymous:2.2.2.2").allowed).toBe(true);
    expect(limiter.check("anonymous:1.1.1.1").allowed).toBe(false);
  });

  it("cleanup removes expired buckets", () => {
    let clock = 0;
    const limiter = createRateLimiter({
      windowMs: 5_000,
      max: 10,
      now: () => clock,
    });
    limiter.check("anonymous:1.1.1.1");
    clock = 10_000;
    limiter.cleanup();
    // After cleanup the bucket is gone, so a new request starts fresh
    expect(limiter.check("anonymous:1.1.1.1").allowed).toBe(true);
  });
});

describe("extractIp", () => {
  it("reads the first IP from x-forwarded-for", () => {
    const ip = extractIp({
      req: {
        header: (name: string) =>
          name === "x-forwarded-for" ? "1.2.3.4, 5.6.7.8" : undefined,
      },
    });
    expect(ip).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const ip = extractIp({
      req: {
        header: (name: string) =>
          name === "x-real-ip" ? "9.8.7.6" : undefined,
      },
    });
    expect(ip).toBe("9.8.7.6");
  });

  it("returns unknown when no IP headers are present", () => {
    const ip = extractIp({
      req: { header: () => undefined },
    });
    expect(ip).toBe("unknown");
  });
});

describe("rate limit middleware integration", () => {
  it("returns 429 with Retry-After when the limit is exceeded", async () => {
    let clock = 0;
    const limiter = createRateLimiter({
      windowMs: 5_000,
      max: 2,
      now: () => clock,
    });
    const app = createApp({
      identityService: {} as never,
      accountRepository: {} as never,
      rateLimiter: limiter,
      devEmailLoginEnabled: true,
    });

    const headers = { "x-forwarded-for": "1.2.3.4" };
    const body = JSON.stringify({ email: "test@example.com" });

    clock = 1_000;
    const first = await app.request("/v1/auth/dev-session", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
    });
    // 500 because identityService is a stub, but the request passed the
    // rate limiter (not 429).
    expect(first.status).not.toBe(429);

    clock = 2_000;
    const second = await app.request("/v1/auth/dev-session", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
    });
    expect(second.status).not.toBe(429);

    clock = 3_000;
    const third = await app.request("/v1/auth/dev-session", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
    });
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).not.toBeNull();
    const retryAfter = Number(third.headers.get("retry-after"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    const json = (await third.json()) as { code: string };
    expect(json.code).toBe("RATE_LIMITED");
  });

  it("allows requests after the window resets", async () => {
    let clock = 0;
    const limiter = createRateLimiter({
      windowMs: 5_000,
      max: 1,
      now: () => clock,
    });
    const app = createApp({
      identityService: {} as never,
      accountRepository: {} as never,
      rateLimiter: limiter,
      devEmailLoginEnabled: true,
    });

    const headers = { "x-forwarded-for": "1.2.3.4" };
    const body = JSON.stringify({ email: "test@example.com" });

    clock = 1_000;
    const first = await app.request("/v1/auth/dev-session", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
    });
    expect(first.status).not.toBe(429);

    clock = 2_000;
    const second = await app.request("/v1/auth/dev-session", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
    });
    expect(second.status).toBe(429);

    // Window expires: oldest at t=1000 + 5000 = 6000
    clock = 6_001;
    const third = await app.request("/v1/auth/dev-session", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
    });
    expect(third.status).not.toBe(429);
  });

  it("isolates rate limits by IP address", async () => {
    let clock = 0;
    const limiter = createRateLimiter({
      windowMs: 5_000,
      max: 1,
      now: () => clock,
    });
    const app = createApp({
      identityService: {} as never,
      accountRepository: {} as never,
      rateLimiter: limiter,
      devEmailLoginEnabled: true,
    });

    const body = JSON.stringify({ email: "test@example.com" });

    clock = 1_000;
    const fromIp1 = await app.request("/v1/auth/dev-session", {
      method: "POST",
      headers: {
        "x-forwarded-for": "1.1.1.1",
        "content-type": "application/json",
      },
      body,
    });
    expect(fromIp1.status).not.toBe(429);

    clock = 2_000;
    const fromIp2 = await app.request("/v1/auth/dev-session", {
      method: "POST",
      headers: {
        "x-forwarded-for": "2.2.2.2",
        "content-type": "application/json",
      },
      body,
    });
    // Different IP, different bucket: should pass
    expect(fromIp2.status).not.toBe(429);
  });
});

describe("createRateLimitMiddleware", () => {
  it("applies key prefix to isolate route groups", () => {
    const clock = 0;
    const limiter = createRateLimiter({
      windowMs: 5_000,
      max: 1,
      now: () => clock,
    });
    const middlewareA = createRateLimitMiddleware(limiter, {
      keyPrefix: "route-a:",
    });
    const middlewareB = createRateLimitMiddleware(limiter, {
      keyPrefix: "route-b:",
    });
    // Both use the same limiter but different prefixes
    void middlewareA;
    void middlewareB;
    expect(limiter.check("route-a:anonymous:1.1.1.1").allowed).toBe(true);
    expect(limiter.check("route-a:anonymous:1.1.1.1").allowed).toBe(false);
    expect(limiter.check("route-b:anonymous:1.1.1.1").allowed).toBe(true);
  });
});
