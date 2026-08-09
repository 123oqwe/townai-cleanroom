import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import { runMigrations } from "@town/db";
import postgres, { type Sql } from "postgres";

import { newId } from "@town/contracts";
import {
  SessionManagementError,
  createSessionManager,
} from "../src/session-management.js";
import {
  generateSessionToken,
  hashSessionToken,
} from "../src/session-token.js";

let sql: Sql;
const now = new Date("2026-08-09T00:00:00Z");
const IDLE = 15 * 60 * 1_000;
const ABSOLUTE = 7 * 24 * 60 * 60 * 1_000;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 4 });
  await runMigrations(sql);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate auth_sessions, users, access_allowlist cascade`;
});

async function seedUser(): Promise<string> {
  const id = newId<"user">();
  await sql`
    insert into users (id, email, timezone, status, created_at, updated_at)
    values (${id}, ${`u-${id}@example.test`}, 'UTC', 'active', ${now}, ${now})
  `;
  return id;
}

function mgr() {
  return createSessionManager(sql);
}

describe("session manager", () => {
  it("creates a hardened session with idle + absolute expiry", async () => {
    const userId = await seedUser();
    const created = await mgr().create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    expect(created.token).toMatch(/^town_session_/);
    expect(created.idleExpiresAt.getTime()).toBe(now.getTime() + IDLE);
    expect(created.absoluteExpiresAt.getTime()).toBe(now.getTime() + ABSOLUTE);
  });

  it("listActive returns non-revoked, non-expired sessions", async () => {
    const userId = await seedUser();
    const m = mgr();
    await m.create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    const list = await m.listActive(userId as never, now);
    expect(list).toHaveLength(1);
    const [first] = list;
    expect(first?.authMethod).toBe("oidc:google");
  });

  it("revokeAll revokes every session except the specified one", async () => {
    const userId = await seedUser();
    const m = mgr();
    const a = await m.create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    const b = await m.create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    const count = await m.revokeAll(userId as never, now, b.sessionId as never);
    expect(count).toBe(1);
    const list = await m.listActive(userId as never, now);
    expect(list).toHaveLength(1);
    const [active] = list;
    expect(active?.id).toBe(b.sessionId);
    expect(a.token).not.toBe(b.token);
  });

  it("rotate invalidates the old token and issues a new one atomically", async () => {
    const userId = await seedUser();
    const m = mgr();
    const created = await m.create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    const rotated = await m.rotate(
      hashSessionToken(created.token),
      userId as never,
      now,
      { idleTtlMs: IDLE, absoluteTtlMs: ABSOLUTE, authMethod: "oidc:google" },
    );
    expect(rotated.token).not.toBe(created.token);
    // Old token no longer authenticates.
    const oldAuth = await m.authenticateHardened(
      hashSessionToken(created.token),
      now,
    );
    expect(oldAuth).toBeNull();
    // New token authenticates.
    const newAuth = await m.authenticateHardened(
      hashSessionToken(rotated.token),
      now,
    );
    expect(newAuth?.sessionId).toBe(rotated.sessionId);
  });

  it("rotate throws SESSION_NOT_FOUND for unknown token", async () => {
    const userId = await seedUser();
    await expect(
      mgr().rotate(
        hashSessionToken(generateSessionToken()),
        userId as never,
        now,
        { idleTtlMs: IDLE, absoluteTtlMs: ABSOLUTE, authMethod: "oidc:google" },
      ),
    ).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    } satisfies Partial<SessionManagementError>);
  });

  it("authenticateHardened rejects idle-expired sessions", async () => {
    const userId = await seedUser();
    const m = mgr();
    const created = await m.create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: 1_000,
      absoluteTtlMs: ABSOLUTE,
    });
    const afterIdle = new Date(now.getTime() + 5_000);
    const auth = await m.authenticateHardened(
      hashSessionToken(created.token),
      afterIdle,
    );
    expect(auth).toBeNull();
  });

  it("authenticateHardened rejects revoked sessions", async () => {
    const userId = await seedUser();
    const m = mgr();
    const created = await m.create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    await m.revoke(created.sessionId as never, userId as never, now);
    const auth = await m.authenticateHardened(
      hashSessionToken(created.token),
      now,
    );
    expect(auth).toBeNull();
  });
});
