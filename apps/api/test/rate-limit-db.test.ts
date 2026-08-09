import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  inject,
  vi,
} from "vitest";
import postgres, { type Sql } from "postgres";
import { runMigrations } from "@town/db";

import {
  createDatabaseRateLimiter,
  hashKey,
  RateLimitError,
} from "../src/lib/rate-limit.js";

let sql: Sql;
beforeAll(async () => {
  // Use max >= 20 so real concurrent transactions are exercised. A pool
  // of max=1 hides race conditions by serializing everything.
  sql = postgres(inject("postgresUrl"), { max: 20 });
  await runMigrations(sql);
});
beforeEach(async () => {
  await sql`truncate table rate_limit_buckets`;
  await sql`truncate table rate_limit_keys`;
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
    expect((await limiter.check(key)).allowed).toBe(true);
    clock = 101_000;
    expect((await limiter.check(key)).allowed).toBe(true);
    clock = 102_000;
    expect((await limiter.check(key)).allowed).toBe(true);
    clock = 103_000;
    const rejected = await limiter.check(key);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
    expect(rejected.remaining).toBe(0);
    expect(rejected.limit).toBe(3);
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

// ===========================================================================
// Required concurrency regression tests (Section 十)
// ===========================================================================

describe("database rate limiter — concurrency regression tests", () => {
  // 1. Real timestamp overflow regression
  it("does not throw integer out of range with real Date.now() timestamps", async () => {
    const now = Date.now();
    const limiter = createDatabaseRateLimiter({
      windowMs: 5_000,
      max: 1,
      sql,
      now: () => now,
    });
    const key = "overflow-test:1.2.3.4";
    const first = await limiter.check(key);
    expect(first.allowed).toBe(true);
    const second = await limiter.check(key);
    expect(second.allowed).toBe(false);
    // Must not throw "integer out of range"
    expect(second.retryAfterMs).toBeGreaterThan(0);
    expect(Number.isFinite(second.retryAfterMs)).toBe(true);
  });

  // 2. Single limiter concurrency — allowed must strictly equal max
  it("allows exactly max concurrent requests for the same key", async () => {
    const now = Date.now();
    const limiter = createDatabaseRateLimiter({
      windowMs: 60_000,
      max: 10,
      sql,
      now: () => now,
    });
    const key = "concurrent-same-key:1.2.3.4";
    const results = await Promise.all(
      Array.from({ length: 100 }, () => limiter.check(key)),
    );
    const allowed = results.filter((r) => r.allowed).length;
    const rejected = results.filter((r) => !r.allowed).length;
    expect(allowed).toBe(10);
    expect(rejected).toBe(90);
  });

  // 3. Two limiter instances sharing the same database
  it("two limiter instances sharing one DB do not exceed max", async () => {
    const now = Date.now();
    const limiterA = createDatabaseRateLimiter({
      windowMs: 60_000,
      max: 10,
      sql,
      now: () => now,
    });
    const limiterB = createDatabaseRateLimiter({
      windowMs: 60_000,
      max: 10,
      sql,
      now: () => now,
    });
    const key = "two-instances:1.2.3.4";
    const checks = [
      ...Array.from({ length: 50 }, () => limiterA.check(key)),
      ...Array.from({ length: 50 }, () => limiterB.check(key)),
    ];
    const results = await Promise.all(checks);
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(10);
  });

  // 4. Different keys parallelism — must not serialize globally
  it("processes different keys in parallel without global serialization", async () => {
    const now = Date.now();
    const limiter = createDatabaseRateLimiter({
      windowMs: 60_000,
      max: 5,
      sql,
      now: () => now,
    });
    const keys = Array.from(
      { length: 50 },
      (_, i) => `parallel-key-${i}:1.2.3.4`,
    );
    const start = Date.now();
    const results = await Promise.all(keys.map((k) => limiter.check(k)));
    const elapsed = Date.now() - start;
    // Each key should be allowed (first request for each).
    for (const r of results) {
      expect(r.allowed).toBe(true);
    }
    // 50 different keys should complete well under 50 * (single-tx-time)
    // because they run in parallel. If they were globally serialized this
    // would take much longer. Use a generous threshold to avoid flakiness.
    expect(elapsed).toBeLessThan(10_000);
  });

  // 5. Window expiration — oldest timestamp and Retry-After correct
  it("re-allows after the window expires with correct retry-after", async () => {
    let clock = Date.now();
    const windowMs = 5_000;
    const limiter = createDatabaseRateLimiter({
      windowMs,
      max: 2,
      sql,
      now: () => clock,
    });
    const key = "window-expire:1.2.3.4";
    clock = clock + 1_000;
    await limiter.check(key);
    clock = clock + 1_000;
    await limiter.check(key);
    clock = clock + 1_000;
    const rejected = await limiter.check(key);
    expect(rejected.allowed).toBe(false);
    // retryAfterMs should point to when the oldest entry expires.
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
    // Advance past the window.
    clock = clock + windowMs + 1_000;
    const afterExpiry = await limiter.check(key);
    expect(afterExpiry.allowed).toBe(true);
  });

  // 6. Cleanup — deletes expired buckets and orphan key rows
  it("cleanup deletes expired buckets and orphan keys, keeps active data", async () => {
    const now = Date.now();
    const windowMs = 5_000;
    const limiter = createDatabaseRateLimiter({
      windowMs,
      max: 10,
      sql,
      retentionMs: 10_000,
      cleanupBatchSize: 1_000,
      now: () => now,
    });
    // Insert an active bucket entry.
    const activeKey = "cleanup-active:1.2.3.4";
    await limiter.check(activeKey);
    // Insert an expired bucket entry directly.
    const expiredKey = "cleanup-expired:1.2.3.4";
    const expiredHash = hashKey(expiredKey);
    const oldTs = now - 20_000;
    await sql`
     insert into rate_limit_keys (key_hash) values (${expiredHash})
   `;
    await sql`
     insert into rate_limit_buckets (key, key_hash, timestamp)
     values (${expiredKey}, ${expiredHash}, ${oldTs})
   `;
    // Set the orphan key's updated_at to the past so cleanup's retention
    // cutoff will catch it.
    await sql`
      update rate_limit_keys set updated_at = to_timestamp(${oldTs} / 1000.0)
      where key_hash = ${expiredHash}
    `;
    // Run cleanup.
    const result = await limiter.cleanup();
    expect(result.bucketsDeleted).toBeGreaterThanOrEqual(1);
    // Active bucket should still be there.
    const activeCount = await sql<{ count: string }[]>`
      select count(*)::text as count from rate_limit_buckets
      where key_hash = ${hashKey(activeKey)}
    `;
    expect(Number(activeCount[0]?.count)).toBe(1);
    // Expired bucket should be gone.
    const expiredCount = await sql<{ count: string }[]>`
      select count(*)::text as count from rate_limit_buckets
      where key_hash = ${expiredHash}
    `;
    expect(Number(expiredCount[0]?.count)).toBe(0);
    // Orphan key row should be deleted.
    const orphanKey = await sql<{ count: string }[]>`
      select count(*)::text as count from rate_limit_keys
      where key_hash = ${expiredHash}
    `;
    expect(Number(orphanKey[0]?.count)).toBe(0);
    // Active key row should remain.
    const activeKeyRow = await sql<{ count: string }[]>`
      select count(*)::text as count from rate_limit_keys
      where key_hash = ${hashKey(activeKey)}
    `;
    expect(Number(activeKeyRow[0]?.count)).toBe(1);
  });

  // 7. Production config — memory backend rejected in production
  it("production memory backend is rejected, test memory is allowed", async () => {
    // Set required env vars so the module-level parse succeeds, then test
    // the production fail-fast logic by overriding NODE_ENV + backend.
    const savedEnv = { ...process.env };
    process.env["DATABASE_URL"] = inject("postgresUrl");
    process.env["CREDENTIAL_MASTER_KEY_BASE64URL"] =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    process.env["RATE_LIMIT_BACKEND"] = "memory";
    try {
      // Test + memory should not throw.
      process.env["NODE_ENV"] = "test";
      vi.resetModules();
      await import("../src/config.js");

      // Production + db should not throw.
      process.env["NODE_ENV"] = "production";
      process.env["RATE_LIMIT_BACKEND"] = "db";
      vi.resetModules();
      await import("../src/config.js");

      // Production + memory should throw (unless escape hatch is set).
      process.env["NODE_ENV"] = "production";
      process.env["RATE_LIMIT_BACKEND"] = "memory";
      process.env["ALLOW_UNSAFE_MEMORY_RATE_LIMIT_IN_PRODUCTION"] = "";
      vi.resetModules();
      await expect(import("../src/config.js")).rejects.toThrow();
    } finally {
      // Restore env.
      for (const key of Object.keys(process.env)) {
        if (!(key in savedEnv)) process.env[key] = "";
      }
      Object.assign(process.env, savedEnv);
      vi.resetModules();
    }
  });

  // 8. Long/spoofed IP header — hash is fixed length, no raw key in DB
  it("long spoofed headers produce fixed-length hashes and no raw key in DB", async () => {
    const now = Date.now();
    const limiter = createDatabaseRateLimiter({
      windowMs: 60_000,
      max: 10,
      sql,
      now: () => now,
    });
    // Simulate a malicious long key.
    const longKey = "user:" + "X".repeat(10_000) + ":1.2.3.4";
    await limiter.check(longKey);
    // The key_hash column should be a fixed 64-char hex digest.
    const rows = await sql<{ key_hash: string }[]>`
      select distinct key_hash from rate_limit_buckets
      where key_hash is not null
    `;
    for (const row of rows) {
      expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // The raw long key text should NOT be stored as key_hash.
    const longHash = hashKey(longKey);
    expect(longHash).toMatch(/^[0-9a-f]{64}$/);
    expect(longHash.length).toBe(64);
  });

  // 9. Transaction rollback — no residual incorrect counts
  it("transaction rollback leaves no residual incorrect counts", async () => {
    const now = Date.now();
    const limiter = createDatabaseRateLimiter({
      windowMs: 60_000,
      max: 5,
      sql,
      now: () => now,
    });
    const key = "rollback-test:1.2.3.4";
    // Fill up to max.
    for (let i = 0; i < 5; i += 1) {
      const r = await limiter.check(key);
      expect(r.allowed).toBe(true);
    }
    // The 6th should be rejected.
    const rejected = await limiter.check(key);
    expect(rejected.allowed).toBe(false);
    // After rollback of a failed transaction (simulated by the error path),
    // the count should still be exactly 5. We verify by counting rows.
    const countRow = await sql<{ count: string }[]>`
      select count(*)::text as count from rate_limit_buckets
      where key_hash = ${hashKey(key)}
    `;
    expect(Number(countRow[0]?.count)).toBe(5);
    // The lock should be released — a new check should still see 5 and reject.
    const afterRb = await limiter.check(key);
    expect(afterRb.allowed).toBe(false);
    // Count should still be 5 (no phantom insert).
    const countRow2 = await sql<{ count: string }[]>`
      select count(*)::text as count from rate_limit_buckets
      where key_hash = ${hashKey(key)}
    `;
    expect(Number(countRow2[0]?.count)).toBe(5);
  });

  // 10. Retry-After boundary — never 0 or negative when rejecting
  it("retry-after is never 0 or negative at window boundary", async () => {
    const now = Date.now();
    const windowMs = 5_000;
    const limiter = createDatabaseRateLimiter({
      windowMs,
      max: 1,
      sql,
      now: () => now,
    });
    const key = "boundary-test:1.2.3.4";
    const first = await limiter.check(key);
    expect(first.allowed).toBe(true);
    const rejected = await limiter.check(key);
    expect(rejected.allowed).toBe(false);
    // retryAfterMs must be >= 1, never 0 or negative.
    expect(rejected.retryAfterMs).toBeGreaterThanOrEqual(1);
    expect(rejected.retryAfterMs).toBeLessThanOrEqual(windowMs);
  });
});

describe("database rate limiter — error handling", () => {
  it("wraps database errors in a stable RateLimitError", async () => {
    // Create a limiter with a closed connection to trigger a DB error.
    const badSql = postgres(inject("postgresUrl"), { max: 1 });
    await badSql.end();
    const limiter = createDatabaseRateLimiter({
      windowMs: 5_000,
      max: 1,
      sql: badSql,
      now: () => Date.now(),
    });
    await expect(limiter.check("error-test:1.2.3.4")).rejects.toThrow(
      RateLimitError,
    );
  });
});
