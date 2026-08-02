import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import postgres, { type Sql } from "postgres";
import { newId, type Id } from "@town/contracts";
import { runMigrations } from "@town/db";
import { createSharedAccountRepository } from "../src/shared-account-repository.js";
import { createSquareRepository } from "../src/index.js";

let sql: Sql;
let ownerId: Id<"user">;
let memberId: Id<"user">;
let accountId: Id<"connected-account">;
let memberAccountId: Id<"connected-account">;
beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 1 });
  await runMigrations(sql);
});
beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  memberId = newId<"user">();
  accountId = newId<"connected-account">();
  memberAccountId = newId<"connected-account">();
  await sql`insert into users (id,email) values (${ownerId},'share-owner@example.invalid'),(${memberId},'share-member@example.invalid')`;
  await sql`insert into connected_accounts (id,owner_id,provider,provider_user_id,email,capabilities) values (${accountId},${ownerId},'google','share-provider-id','share@example.invalid','{}'),(${memberAccountId},${memberId},'google','member-provider-id','member-share@example.invalid','{}')`;
});
afterAll(async () => {
  await sql.end();
});
describe("Square shared account references", () => {
  it("shares references without copying credentials and enforces manager membership", async () => {
    const squares = createSquareRepository(sql);
    const square = await squares.create({
      ownerId,
      name: "Shared",
      slug: "shared",
      settings: {},
    });
    await squares.addMember({
      ownerId,
      squareId: square.id,
      userId: memberId,
      role: "admin",
    });
    const accounts = createSharedAccountRepository(sql);
    const shared = await accounts.grant({
      actorId: ownerId,
      squareId: square.id,
      accountId,
      accountOwnerId: ownerId,
      capabilities: ["calendar.read"],
    });
    expect(shared).toMatchObject({
      accountId,
      accountOwnerId: ownerId,
      capabilities: ["calendar.read"],
    });
    expect(shared).not.toHaveProperty("credentialId");
    expect(shared).not.toHaveProperty("accessToken");
    const listed = await accounts.list(memberId, square.id);
    expect(listed).toHaveLength(1);
    await expect(
      accounts.grant({
        actorId: memberId,
        squareId: square.id,
        accountId,
        accountOwnerId: ownerId,
        capabilities: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      accounts.grant({
        actorId: ownerId,
        squareId: square.id,
        accountId: memberAccountId,
        accountOwnerId: memberId,
        capabilities: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an account owner revoke their own active reference", async () => {
    const squares = createSquareRepository(sql);
    const square = await squares.create({
      ownerId,
      name: "Owner revoke",
      slug: "owner-revoke",
      settings: {},
    });
    await squares.addMember({
      ownerId,
      squareId: square.id,
      userId: memberId,
      role: "admin",
    });
    const accounts = createSharedAccountRepository(sql);
    const shared = await accounts.grant({
      actorId: memberId,
      squareId: square.id,
      accountId: memberAccountId,
      accountOwnerId: memberId,
      capabilities: [],
    });
    await squares.updateMember({
      ownerId,
      squareId: square.id,
      userId: memberId,
      role: "member",
    });
    await expect(accounts.revoke(memberId, shared.id)).resolves.toBeUndefined();
    await expect(accounts.list(memberId, square.id)).resolves.toHaveLength(0);
  });
  it("rejects inactive or unknown account references", async () => {
    const squares = createSquareRepository(sql);
    const square = await squares.create({
      ownerId,
      name: "Missing",
      slug: "missing",
      settings: {},
    });
    const accounts = createSharedAccountRepository(sql);
    await expect(
      accounts.grant({
        actorId: ownerId,
        squareId: square.id,
        accountId: newId<"connected-account">(),
        accountOwnerId: ownerId,
        capabilities: [],
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
  });
});
