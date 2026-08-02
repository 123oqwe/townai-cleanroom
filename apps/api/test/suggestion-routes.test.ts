import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import { asId } from "@town/contracts";
import type { SuggestionRepository } from "@town/suggestions";
import type { AuthVariables } from "../src/auth.js";
import { registerSuggestionRoutes } from "../src/suggestion-routes.js";

describe("suggestion routes", () => {
  it("lists and transitions owner-scoped suggestions", async () => {
    const ownerId = asId<"user">("01900000-0000-7000-8000-000000000001");
    const suggestionId = asId<"suggestion">(
      "01900000-0000-7000-8000-000000000002",
    );
    const transition = vi.fn().mockResolvedValue({
      id: suggestionId,
      status: "dismissed",
      revision: 2,
    });
    const repository = {
      list: vi.fn().mockResolvedValue([{ id: suggestionId, status: "open" }]),
      transition,
    } as unknown as SuggestionRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (context, next) => {
      context.set("identity", {
        user: { id: ownerId },
      } as AuthVariables["identity"]);
      await next();
    });
    registerSuggestionRoutes(app, repository);
    const list = await app.request("http://town.test/v1/suggestions");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { suggestions: unknown[] };
    expect(listBody.suggestions).toHaveLength(1);
    const patch = await app.request(
      `http://town.test/v1/suggestions/${suggestionId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: 1, status: "dismissed" }),
      },
    );
    expect(patch.status).toBe(200);
    expect(transition).toHaveBeenCalledWith(
      ownerId,
      suggestionId,
      1,
      "dismissed",
    );
  });
});
