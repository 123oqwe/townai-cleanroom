import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import type { AuthVariables } from "../src/auth.js";
import { registerContentRoutes } from "../src/content-routes.js";
import { ContentError, type ContentRepository } from "@town/content";

describe("content share route", () => {
  it("returns 404 for unknown share tokens", async () => {
    const repository = {
      resolveShare: vi
        .fn()
        .mockRejectedValue(
          new ContentError(
            "SHARE_NOT_FOUND",
            "The share token is invalid or expired.",
          ),
        ),
      toPublic: (item: Record<string, unknown>) => item,
    } as unknown as ContentRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    registerContentRoutes(app, { repository });

    const json = await app.request(
      "http://town.test/v1/content-shares/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    const legacyJson = await app.request(
      "http://town.test/content-shares/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(json.status).toBe(404);
    expect(await json.json()).toMatchObject({ error: "SHARE_NOT_FOUND" });
    expect(legacyJson.status).toBe(404);
    expect(await legacyJson.json()).toMatchObject({ error: "SHARE_NOT_FOUND" });
  });

  it("returns JSON errors for unknown share tokens even for browser Accept", async () => {
    const repository = {
      resolveShare: vi
        .fn()
        .mockRejectedValue(
          new ContentError(
            "SHARE_NOT_FOUND",
            "The share token is invalid or expired.",
          ),
        ),
      toPublic: (item: Record<string, unknown>) => item,
    } as unknown as ContentRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    registerContentRoutes(app, { repository });

    const legacyPage = await app.request(
      "http://town.test/content-shares/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      { headers: { accept: "text/html" } },
    );
    expect(legacyPage.status).toBe(404);
    expect(await legacyPage.json()).toMatchObject({ error: "SHARE_NOT_FOUND" });
  });

  it("returns 404 for missing shared blobs", async () => {
    const repository = {
      resolveShare: vi
        .fn()
        .mockRejectedValue(
          new ContentError(
            "SHARE_NOT_FOUND",
            "The share token is invalid or expired.",
          ),
        ),
    } as unknown as ContentRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    registerContentRoutes(app, {
      repository,
      storage: {
        read: vi.fn(),
      },
    });

    const legacyBlob = await app.request(
      "http://town.test/content-shares/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/blob",
    );
    const blob = await app.request(
      "http://town.test/v1/content-shares/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/blob",
    );
    expect(legacyBlob.status).toBe(404);
    expect(await legacyBlob.json()).toMatchObject({ error: "SHARE_NOT_FOUND" });
    expect(blob.status).toBe(404);
    expect(await blob.json()).toMatchObject({ error: "SHARE_NOT_FOUND" });
  });

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

  it("reads an owner-scoped stored blob through the configured storage port", async () => {
    const contentId = "01900000-0000-7000-8000-000000000011";
    const repository = {
      get: vi.fn().mockResolvedValue({
        id: contentId,
        storageKey: "objects/report.pdf",
        mimeType: "application/pdf",
      }),
    } as unknown as ContentRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (context, next) => {
      context.set("identity", {
        user: { id: "01900000-0000-7000-8000-000000000001" },
      } as AuthVariables["identity"]);
      await next();
    });
    registerContentRoutes(app, {
      repository,
      storage: {
        read: vi.fn().mockResolvedValue({
          body: new Uint8Array([1, 2, 3]),
          contentType: "application/pdf",
        }),
      },
    });
    const response = await app.request(
      `http://town.test/v1/content/${contentId}/blob`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("reads a shared stored blob without exposing its storage key", async () => {
    const repository = {
      resolveShare: vi.fn().mockResolvedValue({
        id: "01900000-0000-7000-8000-000000000012",
        kind: "image",
        title: "Shared image",
        storageKey: "private/object-key",
        mimeType: "image/png",
      }),
    } as unknown as ContentRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    registerContentRoutes(app, {
      repository,
      storage: {
        read: vi.fn().mockResolvedValue({
          body: new Uint8Array([137, 80, 78, 71]),
          contentType: "image/png",
        }),
      },
    });
    const response = await app.request(
      "http://town.test/v1/content-shares/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/blob",
    );
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
    expect(await response.text().catch(() => "")).not.toContain(
      "private/object-key",
    );
  });

  it("exposes the same share routes without the v1 prefix", async () => {
    const repository = {
      resolveShare: vi.fn().mockResolvedValue({
        id: "01900000-0000-7000-8000-000000000014",
        kind: "document",
        title: "Legacy share",
        body: "content body",
      }),
      toPublic: (item: Record<string, unknown>) => item,
    } as unknown as ContentRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    registerContentRoutes(app, { repository });

    const json = await app.request(
      "http://town.test/content-shares/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({
      content: { title: "Legacy share", body: "content body" },
    });

    const page = await app.request(
      "http://town.test/content-shares/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      { headers: { accept: "text/html" } },
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Legacy share");

    const blob = await app.request(
      "http://town.test/content-shares/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/blob",
    );
    expect(blob.status).toBe(503);
    expect(await blob.json()).toMatchObject({
      error: "CONTENT_STORAGE_NOT_CONFIGURED",
    });
  });

  it("sanitizes legacy shared HTML responses", async () => {
    const repository = {
      resolveShare: vi.fn().mockResolvedValue({
        id: "01900000-0000-7000-8000-000000000015",
        kind: "document",
        title: "<script>alert(1)</script>",
        mimeType: "text/plain",
        body: "<b>safe text</b>",
      }),
      toPublic: (item: Record<string, unknown>) => item,
    } as unknown as ContentRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    registerContentRoutes(app, { repository });

    const page = await app.request(
      "http://town.test/content-shares/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      { headers: { accept: "text/html" } },
    );
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;safe text&lt;/b&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<b>safe text</b>");
  });

  it("uploads an owner-scoped blob and records its storage key", async () => {
    const contentId = "01900000-0000-7000-8000-000000000013";
    const content = {
      id: contentId,
      title: "Upload",
      kind: "file",
      mimeType: null,
      storageKey: null,
      body: null,
      metadata: {},
      currentRevision: 1,
    };
    const repository = {
      get: vi.fn().mockResolvedValue(content),
      update: vi
        .fn()
        .mockResolvedValue({ ...content, storageKey: `content/${contentId}` }),
    } as unknown as ContentRepository;
    const write = vi.fn().mockResolvedValue(undefined);
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (context, next) => {
      context.set("identity", {
        user: { id: "01900000-0000-7000-8000-000000000001" },
      } as AuthVariables["identity"]);
      await next();
    });
    registerContentRoutes(app, {
      repository,
      storage: { read: vi.fn(), write },
    });

    const response = await app.request(
      `http://town.test/v1/content/${contentId}/blob`,
      {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "uploaded",
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      content: { storageKey: `content/${contentId}` },
    });
    expect(write).toHaveBeenCalledWith(
      `content/${contentId}`,
      expect.any(Uint8Array),
      "text/plain",
    );
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId,
        expectedRevision: 1,
        storageKey: `content/${contentId}`,
        body: null,
      }),
    );
  });

  it("rejects blob upload when storage is read-only", async () => {
    const contentId = "01900000-0000-7000-8000-000000000016";
    const repository = {
      get: vi.fn().mockResolvedValue({
        id: contentId,
        title: "ReadOnly",
        mimeType: null,
        storageKey: null,
        body: null,
        metadata: {},
        currentRevision: 1,
      }),
    } as unknown as ContentRepository;
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (context, next) => {
      context.set("identity", {
        user: { id: "01900000-0000-7000-8000-000000000001" },
      } as AuthVariables["identity"]);
      await next();
    });
    registerContentRoutes(app, {
      repository,
      storage: { read: vi.fn() },
    });

    const response = await app.request(
      `http://town.test/v1/content/${contentId}/blob`,
      {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "upload blocked",
      },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "CONTENT_STORAGE_NOT_CONFIGURED",
    });
  });
});
