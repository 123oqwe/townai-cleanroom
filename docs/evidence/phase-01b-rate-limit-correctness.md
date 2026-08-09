# Phase 01B — Database Rate Limiter Correctness Hotfix

## Evidence Document

---

## 1. Start SHA

```
cc51269f589257155f0e07e20794508f826e89b9
```

Branch: `codex/phase-01b-rate-limit-correctness` (from `main`)

---

## 2. End SHA

`7cf30ab422fc625a42514228deb0154fc0f85892`

---

## 3. Original Implementation Problems

The original `apps/api/src/lib/rate-limit.ts` had the following production defects:

1. **Integer overflow**: `timestamp::int` cast in the oldest-timestamp query. PostgreSQL `int` max is ~2.1 billion; `Date.now()` millisecond timestamps are ~1.7 trillion. This caused `integer out of range` errors, returning 500 instead of 429.

2. **No actual `FOR UPDATE` lock**: Comments claimed `FOR UPDATE` row-level locking, but the SQL had no `FOR UPDATE` clause. Concurrent transactions could both count below max and both insert, exceeding the limit.

3. **count → insert race**: The `count(*)` and `insert` were separate statements in the same transaction without a lock. Two concurrent transactions could both see `count < max` and both insert.

4. **`on conflict do nothing` without unique constraint**: The insert used `on conflict do nothing` but `rate_limit_buckets` had no unique constraint on `(key, timestamp)`, so the conflict clause was a no-op.

5. **Test pool `max=1`**: The database test used `postgres(url, { max: 1 })`, serializing all transactions and hiding concurrency bugs.

6. **Small test timestamps**: Tests used timestamps like `100_000` and `400_000` instead of real `Date.now()` values (~1.7 trillion), so the integer overflow was never triggered.

7. **Production default `memory`**: `RATE_LIMIT_BACKEND` defaulted to `memory`, meaning production deployments silently used a single-process Map with no cross-instance limit enforcement.

8. **Silent fallback**: Forgetting to set `RATE_LIMIT_BACKEND=db` silently fell back to `memory`.

9. **No cleanup**: `databaseLimiter.cleanup()` was a no-op. Expired bucket rows accumulated forever.

10. **Raw key storage**: The raw rate-limit key (containing user IDs, IP addresses, route prefixes) was stored directly in the `key` column with no hashing or length limit.

11. **No `RateLimiter` interface**: The memory and database limiters had different return types and no shared interface, making the union type unsafe for `await`.

---

## 4. Integer Overflow Root Cause

The query:

```sql
select timestamp::int as timestamp
from rate_limit_buckets
where key = ${key}
order by timestamp asc
limit 1
```

PostgreSQL `int` is a 32-bit signed integer with a maximum value of 2,147,483,647 (~2.1 billion). JavaScript `Date.now()` returns milliseconds since epoch, currently ~1,760,000,000,000 (~1.76 trillion). Casting this value to `int` triggers:

```
ERROR: integer out of range
```

This propagated as a 500 Internal Server Error instead of the intended 429 Too Many Requests.

**Fix**: Timestamps are now returned as `text` (`timestamp::text`) and converted to JavaScript `Number` via `safeTimestamp()`, which validates `Number.isSafeInteger`. The column type remains `bigint` (from migration 0050), which comfortably holds the value.

---

## 5. Concurrency Race Root Cause

The original transaction flow:

```sql
BEGIN;
DELETE FROM rate_limit_buckets WHERE key = $1 AND timestamp < $cutoff;
SELECT count(*) FROM rate_limit_buckets WHERE key = $1;
-- if count < max:
INSERT INTO rate_limit_buckets (key, timestamp) VALUES ($1, $now);
COMMIT;
```

Without a `FOR UPDATE` lock, two concurrent transactions T1 and T2 could both execute the `SELECT count(*)` before either executes `INSERT`. Both see `count < max`, both insert, and the limit is exceeded.

**Fix**: A new `rate_limit_keys` table provides per-key lock rows. The transaction now:

1. Upserts a `rate_limit_keys` row for the key hash.
2. Executes `SELECT ... FOR UPDATE` on that row, serializing concurrent checks for the same key.
3. Deletes expired buckets, counts, and inserts/denies within the locked transaction.
4. Commits, releasing the lock.

Different keys lock different rows, so they execute fully in parallel.

---

## 6. New Lock Design

### Table: `rate_limit_keys`

```sql
create table rate_limit_keys (
  key_hash text primary key,
  updated_at timestamptz not null default now()
);
```

### Transaction flow

