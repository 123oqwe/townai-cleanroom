import type { Sql } from "postgres";
import { z } from "zod";
import { asId, idSchema, newId, type Id } from "@town/contracts";

const inputSchema = z
  .object({
    ownerId: idSchema,
    sessionId: idSchema,
    runId: idSchema,
    approvalId: z.string().trim().min(1).max(500),
    decision: z.enum(["approve", "reject"]),
  })
  .strict();
export interface HarnessApprovalDecision {
  id: Id<"harness-approval-decision">;
  ownerId: Id<"user">;
  sessionId: Id<"runtime-session">;
  runId: Id<"session-run">;
  approvalId: string;
  decision: "approve" | "reject";
  consumedAt: Date | null;
  createdAt: Date;
}
export class ApprovalDecisionError extends Error {
  constructor(
    readonly code: "DECISION_NOT_FOUND" | "DECISION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ApprovalDecisionError";
  }
}
type Row = {
  id: string;
  owner_id: string;
  session_id: string;
  run_id: string;
  approval_id: string;
  decision: "approve" | "reject";
  consumed_at: Date | null;
  created_at: Date;
};
function safe(row: Row): HarnessApprovalDecision {
  return {
    id: asId<"harness-approval-decision">(row.id),
    ownerId: asId<"user">(row.owner_id),
    sessionId: asId<"runtime-session">(row.session_id),
    runId: asId<"session-run">(row.run_id),
    approvalId: row.approval_id,
    decision: row.decision,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}
const columns =
  "id, owner_id, session_id, run_id, approval_id, decision, consumed_at, created_at";
export function createApprovalDecisionRepository(sql: Sql) {
  return {
    async record(
      input: z.input<typeof inputSchema>,
    ): Promise<HarnessApprovalDecision> {
      const value = inputSchema.parse(input);
      try {
        const rows = await sql<
          Row[]
        >`insert into harness_approval_decisions (id,owner_id,session_id,run_id,approval_id,decision) values (${newId<"harness-approval-decision">()},${value.ownerId},${value.sessionId},${value.runId},${value.approvalId},${value.decision}) on conflict (owner_id,run_id,approval_id) do update set decision=excluded.decision where harness_approval_decisions.consumed_at is null returning ${sql.unsafe(columns)}`;
        if (rows[0]) return safe(rows[0]);
        throw new ApprovalDecisionError(
          "DECISION_CONFLICT",
          "The approval decision was already consumed.",
        );
      } catch (error) {
        if (error instanceof ApprovalDecisionError) throw error;
        throw error;
      }
    },
    async getPending(input: {
      ownerId: Id<"user">;
      sessionId: Id<"runtime-session">;
      runId: Id<"session-run">;
      approvalId: string;
    }): Promise<HarnessApprovalDecision | null> {
      const value = inputSchema
        .pick({ ownerId: true, sessionId: true, runId: true, approvalId: true })
        .parse(input);
      const [row] = await sql<
        Row[]
      >`select ${sql.unsafe(columns)} from harness_approval_decisions where owner_id=${value.ownerId} and session_id=${value.sessionId} and run_id=${value.runId} and approval_id=${value.approvalId} and consumed_at is null`;
      return row === undefined ? null : safe(row);
    },
    async consume(input: {
      ownerId: Id<"user">;
      sessionId: Id<"runtime-session">;
      runId: Id<"session-run">;
      approvalId: string;
    }): Promise<HarnessApprovalDecision | null> {
      const value = inputSchema
        .pick({ ownerId: true, sessionId: true, runId: true, approvalId: true })
        .parse(input);
      const [row] = await sql<
        Row[]
      >`update harness_approval_decisions set consumed_at=clock_timestamp() where owner_id=${value.ownerId} and session_id=${value.sessionId} and run_id=${value.runId} and approval_id=${value.approvalId} and consumed_at is null returning ${sql.unsafe(columns)}`;
      return row === undefined ? null : safe(row);
    },
  };
}
export type ApprovalDecisionRepository = ReturnType<
  typeof createApprovalDecisionRepository
>;
