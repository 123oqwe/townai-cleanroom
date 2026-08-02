import { z } from "zod";

import {
  createPolicyAwareHarnessTool,
  type HarnessToolBinding,
} from "@town/harness";
import type {
  KnowledgeSearchRepository,
  MemoryRepository,
} from "@town/knowledge";
import { resourceTypeSchema } from "@town/knowledge";
import type { Id } from "@town/contracts";
import type { AgentToolBinding, ToolDefinition } from "@town/tools";

const memoryArguments = z.discriminatedUnion("scope", [
  z
    .object({
      scope: z.literal("global"),
      content: z.string().trim().min(1).max(10_000),
      confidence: z.number().min(0).max(1).optional(),
      expiresAt: z.iso.datetime().optional(),
    })
    .strict(),
  z
    .object({
      scope: z.literal("routine"),
      routineId: z.uuidv7(),
      content: z.string().trim().min(1).max(10_000),
      confidence: z.number().min(0).max(1).optional(),
      expiresAt: z.iso.datetime().optional(),
    })
    .strict(),
]);

const searchArguments = z
  .object({
    query: z.string().trim().min(1).max(500),
    types: z.array(resourceTypeSchema).min(1).max(8).optional(),
    limit: z.number().int().min(1).max(20).default(10),
    cursor: z.string().min(1).max(4_096).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.types !== undefined &&
      new Set(value.types).size !== value.types.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["types"],
        message: "types must not contain duplicates",
      });
    }
  });

const MAX_OUTPUT_CHARS = 12_000;
const MAX_ITEM_TEXT_CHARS = 1_500;

function boundedSearchOutput(
  page: Awaited<ReturnType<KnowledgeSearchRepository["search"]>>,
): { output: string; completePage: boolean } {
  const items: typeof page.items = [];
  let truncated = false;
  let nextCursor =
    page.nextCursor !== null && page.nextCursor.length <= 4_096
      ? page.nextCursor
      : null;
  if (nextCursor !== page.nextCursor) truncated = true;
  const encode = () => JSON.stringify({ items, nextCursor, truncated });
  for (const item of page.items) {
    const candidate = {
      ...item,
      text: item.text.slice(0, MAX_ITEM_TEXT_CHARS),
    };
    const originalTextLength = candidate.text.length;
    items.push(candidate);
    if (encode().length <= MAX_OUTPUT_CHARS) {
      if (originalTextLength < item.text.length) truncated = true;
      continue;
    }
    items.pop();
    truncated = true;
    let low = 0;
    let high = originalTextLength;
    let best = "";
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      items.push({ ...candidate, text: candidate.text.slice(0, middle) });
      if (encode().length <= MAX_OUTPUT_CHARS) {
        best = candidate.text.slice(0, middle);
        items.pop();
        low = middle + 1;
      } else {
        items.pop();
        high = middle - 1;
      }
    }
    if (best.length > 0) items.push({ ...candidate, text: best });
    break;
  }
  const completePage = items.length === page.items.length;
  if (!completePage) {
    truncated = true;
    nextCursor = null;
  }
  let output = encode();
  if (output.length > MAX_OUTPUT_CHARS) {
    // A single item's metadata/citations can be oversized; omit that item rather than exceed the model budget.
    items.length = 0;
    truncated = true;
    nextCursor = null;
    output = encode();
  }
  return {
    output,
    completePage: completePage && (items.length > 0 || page.items.length === 0),
  };
}