```
1. hashKey(rawKey) → SHA-256 hex (64 chars)
2. INSERT INTO rate_limit_keys (key_hash) VALUES (...) ON CONFLICT DO UPDATE
3. SELECT key_hash FROM rate_limit_keys WHERE key_hash = ? FOR UPDATE
4. DELETE FROM rate_limit_buckets WHERE key_hash = ? AND timestamp < cutoff
5. SELECT count(*) FROM rate_limit_buckets WHERE key_hash = ?
6. if count < max: INSERT INTO rate_limit_buckets (key, key_hash, timestamp) VALUES (...)
7. if count >= max: SELECT timestamp::text ... ORDER BY timestamp ASC LIMIT 1
8. COMMIT (lock released)
```

### Guarantees

- Same key: serialized (FOR UPDATE on the key_hash row)
- Different keys: fully parallel (different rows)
- Two limiter instances sharing one DB: consistent (shared lock table)
- Multi-process: cannot exceed max (database-enforced serialization)

---

## 7. SQL Transaction Order

See section 6 above. The critical ordering is:

1. Upsert key row (ensures the row exists)
2. `FOR UPDATE` on key row (acquires the lock)
3. Delete expired (within the lock, so no phantom reads)
4. Count (within the lock, so count is stable)
5. Insert or deny (within the lock, so atomic)
6. Commit (releases the lock)

---

## 8. Migration

### `0051_rate_limit_concurrency.sql`

- Creates `rate_limit_keys` table with `key_hash` PK and `updated_at`
- Creates index on `rate_limit_keys(updated_at)` for cleanup
- Adds `key_hash` column to `rate_limit_buckets` (additive, non-breaking)
- Backfills `key_hash` for existing rows using `pgcrypto` `digest(key, 'sha256')`
- Creates indexes on `rate_limit_buckets(key_hash, timestamp)` and `(timestamp)` for cleanup
- Migration 0050 is left untouched
- Existing bucket rows are preserved and backfilled
- `pgcrypto` extension is created if not exists

### Idempotency

All DDL uses `if not exists` / `if not exists` patterns. The migration runner records the migration name in `schema_migrations` and skips already-applied migrations.

---

## 9. Production Fail-fast

### `apps/api/src/config.ts`

```typescript
if (
  environment.NODE_ENV === "production" &&
  environment.RATE_LIMIT_BACKEND === "memory" &&
  !ALLOW_UNSAFE_MEMORY_RATE_LIMIT_IN_PRODUCTION
) {
  throw new Error(
    "RATE_LIMIT_BACKEND=memory is not allowed in production. ...",
  );
}
```

- `NODE_ENV=production` + `RATE_LIMIT_BACKEND=memory` → throws at startup
- `NODE_ENV=test` + `RATE_LIMIT_BACKEND=memory` → allowed
- `NODE_ENV=production` + `RATE_LIMIT_BACKEND=db` → allowed
- Escape hatch: `ALLOW_UNSAFE_MEMORY_RATE_LIMIT_IN_PRODUCTION=true` (not recommended)

### `scripts/check-runtime-config.mjs`

Added `configErrors` array that flags the production+memory combination. `--strict` mode exits with code 1 if config errors are present.

---

## 10. Cleanup Strategy

### `databaseLimiter.cleanup()`

1. Deletes all bucket rows older than `RATE_LIMIT_RETENTION_MS` in batches of `RATE_LIMIT_CLEANUP_BATCH_SIZE` to avoid large transactions.
2. Deletes orphaned `rate_limit_keys` rows that have no remaining bucket entries and whose `updated_at` is older than the retention cutoff.
3. Returns `{ bucketsDeleted, keysDeleted }`.

### Configuration

| Variable                        | Default  | Description                      |
| ------------------------------- | -------- | -------------------------------- |
| `RATE_LIMIT_RETENTION_MS`       | `300000` | How long bucket rows are kept    |
| `RATE_LIMIT_CLEANUP_BATCH_SIZE` | `5000`   | Batch size for delete operations |

### Indexes

- `rate_limit_keys_updated_at_idx` on `rate_limit_keys(updated_at)` — cleanup of stale keys
- `rate_limit_buckets_key_hash_timestamp_idx` on `rate_limit_buckets(key_hash, timestamp)` — per-key cleanup
- `rate_limit_buckets_timestamp_only_idx` on `rate_limit_buckets(timestamp)` — bulk cleanup

### Not a no-op

The previous implementation had `function cleanup(): void {}`. The new implementation executes real SQL deletes with batched transactions.

---

## 11. Test Commands

