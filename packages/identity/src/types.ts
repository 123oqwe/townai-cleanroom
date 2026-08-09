import type { Id } from "@town/contracts";

export interface SafeUser {
  id: Id<"user">;
  email: string;
  firstName: string | null;
  lastName: string | null;
  timezone: string;
  status: "active" | "disabled";
}

export interface SafeSession {
  id: Id<"auth-session">;
  userId: Id<"user">;
  expiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
}

// Phase 01A: hardened session view for the session-management UI.
export interface SafeSessionDetail {
  id: Id<"auth-session">;
  userId: Id<"user">;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  idleExpiresAt: Date | null;
  absoluteExpiresAt: Date | null;
  authMethod: string | null;
  isCurrent: boolean;
  revokedAt: Date | null;
  // Privacy-minimized: a short hash prefix, never the raw UA/IP.
  deviceLabel: string | null;
}

export interface EstablishedIdentity {
  token: string;
  user: SafeUser;
  session: SafeSession;
}

export interface AuthenticatedIdentity {
  user: SafeUser;
  session: SafeSession;
}

export interface EstablishedSession {
  token: string;
  sessionId: Id<"auth-session">;
  userId: Id<"user">;
}
