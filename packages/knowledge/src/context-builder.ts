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
    types: z.array(resourceTypeSchema).min(1).max(6).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    maxChars: z.number().int().min(500).max(50_000).default(12_000),
    includeExternal: z.boolean().default(false),
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
  source: "local_postgresql" | "external_gmail" | "external_calendar";
}

export interface RetrievalPlan {
  query: string;
  branches: Array<{
    source: string;
    types?: ResourceType[];
    rationale: string;
  }>;
}

export interface KnowledgeContext {
  query: string;
  plan: RetrievalPlan;
  items: KnowledgeContextItem[];
  text: string;
  includedChars: number;
  truncated: boolean;
  compressed: boolean;
  deduplicatedCount: number;
  source: {
    kind: "local_postgresql";
    algorithm: "retrieval_planning_v1";
  };
}

/** External search provider interface for federated retrieval. */
export interface ExternalSearchProvider {
  name: string;
  search(input: { ownerId: Id<"user">; query: string; limit: number }): Promise<
    Array<{
      resourceType: ResourceType;
      resourceId: string;
      title: string | null;
      text: string;
      score: number;
      updatedAt: Date;
      citations: KnowledgeSearchResult["citations"];
      source: "external_gmail" | "external_calendar";
    }>
  >;
}

function formatItem(item: KnowledgeContextItem): string {
  const title = item.title === null ? item.resourceType : item.title;
  return `[${item.resourceType}:${item.resourceId}] ${title}\n${item.text}`;
}

/**
 * Generates a retrieval plan by analyzing the query and deciding which
 * knowledge sources to search. Real Town.ai calls this "context engineering
 * as search" - the plan determines the retrieval branches, not a single query.
 */
function planRetrieval(query: string, types?: ResourceType[]): RetrievalPlan {
  const branches: RetrievalPlan["branches"] = [];
  const queryLower = query.toLowerCase();

  // Always search local knowledge first
  branches.push({
    source: "local_postgresql",
    ...(types === undefined ? {} : { types }),
    rationale:
      "Search structured knowledge: Profile, Memory, People, Wiki, Goals, Projects",
  });

  // If the query mentions email, add Gmail as a retrieval branch
  if (
    queryLower.includes("email") ||
    queryLower.includes("mail") ||
    queryLower.includes("inbox") ||
    queryLower.includes("sent")
  ) {
    branches.push({
      source: "external_gmail",
      rationale:
        "Query references email content; search connected Gmail accounts",
    });
  }

  // If the query mentions calendar, schedule, meeting, or time
  if (
    queryLower.includes("calendar") ||
    queryLower.includes("meeting") ||
    queryLower.includes("schedule") ||
    queryLower.includes("event") ||
    queryLower.includes("appointment")
  ) {
    branches.push({
      source: "external_calendar",
      rationale: "Query references calendar events; search connected calendars",
    });
  }

  // If the query mentions people, contacts, or relationships
  if (
    queryLower.includes("person") ||
    queryLower.includes("people") ||
    queryLower.includes("contact") ||
    queryLower.includes("relationship")
  ) {
    branches.push({
      source: "local_postgresql",
      types: ["person" as const],
      rationale: "Query references people; prioritize People graph search",
    });
  }

  return { query, branches };
}

/**
 * Deduplicates context items by resource identity and removes near-duplicate
 * text. Real Town.ai deduplicates across sources before compression.
 */
function deduplicateItems(items: KnowledgeContextItem[]): {
  items: KnowledgeContextItem[];
  removed: number;
} {
  const seen = new Set<string>();
  const seenTextHashes = new Set<string>();
  const deduped: KnowledgeContextItem[] = [];
  let removed = 0;

  for (const item of items) {
    const idKey = `${item.resourceType}:${item.resourceId}:${item.source}`;
    if (seen.has(idKey)) {
      removed += 1;
      continue;
    }
    seen.add(idKey);

    // Simple text dedup: if the first 200 chars match, skip
    const textHash = item.text.slice(0, 200);
    if (seenTextHashes.has(textHash) && item.text.length < 300) {
      removed += 1;
      continue;
    }
    seenTextHashes.add(textHash);
    deduped.push(item);
  }

  return { items: deduped, removed };
}

