import type { MiddlewareHandler } from "hono";

import {
  IdentityError,
  type AuthenticatedIdentity,
  type IdentityService,
} from "@town/identity";

export interface AuthVariables {
  identity: AuthenticatedIdentity;
}

export function createAuthMiddleware(
  identityService: IdentityService,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (context, next) => {
    const authorization = context.req.header("Authorization");
    const match = authorization?.match(/^Bearer ([^\s,]+)$/);

    try {
      if (match?.[1] === undefined) {
        throw new IdentityError("UNAUTHENTICATED", "The session is invalid.");
      }
      context.set("identity", await identityService.authenticate(match[1]));
      await next();
    } catch (error: unknown) {
      if (error instanceof IdentityError && error.code === "UNAUTHENTICATED") {
        return context.json(
          {
            type: "https://town.local/problems/unauthenticated",
            title: "Authentication required",
            status: 401,
            detail: "A valid bearer session is required.",
            code: "UNAUTHENTICATED",
          },
          401,
        );
      }
      throw error;
    }
  };
}
