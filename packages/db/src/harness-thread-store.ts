import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";

import {
  threadSnapshotSchema,
  type PersistentThreadStore,
  type ThreadSnapshot,
} from "@town/harness";

import { createDatabase } from "./client.js";
import { harnessThreads } from "./schema.js";

type TownDatabase = ReturnType<typeof createDatabase>["db"];

function toSnapshot(
  threadId: string,
  row: {
    snapshot: unknown;
    revision: number;
    leaseOwner: string | null;
    leaseExpiresAt: Date | null;
  },
): ThreadSnapshot {
  if (
    typeof row.snapshot !== "object" ||
    row.snapshot === null ||
    Array.isArray(row.snapshot)
  )
    throw new Error("HARNESS_THREAD_CORRUPT: snapshot does not match its row.");
  try {
    const snapshot = { ...(row.snapshot as Record<string, unknown>) };
    delete snapshot["revision"];
    delete snapshot["leaseOwner"];
    delete snapshot["leaseExpiresAt"];
    const parsed = threadSnapshotSchema.parse({
      ...snapshot,
      revision: row.revision,
      ...(row.leaseOwner === null ? {} : { leaseOwner: row.leaseOwner }),
      ...(row.leaseExpiresAt === null
        ? {}
        : { leaseExpiresAt: row.leaseExpiresAt.getTime() }),
    });
    if (parsed.threadId !== threadId)
      throw new Error("HARNESS_THREAD_CORRUPT: snapshot row id mismatch.");
    return parsed as unknown as ThreadSnapshot;
  } catch {
    throw new Error(
      "HARNESS_THREAD_CORRUPT: snapshot failed schema validation.",
    );
  }
}

export function createHarnessThreadStore(
  db: TownDatabase,
): PersistentThreadStore {
  return {
    async now() {
      const rows = await db.execute(
        sql`select extract(epoch from clock_timestamp()) * 1000 as epoch_ms`,
      );
      return Number(
        (rows as unknown as Array<{ epoch_ms: string | number }>)[0]?.epoch_ms,
      );
    },
    async get(threadId) {
      const [row] = await db
        .select()
        .from(harnessThreads)
        .where(eq(harnessThreads.id, threadId));
      if (row === undefined) return undefined;
      return toSnapshot(threadId, row);
    },
    async set(threadId, snapshot) {
      if (snapshot.threadId !== threadId)
        throw new Error(
          "HARNESS_THREAD_CORRUPT: snapshot threadId does not match row.",
        );
      await db
        .insert(harnessThreads)
        .values({
          id: threadId,
          snapshot,
          revision: snapshot.revision,
          leaseOwner: snapshot.leaseOwner ?? null,
          leaseExpiresAt:
            snapshot.leaseExpiresAt === undefined
              ? null
              : new Date(snapshot.leaseExpiresAt),
        })
        .onConflictDoUpdate({
          target: harnessThreads.id,
          set: {
            snapshot,
            revision: snapshot.revision,
            leaseOwner: snapshot.leaseOwner ?? null,
            leaseExpiresAt:
              snapshot.leaseExpiresAt === undefined
                ? null
                : new Date(snapshot.leaseExpiresAt),
            updatedAt: new Date(),
          },
        });
    },
    async compareAndSet(threadId, expected, snapshot) {
      if (snapshot.threadId !== threadId)
        throw new Error(
          "HARNESS_THREAD_CORRUPT: snapshot threadId does not match row.",
        );
      const rows = await db
        .update(harnessThreads)
        .set({
          snapshot,
          revision: snapshot.revision,
          leaseOwner: snapshot.leaseOwner ?? null,
          leaseExpiresAt:
            snapshot.leaseExpiresAt === undefined
              ? null
              : new Date(snapshot.leaseExpiresAt),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(harnessThreads.id, threadId),
            eq(harnessThreads.revision, expected.revision),
            expected.takeover === true
              ? expected.leaseOwner === undefined
                ? or(
                    isNull(harnessThreads.leaseOwner),
                    lte(harnessThreads.leaseExpiresAt, sql`now()`),
                  )
                : and(
                    eq(harnessThreads.leaseOwner, expected.leaseOwner),
                    lte(harnessThreads.leaseExpiresAt, sql`now()`),
                  )
              : expected.leaseOwner === undefined
                ? isNull(harnessThreads.leaseOwner)
                : and(
                    eq(harnessThreads.leaseOwner, expected.leaseOwner),
                    gt(harnessThreads.leaseExpiresAt, sql`now()`),
                  ),
          ),
        )
        .returning({ id: harnessThreads.id });
      return rows.length === 1;
    },
    async acquireLease(threadId, expectedRevision, leaseOwner, leaseMs) {
      const rows = await db
        .update(harnessThreads)
        .set({
          revision: sql`${harnessThreads.revision} + 1`,
          leaseOwner,
          leaseExpiresAt: sql`clock_timestamp() + (${leaseMs} * interval '1 millisecond')`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(harnessThreads.id, threadId),
            eq(harnessThreads.revision, expectedRevision),
            or(
              isNull(harnessThreads.leaseOwner),
              lte(harnessThreads.leaseExpiresAt, sql`clock_timestamp()`),
            ),
          ),
        )
        .returning();
      const row = rows[0];
      return row === undefined ? undefined : toSnapshot(threadId, row);
    },
  };
}
