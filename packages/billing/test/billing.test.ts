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
import { createBillingRepository } from "../src/index.js";

let sql: Sql;
let ownerId: Id<"user">;
let otherId: Id<"user">;
beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 1 });
  await runMigrations(sql);
});
beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  otherId = newId<"user">();
  await sql`insert into users (id,email) values (${ownerId},'billing-owner@example.invalid'),(${otherId},'billing-other@example.invalid')`;
});
afterAll(async () => {
  await sql.end();
});

describe("billing and usage", () => {
  it("returns not configured until provisioned and records usage idempotently", async () => {
    const repository = createBillingRepository(sql);
    await expect(repository.get(ownerId)).resolves.toBeNull();
    const state = await repository.setState({
      ownerId,
      planName: "trial",
      isTrial: true,
      creditBanners: ["trial_expiring"],
    });
    expect(state).toMatchObject({
      ownerId,
      planName: "trial",
      isTrial: true,
      revision: 1,
    });
    const entry = await repository.recordUsage({
      ownerId,
      idempotencyKey: "run-1",
      category: "model",
      quantity: 10,
      unit: "credits",
      metadata: { model: "a" },
    });
    await expect(
      repository.recordUsage({
        ownerId,
        idempotencyKey: "run-1",
        category: "model",
        quantity: 10,
        unit: "credits",
        metadata: { model: "a" },
      }),
    ).resolves.toMatchObject({ id: entry.id });
    await expect(
      repository.recordUsage({
        ownerId,
        idempotencyKey: "run-1",
        category: "tool",
        quantity: 1,
        unit: "calls",
      }),
    ).rejects.toMatchObject({ code: "USAGE_CONFLICT" });
    await expect(
      repository.recordUsage({
        ownerId,
        idempotencyKey: "run-1",
        category: "model",
        quantity: 10,
        unit: "credits",
        metadata: { model: "b" },
      }),
    ).rejects.toMatchObject({ code: "USAGE_CONFLICT" });
    await expect(
      repository.summarize(otherId, new Date(0), new Date(Date.now() + 1_000)),
    ).resolves.toEqual([]);
  });
  it("uses optimistic billing revisions", async () => {
    const repository = createBillingRepository(sql);
    await repository.setState({ ownerId, planName: "pro" });
    await expect(
      repository.setState({
        ownerId,
        planName: "enterprise",
        expectedRevision: 99,
      }),
    ).rejects.toMatchObject({ code: "BILLING_REVISION_CONFLICT" });
  });
});
