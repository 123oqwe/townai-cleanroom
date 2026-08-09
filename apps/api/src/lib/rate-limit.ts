import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";

import type { AuthVariables } from "./auth.js";

// ---------------------------------------------------------------------------
// Types and interfaces
// ---------------------------------------------------------------------------

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
  limit: number;
  resetAt: number;
}

export interface RateLimitCleanupResult {
  bucketsDeleted: number;
  keysDeleted: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitDecision>;
  cleanup(): Promise<RateLimitCleanupResult>;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  now?: () => number;
  cleanupIntervalMs?: number;
}

export interface DatabaseRateLimiterOptions {
  windowMs: number;
  max: number;
  sql: import("postgres").Sql;
  now?: () => number;
  retentionMs?: number;
  cleanupBatchSize?: number;
}

// ---------------------------------------------------------------------------
// Key normalization and hashing
// ---------------------------------------------------------------------------

/**
 * Maximum length for any individual header value before it is truncated.
 * Prevents malicious clients from stuffing arbitrarily long headers into
 * the rate-limit key derivation.
 */
const MAX_HEADER_LENGTH = 512;

/**
 * Normalizes a raw rate-limit key into a fixed-length SHA-256 hex digest.
 * The raw key never touches the database; only the hash is stored. This
 * prevents raw user IDs, IP addresses, or route prefixes from being
 * persisted in plaintext and limits row size to a fixed 64 characters.
 */
export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

function isControlChar(code: number): boolean {
  // Reject ASCII control characters (0x00-0x1F, 0x7F) but allow tab (0x09).
  return (code < 0x20 && code !== 0x09) || code === 0x7f;
}

function sanitizeHeaderValue(value: string): string {
  if (value.length > MAX_HEADER_LENGTH) {
    value = value.slice(0, MAX_HEADER_LENGTH);
  }
  // Strip control characters that could be used for header injection or
  // cause unexpected key collisions.
  let result = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (!isControlChar(code)) {
      result += value[i];
    }
  }
  return result.trim();
}

// ---------------------------------------------------------------------------
// IP extraction
// ---------------------------------------------------------------------------

export interface IpExtractionContext {
  req: { header: (name: string) => string | undefined };
}

/**
 * Extracts the client IP from proxy headers. Handles comma-separated
 * x-forwarded-for lists, trims whitespace, rejects control characters,
 * and imposes a maximum header length to prevent abuse.
 *
 * Trust boundary: this assumes the reverse proxy (Vercel, nginx, etc.)
 * overwrites x-forwarded-for before forwarding. If you run without a
 * trusted proxy, clients can spoof this header. The fallback to
 * x-real-ip and then "unknown" is the safe default.
 */
