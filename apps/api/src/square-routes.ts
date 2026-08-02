import type { Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import {
  squareModeSchema,
  squareRoleSchema,
  membershipStatusSchema,
  type SquareRepository,
} from "@town/teams";
import type { AuthVariables } from "./auth.js";

export interface SquareDependencies {
  repository: SquareRepository;
}
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
    description: z.string().max(2_000).optional(),
    settings: z.record(z.string(), z.json()).default({}),
  })
  .strict();
const memberSchema = z
  .object({
    userId: z.uuidv7(),
    role: squareRoleSchema,
    status: membershipStatusSchema.default("active"),
  })
  .strict();
const memberUpdateSchema = z
  .object({
    role: squareRoleSchema.optional(),
    status: membershipStatusSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.role !== undefined || value.status !== undefined,
    "role or status is required",
  );
const policySchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    defaultMode: squareModeSchema,
    allowedDomains: z.array(z.string().trim().min(1).max(255)).max(500),
    allowedToolNames: z.array(z.string().trim().min(1).max(200)).max(500),
    settings: z.record(z.string(), z.json()).default({}),
  })
  .strict();

export function registerSquareRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: SquareDependencies,
): void {
  app.get("/v1/squares", async (context) => {
    const userId = context.get("identity").user.id;
    return context.json({
      squares: await dependencies.repository.listForUser(userId),
    });
  });
  app.post("/v1/squares", async (context) => {
    const ownerId = context.get("identity").user.id;
    const value = createSchema.parse(await context.req.json());
    return context.json(
      {
        square: await dependencies.repository.create({
          ownerId,
          ...(value.description === undefined
            ? { name: value.name, slug: value.slug, settings: value.settings }
            : value),
        }),
      },
      201,
    );
  });
  app.get("/v1/squares/:squareId", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      square: await dependencies.repository.getForActor(
        ownerId,
        asId<"square">(context.req.param("squareId")),
      ),
    });
  });
  app.get("/v1/squares/:squareId/members", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      members: await dependencies.repository.listMembers(
        ownerId,
        asId<"square">(context.req.param("squareId")),
      ),
    });
  });
  app.post("/v1/squares/:squareId/members", async (context) => {
    const ownerId = context.get("identity").user.id;
    const value = memberSchema.parse(await context.req.json());
    return context.json(
      {
        membership: await dependencies.repository.addMember({
          ownerId,
          squareId: asId<"square">(context.req.param("squareId")),
          userId: asId<"user">(value.userId),
          role: value.role,
          status: value.status,
          invitedBy: ownerId,
        }),
      },
      201,
    );
  });
  app.patch("/v1/squares/:squareId/members/:userId", async (context) => {
    const ownerId = context.get("identity").user.id;
    const value = memberUpdateSchema.parse(await context.req.json());
    return context.json({
      membership: await dependencies.repository.updateMember({
        ownerId,
        squareId: asId<"square">(context.req.param("squareId")),
        userId: asId<"user">(context.req.param("userId")),
        ...(value.role === undefined ? {} : { role: value.role }),
        ...(value.status === undefined ? {} : { status: value.status }),
      }),
    });
  });
  app.get("/v1/squares/:squareId/policy", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      policy: await dependencies.repository.getPolicy(
        ownerId,
        asId<"square">(context.req.param("squareId")),
      ),
    });
  });
  app.patch("/v1/squares/:squareId/policy", async (context) => {
    const ownerId = context.get("identity").user.id;
    const value = policySchema.parse(await context.req.json());
    return context.json({
      policy: await dependencies.repository.updatePolicy({
        ownerId,
        squareId: asId<"square">(context.req.param("squareId")),
        ...value,
      }),
    });
  });
}
