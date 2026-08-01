import { z } from "zod";

import { idSchema, type Id } from "@town/contracts";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const resourceTypeSchema = z.enum([
  "profile",
  "memory",
  "person",
  "wiki",
]);
export const authorTypeSchema = z.enum(["user", "assistant", "system"]);
export const snapshotSchema = z.record(z.string(), z.json());

const citationBase = {
  sourceRef: z.string().trim().min(1),
  sourceLabel: z.string().trim().min(1).optional(),
  observedAt: z.date(),
};

export const citationInputSchema = z.discriminatedUnion("sourceType", [
  z
    .object({
      sourceType: z.literal("account"),
      accountId: idSchema,
      ...citationBase,
    })
    .strict(),
  ...(["user", "session", "web", "system"] as const).map((sourceType) =>
    z
      .object({
        sourceType: z.literal(sourceType),
        accountId: z.undefined().optional(),
        ...citationBase,
      })
      .strict(),
  ),
]);

export type ResourceType = z.infer<typeof resourceTypeSchema>;
export type AuthorType = z.infer<typeof authorTypeSchema>;
export type CitationInput = z.infer<typeof citationInputSchema>;

export interface KnowledgeCitation {
  id: Id<"knowledge-citation">;
  sourceType: CitationInput["sourceType"];
  sourceRef: string;
  sourceLabel: string | null;
  accountId: Id<"connected-account"> | null;
  observedAt: Date;
}

export interface KnowledgeRevision {
  id: Id<"knowledge-revision">;
  ownerId: Id<"user">;
  resourceType: ResourceType;
  resourceId: string;
  revision: number;
  baseRevision: number;
  authorType: AuthorType;
  snapshot: Record<string, JsonValue>;
  changeReason: string | null;
  createdAt: Date;
  citations: KnowledgeCitation[];
}

export interface KnowledgeConflict {
  id: Id<"knowledge-conflict">;
  ownerId: Id<"user">;
  resourceType: ResourceType;
  resourceId: string;
  baseRevision: number;
  currentRevision: number;
  proposedAuthorType: "assistant" | "system";
  proposedSnapshot: Record<string, JsonValue>;
  proposedCitations: CitationInput[];
  status: "pending" | "resolved" | "rejected";
  createdAt: Date;
  resolvedAt: Date | null;
}
