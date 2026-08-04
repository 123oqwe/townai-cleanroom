import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../lib/auth.js";

const appSummarySchema = z
  .object({
    name: z.string(),
    name_slug: z.string().optional(),
    description: z.string().optional(),
    img_src: z.string().optional(),
    auth_type: z.string().optional(),
    categories: z.array(z.string()).optional(),
    id: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

const appsResponseSchema = z.object({
  data: z.array(appSummarySchema),
  page_info: z
    .object({
      next_cursor: z.string().optional(),
      start_cursor: z.string().optional(),
    })
    .optional(),
});

export interface PipedreamDependencies {
  apiUrl: string;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Pipedream integration catalog proxy. Lists available Pipedream apps
 * (connectors) so users can discover integrations without exposing the
 * Pipedream API key to the client. Supports search and pagination.
 */
export function registerPipedreamRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: PipedreamDependencies,
): void {
  app.get("/v1/integrations/pipedream/apps", async (context) => {
    const query = context.req.query();
    const params = new URLSearchParams();
    if (query["q"] !== undefined) params.set("q", query["q"]);
    if (query["limit"] !== undefined) params.set("limit", query["limit"]);
    if (query["cursor"] !== undefined) params.set("cursor", query["cursor"]);

    const url = `${dependencies.apiUrl}?${params.toString()}`;
    const fetcher = dependencies.fetch ?? globalThis.fetch;
    const headers: Record<string, string> = { accept: "application/json" };
    if (dependencies.apiKey !== undefined)
      headers["authorization"] = `Bearer ${dependencies.apiKey}`;

    const response = await fetcher(url, { headers });
    if (!response.ok)
      return context.json(
        { code: "PIPEDREAM_UPSTREAM_ERROR", status: response.status },
        502,
      );

    const parsed = appsResponseSchema.safeParse(await response.json());
    if (!parsed.success)
      return context.json({ code: "PIPEDREAM_INVALID_RESPONSE" }, 502);

    return context.json({
      apps: parsed.data.data.map((a) => ({
        name: a.name,
        slug: a.name_slug ?? a.name.toLowerCase().replace(/\s+/g, "-"),
        description: a.description ?? "",
        icon: a.img_src,
        authType: a.auth_type,
        categories: a.categories ?? [],
        externalId: a.id,
      })),
      nextCursor: parsed.data.page_info?.next_cursor,
    });
  });

  app.get("/v1/integrations/pipedream/apps/:slug", async (context) => {
    const slug = z.string().min(1).max(200).parse(context.req.param("slug"));
    const url = `${dependencies.apiUrl}/${slug}`;
    const fetcher = dependencies.fetch ?? globalThis.fetch;
    const headers: Record<string, string> = { accept: "application/json" };
    if (dependencies.apiKey !== undefined)
      headers["authorization"] = `Bearer ${dependencies.apiKey}`;

    const response = await fetcher(url, { headers });
    if (!response.ok)
      return context.json(
        { code: "PIPEDREAM_APP_NOT_FOUND", status: response.status },
        response.status === 404 ? 404 : 502,
      );

    return context.json({ app: await response.json() });
  });
}
