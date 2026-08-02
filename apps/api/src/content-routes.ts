import type { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import {
  contentKindSchema,
  contentStatusSchema,
  type ContentRepository,
} from "@town/content";
import type { AuthVariables } from "./auth.js";

export interface ContentDependencies {
  repository: ContentRepository;
}
const payload = z
  .object({
    kind: contentKindSchema,
    title: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().min(1).max(255).nullable().optional(),
    storageKey: z.string().trim().min(1).max(2_000).nullable().optional(),
    body: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.json()).default({}),
  })
  .strict();
const update = payload.omit({ kind: true }).extend({
  expectedRevision: z.number().int().positive(),
});
const collectionInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2_000).optional(),
  })
  .strict();

export function registerContentRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: ContentDependencies,
): void {
  app.get("/v1/content-shares/:token", async (context) => {
    return context.json({
      content: dependencies.repository.toPublic(
        await dependencies.repository.resolveShare(context.req.param("token")),
      ),
    });
  });
  app.get("/v1/content", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = z
      .object({
        status: contentStatusSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict()
      .parse(context.req.query());
    return context.json({
      items: await dependencies.repository.list(
        ownerId,
        query.status === undefined
          ? { limit: query.limit }
          : { status: query.status, limit: query.limit },
      ),
    });
  });
  app.post("/v1/content", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json(
      {
        content: await dependencies.repository.create({
          ownerId,
          ...payload.parse(await context.req.json()),
        }),
      },
      201,
    );
  });
  app.post("/v1/content/collections", async (context) => {
    const ownerId = context.get("identity").user.id;
    const value = collectionInput.parse(await context.req.json());
    return context.json(
      {
        collection: await dependencies.repository.createCollection({
          ownerId,
          ...(value.description === undefined
            ? { name: value.name }
            : { name: value.name, description: value.description }),
        }),
      },
      201,
    );
  });
  app.get("/v1/content/collections/:collectionId", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      items: await dependencies.repository.listCollection(
        ownerId,
        asId<"content-collection">(context.req.param("collectionId")),
      ),
    });
  });
  app.post("/v1/content/collections/:collectionId/items", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = z
      .object({
        contentId: z.uuidv7(),
        position: z.number().int().min(0).optional(),
      })
      .strict()
      .parse(await context.req.json());
    await dependencies.repository.addToCollection(
      ownerId,
      asId<"content-collection">(context.req.param("collectionId")),
      asId<"content">(body.contentId),
      body.position,
    );
    return context.json({ ok: true }, 201);
  });
  app.get("/v1/content/:contentId", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      content: await dependencies.repository.get(
        ownerId,
        asId<"content">(context.req.param("contentId")),
      ),
    });
  });
  app.patch("/v1/content/:contentId", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      content: await dependencies.repository.update({
        ownerId,
        contentId: asId<"content">(context.req.param("contentId")),
        ...update.parse(await context.req.json()),
      }),
    });
  });
  app.post("/v1/content/:contentId/archive", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      content: await dependencies.repository.archive(
        ownerId,
        asId<"content">(context.req.param("contentId")),
      ),
    });
  });
  app.post("/v1/content/:contentId/shares", async (context) => {
    const ownerId = context.get("identity").user.id;
    const body = z
      .object({ expiresAt: z.iso.datetime().nullable().optional() })
      .strict()
      .parse(await context.req.json().catch(() => ({})));
    return context.json(
      {
        share: await dependencies.repository.createShare(
          ownerId,
          asId<"content">(context.req.param("contentId")),
          body.expiresAt === undefined || body.expiresAt === null
            ? body.expiresAt
            : new Date(body.expiresAt),
        ),
      },
      201,
    );
  });
  app.delete("/v1/content/shares/:shareId", async (context) => {
    const ownerId = context.get("identity").user.id;
    await dependencies.repository.revokeShare(
      ownerId,
      asId<"content-share">(context.req.param("shareId")),
    );
    return context.body(null, 204);
  });
}
