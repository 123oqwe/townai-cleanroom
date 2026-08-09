import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  inject,
} from "vitest";
import postgres, { type Sql } from "postgres";
import { runMigrations } from "@town/db";

import { createDatabaseRateLimiter } from "../src/lib/rate-limit.js";

let sql: Sql;
beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 1 });
  await runMigrations(sql);
});
beforeEach(async () => {
  await sql`truncate table rate_limit_buckets`;
});
afterAll(async () => {
  await sql.end();
});

describe("database rate limiter", () => {
  it("allows requests up to max and rejects the next one", async () => {
    let clock = 100_000;
    const limiter = createDatabaseRateLimiter({
      windowMs: 5_000,
      max: 3,
      sql,
      now: () => clock,
    });
    const key = "db-test:1.2.3.4";
    clock = 100_000;
    expect(await limiter.check(key)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
    clock = 101_000;
    expect(await limiter.check(key)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
    clock = 102_000;
    expect(await limiter.check(key)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
    clock = 103_000;
    const rejected = await limiter.check(key);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets the window after it expires", async () => {
    let clock = 200_000;
    const limiter = createDatabaseRateLimiter({
      windowMs: 5_000,
      max: 2,
      sql,
      now: () => clock,
    });
    const key = "db-reset:1.2.3.4";
    clock = 201_000;
    expect((await limiter.check(key)).allowed).toBe(true);
    clock = 202_000;
    expect((await limiter.check(key)).allowed).toBe(true);
    clock = 203_000;
    expect((await limiter.check(key)).allowed).toBe(false);
    clock = 206_001;
    expect((await limiter.check(key)).allowed).toBe(true);
  });

  it("tracks different keys independently", async () => {
    const clock = 300_000;
    const limiter = createDatabaseRateLimiter({
      windowMs: 5_000,
      max: 1,
      sql,
      now: () => clock,
    });
    expect((await limiter.check("db-indep-a:1.2.3.4")).allowed).toBe(true);
    expect((await limiter.check("db-indep-b:1.2.3.4")).allowed).toBe(true);
    expect((await limiter.check("db-indep-a:1.2.3.4")).allowed).toBe(false);
    expect((await limiter.check("db-indep-b:1.2.3.4")).allowed).toBe(false);
  });

  it("provides retry-after based on oldest entry", async () => {
    let clock = 400_000;
    const limiter = createDatabaseRateLimiter({
      windowMs: 5_000,
      max: 2,
      sql,
      now: () => clock,
    });
    const key = "db-retry:1.2.3.4";
    clock = 401_000;
    await limiter.check(key);
    clock = 402_000;
    await limiter.check(key);
    clock = 403_000;
    const rejected = await limiter.check(key);
    expect(rejected.allowed).toBe(false);
    // oldest(401000) + window(5000) - now(403000) = 3000
    expect(rejected.retryAfterMs).toBe(3_000);
  });
});
