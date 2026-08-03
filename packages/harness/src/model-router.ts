import { z } from "zod";

import type { HarnessItem, ModelPort } from "./index.js";

/** Stable operation classes keep model selection explicit at the runtime boundary. */
export const modelOperationSchema = z.enum([
  "interactive",
  "routine",
  "compaction",
]);
export type ModelOperation = z.infer<typeof modelOperationSchema>;

export interface ModelRoute {
  id: string;
  operation: ModelOperation;
  provider: string;
  model: string;
  priority: number;
  enabled?: boolean;
  port: ModelPort;
}

export interface ModelRouteSelection {
  routeId: string;
  operation: ModelOperation;
  provider: string;
  model: string;
  attempt: number;
}

export interface ModelRouter {
  model(operation: ModelOperation): ModelPort;
  routes(operation: ModelOperation): readonly ModelRoute[];
}

const routeSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    operation: modelOperationSchema,
    provider: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(200),
    priority: z.number().int().min(0).max(10_000),
    enabled: z.boolean().default(true),
  })
  .strict();

function routeOrder(routes: readonly ModelRoute[], operation: ModelOperation) {
  return routes
    .filter((route) => route.operation === operation && route.enabled !== false)
    .sort(
      (left, right) =>
        left.priority - right.priority || left.id.localeCompare(right.id),
    );
}

/**
 * Selects provider-backed model ports by operation and priority. Fallback is
 * only attempted after a provider call rejects; no assistant output is ever
 * fabricated and the final provider error is preserved when every route fails.
 */
export function createModelRouter(input: {
  routes: readonly ModelRoute[];
  onSelection?: (selection: ModelRouteSelection) => void | Promise<void>;
}): ModelRouter {
  const seen = new Set<string>();
  for (const route of input.routes) {
    const value = routeSchema.parse({
      id: route.id,
      operation: route.operation,
      provider: route.provider,
      model: route.model,
      priority: route.priority,
      enabled: route.enabled,
    });
    if (seen.has(value.id))
      throw new Error(`HARNESS_MODEL_ROUTE_DUPLICATE: ${value.id}`);
    seen.add(value.id);
  }

  function candidates(operation: ModelOperation): readonly ModelRoute[] {
    return routeOrder(input.routes, modelOperationSchema.parse(operation));
  }

  return {
    routes(operation) {
      return candidates(operation);
    },
    model(operation) {
      const selectedOperation = modelOperationSchema.parse(operation);
      return {
        async respond(modelInput: { items: HarnessItem[] }) {
          const available = candidates(selectedOperation);
          if (available.length === 0)
            throw new Error(
              `HARNESS_MODEL_ROUTE_UNAVAILABLE: no enabled route for ${selectedOperation}.`,
            );
          let lastError: unknown;
          for (const [index, route] of available.entries()) {
            const selection = {
              routeId: route.id,
              operation: selectedOperation,
              provider: route.provider,
              model: route.model,
              attempt: index + 1,
            } satisfies ModelRouteSelection;
            await input.onSelection?.(selection);
            try {
              return await route.port.respond(modelInput);
            } catch (error) {
              lastError = error;
            }
          }
          throw lastError instanceof Error
            ? lastError
            : new Error("HARNESS_MODEL_ROUTE_FAILED: all model routes failed.");
        },
      };
    },
  };
}
