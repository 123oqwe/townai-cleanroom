import { describe, expect, it, vi } from "vitest";

import { newId } from "@town/contracts";

import { TownApiError, TownClient } from "../src/index.js";

type FetchCall = {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
};

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  if (body === null || status === 204)
    return new Response(null, {
      status,
      headers: { ...(init.headers ?? {}) },
    });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function makeClient(
  responses: Response[],
  calls: FetchCall[],
  options: { token?: string } = {},
): TownClient {
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      init: {
        ...init,
        headers: (init.headers ?? {}) as Record<string, string>,
      },
    });
    const response = responses.shift();
    if (response === undefined) throw new Error("no mock response queued");
    return response;
  }) as unknown as typeof globalThis.fetch;
  return new TownClient({
    baseUrl: "https://api.example.test",
    ...(options.token === undefined ? {} : { token: options.token }),
    fetch: fetchImpl,
  });
}

function contentFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: newId<"content">(),
    ownerId: newId<"user">(),
    kind: "document",
    title: "Meeting Notes",
    mimeType: "text/plain",
    storageKey: null,
    body: "Notes from the meeting.",
    metadata: {},
    sourceSessionId: null,
    status: "active",
    currentRevision: 1,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("TownClient content namespace", () => {
  it("lists content via GET /v1/content with status and cursor", async () => {
    const item = contentFixture();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ items: [item], nextCursor: "c1" })],
      calls,
      { token: "t" },
    );

    const result = await client.content.list({
      status: "active",
      limit: 20,
      cursor: "c0",
    });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe("c1");
    expect(calls[0].url).toBe(
      "https://api.example.test/v1/content?status=active&limit=20&cursor=c0",
    );
  });

  it("gets a single content via GET /v1/content/:id", async () => {
    const item = contentFixture();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ content: item })], calls, {
      token: "t",
    });

    const result = await client.content.get(item.id);

    expect(result.title).toBe("Meeting Notes");
    expect(calls[0].url).toBe(`https://api.example.test/v1/content/${item.id}`);
  });

  it("creates content via POST /v1/content", async () => {
    const item = contentFixture();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ content: item }, { status: 201 })],
      calls,
      { token: "t" },
    );

    const result = await client.content.create({
      kind: "document",
      title: "Meeting Notes",
      body: "Notes from the meeting.",
    });

    expect(result.kind).toBe("document");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string).kind).toBe("document");
  });

  it("fetches content history via GET /v1/content/:id/revisions", async () => {
    const id = newId<"content">();
    const revision = {
      id: newId<"content-revision">(),
      contentId: id,
      revision: 1,
      title: "Meeting Notes",
      mimeType: "text/plain",
      storageKey: null,
      body: "Original body.",
      metadata: {},
      createdAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ revisions: [revision] })],
      calls,
      { token: "t" },
    );

    const result = await client.content.history(id);

    expect(result).toHaveLength(1);
    expect(result[0].revision).toBe(1);
    expect(calls[0].url).toBe(
      `https://api.example.test/v1/content/${id}/revisions`,
    );
  });

  it("lists collections via GET /v1/content/collections", async () => {
    const collection = {
      id: newId<"content-collection">(),
      ownerId: newId<"user">(),
      name: "Research",
      description: "Research materials",
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ collections: [collection] })],
      calls,
      { token: "t" },
    );

    const result = await client.content.collections.list();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Research");
    expect(calls[0].url).toBe(
      "https://api.example.test/v1/content/collections",
    );
  });

  it("creates a collection via POST /v1/content/collections", async () => {
    const collection = {
      id: newId<"content-collection">(),
      ownerId: newId<"user">(),
      name: "Research",
      description: "Research materials",
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ collection }, { status: 201 })],
      calls,
      { token: "t" },
    );

    const result = await client.content.collections.create({
      name: "Research",
      description: "Research materials",
    });

    expect(result.name).toBe("Research");
    expect(calls[0].init.method).toBe("POST");
  });

  it("creates a content share via POST /v1/content/:id/shares", async () => {
    const id = newId<"content">();
    const share = {
      id: newId<"content-share">(),
      contentId: id,
      expiresAt: "2026-08-07T00:00:00.000Z",
      createdAt: "2026-08-06T00:00:00.000Z",
    };
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ share: { share, token: "token123" } }, 201)],
      calls,
      { token: "t" },
    );

    const result = await client.content.shares.create(id);

    expect(result.token).toBe("token123");
    expect(result.share.contentId).toBe(id);
  });

  it("deletes a content share via DELETE /v1/content/shares/:id", async () => {
    const shareId = newId<"content-share">();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse(null, { status: 204 })], calls, {
      token: "t",
    });

    await client.content.shares.delete(shareId);

    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url).toBe(
      `https://api.example.test/v1/content/shares/${shareId}`,
    );
  });

  it("downloads a blob via GET /v1/content/:id/blob", async () => {
    const id = newId<"content">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [
        new Response("file contents", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      ],
      calls,
      { token: "t" },
    );

    const blob = await client.content.blob(id);

    expect(blob.size).toBeGreaterThan(0);
    expect(calls[0].url).toBe(`https://api.example.test/v1/content/${id}/blob`);
    expect(calls[0].init.headers["Accept"]).toBe("*/*");
  });

  it("archives content via POST /v1/content/:id/archive", async () => {
    const id = newId<"content">();
    const archived = contentFixture({ status: "archived" });
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ content: archived })], calls, {
      token: "t",
    });

    const result = await client.content.archive(id);

    expect(result.status).toBe("archived");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].url).toBe(
      `https://api.example.test/v1/content/${id}/archive`,
    );
  });

  it("adds an item to a collection", async () => {
    const collectionId = newId<"content-collection">();
    const contentId = newId<"content">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ ok: true }, { status: 201 })],
      calls,
      { token: "t" },
    );

    await client.content.collections.addItem(collectionId, contentId);

    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string).contentId).toBe(contentId);
    expect(calls[0].url).toBe(
      `https://api.example.test/v1/content/collections/${collectionId}/items`,
    );
  });

  it("throws TownApiError on 401 unauthorized", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ error: "UNAUTHORIZED" }, { status: 401 })],
      calls,
    );

    await expect(client.content.list()).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("throws TownApiError on 404 for missing content", async () => {
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ error: "CONTENT_NOT_FOUND" }, { status: 404 })],
      calls,
      { token: "t" },
    );

    await expect(client.content.get(newId<"content">())).rejects.toMatchObject({
      status: 404,
      code: "CONTENT_NOT_FOUND",
    });
  });

  it("throws TownApiError on 409 conflict for stale revision", async () => {
    const id = newId<"content">();
    const calls: FetchCall[] = [];
    const client = makeClient(
      [jsonResponse({ error: "CONTENT_CONFLICT" }, { status: 409 })],
      calls,
      { token: "t" },
    );

    await expect(
      client.content.update(id, {
        expectedRevision: 1,
        title: "Updated",
        mimeType: "text/plain",
        storageKey: null,
        body: "Updated body",
        metadata: {},
      }),
    ).rejects.toMatchObject({ status: 409, code: "CONTENT_CONFLICT" });
  });

  it("lists items in a collection via GET /v1/content/collections/:id", async () => {
    const collectionId = newId<"content-collection">();
    const item = contentFixture();
    const calls: FetchCall[] = [];
    const client = makeClient([jsonResponse({ items: [item] })], calls, {
      token: "t",
    });

    const result = await client.content.collections.get(collectionId);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Meeting Notes");
    expect(calls[0].url).toBe(
      `https://api.example.test/v1/content/collections/${collectionId}`,
    );
  });
});
