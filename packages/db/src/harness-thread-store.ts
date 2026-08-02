import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";

import type { PersistentThreadStore, ThreadSnapshot } from "@town/harness";

import { createDatabase } from "./client.js";
import { harnessThreads } from "./schema.js";

type TownDatabase = ReturnType<typeof createDatabase>["db"];

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
      return {
        ...(row.snapshot as ThreadSnapshot),
        revision: row.revision,
        ...(row.leaseOwner === null ? {} : { leaseOwner: row.leaseOwner }),
        ...(row.leaseExpiresAt === null
          ? {}
          : { leaseExpiresAt: row.leaseExpiresAt.getTime() }),
      };
    },
    async set(threadId, snapshot) {
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
  };
}
