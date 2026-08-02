import { z } from "zod";
import type {
  AccountRepository,
  SafeConnectedAccount,
} from "./account-repository.js";
import type { CredentialSecret } from "./credential-cipher.js";
import type { Id } from "@town/contracts";

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    refresh_token: z.string().min(1).optional(),
  })
  .passthrough();

export class GoogleTokenError extends Error {
  constructor(
    readonly code:
      | "GOOGLE_TOKEN_NOT_CONFIGURED"
      | "GOOGLE_TOKEN_REFRESH_FAILED"
      | "GOOGLE_ACCOUNT_NOT_GOOGLE",
    message: string,
  ) {
    super(message);
    this.name = "GoogleTokenError";
  }
}

export function createGoogleTokenRefresher(input: {
  accounts: AccountRepository;
  clientId?: string;
  clientSecret?: string;
  fetch?: typeof globalThis.fetch;
}) {
  const request = input.fetch ?? globalThis.fetch;
  return {
    async refresh(
      ownerId: Id<"user">,
      accountId: Id<"connected-account">,
    ): Promise<SafeConnectedAccount> {
      if (input.clientId === undefined || input.clientSecret === undefined)
        throw new GoogleTokenError(
          "GOOGLE_TOKEN_NOT_CONFIGURED",
          "Google OAuth client credentials are not configured.",
        );
      if (request === undefined)
        throw new GoogleTokenError(
          "GOOGLE_TOKEN_REFRESH_FAILED",
          "Fetch is unavailable.",
        );
      const loaded = await input.accounts.getCredential(ownerId, accountId);
      if (loaded.account.provider !== "google")
        throw new GoogleTokenError(
          "GOOGLE_ACCOUNT_NOT_GOOGLE",
          "The connected account is not Google.",
        );
      if (loaded.credential.refreshToken === undefined)
        throw new GoogleTokenError(
          "GOOGLE_TOKEN_REFRESH_FAILED",
          "The Google account has no refresh token.",
        );
      const response = await request("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: input.clientId,
          client_secret: input.clientSecret,
          grant_type: "refresh_token",
          refresh_token: loaded.credential.refreshToken,
        }),
      });
      if (!response.ok)
        throw new GoogleTokenError(
          "GOOGLE_TOKEN_REFRESH_FAILED",
          `Google token refresh failed with HTTP ${response.status}.`,
        );
      const body = tokenResponseSchema.safeParse(await response.json());
      if (!body.success)
        throw new GoogleTokenError(
          "GOOGLE_TOKEN_REFRESH_FAILED",
          "Google returned an invalid token response.",
        );
      const credential: CredentialSecret = {
        accessToken: body.data.access_token,
        refreshToken: body.data.refresh_token ?? loaded.credential.refreshToken,
        scopes: loaded.credential.scopes,
      };
      await input.accounts.rotateCredential(
        ownerId,
        accountId,
        credential,
        new Date(Date.now() + body.data.expires_in * 1000),
      );
      return (
        (await input.accounts.listByOwner(ownerId)).find(
          (account) => account.id === accountId,
        ) ?? loaded.account
      );
    },
  };
}

export type GoogleTokenRefresher = ReturnType<
  typeof createGoogleTokenRefresher
>;
