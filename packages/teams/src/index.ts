import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

export const squareRoleSchema = z.enum(["owner", "admin", "member"]);
export const membershipStatusSchema = z.enum([
  "invited",
  "active",
  "suspended",
]);
export const squareStatusSchema = z.enum(["active", "archived"]);
export const squareModeSchema = z.enum([
  "read_only",
  "approval_required",
  "autonomous",
]);

export interface Square {
  id: Id<"square">;
  ownerId: Id<"user">;
  name: string;
  slug: string;
  description: string;
  status: z.infer<typeof squareStatusSchema>;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
export interface SquareMembership {
  squareId: Id<"square">;
  userId: Id<"user">;
  ownerId: Id<"user">;
  role: z.infer<typeof squareRoleSchema>;
  status: z.infer<typeof membershipStatusSchema>;
  invitedBy: Id<"user"> | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface SquarePolicy {
  squareId: Id<"square">;
  ownerId: Id<"user">;
  defaultMode: z.infer<typeof squareModeSchema>;
  allowedDomains: string[];
  allowedToolNames: string[];
  settings: Record<string, unknown>;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export class SquareError extends Error {
  constructor(
    readonly code:
      | "SQUARE_NOT_FOUND"
      | "MEMBERSHIP_NOT_FOUND"
      | "MEMBERSHIP_CONFLICT"
      | "SQUARE_ALREADY_EXISTS"
      | "FORBIDDEN"
      | "POLICY_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "SquareError";
  }
}
type SquareRow = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string;
  status: Square["status"];
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};
type MemberRow = {
  square_id: string;
  user_id: string;
  owner_id: string;
  role: SquareMembership["role"];
  status: SquareMembership["status"];
  invited_by: string | null;
  created_at: Date;
  updated_at: Date;
};
type PolicyRow = {
  square_id: string;
  owner_id: string;
  default_mode: SquarePolicy["defaultMode"];
  allowed_domains: string[];
  allowed_tool_names: string[];
  settings: Record<string, unknown>;
  revision: number;
  created_at: Date;
  updated_at: Date;
};
type JoinedSquareMemberRow = SquareRow & {
  square_id: string;
  user_id: string;
  membership_owner_id: string;
  role: SquareMembership["role"];
  status: SquareMembership["status"];
  invited_by: string | null;
  membership_created_at: Date;
  membership_updated_at: Date;
};
const squareInput = z
  .object({
    ownerId: idSchema,
    name: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
    description: z.string().max(2_000).default(""),
    settings: z.record(z.string(), z.json()).default({}),
  })
  .strict();
const memberInput = z
  .object({
    ownerId: idSchema,
    squareId: idSchema,
    userId: idSchema,
    role: squareRoleSchema,
    status: membershipStatusSchema.default("active"),
    invitedBy: idSchema.nullable().optional(),
  })
  .strict();
function safeSquare(row: SquareRow): Square {
  return {
    id: asId<"square">(row.id),
    ownerId: asId<"user">(row.owner_id),
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    settings: row.settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function safeMember(row: MemberRow): SquareMembership {
  return {
    squareId: asId<"square">(row.square_id),
    userId: asId<"user">(row.user_id),
    ownerId: asId<"user">(row.owner_id),
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by === null ? null : asId<"user">(row.invited_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function safePolicy(row: PolicyRow): SquarePolicy {
  return {
    squareId: asId<"square">(row.square_id),
    ownerId: asId<"user">(row.owner_id),
    defaultMode: row.default_mode,
    allowedDomains: row.allowed_domains,
    allowedToolNames: row.allowed_tool_names,
    settings: row.settings,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSquareRepository(sql: Sql) {
  async function resolveActor(
    actorId: Id<"user">,
    squareId: Id<"square">,
  ): Promise<{ ownerId: Id<"user">; membership: SquareMembership }> {
    const parsedActorId = idSchema.parse(actorId);
    const parsedSquareId = idSchema.parse(squareId);
    const [row] = await sql<
      MemberRow[]
    >`select * from square_memberships where user_id=${parsedActorId} and square_id=${parsedSquareId} and status='active'`;
    if (!row)
      throw new SquareError("SQUARE_NOT_FOUND", "The Square was not found.");
    return { ownerId: asId<"user">(row.owner_id), membership: safeMember(row) };
  }
  async function get(
    ownerId: Id<"user">,
    squareId: Id<"square">,
  ): Promise<Square> {
    const value = z
      .object({ ownerId: idSchema, squareId: idSchema })
      .parse({ ownerId, squareId });
    const [row] = await sql<
      SquareRow[]
    >`select * from squares where owner_id=${value.ownerId} and id=${value.squareId}`;
    if (!row)
      throw new SquareError("SQUARE_NOT_FOUND", "The Square was not found.");
    return safeSquare(row);
  }
  async function getForActor(
    actorId: Id<"user">,
    squareId: Id<"square">,
  ): Promise<Square> {
    const context = await resolveActor(actorId, squareId);
    return get(context.ownerId, squareId);
  }
  async function listForUser(
    userId: Id<"user">,
  ): Promise<Array<Square & { membership: SquareMembership }>> {
    const value = idSchema.parse(userId);
    const rows = await sql<
      JoinedSquareMemberRow[]
    >`select s.*,m.square_id,m.user_id,m.owner_id as membership_owner_id,m.role,m.status,m.invited_by,m.created_at as membership_created_at,m.updated_at as membership_updated_at from square_memberships m join squares s on s.id=m.square_id and s.owner_id=m.owner_id where m.user_id=${value} and m.status='active' order by s.updated_at desc,s.id desc`;
    return rows.map((row) => ({
      ...safeSquare(row),
      membership: safeMember({
        square_id: row.square_id,
        user_id: row.user_id,
        owner_id: row.membership_owner_id,
        role: row.role,
        status: row.status,
        invited_by: row.invited_by,
        created_at: row.membership_created_at,
        updated_at: row.membership_updated_at,
      }),
    }));
  }
  async function create(input: z.input<typeof squareInput>): Promise<Square> {
    const value = squareInput.parse(input);
    const id = newId<"square">();
    try {
      await sql.begin(async (tx) => {
        await tx`insert into squares (id,owner_id,name,slug,description,settings) values (${id},${value.ownerId},${value.name},${value.slug},${value.description},${tx.json(value.settings)})`;
        await tx`insert into square_memberships (square_id,user_id,owner_id,role,status) values (${id},${value.ownerId},${value.ownerId},'owner','active')`;
        await tx`insert into square_policies (square_id,owner_id) values (${id},${value.ownerId})`;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "constraint_name" in error &&
        error.constraint_name === "squares_owner_slug_unique"
      )
        throw new SquareError(
          "SQUARE_ALREADY_EXISTS",
          "A Square with this slug already exists.",
        );
      throw error;
    }
    return get(asId<"user">(value.ownerId), id);
  }
  async function addMember(
    input: z.input<typeof memberInput>,
  ): Promise<SquareMembership> {
    const value = memberInput.parse(input);
    const [row] = await sql.begin(async (tx) => {
      const [manager] = await tx<
        { owner_id: string; role: SquareMembership["role"] }[]
      >`select owner_id,role from square_memberships where owner_id=(select owner_id from squares where id=${value.squareId}) and square_id=${value.squareId} and user_id=${value.ownerId} and status='active' for update`;
      if (!manager || (manager.role !== "owner" && manager.role !== "admin"))
        throw new SquareError(
          "FORBIDDEN",
          "Only Square owners or admins may change team state.",
        );
      if (value.role === "owner" || value.userId === manager.owner_id)
        throw new SquareError(
          "FORBIDDEN",
          "The canonical Square owner cannot be reassigned.",
        );
      const [target] = await tx<
        { id: string }[]
      >`select id from users where id=${value.userId}`;
      if (!target)
        throw new SquareError(
          "MEMBERSHIP_NOT_FOUND",
          "The invited user was not found.",
        );
      return tx<
        MemberRow[]
      >`insert into square_memberships (square_id,user_id,owner_id,role,status,invited_by) values (${value.squareId},${value.userId},${manager.owner_id},${value.role},${value.status},${value.invitedBy ?? value.ownerId}) on conflict (square_id,user_id) do update set role=excluded.role,status=excluded.status,invited_by=excluded.invited_by,updated_at=now() returning *`;
    });
    if (!row)
      throw new SquareError(
        "MEMBERSHIP_CONFLICT",
        "The membership could not be saved.",
      );
    return safeMember(row);
  }
  async function getMember(
    ownerId: Id<"user">,
    squareId: Id<"square">,
    userId: Id<"user">,
  ): Promise<SquareMembership> {
    const [row] = await sql<
      MemberRow[]
    >`select m.* from square_memberships m join squares s on s.id=m.square_id and s.owner_id=m.owner_id where m.owner_id=${ownerId} and m.square_id=${squareId} and m.user_id=${userId}`;
    if (!row)
      throw new SquareError(
        "MEMBERSHIP_NOT_FOUND",
        "The membership was not found.",
      );
    return safeMember(row);
  }
  async function listMembers(
    ownerId: Id<"user">,
    squareId: Id<"square">,
  ): Promise<SquareMembership[]> {
    const context = await resolveActor(ownerId, squareId);
    const rows = await sql<
      MemberRow[]
    >`select * from square_memberships where owner_id=${context.ownerId} and square_id=${squareId} order by role,user_id`;
    return rows.map(safeMember);
  }
  async function updateMember(input: {
    ownerId: Id<"user">;
    squareId: Id<"square">;
    userId: Id<"user">;
    role?: SquareMembership["role"];
    status?: SquareMembership["status"];
  }): Promise<SquareMembership> {
    const value = z
      .object({
        ownerId: idSchema,
        squareId: idSchema,
        userId: idSchema,
        role: squareRoleSchema.optional(),
        status: membershipStatusSchema.optional(),
      })
      .strict()
      .parse(input);
    const [row] = await sql.begin(async (tx) => {
      const [manager] = await tx<
        { owner_id: string; role: SquareMembership["role"] }[]
      >`select owner_id,role from square_memberships where owner_id=(select owner_id from squares where id=${value.squareId}) and square_id=${value.squareId} and user_id=${value.ownerId} and status='active' for update`;
      if (!manager || (manager.role !== "owner" && manager.role !== "admin"))
        throw new SquareError(
          "FORBIDDEN",
          "Only Square owners or admins may change team state.",
        );
      if (value.userId === manager.owner_id || value.role === "owner")
        throw new SquareError(
          "FORBIDDEN",
          "The canonical Square owner cannot be reassigned.",
        );
      const [current] = await tx<
        MemberRow[]
      >`select * from square_memberships where owner_id=${manager.owner_id} and square_id=${value.squareId} and user_id=${value.userId} for update`;
      if (!current)
        throw new SquareError(
          "MEMBERSHIP_NOT_FOUND",
          "The membership was not found.",
        );
      return tx<
        MemberRow[]
      >`update square_memberships set role=${value.role ?? current.role},status=${value.status ?? current.status},updated_at=now() where owner_id=${manager.owner_id} and square_id=${value.squareId} and user_id=${value.userId} returning *`;
    });
    if (!row)
      throw new SquareError(
        "MEMBERSHIP_NOT_FOUND",
        "The membership was not found.",
      );
    return safeMember(row);
  }
  async function getPolicy(
    ownerId: Id<"user">,
    squareId: Id<"square">,
  ): Promise<SquarePolicy> {
    const context = await resolveActor(ownerId, squareId);
    const [row] = await sql<
      PolicyRow[]
    >`select * from square_policies where owner_id=${context.ownerId} and square_id=${squareId}`;
    if (!row)
      throw new SquareError(
        "SQUARE_NOT_FOUND",
        "The Square policy was not found.",
      );
    return safePolicy(row);
  }
  async function updatePolicy(input: {
    ownerId: Id<"user">;
    squareId: Id<"square">;
    expectedRevision: number;
    defaultMode: SquarePolicy["defaultMode"];
    allowedDomains: string[];
    allowedToolNames: string[];
    settings?: Record<string, unknown>;
  }): Promise<SquarePolicy> {
    const value = z
      .object({
        ownerId: idSchema,
        squareId: idSchema,
        expectedRevision: z.number().int().positive(),
        defaultMode: squareModeSchema,
        allowedDomains: z.array(z.string().trim().min(1).max(255)).max(500),
        allowedToolNames: z.array(z.string().trim().min(1).max(200)).max(500),
        settings: z.record(z.string(), z.json()).default({}),
      })
      .strict()
      .parse(input);
    const [row] = await sql.begin(async (tx) => {
      const [manager] = await tx<
        { owner_id: string; role: SquareMembership["role"] }[]
      >`select owner_id,role from square_memberships where owner_id=(select owner_id from squares where id=${value.squareId}) and square_id=${value.squareId} and user_id=${value.ownerId} and status='active' for update`;
      if (!manager || (manager.role !== "owner" && manager.role !== "admin"))
        throw new SquareError(
          "FORBIDDEN",
          "Only Square owners or admins may change team state.",
        );
      return tx<
        PolicyRow[]
      >`update square_policies set default_mode=${value.defaultMode},allowed_domains=${tx.json(value.allowedDomains)},allowed_tool_names=${tx.json(value.allowedToolNames)},settings=${tx.json(value.settings)},revision=revision+1,updated_at=now() where owner_id=${manager.owner_id} and square_id=${value.squareId} and revision=${value.expectedRevision} returning *`;
    });
    if (!row)
      throw new SquareError(
        "POLICY_CONFLICT",
        "The Square policy revision is stale.",
      );
    return safePolicy(row);
  }
  return {
    get,
    getForActor,
    listForUser,
    create,
    addMember,
    getMember,
    listMembers,
    updateMember,
    getPolicy,
    updatePolicy,
  };
}
export type SquareRepository = ReturnType<typeof createSquareRepository>;