/**
 * Compresses context by truncating individual items to a per-item budget and
 * re-ranking by score. Real Town.ai compresses context before sending to the
 * model to minimize token usage.
 */
function compressContext(
  items: KnowledgeContextItem[],
  maxChars: number,
): { items: KnowledgeContextItem[]; text: string; truncated: boolean } {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const perItemBudget = Math.floor(maxChars / Math.min(sorted.length, 10));
  const result: KnowledgeContextItem[] = [];
  let text = "";
  let truncated = false;

  for (const item of sorted) {
    const formatted = formatItem(item);
    const budgeted =
      formatted.length > perItemBudget
        ? formatted.slice(0, perItemBudget - 3) + "..."
        : formatted;
   const separator = text.length === 0 ? "" : "\n\n";
   if (
      budgeted.length >= maxChars ||
      text.length + separator.length + budgeted.length > maxChars
   ) {
     truncated = true;
     break;
   }
    text += separator + budgeted;
    result.push({
      ...item,
      text:
        item.text.length > perItemBudget - 100
          ? item.text.slice(0, perItemBudget - 103) + "..."
          : item.text,
    });
  }

  return { items: result, text, truncated };
}

/**
 * Builds a bounded, citation-preserving context block using retrieval planning,
 * federated search, deduplication, and compression. This implements Town's
 * "context engineering as search" philosophy: the builder plans retrieval
 * branches, searches multiple sources, deduplicates, compresses, and ranks
 * before returning the minimal sufficient context for the model.
 */
export function createKnowledgeContextBuilder(
  search: KnowledgeSearchRepository,
  externalProviders?: readonly ExternalSearchProvider[],
) {
  return {
    async build(input: {
      ownerId: Id<"user">;
      query: string;
      types?: ResourceType[];
      limit?: number;
      maxChars?: number;
      includeExternal?: boolean;
    }): Promise<KnowledgeContext> {
      const value = contextInputSchema.parse(input);
      const plan = planRetrieval(value.query, value.types);

      // Branch 1: Local PostgreSQL full-text search
      const page = await search.search({
        ownerId: value.ownerId as Id<"user">,
        query: value.query,
        ...(value.types === undefined ? {} : { types: value.types }),
        limit: value.limit,
      });

      const allItems: KnowledgeContextItem[] = page.items.map((result) => ({
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        title: result.title,
        text: result.text,
        score: result.score,
        updatedAt: result.updatedAt,
        citations: result.citations,
        source: "local_postgresql" as const,
      }));

      // Branch 2+: External federated search (Gmail, Calendar, etc.)
      if (value.includeExternal && externalProviders !== undefined) {
        const externalResults = await Promise.allSettled(
          externalProviders.map((provider) =>
            provider.search({
              ownerId: value.ownerId as Id<"user">,
              query: value.query,
              limit: Math.min(value.limit, 10),
            }),
          ),
        );
        for (const result of externalResults) {
          if (result.status === "fulfilled") {
            for (const item of result.value) {
              allItems.push({
                resourceType: item.resourceType,
                resourceId: item.resourceId,
                title: item.title,
                text: item.text,
                score: item.score * 0.8, // External results get a relevance penalty
                updatedAt: item.updatedAt,
                citations: item.citations,
                source: item.source,
              });
            }
          }
        }
      }

      // Deduplicate across sources
      const { items: dedupedItems, removed: deduplicatedCount } =
        deduplicateItems(allItems);

      // Compress and rank
      const {
        items: compressedItems,
        text,
        truncated,
      } = compressContext(dedupedItems, value.maxChars);

      return {
        query: value.query,
        plan,
        items: compressedItems,
        text,
        includedChars: text.length,
        truncated,
        compressed: dedupedItems.length > compressedItems.length,
        deduplicatedCount,
        source: {
          kind: "local_postgresql",
          algorithm: "retrieval_planning_v1",
        },
      };
    },
  };
}

export type KnowledgeContextBuilder = ReturnType<
  typeof createKnowledgeContextBuilder
>;
