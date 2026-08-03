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
import { createA2ARepository } from "../src/index.js";

let sql: Sql;
let requester: Id<"user">;
let recipient: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 1 });
  await runMigrations(sql);
});
beforeEach(async () => {
  await sql`truncate table users cascade`;
  requester = newId<"user">();
  recipient = newId<"user">();
  await sql`insert into users (id,email) values (${requester},'a2a-requester@example.invalid'),(${recipient},'a2a-recipient@example.invalid')`;
});
afterAll(async () => sql.end());

describe("A2A requests", () => {
  it("requires recipient consent and protects stale transitions", async () => {
    const repository = createA2ARepository(sql);
    const request = await repository.create({
      requesterId: requester,
      recipientId: recipient,
      capability: "calendar.find-time",
      request: { window: "next-week", durationMinutes: 30 },
    });
    expect(request.status).toBe("pending");
    await expect(
      repository.transition({
        userId: requester,
        requestId: request.id,
        status: "accepted",
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: "A2A_CONFLICT" });
    const accepted = await repository.transition({
      userId: recipient,
      requestId: request.id,
      status: "accepted",
      revision: 1,
    });
    expect(accepted.revision).toBe(2);
    await expect(
      repository.transition({
        userId: recipient,
        requestId: request.id,
        status: "declined",
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: "A2A_CONFLICT" });
    const completed = await repository.transition({
      userId: requester,
      requestId: request.id,
      status: "completed",
      revision: 2,
      result: { slots: ["2026-08-04T10:00:00Z"] },
    });
    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual({ slots: ["2026-08-04T10:00:00Z"] });
  });

  it("does not expose or accept expired pending requests", async () => {
    const repository = createA2ARepository(sql);
    const request = await repository.create({
      requesterId: requester,
      recipientId: recipient,
      capability: "calendar.find-time",
      request: { window: "expired" },
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await repository.listForUser(recipient, "pending")).toEqual([]);
    await expect(
      repository.transition({
        userId: recipient,
        requestId: request.id,
        status: "accepted",
        revision: request.revision,
      }),
    ).rejects.toMatchObject({ code: "A2A_CONFLICT" });
  });

  it("records scoped recipient consent and supports revocation", async () => {
    const repository = createA2ARepository(sql);
    const request = await repository.create({
      requesterId: requester,
      recipientId: recipient,
      capability: "calendar.find-time",
      request: { window: "next-week" },
    });
    const granted = await repository.consent({
      userId: recipient,
      requestId: request.id,
      revision: request.revision,
      decision: "grant",
      scope: ["calendar.read", "calendar.availability"],
    });
    expect(granted.status).toBe("accepted");
    expect(granted.consentStatus).toBe("granted");
    expect(granted.consentScope).toEqual([
      "calendar.read",
      "calendar.availability",
    ]);
    const revoked = await repository.consent({
      userId: recipient,
      requestId: request.id,
      revision: granted.revision,
      decision: "revoke",
    });
    expect(revoked.consentStatus).toBe("revoked");
    expect(revoked.status).toBe("accepted");
    await expect(
      repository.consent({
        userId: requester,
        requestId: request.id,
        revision: revoked.revision,
        decision: "grant",
      }),
    ).rejects.toMatchObject({ code: "A2A_CONFLICT" });
  });
});
