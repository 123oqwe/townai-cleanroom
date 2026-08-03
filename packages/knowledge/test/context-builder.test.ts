import { describe, expect, it, vi } from "vitest";

import { createKnowledgeContextBuilder } from "../src/context-builder.js";

describe("knowledge context builder", () => {
  it("preserves owner-scoped search items and citations within a character budget", async () => {
    const search = {
      search: vi.fn().mockResolvedValue({
        items: [
          {
            ownerId: "01900000-0000-7000-8000-000000000001",
            resourceType: "wiki",
            resourceId: "01900000-0000-7000-8000-000000000002",
            title: "Roadmap",
            text: "Ship the durable runtime before expanding integrations.",
            subtype: "project",
            status: "active",
            score: 0.9,
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            citations: [],
            source: {
              kind: "local_postgresql",
              algorithm: "postgres_full_text_v1",
            },
          },
        ],
        nextCursor: null,
      }),
    };
    const builder = createKnowledgeContextBuilder(search as never);
    const result = await builder.build({
      ownerId: "01900000-0000-7000-8000-000000000001" as never,
      query: "roadmap",
      maxChars: 500,
    });

    expect(search.search).toHaveBeenCalledWith({
      ownerId: "01900000-0000-7000-8000-000000000001",
      query: "roadmap",
      limit: 20,
    });
    expect(result).toMatchObject({
      query: "roadmap",
      truncated: false,
      includedChars: result.text.length,
      items: [{ resourceType: "wiki", title: "Roadmap" }],
    });
    expect(result.text).toContain(
      "[wiki:01900000-0000-7000-8000-000000000002]",
    );
  });

  it("marks truncation when a result cannot fit the explicit context budget", async () => {
    const search = {
      search: vi.fn().mockResolvedValue({
        items: [
          {
            ownerId: "01900000-0000-7000-8000-000000000001",
            resourceType: "memory",
            resourceId: "01900000-0000-7000-8000-000000000002",
            title: null,
            text: "x".repeat(600),
            subtype: "global",
            status: "active",
            score: 0.5,
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            citations: [],
            source: {
              kind: "local_postgresql",
              algorithm: "postgres_full_text_v1",
            },
          },
        ],
        nextCursor: null,
      }),
    };
    const builder = createKnowledgeContextBuilder(search as never);
    const result = await builder.build({
      ownerId: "01900000-0000-7000-8000-000000000001" as never,
      query: "memory",
      maxChars: 500,
    });

    expect(result.items).toHaveLength(0);
    expect(result.text).toBe("");
    expect(result.truncated).toBe(true);
  });
});
