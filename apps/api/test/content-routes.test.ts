import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import type { AuthVariables } from "../src/auth.js";
import { registerContentRoutes } from "../src/content-routes.js";
import type { ContentRepository } from "@town/content";

describe("content share route", () => {
  it("keeps JSON for API clients and renders escaped HTML for browsers", async () => {
    const repository = {
      resolveShare: vi.fn().mockResolvedValue({
        id: "01900000-0000-7000-8000-000000000010",
        kind: "document",
        title: "<script>alert(1)</script>",
        mimeType: "text/plain",
        body: "<b>safe text</b>",
      }),
      toPublic: (item: Record<string, unknown>) => item,
    } as unknown as ContentRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    registerContentRoutes(app, { repository });

    const json = await app.request(
      "http://town.test/v1/content-shares/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({
      content: { title: "<script>alert(1)</script>" },
    });

    const page = await app.request(
      "http://town.test/v1/content-shares/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      { headers: { accept: "text/html" } },
    );
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;b&gt;safe text&lt;/b&gt;");
  });
});
