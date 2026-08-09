#!/usr/bin/env node
// Concurrency smoke test for the database-backed rate limiter.
//
// Verifies correctness under load:
//   - 1,000 concurrent checks against the same key
//   - 10 limiter instances sharing one PostgreSQL
//   - allowed count strictly equals max
//   - no 500s, deadlocks, or timeouts
//   - multi-key parallelism
//   - outputs P50/P95/P99 latency and DB row growth
//
// Usage:
//   pnpm --filter @town/api build
//   DATABASE_URL=postgres://... node scripts/rate-limit-concurrency-smoke.mjs

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve postgres from the apps/api workspace where it is installed.
// postgres supports both ESM and CJS, so createRequire works here.
const apiDir = resolve(__dirname, "../apps/api");
const apiRequire = createRequire(resolve(apiDir, "package.json"));
const postgres = apiRequire("postgres");

// @town/db is ESM-only (no CJS export), so use dynamic import from its dist.
const dbDist = resolve(__dirname, "../packages/db/dist/index.js");
const { runMigrations } = await import(dbDist);

// The rate limiter is compiled to apps/api/dist.
const { createDatabaseRateLimiter } = await import(
  resolve(apiDir, "dist/lib/rate-limit.js")
);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const MAX = 20;
const WINDOW_MS = 60_000;
const CONCURRENT = 1_000;
const INSTANCES = 10;
const NUM_KEYS = 50;

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  const sql = postgres(DATABASE_URL, { max: 30 });
  await runMigrations(sql);

  // Clean slate.
  await sql`truncate table rate_limit_buckets`;
  await sql`truncate table rate_limit_keys`;

  const now = Date.now();
  const nowFn = () => now;

  // Create 10 limiter instances sharing the same DB.
  const limiters = Array.from({ length: INSTANCES }, () =>
    createDatabaseRateLimiter({
      windowMs: WINDOW_MS,
      max: MAX,
      sql,
      now: nowFn,
      retentionMs: 120_000,
      cleanupBatchSize: 1_000,
    }),
  );

  console.log(
    "=== Phase 1: Single-key concurrency (1000 checks, 10 instances) ===",
  );

  const key = "smoke:single-key:1.2.3.4";
  const latencies = [];
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: CONCURRENT }, (_, i) => {
      const limiter = limiters[i % INSTANCES];
      const start = Date.now();
      return limiter.check(key).then((r) => {
        latencies.push(Date.now() - start);
        return r;
      });
    }),
  );
  const elapsed = Date.now() - t0;

  const allowed = results.filter((r) => r.allowed).length;
  const rejected = results.filter((r) => !r.allowed).length;

  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  console.log(`  Total checks:      ${CONCURRENT}`);
  console.log(`  Allowed:           ${allowed} (expected: ${MAX})`);
  console.log(
    `  Rejected:          ${rejected} (expected: ${CONCURRENT - MAX})`,
  );
  console.log(`  Wall time:         ${elapsed}ms`);
  console.log(`  Latency P50:       ${p50.toFixed(1)}ms`);
  console.log(`  Latency P95:       ${p95.toFixed(1)}ms`);
  console.log(`  Latency P99:       ${p99.toFixed(1)}ms`);

  const pass1 = allowed === MAX && rejected === CONCURRENT - MAX;
  console.log(`  Result:            ${pass1 ? "PASS" : "FAIL"}`);
  if (!pass1) {
    console.error("  FAILED: allowed count does not match max");
    await sql.end();
    process.exit(1);
  }

  // DB row count for this key.
  const singleKeyRows =
    await sql`select count(*)::text as count from rate_limit_buckets where key = ${key}`;
  console.log(`  DB bucket rows:    ${singleKeyRows[0].count}`);

  console.log("\n=== Phase 2: Multi-key parallelism (50 keys) ===");
  await sql`truncate table rate_limit_buckets`;
  await sql`truncate table rate_limit_keys`;

  const keys = Array.from(
    { length: NUM_KEYS },
    (_, i) => `smoke:multi-${i}:1.2.3.4`,
  );
  const t1 = Date.now();
  const multiResults = await Promise.all(
    keys.map((k, i) => limiters[i % INSTANCES].check(k)),
  );
  const multiElapsed = Date.now() - t1;
  const multiAllowed = multiResults.filter((r) => r.allowed).length;
  console.log(`  Keys:              ${NUM_KEYS}`);
  console.log(`  Allowed:           ${multiAllowed} (expected: ${NUM_KEYS})`);
  console.log(`  Wall time:         ${multiElapsed}ms`);
  const pass2 = multiAllowed === NUM_KEYS;
  console.log(`  Result:            ${pass2 ? "PASS" : "FAIL"}`);
  if (!pass2) {
    console.error("  FAILED: not all keys allowed");
    await sql.end();
    process.exit(1);
  }

  console.log("\n=== Phase 3: Cleanup ===");
  const totalBefore =
    await sql`select count(*)::text as count from rate_limit_buckets`;
  console.log(`  Rows before cleanup: ${totalBefore[0].count}`);
  const cleanupResult = await limiters[0].cleanup();
  console.log(`  Buckets deleted:     ${cleanupResult.bucketsDeleted}`);
  console.log(`  Keys deleted:        ${cleanupResult.keysDeleted}`);
  const totalAfter =
    await sql`select count(*)::text as count from rate_limit_buckets`;
  console.log(`  Rows after cleanup:  ${totalAfter[0].count}`);

  console.log("\n=== Summary ===");
  console.log(`  Single-key correctness: ${pass1 ? "PASS" : "FAIL"}`);
  console.log(`  Multi-key parallelism:  ${pass2 ? "PASS" : "FAIL"}`);
  console.log(`  Cleanup executed:       YES`);
  console.log(
    `  P50: ${p50.toFixed(1)}ms  P95: ${p95.toFixed(1)}ms  P99: ${p99.toFixed(1)}ms`,
  );

  await sql.end();
  console.log("\nAll smoke tests passed.");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