/** The first built-in Harness tool: owner-scoped local knowledge search. */
export function createTownSearchHarnessBinding(
  ownerId: Id<"user">,
  search: KnowledgeSearchRepository,
): HarnessToolBinding {
  return {
    definition: {
      name: "town_search",
      description:
        "Search the owner's profile, memories, people, and wiki with citations.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 500 },
          types: {
            type: "array",
            items: { enum: resourceTypeSchema.options },
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
          },
          limit: { type: "integer", minimum: 1, maximum: 20 },
          cursor: { type: "string", minLength: 1, maxLength: 4096 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    port: {
      name: "town_search",
      requiresApproval: false,
      async execute(arguments_) {
        const value = searchArguments.parse(arguments_);
        let limit = value.limit;
        let page;
        let bounded: ReturnType<typeof boundedSearchOutput> = {
          output: "",
          completePage: false,
        };
        let pageIsComplete = false;
        while (!pageIsComplete) {
          page = await search.search({
            ownerId,
            query: value.query,
            ...(value.types === undefined ? {} : { types: value.types }),
            limit,
            ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
          });
          bounded = boundedSearchOutput(page);
          pageIsComplete = bounded.completePage || limit === 1;
          if (!pageIsComplete) limit = Math.max(1, Math.floor(limit / 2));
        }
        return {
          kind: "result",
          output: bounded.output,
        };
      },
    },
  };
}

/** Writes a durable Memory only after the Harness approval boundary resumes. */
export function createTownMemoryAddHarnessBinding(
  ownerId: Id<"user">,
  memory: MemoryRepository,
  threadId: string,
  ownsSchedule: (
    ownerId: Id<"user">,
    routineScheduleId: Id<"routine-schedule">,
  ) => Promise<boolean>,
): HarnessToolBinding {
  const definition = {
    name: "town_memory_add",
    description: "Save a user-approved fact to Town memory.",
    parameters: {
      type: "object",
      properties: {
        scope: { enum: ["global", "routine"] },
        routineId: {
          type: "string",
          pattern:
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
        },
        content: { type: "string", minLength: 1, maxLength: 10_000 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        expiresAt: { type: "string", format: "date-time" },
      },
      oneOf: [
        {
          required: ["scope", "content"],
          properties: { scope: { const: "global" } },
          not: { required: ["routineId"] },
        },
        {
          required: ["scope", "routineId", "content"],
          properties: { scope: { const: "routine" } },
        },
      ],
      additionalProperties: false,
    },
  } as const;
  return createPolicyAwareHarnessTool({
    definition,
    decide: (arguments_) =>
      memoryArguments.safeParse(arguments_).success
        ? "approval_required"
        : "deny",
    async execute(arguments_) {
      const value = memoryArguments.parse(arguments_);
      if (
        value.scope === "routine" &&
        !(await ownsSchedule(
          ownerId,
          value.routineId as Id<"routine-schedule">,
        ))
      ) {
        throw new Error(
          "HARNESS_MEMORY_ROUTINE_NOT_FOUND: routine is not owned by this user.",
        );
      }
      const common = {
        ownerId,
        content: value.content,
        status: "active" as const,
        ...(value.confidence === undefined
          ? {}
          : { confidence: value.confidence }),
        ...(value.expiresAt === undefined
          ? {}
          : { expiresAt: new Date(value.expiresAt) }),
        observedAt: new Date(),
        authorType: "assistant" as const,
        citations: [
          {
            sourceType: "session" as const,
            sourceRef: `harness:${threadId}:town_memory_add`,
            observedAt: new Date(),
          },
        ],
      };
      const created =
        value.scope === "global"
          ? await memory.create({ ...common, scope: "global" })
          : await memory.create({
              ...common,
              scope: "routine",
              routineId: value.routineId as Id<"routine">,
            });
      return {
        kind: "result" as const,
        output: JSON.stringify({
          memory: {
            id: created.id,
            scope: created.scope,
            routineId: created.routineId,
            status: created.status,
            confidence: created.confidence,
            createdAt: created.createdAt,
          },
        }),
      };
    },
  });
}

/**
 * Converts only registry definitions with an explicitly registered handler.
 * Definitions without a handler are intentionally omitted, never stubbed.
 */
export function createRegistryHarnessBindings(input: {
  ownerId: Id<"user">;
  threadId: string;
  definitions: ReadonlyArray<ToolDefinition & { binding: AgentToolBinding }>;
  handlers: ReadonlyMap<
    string,
    (
      arguments_: Record<string, unknown>,
    ) => ReturnType<NonNullable<HarnessToolBinding["port"]>["execute"]>
  >;
}): HarnessToolBinding[] {
  const latestByName = new Map<
    string,
    ToolDefinition & { binding: AgentToolBinding }
  >();
  for (const definition of input.definitions) {
    const current = latestByName.get(definition.name);
    if (current === undefined || definition.version > current.version) {
      latestByName.set(definition.name, definition);
    }
  }
  return [...latestByName.values()].flatMap((definition) => {
    const handler = input.handlers.get(definition.name);
    if (handler === undefined || definition.ownerId !== input.ownerId)
      return [];
    const binding = createPolicyAwareHarnessTool({
      definition: {
        name: definition.name,
        description: definition.description,
        parameters: definition.inputSchema,
      },
      decide: () => {
        if (definition.sideEffect === "read") return "allow";
        if (definition.binding.modeOverride === "read_only") return "deny";
        return "approval_required";
      },
      execute: handler,
    });
    return [binding];
  });
}
