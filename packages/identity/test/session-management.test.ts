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
import { hashSessionToken } from "../src/session-token.js";

let sql: Sql;
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
  const now = new Date();
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
    const now = new Date();
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

  it("createWithDbClock returns DB-authoritative timestamps", async () => {
    const userId = await seedUser();
    const created = await mgr().createWithDbClock({
      userId: userId as never,
      authMethod: "oidc:google",
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    expect(created.token).toMatch(/^town_session_/);
    expect(created.cookieMaxAgeSeconds).toBeGreaterThan(0);
    expect(created.cookieMaxAgeSeconds).toBeLessThanOrEqual(
      Math.floor(ABSOLUTE / 1000),
    );
  });

  it("listActive returns non-revoked, non-expired sessions with dynamic isCurrent", async () => {
    const userId = await seedUser();
    const now = new Date();
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
    const list = await m.listActive(userId as never, now, b.sessionId as never);
    expect(list).toHaveLength(2);
    const current = list.find((s) => s.isCurrent);
    const other = list.find((s) => !s.isCurrent);
    expect(current?.id).toBe(b.sessionId);
    expect(other?.id).toBe(a.sessionId);
  });

  it("revokeAll revokes every session except the specified one", async () => {
    const userId = await seedUser();
    const now = new Date();
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
    const count = await m.revokeAll(userId as never, b.sessionId as never);
    expect(count).toBe(1);
    const list = await m.listActive(userId as never, now);
    expect(list).toHaveLength(1);
    const [active] = list;
    expect(active?.id).toBe(b.sessionId);
    expect(a.token).not.toBe(b.token);
  });

  it("revokeAllIncludingCurrent revokes all sessions including current", async () => {
    const userId = await seedUser();
    const now = new Date();
    const m = mgr();
    await m.create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    await m.create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    const count = await m.revokeAllIncludingCurrent(userId as never);
    expect(count).toBe(2);
    const list = await m.listActive(userId as never, now);
    expect(list).toHaveLength(0);
  });

  it("rotateById invalidates old token and issues new one with DB clock", async () => {
    const userId = await seedUser();
    const now = new Date();
    const m = mgr();
    const created = await m.create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    const rotated = await m.rotateById(created.sessionId, userId as never, {
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    expect(rotated.token).not.toBe(created.token);
    expect(rotated.cookieMaxAgeSeconds).toBeGreaterThan(0);
    // Old token no longer authenticates.
    const oldAuth = await m.authenticateHardened(
      hashSessionToken(created.token),
      now,
      IDLE,
    );
    expect(oldAuth).toBeNull();
    // New token authenticates.
    const newAuth = await m.authenticateHardened(
      hashSessionToken(rotated.token),
      now,
      IDLE,
    );
    expect(newAuth?.sessionId).toBe(rotated.sessionId);
  });

  it("rotateById inherits original auth_method", async () => {
    const userId = await seedUser();
    const now = new Date();
    const m = mgr();
    const created = await m.create({
      userId: userId as never,
      authMethod: "dev:email",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    const rotated = await m.rotateById(created.sessionId, userId as never, {
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    const [row] = await sql<{ auth_method: string | null }[]>`
      select auth_method from auth_sessions where id = ${rotated.sessionId}
    `;
    expect(row?.auth_method).toBe("dev:email");
  });

  it("rotateById rejects unknown session", async () => {
    const userId = await seedUser();
    await expect(
      mgr().rotateById(
        "00000000-0000-0000-0000-000000000000" as never,
        userId as never,
        { idleTtlMs: IDLE, absoluteTtlMs: ABSOLUTE },
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
      now: new Date(),
      idleTtlMs: 1_000,
      absoluteTtlMs: ABSOLUTE,
    });
    await sql`
      update auth_sessions
      set created_at = now() - interval '5 minutes',
          idle_expires_at = now() - interval '1 minute',
          last_seen_at = now() - interval '5 minutes',
          expires_at = now() - interval '1 minute'
      where id = ${created.sessionId}
    `;
    const auth = await m.authenticateHardened(
      hashSessionToken(created.token),
      new Date(),
      IDLE,
    );
    expect(auth).toBeNull();
  });

  it("authenticateHardened rejects revoked sessions", async () => {
    const userId = await seedUser();
    const now = new Date();
    const m = mgr();
    const created = await m.create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    await m.revoke(created.sessionId as never, userId as never);
    const auth = await m.authenticateHardened(
      hashSessionToken(created.token),
      now,
      IDLE,
    );
    expect(auth).toBeNull();
  });

  it("authenticateHardened does not update last_seen_at below throttle", async () => {
    const userId = await seedUser();
    const now = new Date();
    const m = mgr();
    const created = await m.create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    const [before] = await sql<{ last_seen_at: Date }[]>`
      select last_seen_at from auth_sessions where id = ${created.sessionId}
    `;
    await m.authenticateHardened(hashSessionToken(created.token), now, IDLE);
    const [after] = await sql<{ last_seen_at: Date }[]>`
      select last_seen_at from auth_sessions where id = ${created.sessionId}
    `;
    expect(after?.last_seen_at.getTime()).toBe(before?.last_seen_at.getTime());
  });

  it("authenticateHardened returns real createdAt", async () => {
    const userId = await seedUser();
    const now = new Date();
    const m = mgr();
    const created = await m.create({
      userId: userId as never,
      authMethod: "oidc:google",
      now,
      idleTtlMs: IDLE,
      absoluteTtlMs: ABSOLUTE,
    });
    const auth = await m.authenticateHardened(
      hashSessionToken(created.token),
      now,
      IDLE,
    );
    expect(auth?.createdAt).toBeInstanceOf(Date);
    expect(auth?.createdAt.getTime()).not.toBe(0);
  });
});
