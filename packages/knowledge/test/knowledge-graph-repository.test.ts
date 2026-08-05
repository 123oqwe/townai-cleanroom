import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import postgres, { type Sql } from "postgres";

import { newId, type Id } from "@town/contracts";
import { runMigrations } from "@town/db";

import {
  createKnowledgeGraphRepository,
  GraphError,
} from "../src/knowledge-graph-repository.js";

let sql: Sql;
let ownerId: Id<"user">;
let otherOwnerId: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 1 });
  await runMigrations(sql);
});

beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  otherOwnerId = newId<"user">();
  await sql`
    insert into users (id, email, timezone)
    values
      (${ownerId}, 'graph-owner@example.invalid', 'UTC'),
      (${otherOwnerId}, 'graph-other@example.invalid', 'UTC')
  `;
});

afterAll(async () => {
  await sql.end();
});

describe("knowledge graph repository", () => {
  it("creates an edge and lists it back", async () => {
    const graph = createKnowledgeGraphRepository(sql);
    const edge = await graph.createEdge({
      ownerId,
      fromType: "person",
      fromId: "person-1",
      toType: "organization",
      toId: "org-1",
      edgeType: "works_at",
      metadata: {},
      notes: "Senior engineer",
    });
    expect(edge.fromType).toBe("person");
    expect(edge.toType).toBe("organization");
    expect(edge.edgeType).toBe("works_at");
    expect(edge.status).toBe("active");
    expect(edge.revision).toBe(1);

    const edges = await graph.listEdges(ownerId);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ id: edge.id });
  });

  it("rejects a duplicate edge with GRAPH_EDGE_DUPLICATE", async () => {
    const graph = createKnowledgeGraphRepository(sql);
    const input = {
      ownerId,
      fromType: "person" as const,
      fromId: "person-1",
      toType: "organization" as const,
      toId: "org-1",
      edgeType: "works_at" as const,
      metadata: {},
    };
    await graph.createEdge(input);
    await expect(graph.createEdge(input)).rejects.toThrow(GraphError);
    await expect(graph.createEdge(input)).rejects.toMatchObject({
      code: "GRAPH_EDGE_DUPLICATE",
    });
  });

  it("isolates edges by owner", async () => {
    const graph = createKnowledgeGraphRepository(sql);
    await graph.createEdge({
      ownerId,
      fromType: "person",
      fromId: "person-1",
      toType: "topic",
      toId: "topic-1",
      edgeType: "mentioned_in",
      metadata: {},
    });
    await graph.createEdge({
      ownerId: otherOwnerId,
      fromType: "person",
      fromId: "person-1",
      toType: "topic",
      toId: "topic-1",
      edgeType: "mentioned_in",
      metadata: {},
    });
    const ownerEdges = await graph.listEdges(ownerId);
    const otherEdges = await graph.listEdges(otherOwnerId);
    expect(ownerEdges).toHaveLength(1);
    expect(otherEdges).toHaveLength(1);
    expect(ownerEdges[0]).toMatchObject({ ownerId });
    expect(otherEdges[0]).toMatchObject({ ownerId: otherOwnerId });
  });

  it("filters edges by type and node", async () => {
    const graph = createKnowledgeGraphRepository(sql);
    await graph.createEdge({
      ownerId,
      fromType: "person",
      fromId: "p1",
      toType: "organization",
      toId: "org-1",
      edgeType: "works_at",
      metadata: {},
    });
    await graph.createEdge({
      ownerId,
      fromType: "person",
      fromId: "p1",
      toType: "project",
      toId: "proj-1",
      edgeType: "owns",
      metadata: {},
    });
    await graph.createEdge({
      ownerId,
      fromType: "person",
      fromId: "p2",
      toType: "organization",
      toId: "org-1",
      edgeType: "works_at",
      metadata: {},
    });

    const p1Edges = await graph.listEdges(ownerId, { fromId: "p1" });
    expect(p1Edges).toHaveLength(2);

    const worksAtEdges = await graph.listEdges(ownerId, {
      edgeType: "works_at",
    });
    expect(worksAtEdges).toHaveLength(2);

    const org1Targets = await graph.listEdges(ownerId, {
      toType: "organization",
      toId: "org-1",
    });
    expect(org1Targets).toHaveLength(2);
  });

  it("retires an edge with optimistic revision check", async () => {
    const graph = createKnowledgeGraphRepository(sql);
    const edge = await graph.createEdge({
      ownerId,
      fromType: "person",
      fromId: "p1",
      toType: "topic",
      toId: "t1",
      edgeType: "related_to",
      metadata: {},
    });
    await graph.retireEdge(ownerId, edge.id, 1);
    const active = await graph.listEdges(ownerId);
    expect(active).toHaveLength(0);

    // Wrong revision should fail
    await expect(graph.retireEdge(ownerId, edge.id, 99)).rejects.toThrow(
      GraphError,
    );
  });

  it("finds neighbors in both directions", async () => {
    const graph = createKnowledgeGraphRepository(sql);
    await graph.createEdge({
      ownerId,
      fromType: "person",
      fromId: "p1",
      toType: "organization",
      toId: "org-1",
      edgeType: "works_at",
      metadata: {},
    });
    await graph.createEdge({
      ownerId,
      fromType: "person",
      fromId: "p2",
      toType: "person",
      toId: "p1",
      edgeType: "reports_to",
      metadata: {},
    });

    const neighbors = await graph.getNeighbors(ownerId, "person", "p1");
    expect(neighbors).toHaveLength(2);
    const edgeTypes = neighbors.map((e) => e.edgeType).sort();
    expect(edgeTypes).toEqual(["reports_to", "works_at"]);
  });

  it("traverses 3-hop relationships with findRelated", async () => {
    const graph = createKnowledgeGraphRepository(sql);
    // p1 -> org-1
    await graph.createEdge({
      ownerId,
      fromType: "person",
      fromId: "p1",
      toType: "organization",
      toId: "org-1",
      edgeType: "works_at",
      metadata: {},
    });
    // org-1 -> proj-1
    await graph.createEdge({
      ownerId,
      fromType: "organization",
      fromId: "org-1",
      toType: "project",
      toId: "proj-1",
      edgeType: "owns",
      metadata: {},
    });
    // proj-1 -> task-1
    await graph.createEdge({
      ownerId,
      fromType: "project",
      fromId: "proj-1",
      toType: "task",
      toId: "task-1",
      edgeType: "assigned_to",
      metadata: {},
    });

    // 1-hop: org-1
    const hop1 = await graph.findRelated(ownerId, "person", "p1", 1);
    expect(hop1.map((n) => n.id)).toContain("org-1");
    expect(hop1.map((n) => n.id)).not.toContain("task-1");

    // 2-hop: org-1, proj-1
    const hop2 = await graph.findRelated(ownerId, "person", "p1", 2);
    expect(hop2.map((n) => n.id)).toContain("org-1");
    expect(hop2.map((n) => n.id)).toContain("proj-1");

    // 3-hop: org-1, proj-1, task-1
    const hop3 = await graph.findRelated(ownerId, "person", "p1", 3);
    expect(hop3.map((n) => n.id)).toContain("task-1");

    // Invalid hops
    await expect(graph.findRelated(ownerId, "person", "p1", 0)).rejects.toThrow(
      GraphError,
    );
    await expect(graph.findRelated(ownerId, "person", "p1", 4)).rejects.toThrow(
      GraphError,
    );
  });
});
