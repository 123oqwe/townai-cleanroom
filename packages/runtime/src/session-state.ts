import type { TransactionSql } from "postgres";

import {
  runtimeSessionStateSchema,
  type RuntimeSessionState,
} from "./types.js";

export async function deriveRuntimeSessionStateInTransaction(
  transaction: TransactionSql,
  ownerId: string,
  sessionId: string,
): Promise<RuntimeSessionState> {
  const [row] = await transaction<{ state: string }[]>`
    select case
      when exists (
        select 1 from session_runs
        where owner_id = ${ownerId} and session_id = ${sessionId}
          and state = 'running'
      ) then 'running'
      when exists (
        select 1 from session_runs
        where owner_id = ${ownerId} and session_id = ${sessionId}
          and state = 'waiting_approval'
      ) then 'waiting_approval'
      when exists (
        select 1 from session_runs
        where owner_id = ${ownerId} and session_id = ${sessionId}
          and state = 'waiting_user_input'
      ) then 'waiting_user_input'
      when exists (
        select 1 from session_runs
        where owner_id = ${ownerId} and session_id = ${sessionId}
          and state = 'queued'
      ) then 'idle'
      else coalesce((
        select case when state = 'failed' then 'failed' else 'idle' end
        from session_runs
        where owner_id = ${ownerId} and session_id = ${sessionId}
        order by created_at desc, id desc
        limit 1
      ), 'idle')
    end as state
  `;
  return runtimeSessionStateSchema.parse(row?.state);
}