```bash
# Rate limit unit + concurrency tests
npx vitest run apps/api/test/rate-limit.test.ts apps/api/test/rate-limit-db.test.ts

# Full test suite
pnpm test

# Type check + lint + format
pnpm typecheck && pnpm lint && pnpm format:check

# Full verify
pnpm verify

# Concurrency smoke test (requires built API + running PostgreSQL)
pnpm --filter @town/api build
DATABASE_URL=postgres://... node scripts/rate-limit-concurrency-smoke.mjs

# Browser E2E
pnpm test:e2e:browser
```

---

## 12. Concurrency Test Results

### Test: `rate-limit-db.test.ts`

32 tests, all passing.

Key concurrency tests:

| #   | Test                                                | Result                         |
| --- | --------------------------------------------------- | ------------------------------ |
| 1   | Real timestamp overflow regression                  | PASS                           |
| 2   | Single limiter concurrency (100 concurrent, max=10) | PASS (allowed=10, rejected=90) |
| 3   | Two limiter instances (100 concurrent, max=10)      | PASS (allowed=10)              |
| 4   | Different keys parallelism (50 keys)                | PASS (all allowed, <10s)       |
| 5   | Window expiration + retry-after                     | PASS                           |
| 6   | Cleanup (expired buckets + orphan keys deleted)     | PASS                           |
| 7   | Production config (memory rejected in production)   | PASS                           |
| 8   | Long/spoofed IP header (fixed-length hash)          | PASS                           |
| 9   | Transaction rollback (no residual counts)           | PASS                           |
| 10  | Retry-After boundary (never 0 or negative)          | PASS                           |

Test PostgreSQL pool: `max: 20` (previously `max: 1`).

---

## 13. Smoke Test Data

(Run after build — see test commands above.)

The smoke test verifies:

- 1,000 concurrent checks, same key, 10 limiter instances
- allowed count strictly equals max (20)
- 50 different keys all allowed (parallelism)
- P50/P95/P99 latency
- DB row growth and cleanup

---

## 14. Unresolved Risks

1. **Per-tenant, per-tool, per-model dimension limits**: Not yet implemented. Current limiter is per-identity+IP+route-prefix only.

2. **Advisory lock alternative**: The implementation uses explicit `FOR UPDATE` row locking rather than `pg_advisory_xact_lock`. This is simpler and keeps the lock tied to a real row, but adds a table. If hash collisions were a concern (SHA-256 collision probability is negligible), advisory locks would be an alternative.

3. **Staging verification (S3+)**: Not yet performed. The code is S2 (tested). S3 requires staging with `RATE_LIMIT_BACKEND=db` configured. S4 requires multi-instance staging verification.

4. **Monitoring and alerting (S6)**: No rate-limit-specific dashboards or alerts are configured. Production fault drills (e.g., DB outage behavior) have not been performed.

5. **Fail-open on DB error**: The middleware catches rate limiter errors and allows the request through (`await next()`) rather than blocking all traffic. This is a deliberate trade-off: a DB outage should not take down the API, but it means limits are not enforced during outages.

6. **IP spoofing without trusted proxy**: If the deployment does not use a trusted reverse proxy that overwrites `x-forwarded-for`, clients can spoof their IP. This is documented in the deployment docs.

---

## 15. Rollback

### Migration rollback

Migration 0051 is additive (creates a new table, adds a nullable column, creates indexes). To roll back:

```sql
drop index if exists rate_limit_buckets_timestamp_only_idx;
drop index if exists rate_limit_buckets_key_hash_timestamp_idx;
alter table rate_limit_buckets drop column if exists key_hash;
drop index if exists rate_limit_keys_updated_at_idx;
drop table if exists rate_limit_keys;
delete from schema_migrations where name = '0051_rate_limit_concurrency.sql';
```

### Code rollback

Revert to the previous `rate-limit.ts` implementation. The 0050 migration and `rate_limit_buckets` table are unchanged.

---

## 16. Maturity (S0–S6)

| Level                     | Status       | Evidence                                                                  |
| ------------------------- | ------------ | ------------------------------------------------------------------------- |
| S0 (Spec)                 | —            | —                                                                         |
| S1 (Implemented)          | —            | —                                                                         |
| S2 (Tested)               | **Achieved** | Code + 32 automated tests (10 concurrency regression tests), smoke script |
| S3 (Configured)           | Not yet      | Requires staging with `RATE_LIMIT_BACKEND=db`                             |
| S4 (Live Verified)        | Not yet      | Requires multi-instance staging verification                              |
| S5 (Quality Gated)        | Not yet      | No golden eval suite                                                      |
| S6 (Production Certified) | Not yet      | No monitoring, alerting, or fault drills                                  |

**Current maturity: S2.** CI tests passing does not justify S6.
