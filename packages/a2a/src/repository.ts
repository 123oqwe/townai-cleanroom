import type { Sql } from "postgres";
import { z } from "zod";
import { asId, idSchema, newId, type Id } from "@town/contracts";

import {
  type A2AStatus,
  type A2ARequest,
  a2aStatusSchema,
  a2aConsentStatusSchema,
  A2AError,
} from "./types.js";

type Row = {
  id: string;
  requester_id: string;
  recipient_id: string;
  capability: string;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  status: A2AStatus;
  revision: number;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  consent_status: z.infer<typeof a2aConsentStatusSchema>;
  consent_scope: string[];
  consented_by: string | null;
  consented_at: Date | null;
};
const createInput = z
  .object({
    requesterId: idSchema,
    recipientId: idSchema,
    capability: z.string().trim().min(1).max(200),
    request: z.record(z.string(), z.json()),
    expiresAt: z.coerce.date().nullable().optional(),
  })
  .strict();
function safe(row: Row): A2ARequest {
  return {
    id: asId<"a2a-request">(row.id),
    requesterId: asId<"user">(row.requester_id),
    recipientId: asId<"user">(row.recipient_id),
    capability: row.capability,
    request: row.request,
    result: row.result,
    status: a2aStatusSchema.parse(row.status),
    revision: row.revision,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    consentStatus: a2aConsentStatusSchema.parse(row.consent_status),
    consentScope: z.array(z.string()).parse(row.consent_scope),
    consentedBy:
      row.consented_by === null ? null : asId<"user">(row.consented_by),
    consentedAt: row.consented_at,
  };
}
const columns =
  "id, requester_id, recipient_id, capability, request, result, status, revision, expires_at, created_at, updated_at, consent_status, consent_scope, consented_by, consented_at";
export function createA2ARepository(sql: Sql) {
  return {
    async create(input: z.input<typeof createInput>): Promise<A2ARequest> {
      const value = createInput.parse(input);
      if (value.requesterId === value.recipientId)
        throw new A2AError(
          "A2A_INVALID",
          "Requester and recipient must differ.",
        );
      const rows = await sql<
        Row[]
      >`insert into a2a_requests (id, requester_id, recipient_id, capability, request, expires_at) values (${newId<"a2a-request">()}, ${value.requesterId}, ${value.recipientId}, ${value.capability}, ${sql.json(value.request)}, ${value.expiresAt ?? null}) returning ${sql.unsafe(columns)}`;
      if (!rows[0]) throw new Error("A2A insert returned no row.");
      return safe(rows[0]);
    },
    async listForUser(
      userId: Id<"user">,
      status?: A2AStatus,
    ): Promise<A2ARequest[]> {
      const rows = await sql<
        Row[]
      >`select ${sql.unsafe(columns)} from a2a_requests where (requester_id=${userId} or recipient_id=${userId}) and (${status ?? null}::text is null or status=${status ?? null}) and (status <> 'pending' or expires_at is null or expires_at > now()) order by created_at desc, id desc`;
      return rows.map(safe);
    },
    async transition(input: {
      userId: Id<"user">;
      requestId: Id<"a2a-request">;
      status: Exclude<A2AStatus, "pending">;
      revision: number;
      result?: Record<string, unknown>;
    }): Promise<A2ARequest> {
      const allowed =
        input.status === "accepted" || input.status === "declined"
          ? "recipient_id"
          : "requester_id";
      const rows = await sql<
        Row[]
      >`update a2a_requests set status=${input.status}, result=coalesce(${input.result ? sql.json(input.result as never) : null}, result), revision=revision+1, updated_at=now() where id=${input.requestId} and ${sql.unsafe(allowed)}=${input.userId} and revision=${input.revision} and status in ('pending','accepted') and (status <> 'pending' or expires_at is null or expires_at > now()) returning ${sql.unsafe(columns)}`;
      if (!rows[0]) {
        const existing = await sql<
          { id: string }[]
        >`select id from a2a_requests where id=${input.requestId} and (${input.userId}=requester_id or ${input.userId}=recipient_id)`;
        if (!existing[0])
          throw new A2AError("A2A_NOT_FOUND", "The A2A request was not found.");
        throw new A2AError(
          "A2A_CONFLICT",
          "The A2A request changed concurrently or is not actionable.",
        );
      }
      return safe(rows[0]);
    },
    async consent(input: {
      userId: Id<"user">;
      requestId: Id<"a2a-request">;
      revision: number;
      decision: "grant" | "deny" | "revoke";
      scope?: string[];
    }): Promise<A2ARequest> {
      const value = z
        .object({
          userId: idSchema,
          requestId: idSchema,
          revision: z.number().int().positive(),
          decision: z.enum(["grant", "deny", "revoke"]),
          scope: z
            .array(z.string().trim().min(1).max(200))
            .max(100)
            .default([]),
        })
        .parse(input);
      const consentStatus =
        value.decision === "grant"
          ? "granted"
          : value.decision === "deny"
            ? "denied"
            : "revoked";
      const nextStatus =
        value.decision === "grant"
          ? "accepted"
          : value.decision === "deny"
            ? "declined"
            : null;
      const rows = await sql<Row[]>`
        update a2a_requests
        set consent_status=${consentStatus}, consent_scope=${sql.json(value.scope)},
            consented_by=${value.userId}, consented_at=now(),
            status=coalesce(${nextStatus}, status), revision=revision+1, updated_at=now()
        where id=${value.requestId} and recipient_id=${value.userId}
          and revision=${value.revision}
          and (${value.decision === "revoke"} or status='pending')
          and (expires_at is null or expires_at > now())
        returning ${sql.unsafe(columns)}
      `;
      if (!rows[0]) {
        const [existing] = await sql<{ id: string }[]>`
          select id from a2a_requests where id=${value.requestId}
            and (requester_id=${value.userId} or recipient_id=${value.userId})
        `;
        if (!existing)
          throw new A2AError("A2A_NOT_FOUND", "The A2A request was not found.");
        throw new A2AError(
          "A2A_CONFLICT",
          "The A2A consent changed concurrently or is not actionable.",
        );
      }
      return safe(rows[0]);
    },
  };
}
export type A2ARepository = ReturnType<typeof createA2ARepository>;
