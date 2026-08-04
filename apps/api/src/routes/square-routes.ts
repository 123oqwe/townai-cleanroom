import type { Context, Hono } from "hono";
import { z } from "zod";

import { asId } from "@town/contracts";
import {
  squareModeSchema,
  squareRoleSchema,
  membershipStatusSchema,
  type SquareRepository,
} from "@town/teams";
import type { AuthVariables } from "../lib/auth.js";

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
  const listSquares = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
    const userId = context.get("identity").user.id;
    return context.json({
      squares: await dependencies.repository.listForUser(userId),
    });
  };
  const createSquare = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
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
  };
  const getSquare = async (context: Context<{ Variables: AuthVariables }>) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      square: await dependencies.repository.getForActor(
        ownerId,
        asId<"square">(context.req.param("squareId")),
      ),
    });
  };
  const listSquareMembers = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      members: await dependencies.repository.listMembers(
        ownerId,
        asId<"square">(context.req.param("squareId")),
      ),
    });
  };
  const addSquareMember = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
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
  };
  const updateSquareMember = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
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
  };
  const getSquarePolicy = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      policy: await dependencies.repository.getPolicy(
        ownerId,
        asId<"square">(context.req.param("squareId")),
      ),
    });
  };
  const updateSquarePolicy = async (
    context: Context<{ Variables: AuthVariables }>,
  ) => {
    const ownerId = context.get("identity").user.id;
    const value = policySchema.parse(await context.req.json());
    return context.json({
      policy: await dependencies.repository.updatePolicy({
        ownerId,
        squareId: asId<"square">(context.req.param("squareId")),
        ...value,
      }),
    });
  };

  app.get("/v1/squares", listSquares);
  app.post("/v1/squares", createSquare);
  app.get("/v1/squares/:squareId", getSquare);
  app.get("/v1/squares/:squareId/members", listSquareMembers);
  app.post("/v1/squares/:squareId/members", addSquareMember);
  app.patch("/v1/squares/:squareId/members/:userId", updateSquareMember);
  app.get("/v1/squares/:squareId/policy", getSquarePolicy);
  app.patch("/v1/squares/:squareId/policy", updateSquarePolicy);

  app.get("/squares", listSquares);
  app.post("/squares", createSquare);
  app.get("/squares/:squareId", getSquare);
  app.get("/squares/:squareId/members", listSquareMembers);
  app.post("/squares/:squareId/members", addSquareMember);
  app.patch("/squares/:squareId/members/:userId", updateSquareMember);
  app.get("/squares/:squareId/policy", getSquarePolicy);
  app.patch("/squares/:squareId/policy", updateSquarePolicy);
}
