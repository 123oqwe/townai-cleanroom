import type { TransactionSql } from "postgres";

import type { ResourceType } from "./types.js";

export async function lockKnowledgeResource(
  transaction: TransactionSql,
  ownerId: string,
  resourceType: ResourceType,
  resourceId: string,
): Promise<void> {
  const lockKey = `${ownerId}:${resourceType}:${resourceId}`;
  await transaction`
    select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `;
}
