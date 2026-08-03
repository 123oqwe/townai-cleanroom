import { z } from "zod";

import { idSchema, type Id } from "@town/contracts";

import {
  type KnowledgeSearchRepository,
  type KnowledgeSearchResult,
} from "./search-repository.js";
import { resourceTypeSchema, type ResourceType } from "./types.js";

const contextInputSchema = z
  .object({
    ownerId: idSchema,
    query: z.string().trim().min(1).max(500),
    types: z.array(resourceTypeSchema).min(1).max(4).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    maxChars: z.number().int().min(500).max(50_000).default(12_000),
  })
  .strict()
  .refine(
    (value) =>
      value.types === undefined ||
      new Set(value.types).size === value.types.length,
    { message: "Context resource types must be unique.", path: ["types"] },
  );

export interface KnowledgeContextItem {
  resourceType: ResourceType;
  resourceId: string;
  title: string | null;
  text: string;
  score: number;
  updatedAt: Date;
  citations: KnowledgeSearchResult["citations"];
}

export interface KnowledgeContext {
  query: string;
  items: KnowledgeContextItem[];
  text: string;
  includedChars: number;
  truncated: boolean;
  source: {
    kind: "local_postgresql";
    algorithm: "postgres_full_text_v1";
  };
}

function formatItem(item: KnowledgeSearchResult): string {
  const title = item.title === null ? item.resourceType : item.title;
  return `[${item.resourceType}:${item.resourceId}] ${title}\n${item.text}`;
}

/**
 * Builds a bounded, citation-preserving context block from owner-scoped
 * knowledge search. It is deterministic and does not summarize or invent
 * content; callers can pass the returned text to a model provider explicitly.
 */
export function createKnowledgeContextBuilder(
  search: KnowledgeSearchRepository,
) {
  return {
    async build(input: {
      ownerId: Id<"user">;
      query: string;
      types?: ResourceType[];
      limit?: number;
      maxChars?: number;
    }): Promise<KnowledgeContext> {
      const value = contextInputSchema.parse(input);
      const page = await search.search({
        ownerId: value.ownerId as Id<"user">,
        query: value.query,
        ...(value.types === undefined ? {} : { types: value.types }),
        limit: value.limit,
      });
      const items: KnowledgeContextItem[] = [];
      let text = "";
      let truncated = page.nextCursor !== null;
      for (const result of page.items) {
        const formatted = formatItem(result);
        const separator = text.length === 0 ? "" : "\n\n";
        if (
          text.length + separator.length + formatted.length >
          value.maxChars
        ) {
          truncated = true;
          break;
        }
        text += separator + formatted;
        items.push({
          resourceType: result.resourceType,
          resourceId: result.resourceId,
          title: result.title,
          text: result.text,
          score: result.score,
          updatedAt: result.updatedAt,
          citations: result.citations,
        });
      }
      return {
        query: value.query,
        items,
        text,
        includedChars: text.length,
        truncated,
        source: {
          kind: "local_postgresql",
          algorithm: "postgres_full_text_v1",
        },
      };
    },
  };
}

export type KnowledgeContextBuilder = ReturnType<
  typeof createKnowledgeContextBuilder
>;
