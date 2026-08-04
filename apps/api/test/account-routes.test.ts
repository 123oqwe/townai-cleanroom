import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import type { AuthVariables } from "../src/lib/auth.js";
import { registerAccountRoutes } from "../src/routes/account-routes.js";
import type { AccountRepository } from "@town/identity";
import { asId } from "@town/contracts";

const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
const accountId = asId<"connected-account">(
  "01900000-0000-7000-8000-000000000002",
);

describe("account routes", () => {
  it("rotates credentials and removes only the requested account", async () => {
    const rotateCredential = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const repository = {
      listByOwner: vi.fn(async () => []),
      rotateCredential,
      remove,
    } as unknown as AccountRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (context, next) => {
      context.set("identity", {
        user: { id: ownerId },
      } as AuthVariables["identity"]);
      await next();
    });
    registerAccountRoutes(app, { repository });

    const rotate = await app.request(
      `http://town.test/v1/accounts/${accountId}/credential`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessToken: "secret",
          scopes: ["mail.read"],
        }),
      },
    );
    expect(rotate.status).toBe(204);
    expect(rotateCredential).toHaveBeenCalledWith(ownerId, accountId, {
      accessToken: "secret",
      scopes: ["mail.read"],
    });

    const removeResponse = await app.request(
      `http://town.test/v1/accounts/${accountId}`,
      { method: "DELETE" },
    );
    expect(removeResponse.status).toBe(204);
    expect(remove).toHaveBeenCalledWith(ownerId, accountId);
  });
});
