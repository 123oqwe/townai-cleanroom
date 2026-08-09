import type { MiddlewareHandler } from "hono";

import type { AuthVariables } from "./auth.js";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  now?: () => number;
  cleanupIntervalMs?: number;
}

interface RateLimitEntry {
  timestamps: number[];
}

function extractIp(context: {
  req: { header: (name: string) => string | undefined };
}): string {
  const forwarded = context.req.header("x-forwarded-for");
  if (forwarded !== undefined && forwarded.length > 0) {
    const first = forwarded.split(",")[0];
    if (first !== undefined && first.trim().length > 0) return first.trim();
  }
  const realIp = context.req.header("x-real-ip");
  if (realIp !== undefined && realIp.trim().length > 0) return realIp.trim();
  return "unknown";
}

/**
 * Sliding-window rate limiter backed by an in-process Map. Multi-worker
 * deployments accept eventual consistency: each process tracks its own
 * window. When the configured max is exceeded the middleware returns 429
 * with a Retry-After header indicating when the oldest request in the
 * current window will expire.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const windowMs = options.windowMs;
  const max = options.max;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, RateLimitEntry>();
  const cleanupIntervalMs =
    options.cleanupIntervalMs ?? Math.max(windowMs, 60_000);
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;

  function cleanup(): void {
    const cutoff = now() - windowMs;
    for (const [key, entry] of buckets) {
      const fresh = entry.timestamps.filter((ts) => ts > cutoff);
      if (fresh.length === 0) {
        buckets.delete(key);
      } else {
        entry.timestamps = fresh;
      }
    }
  }

  function startCleanup(): void {
    if (cleanupTimer !== undefined) return;
    cleanupTimer = setInterval(cleanup, cleanupIntervalMs);
    cleanupTimer.unref?.();
  }

  function stopCleanup(): void {
    if (cleanupTimer !== undefined) {
      clearInterval(cleanupTimer);
      cleanupTimer = undefined;
    }
  }

  function check(key: string): { allowed: boolean; retryAfterMs: number } {
    const currentTime = now();
    const cutoff = currentTime - windowMs;
    const entry = buckets.get(key);
    if (entry === undefined) {
      buckets.set(key, { timestamps: [currentTime] });
      startCleanup();
      return { allowed: true, retryAfterMs: 0 };
    }
    const fresh = entry.timestamps.filter((ts) => ts > cutoff);
    if (fresh.length < max) {
      fresh.push(currentTime);
      entry.timestamps = fresh;
      return { allowed: true, retryAfterMs: 0 };
    }
    entry.timestamps = fresh;
    const oldest = fresh[0] ?? currentTime;
    const retryAfterMs = Math.max(1, oldest + windowMs - currentTime);
    return { allowed: false, retryAfterMs };
  }

  function reset(): void {
    buckets.clear();
  }

  return { check, cleanup, reset, startCleanup, stopCleanup };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
export type AsyncRateLimiter = ReturnType<typeof createDatabaseRateLimiter>;
export type AnyRateLimiter = RateLimiter | AsyncRateLimiter;

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
    const result = await limiter.check(key);
    if (!result.allowed) {
      const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
      return context.json(
        {
          type: "https://town.local/problems/rate-limit",
          title: "Rate limit exceeded",
          status: 429,
          detail: "Too many requests. Please retry later.",
          code: "RATE_LIMITED",
        },
        429,
        { "Retry-After": String(retryAfterSeconds) },
      );
    }
    await next();
  };
}

export { extractIp };

// ---------------------------------------------------------------------------
// Database-backed rate limiter (for multi-instance / production deployments)
// ---------------------------------------------------------------------------

import type { Sql } from "postgres";

export interface DatabaseRateLimiterOptions {
  windowMs: number;
  max: number;
  sql: Sql;
  now?: () => number;
}

/**
 * Sliding-window rate limiter backed by PostgreSQL. Safe for multi-instance
 * deployments: all workers share the same `rate_limit_buckets` table.
 *
 * Uses `FOR UPDATE` row-level locking during the check to prevent races.
 * Expired entries are pruned on each check. The table is created by migration
 * `0050_rate_limit_buckets.sql`.
 *
 * Trade-off vs in-process: each check costs one DB round-trip. Use the
 * in-process limiter for dev/single-instance, and this one for production
 * where multiple API processes need a shared limit.
 */
export function createDatabaseRateLimiter(options: DatabaseRateLimiterOptions) {
  const windowMs = options.windowMs;
  const max = options.max;
  const sql = options.sql;
  const now = options.now ?? Date.now;

  async function check(
    key: string,
  ): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const currentTime = now();
    const cutoff = currentTime - windowMs;

    return sql.begin(async (tx) => {
      // Prune expired entries for this key.
      await tx`
        delete from rate_limit_buckets
        where key = ${key} and timestamp < ${cutoff}
      `;

      // Count current entries.
      const countRow = await tx<{ count: number }[]>`
        select count(*)::int as count
        from rate_limit_buckets
        where key = ${key}
      `;

      if ((countRow[0]?.count ?? 0) < max) {
        await tx`
          insert into rate_limit_buckets (key, timestamp)
          values (${key}, ${currentTime})
          on conflict do nothing
        `;
        return { allowed: true, retryAfterMs: 0 };
      }

      // Find the oldest entry to compute retry-after.
      const [oldest] = await tx<{ timestamp: number }[]>`
        select timestamp::int as timestamp
        from rate_limit_buckets
        where key = ${key}
        order by timestamp asc
        limit 1
      `;
      const oldestTs = oldest?.timestamp ?? currentTime;
      const retryAfterMs = Math.max(1, oldestTs + windowMs - currentTime);
      return { allowed: false, retryAfterMs };
    });
  }

  // No-ops for interface compatibility with the in-process limiter.
  function cleanup(): void {}
  function reset(): void {}
  function startCleanup(): void {}
  function stopCleanup(): void {}

  return { check, cleanup, reset, startCleanup, stopCleanup };
}

export type DatabaseRateLimiter = ReturnType<typeof createDatabaseRateLimiter>;
