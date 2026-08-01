import type { Sql } from "postgres";

import { asId, type Id } from "@town/contracts";

import type { AuthenticatedIdentity, SafeSession, SafeUser } from "./types.js";

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  timezone: string;
  status: "active" | "disabled";
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
  last_seen_at: Date;
}

interface AuthenticatedRow extends UserRow {
  session_id: string;
  session_user_id: string;
  expires_at: Date;
  created_at: Date;
  last_seen_at: Date;
}

function safeUser(row: UserRow): SafeUser {
  return {
    id: asId<"user">(row.id),
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    timezone: row.timezone,
    status: row.status,
  };
}

function safeSession(row: SessionRow): SafeSession {
  return {
    id: asId<"auth-session">(row.id),
    userId: asId<"user">(row.user_id),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export class IdentityRepository {
  constructor(private readonly sql: Sql) {}

  async establish(
    input: {
      email: string;
      firstName?: string | undefined;
      lastName?: string | undefined;
      timezone: string;
    },
    values: {
      userId: Id<"user">;
      sessionId: Id<"auth-session">;
      tokenHash: Buffer;
      now: Date;
      expiresAt: Date;
    },
  ): Promise<{ user: SafeUser; session: SafeSession } | null> {
    return this.sql.begin(async (transaction) => {
      const [allowed] = await transaction<{ enabled: boolean }[]>`
        select enabled
        from access_allowlist
        where email = ${input.email}
        for update
      `;
      if (allowed?.enabled !== true) return null;

      const [user] = await transaction<UserRow[]>`
        insert into users (
          id, email, first_name, last_name, timezone, status, created_at, updated_at
        ) values (
          ${values.userId}, ${input.email}, ${input.firstName ?? null},
          ${input.lastName ?? null}, ${input.timezone}, 'active', ${values.now}, ${values.now}
        )
        on conflict (email) do update set
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          timezone = excluded.timezone,
          updated_at = excluded.updated_at
        returning id, email::text, first_name, last_name, timezone, status
      `;
      if (user === undefined || user.status !== "active") return null;

      const [session] = await transaction<SessionRow[]>`
        insert into auth_sessions (
          id, user_id, token_hash, expires_at, created_at, last_seen_at
        ) values (
          ${values.sessionId}, ${user.id}, ${values.tokenHash}, ${values.expiresAt},
          ${values.now}, ${values.now}
        )
        returning id, user_id, expires_at, created_at, last_seen_at
      `;
      if (session === undefined)
        throw new Error("Session insert returned no row.");

      return { user: safeUser(user), session: safeSession(session) };
    });
  }

  async authenticate(
    tokenHash: Buffer,
    now: Date,
  ): Promise<AuthenticatedIdentity | null> {
    const [row] = await this.sql<AuthenticatedRow[]>`
      update auth_sessions as session
      set last_seen_at = ${now}
      from users as app_user
      where session.user_id = app_user.id
        and session.token_hash = ${tokenHash}
        and session.revoked_at is null
        and session.expires_at > ${now}
        and app_user.status = 'active'
      returning
        session.id as session_id, session.user_id as session_user_id,
        session.expires_at, session.created_at,
        session.last_seen_at, app_user.email::text, app_user.first_name,
        app_user.last_name, app_user.timezone, app_user.status,
        app_user.id as id
    `;
    if (row === undefined) return null;

    const user = safeUser(row);
    const session = safeSession({
      id: row.session_id,
      user_id: row.session_user_id,
      expires_at: row.expires_at,
      created_at: row.created_at,
      last_seen_at: row.last_seen_at,
    });
    return { user, session };
  }

  async revoke(
    sessionId: Id<"auth-session">,
    ownerId: Id<"user">,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.sql`
      update auth_sessions
      set revoked_at = ${now}
      where id = ${sessionId} and user_id = ${ownerId} and revoked_at is null
      returning id
    `;
    return rows.count === 1;
  }
}
