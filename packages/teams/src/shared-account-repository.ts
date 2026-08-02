import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";
import { SquareError } from "./index.js";

export interface SharedAccountReference {
  id: Id<"square-account-share">;
  squareId: Id<"square">;
  squareOwnerId: Id<"user">;
  accountId: Id<"connected-account">;
  accountOwnerId: Id<"user">;
  provider: string;
  email: string;
  capabilities: string[];
  status: "active" | "revoked";
  grantedBy: Id<"user">;
  createdAt: Date;
  revokedAt: Date | null;
}
type Row = {
  id: string;
  square_id: string;
  square_owner_id: string;
  account_id: string;
  account_owner_id: string;
  provider: string;
  email: string;
  capabilities: string[];
  status: "active" | "revoked";
  granted_by: string;
  created_at: Date;
  revoked_at: Date | null;
};
const shareInput = z
  .object({
    actorId: idSchema,
    squareId: idSchema,
    accountId: idSchema,
    accountOwnerId: idSchema,
    capabilities: z.array(z.string().trim().min(1).max(100)).max(100),
  })
  .strict();
function safe(row: Row): SharedAccountReference {
  return {
    id: asId<"square-account-share">(row.id),
    squareId: asId<"square">(row.square_id),
    squareOwnerId: asId<"user">(row.square_owner_id),
    accountId: asId<"connected-account">(row.account_id),
    accountOwnerId: asId<"user">(row.account_owner_id),
    provider: row.provider,
    email: row.email,
    capabilities: row.capabilities,
    status: row.status,
    grantedBy: asId<"user">(row.granted_by),
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export function createSharedAccountRepository(sql: Sql) {
  async function managerOwner(
    tx: Sql | TransactionSql,
    actorId: Id<"user">,
    squareId: Id<"square">,
  ): Promise<{ ownerId: string; role: "owner" | "admin" }> {
    const parsedActor = idSchema.parse(actorId);
    const parsedSquare = idSchema.parse(squareId);
    const [row] = await tx<
      { owner_id: string; role: "owner" | "admin" | "member" }[]
    >`select owner_id,role from square_memberships where user_id=${parsedActor} and square_id=${parsedSquare} and status='active' for update`;
    if (!row || (row.role !== "owner" && row.role !== "admin"))
      throw new SquareError(
        "FORBIDDEN",
        "Only Square owners or admins may share accounts.",
      );
    return { ownerId: row.owner_id, role: row.role };
  }
  async function grant(
    input: z.input<typeof shareInput>,
  ): Promise<SharedAccountReference> {
    const value = shareInput.parse(input);
    const id = newId<"square-account-share">();
    const row = await sql.begin(async (tx) => {
      const manager = await managerOwner(
        tx,
        value.actorId as Id<"user">,
        value.squareId as Id<"square">,
      );
      if (value.accountOwnerId !== value.actorId)
        throw new SquareError(
          "FORBIDDEN",
          "Only the connected account owner may share this account.",
        );
      const [account] = await tx<
        { id: string }[]
      >`select id from connected_accounts where id=${value.accountId} and owner_id=${value.accountOwnerId} and is_active=true`;
      if (!account)
        throw new SquareError(
          "ACCOUNT_NOT_FOUND",
          "The connected account was not found or is inactive.",
        );
      const [inserted] = await tx<
        { id: string }[]
      >`insert into square_account_shares (id,square_id,square_owner_id,account_id,account_owner_id,granted_by,capabilities) values (${id},${value.squareId},${manager.ownerId},${value.accountId},${value.accountOwnerId},${value.actorId},${tx.json(value.capabilities)}) on conflict (square_id,account_owner_id,account_id) do update set status='active',revoked_at=null,capabilities=excluded.capabilities,granted_by=excluded.granted_by returning id`;
      if (!inserted) return undefined;
      const [full] = await tx<
        Row[]
      >`select s.*,a.provider,a.email::text from square_account_shares s join connected_accounts a on a.id=s.account_id and a.owner_id=s.account_owner_id where s.id=${inserted.id}`;
      return full;
    });
    if (!row)
      throw new SquareError(
        "MEMBERSHIP_CONFLICT",
        "The shared account reference could not be saved.",
      );
    return safe(row);
  }
  async function list(
    actorId: Id<"user">,
    squareId: Id<"square">,
  ): Promise<SharedAccountReference[]> {
    const [context] = await sql<
      { owner_id: string }[]
    >`select owner_id from square_memberships where user_id=${idSchema.parse(actorId)} and square_id=${idSchema.parse(squareId)} and status='active'`;
    if (!context)
      throw new SquareError("SQUARE_NOT_FOUND", "The Square was not found.");
    const rows = await sql<
      Row[]
    >`select s.*,a.provider,a.email::text from square_account_shares s join connected_accounts a on a.id=s.account_id and a.owner_id=s.account_owner_id and a.is_active=true where s.square_owner_id=${context.owner_id} and s.square_id=${squareId} and s.status='active' order by s.created_at desc,s.id desc`;
    return rows.map(safe);
  }
  async function revoke(
    actorId: Id<"user">,
    shareId: Id<"square-account-share">,
  ): Promise<void> {
    await sql.begin(async (tx) => {
      const [share] = await tx<
        { square_id: string; account_owner_id: string }[]
      >`select square_id,account_owner_id from square_account_shares where id=${idSchema.parse(shareId)} and status='active' for update`;
      if (!share)
        throw new SquareError(
          "ACCOUNT_SHARE_NOT_FOUND",
          "The shared account reference was not found.",
        );
      const parsedActor = idSchema.parse(actorId);
      const [membership] = await tx<
        { role: "owner" | "admin" | "member" }[]
      >`select role from square_memberships where user_id=${parsedActor} and square_id=${share.square_id} and status='active'`;
      if (
        parsedActor !== share.account_owner_id &&
        (!membership ||
          (membership.role !== "owner" && membership.role !== "admin"))
      )
        throw new SquareError(
          "FORBIDDEN",
          "Only the account owner or a Square manager may revoke this reference.",
        );
      await tx`update square_account_shares set status='revoked',revoked_at=now() where id=${shareId} and status='active'`;
    });
  }
  return { grant, list, revoke };
}
export type SharedAccountRepository = ReturnType<
  typeof createSharedAccountRepository
>;
