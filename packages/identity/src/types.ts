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

export interface EstablishedIdentity {
  token: string;
  user: SafeUser;
  session: SafeSession;
}

export interface AuthenticatedIdentity {
  user: SafeUser;
  session: SafeSession;
}
