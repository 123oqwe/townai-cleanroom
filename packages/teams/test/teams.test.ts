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
import { createSquareRepository } from "../src/index.js";

let sql: Sql;
let ownerId: Id<"user">;
let memberId: Id<"user">;
let otherId: Id<"user">;
beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 1 });
  await runMigrations(sql);
});
beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  memberId = newId<"user">();
  otherId = newId<"user">();
  await sql`insert into users (id,email) values (${ownerId},'square-owner@example.invalid'),(${memberId},'square-member@example.invalid'),(${otherId},'square-other@example.invalid')`;
});
afterAll(async () => {
  await sql.end();
});
describe("Squares", () => {
  it("creates an owner membership and isolates member lists", async () => {
    const squares = createSquareRepository(sql);
    const square = await squares.create({
      ownerId,
      name: "Product",
      slug: "product",
      settings: {},
    });
    await squares.addMember({
      ownerId,
      squareId: square.id,
      userId: memberId,
      role: "member",
    });
    await expect(squares.listMembers(otherId, square.id)).rejects.toMatchObject(
      { code: "SQUARE_NOT_FOUND" },
    );
    await expect(squares.listMembers(ownerId, square.id)).resolves.toHaveLength(
      2,
    );
    await expect(
      squares.getForActor(memberId, square.id),
    ).resolves.toMatchObject({ id: square.id });
    await expect(
      squares.listMembers(memberId, square.id),
    ).resolves.toHaveLength(2);
    await expect(
      squares.addMember({
        ownerId: memberId,
        squareId: square.id,
        userId: otherId,
        role: "member",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      squares.updateMember({
        ownerId,
        squareId: square.id,
        userId: ownerId,
        role: "member",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      squares.addMember({
        ownerId,
        squareId: square.id,
        userId: newId<"user">(),
        role: "member",
      }),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_NOT_FOUND" });
    await squares.updateMember({
      ownerId,
      squareId: square.id,
      userId: memberId,
      role: "admin",
    });
    await expect(
      squares.addMember({
        ownerId: memberId,
        squareId: square.id,
        userId: otherId,
        role: "member",
      }),
    ).resolves.toMatchObject({ userId: otherId });
    await expect(squares.listForUser(memberId)).resolves.toHaveLength(1);
  });
  it("uses optimistic policy revisions and rejects stale writes", async () => {
    const squares = createSquareRepository(sql);
    const square = await squares.create({
      ownerId,
      name: "Ops",
      slug: "ops",
      settings: {},
    });
    const policy = await squares.getPolicy(ownerId, square.id);
    const updated = await squares.updatePolicy({
      ownerId,
      squareId: square.id,
      expectedRevision: policy.revision,
      defaultMode: "read_only",
      allowedDomains: ["example.com"],
      allowedToolNames: ["town_search"],
      settings: {},
    });
    expect(updated.revision).toBe(2);
    await expect(
      squares.updatePolicy({
        ownerId,
        squareId: square.id,
        expectedRevision: 1,
        defaultMode: "autonomous",
        allowedDomains: [],
        allowedToolNames: [],
        settings: {},
      }),
    ).rejects.toMatchObject({ code: "POLICY_CONFLICT" });
  });
});