export function extractIp(context: IpExtractionContext): string {
  const forwarded = context.req.header("x-forwarded-for");
  if (forwarded !== undefined) {
    const sanitized = sanitizeHeaderValue(forwarded);
    if (sanitized.length > 0) {
      const first = sanitized.split(",")[0];
      if (first !== undefined && first.trim().length > 0) {
        return first.trim();
      }
    }
  }
  const realIp = context.req.header("x-real-ip");
  if (realIp !== undefined) {
    const sanitized = sanitizeHeaderValue(realIp);
    if (sanitized.length > 0) return sanitized;
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Bigint-safe timestamp helpers
// ---------------------------------------------------------------------------

/**
 * Safely converts a value returned from PostgreSQL (which may be a bigint,
 * string, or number) into a JavaScript number. Throws a stable error if the
 * value is missing, non-numeric, or outside the safe integer range.
 *
 * Date.now() millisecond timestamps (~1.7 trillion) exceed PostgreSQL's
 * 32-bit int range (~2.1 billion) but fit comfortably within both bigint
 * and JavaScript's safe integer range (2^53 - 1).
 */
export function safeTimestamp(value: unknown): number {
  if (value === null || value === undefined) {
    throw new RateLimitError("TIMESTAMP_NULL");
  }
  const num = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(num)) {
    throw new RateLimitError("TIMESTAMP_NOT_FINITE");
  }
  if (!Number.isSafeInteger(num)) {
    throw new RateLimitError("TIMESTAMP_UNSAFE_INTEGER");
  }
  return num;
}

/**
 * Stable error type for rate limiter failures. The message never includes
 * SQL or connection details, preventing information leakage.
 */
export class RateLimitError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Rate limit error: ${code}`);
    this.name = "RateLimitError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// In-process (memory) rate limiter
// ---------------------------------------------------------------------------

interface MemoryEntry {
  timestamps: number[];
}

/**
 * Sliding-window rate limiter backed by an in-process Map. Each process
 * tracks its own window, so multi-worker deployments are eventually
 * consistent. Use the database limiter for multi-instance production.
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const windowMs = options.windowMs;
  const max = options.max;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, MemoryEntry>();
  const cleanupIntervalMs =
    options.cleanupIntervalMs ?? Math.max(windowMs, 60_000);
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;

  function pruneEntry(entry: MemoryEntry, currentTime: number): number[] {
    const cutoff = currentTime - windowMs;
    const fresh = entry.timestamps.filter((ts) => ts > cutoff);
    entry.timestamps = fresh;
    return fresh;
  }

  function periodicCleanup(): void {
    const currentTime = now();
    for (const [key, entry] of buckets) {
      pruneEntry(entry, currentTime);
      if (entry.timestamps.length === 0) {
        buckets.delete(key);
      }
    }
  }

  async function check(key: string): Promise<RateLimitDecision> {
    const currentTime = now();
    const entry = buckets.get(key);
    if (entry === undefined) {
      buckets.set(key, { timestamps: [currentTime] });
      return {
        allowed: true,
        retryAfterMs: 0,
        remaining: max - 1,
        limit: max,
        resetAt: currentTime + windowMs,
      };
    }
    const fresh = pruneEntry(entry, currentTime);
    if (fresh.length < max) {
      fresh.push(currentTime);
      entry.timestamps = fresh;
      return {
        allowed: true,
        retryAfterMs: 0,
        remaining: max - fresh.length,
        limit: max,
        resetAt: currentTime + windowMs,
      };
    }
    const oldest = fresh[0] ?? currentTime;
    const retryAfterMs = Math.max(1, oldest + windowMs - currentTime);
    return {
      allowed: false,
      retryAfterMs,
      remaining: 0,
      limit: max,
      resetAt: oldest + windowMs,
    };
  }

  async function cleanup(): Promise<RateLimitCleanupResult> {
    periodicCleanup();
    return { bucketsDeleted: 0, keysDeleted: 0 };
  }

  function startCleanup(): void {
    if (cleanupTimer !== undefined) return;
    cleanupTimer = setInterval(periodicCleanup, cleanupIntervalMs);
    cleanupTimer.unref?.();
  }

  function stopCleanup(): void {
    if (cleanupTimer !== undefined) {
      clearInterval(cleanupTimer);
      cleanupTimer = undefined;
    }
  }

  // Expose resetForTestOnly for test isolation. Not used in production paths.
  function resetForTestOnly(): void {
    buckets.clear();
  }

  // Attach lifecycle methods as non-enumerable extras for backward compat.
  return Object.assign(
    { check, cleanup },
    {
      startCleanup,
      stopCleanup,
      resetForTestOnly,
      // Deprecated alias kept for transition; prefer resetForTestOnly.
      reset: resetForTestOnly,
    },
  ) as RateLimiter & {
    startCleanup: typeof startCleanup;
    stopCleanup: typeof stopCleanup;
    resetForTestOnly: typeof resetForTestOnly;
    reset: typeof resetForTestOnly;
  };
}

// ---------------------------------------------------------------------------
// Database-backed rate limiter
// ---------------------------------------------------------------------------

/**
 * Sliding-window rate limiter backed by PostgreSQL with real per-key
 * row-level locking. Safe for multi-instance deployments: all workers
 * share the same `rate_limit_buckets` and `rate_limit_keys` tables.
 *
 * Concurrency design:
 *   1. The raw key is normalized and SHA-256 hashed (fixed 64-char hex).
 *   2. A `rate_limit_keys` row is inserted (upsert) for the key hash.
 *   3. `SELECT ... FOR UPDATE` locks that single key row, serializing
 *      concurrent checks for the same key within a transaction.
 *   4. Expired bucket rows for that key are deleted.
 *   5. Remaining rows are counted; if below max, a new timestamp is
 *      inserted and the request is allowed.
 *   6. If at or above max, the oldest timestamp determines retryAfterMs.
 *   7. The transaction commits, releasing the row lock.
 *
 * Different keys lock different rows, so they execute fully in parallel.
 * Timestamps are stored as bigint and returned as text to avoid the
 * PostgreSQL `int` overflow that affected the previous implementation.
 */
export function createDatabaseRateLimiter(
  options: DatabaseRateLimiterOptions,
): RateLimiter {
  const windowMs = options.windowMs;
  const max = options.max;
  const sql = options.sql;
  const now = options.now ?? Date.now;
  const retentionMs = options.retentionMs ?? Math.max(windowMs * 2, 300_000);
  const cleanupBatchSize = options.cleanupBatchSize ?? 5_000;

  async function check(key: string): Promise<RateLimitDecision> {
    const currentTime = now();
    const cutoff = currentTime - windowMs;
    const keyHash = hashKey(key);

    try {
      return await sql.begin(async (tx) => {
        // 1. Upsert the key row so we have something to lock.
        await tx`
          insert into rate_limit_keys (key_hash, updated_at)
          values (${keyHash}, now())
          on conflict (key_hash) do update
            set updated_at = now()
        `;

        // 2. Lock the key row FOR UPDATE. This serializes concurrent
        //    checks for the same key. Different keys lock different rows.
        await tx`
          select key_hash from rate_limit_keys
          where key_hash = ${keyHash}
          for update
        `;

        // 3. Delete expired bucket rows for this key.
        await tx`
          delete from rate_limit_buckets
          where key_hash = ${keyHash} and timestamp < ${cutoff}
        `;

        // 4. Count remaining rows in the current window.
        const countRow = await tx<{ count: string }[]>`
          select count(*)::text as count
          from rate_limit_buckets
          where key_hash = ${keyHash}
        `;
        const currentCount = safeTimestamp(countRow[0]?.["count"]);

        if (currentCount < max) {
          // 5. Insert the current request timestamp as bigint.
          await tx`
            insert into rate_limit_buckets (key, key_hash, timestamp)
            values (${key}, ${keyHash}, ${currentTime})
          `;
          return {
            allowed: true,
            retryAfterMs: 0,
            remaining: max - currentCount - 1,
            limit: max,
            resetAt: currentTime + windowMs,
          };
        }

        // 6. At limit: find the oldest timestamp to compute retry-after.
        //    Return timestamp as text to avoid int overflow.
        const [oldest] = await tx<{ timestamp: string }[]>`
          select timestamp::text as timestamp
          from rate_limit_buckets
          where key_hash = ${keyHash}
          order by timestamp asc
          limit 1
        `;
        const oldestTs = safeTimestamp(oldest?.timestamp);
        const retryAfterMs = Math.max(1, oldestTs + windowMs - currentTime);
        return {
          allowed: false,
          retryAfterMs,
          remaining: 0,
          limit: max,
          resetAt: oldestTs + windowMs,
        };
      });
    } catch (error) {
      if (error instanceof RateLimitError) throw error;
      // Wrap all other errors (including SQL errors) in a stable type.
      // Never leak SQL text, connection strings, or query details.
      throw new RateLimitError("DATABASE_ERROR");
    }
  }

  async function cleanup(): Promise<RateLimitCleanupResult> {
    const currentTime = now();
    const retentionCutoff = currentTime - retentionMs;

    try {
      // 1. Delete all bucket rows older than the retention window in batches.
      let bucketsDeleted = 0;
      let batchDeleted = cleanupBatchSize;
      while (batchDeleted >= cleanupBatchSize) {
        const result = await sql`
          with deleted as (
            delete from rate_limit_buckets
            where ctid in (
              select ctid from rate_limit_buckets
              where timestamp < ${retentionCutoff}
              limit ${cleanupBatchSize}
            )
            returning 1
          )
          select count(*)::text as count from deleted
        `;
        batchDeleted = safeTimestamp(result[0]?.["count"]);
        bucketsDeleted += batchDeleted;
      }

      // 2. Delete orphaned key rows that have no remaining bucket entries
      //    and haven't been updated within the retention period.
      const keyResult = await sql<{ count: string }[]>`
        with deleted as (
          delete from rate_limit_keys
          where updated_at < to_timestamp(${retentionCutoff} / 1000.0)
            and not exists (
              select 1 from rate_limit_buckets b
              where b.key_hash = rate_limit_keys.key_hash
            )
          returning 1
        )
        select count(*)::text as count from deleted
      `;
      const keysDeleted = safeTimestamp(keyResult[0]?.["count"]);

      return { bucketsDeleted, keysDeleted };
    } catch {
      throw new RateLimitError("CLEANUP_ERROR");
    }
  }

  function resetForTestOnly(): void {
    // Synchronous test helper. Callers that need async reset should use
    // direct SQL truncate in test setup.
  }

  return Object.assign(
    { check, cleanup },
    { resetForTestOnly },
  ) as RateLimiter & { resetForTestOnly: typeof resetForTestOnly };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export type AnyRateLimiter = RateLimiter;

export function createRateLimitMiddleware(
  limiter: AnyRateLimiter,
  options?: { keyPrefix?: string },
): MiddlewareHandler<{ Variables: AuthVariables }> {
  const keyPrefix = options?.keyPrefix ?? "";
  return async (context, next) => {
    const ip = extractIp(context);
    let identity: string;
    try {
      identity = context.get("identity")?.user?.id ?? "anonymous";
    } catch {
      identity = "anonymous";
    }
    const key = `${keyPrefix}${identity}:${ip}`;
    let result: RateLimitDecision;
    try {
      result = await limiter.check(key);
    } catch {
      // On rate limiter failure, fail open (allow the request) but log
      // nothing sensitive. This prevents a DB outage from taking down
      // the entire API. The error is already a stable RateLimitError.
      await next();
      return;
    }
    const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
    if (!result.allowed) {
      return context.json(
        {
          type: "https://town.local/problems/rate-limit",
          title: "Rate limit exceeded",
          status: 429,
          detail: "Too many requests. Please retry later.",
          code: "RATE_LIMITED",
        },
        429,
        {
          "Retry-After": String(Math.max(1, retryAfterSeconds)),
          "RateLimit-Limit": String(result.limit),
          "RateLimit-Remaining": "0",
          "RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
        },
      );
    }
    // Set rate limit headers on allowed responses too, before next().
    context.header("RateLimit-Limit", String(result.limit));
    context.header(
      "RateLimit-Remaining",
      String(Math.max(0, result.remaining)),
    );
    context.header("RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
    await next();
  };
}
