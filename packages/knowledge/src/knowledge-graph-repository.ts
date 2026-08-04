import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

export const graphNodeTypeSchema = z.enum([
  "person",
  "organization",
  "project",
  "goal",
  "topic",
  "email_thread",
  "calendar_event",
  "document",
  "task",
  "routine",
  "memory",
  "wiki",
]);
export const graphEdgeTypeSchema = z.enum([
  "works_at",
  "reports_to",
  "communicated_with",
  "attended",
  "related_to",
  "owns",
  "mentioned_in",
  "member_of",
  "part_of",
  "created_by",
  "assigned_to",
  "references",
  "depends_on",
  "collaborated_on",
  "manages",
]);

export type GraphNodeType = z.infer<typeof graphNodeTypeSchema>;
export type GraphEdgeType = z.infer<typeof graphEdgeTypeSchema>;

const edgeInputSchema = z
  .object({
    ownerId: idSchema,
    fromType: graphNodeTypeSchema,
    fromId: z.string().trim().min(1).max(500),
    toType: graphNodeTypeSchema,
    toId: z.string().trim().min(1).max(500),
    edgeType: graphEdgeTypeSchema,
    notes: z.string().trim().max(2_000).optional(),
    metadata: z.record(z.string(), z.json()).default({}),
  })
  .strict();

const edgeUpdateSchema = edgeInputSchema.extend({
  id: idSchema,
  expectedRevision: z.number().int().positive(),
});

interface GraphEdgeRow {
  id: string;
  owner_id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  edge_type: string;
  notes: string | null;
  metadata: Record<string, unknown>;
  revision: number;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface GraphEdge {
  id: Id<"graph-edge">;
  ownerId: Id<"user">;
  fromType: GraphNodeType;
  fromId: string;
  toType: GraphNodeType;
  toId: string;
  edgeType: GraphEdgeType;
  notes: string | null;
  metadata: Record<string, unknown>;
  revision: number;
  status: "active" | "retired";
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphNode {
  type: GraphNodeType;
  id: string;
  label: string | null;
  edgeCount: number;
}

export class GraphError extends Error {
  constructor(
    readonly code:
      | "GRAPH_EDGE_NOT_FOUND"
      | "GRAPH_EDGE_CONFLICT"
      | "GRAPH_EDGE_DUPLICATE"
      | "GRAPH_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

function mapRow(row: GraphEdgeRow): GraphEdge {
  return {
    id: asId<"graph-edge">(row.id),
    ownerId: asId<"user">(row.owner_id),
    fromType: row.from_type as GraphNodeType,
    fromId: row.from_id,
    toType: row.to_type as GraphNodeType,
    toId: row.to_id,
    edgeType: row.edge_type as GraphEdgeType,
    notes: row.notes,
    metadata: row.metadata,
    revision: row.revision,
    status: row.status as "active" | "retired",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Structured knowledge graph with typed edges between arbitrary entities.
 * Real Town.ai has a knowledge graph with Person, Organization, Project,
 * Goal, Topic, Email Thread, Calendar Event, Document, Task, Routine nodes
 * and typed edges like works_at, reports_to, communicated_with, attended,
 * related_to, owns, mentioned_in, member_of.
 *
 * This graph complements the People relationship graph: People edges are
 * person-to-person, while this graph supports any entity-to-entity edge.
 */
export function createKnowledgeGraphRepository(sql: Sql) {
  return {
    async createEdge(
      input: z.infer<typeof edgeInputSchema>,
    ): Promise<GraphEdge> {
      const value = edgeInputSchema.parse(input);
      const id = newId<"graph-edge">();
      try {
        const rows = await sql<GraphEdgeRow[]>`
          insert into knowledge_graph_edges
            (id, owner_id, from_type, from_id, to_type, to_id, edge_type,
             notes, metadata, revision, status)
          values (${id}, ${value.ownerId}, ${value.fromType}, ${value.fromId},
                  ${value.toType}, ${value.toId}, ${value.edgeType},
                  ${value.notes ?? null}, ${sql.json(value.metadata)}, 1, 'active')
          returning *`;
        return mapRow(rows[0]!);
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "constraint_name" in error &&
          (error as { constraint_name: string }).constraint_name ===
            "graph_edges_owner_from_to_type_unique"
        )
          throw new GraphError(
            "GRAPH_EDGE_DUPLICATE",
            "This edge already exists.",
          );
        throw error;
      }
    },

    async listEdges(
      ownerId: Id<"user">,
      filter?: {
        fromType?: GraphNodeType;
        fromId?: string;
        toType?: GraphNodeType;
        toId?: string;
        edgeType?: GraphEdgeType;
      },
    ): Promise<GraphEdge[]> {
      const rows = await sql<GraphEdgeRow[]>`
        select * from knowledge_graph_edges
        where owner_id = ${ownerId}
          and status = 'active'
          and (${filter?.fromType ?? null}::text is null or from_type = ${filter?.fromType ?? null})
          and (${filter?.fromId ?? null}::text is null or from_id = ${filter?.fromId ?? null})
          and (${filter?.toType ?? null}::text is null or to_type = ${filter?.toType ?? null})
          and (${filter?.toId ?? null}::text is null or to_id = ${filter?.toId ?? null})
          and (${filter?.edgeType ?? null}::text is null or edge_type = ${filter?.edgeType ?? null})
        order by updated_at desc
        limit 200`;
      return rows.map(mapRow);
    },

    async getNeighbors(
      ownerId: Id<"user">,
      nodeType: GraphNodeType,
      nodeId: string,
    ): Promise<GraphEdge[]> {
      const rows = await sql<GraphEdgeRow[]>`
        select * from knowledge_graph_edges
        where owner_id = ${ownerId}
          and status = 'active'
          and ((from_type = ${nodeType} and from_id = ${nodeId})
               or (to_type = ${nodeType} and to_id = ${nodeId}))
        order by updated_at desc
        limit 100`;
      return rows.map(mapRow);
    },

    async retireEdge(
      ownerId: Id<"user">,
      id: Id<"graph-edge">,
      expectedRevision: number,
    ): Promise<void> {
      const rows = await sql`
        update knowledge_graph_edges
        set status = 'retired', revision = revision + 1, updated_at = now()
        where id = ${id} and owner_id = ${ownerId}
          and revision = ${expectedRevision} and status = 'active'`;
      if (rows.count === 0)
        throw new GraphError(
          "GRAPH_EDGE_NOT_FOUND",
          "Edge not found or revision conflict.",
        );
    },

    /**
     * Finds related nodes by traversing up to 2 hops from a starting node.
     * This supports context building when the agent needs to understand
     * relationships between entities.
     */
    async findRelated(
      ownerId: Id<"user">,
      nodeType: GraphNodeType,
      nodeId: string,
      maxHops: number = 2,
    ): Promise<GraphNode[]> {
      if (maxHops < 1 || maxHops > 3)
        throw new GraphError("GRAPH_INVALID", "maxHops must be 1-3.");
      const rows = await sql<
        { node_type: string; node_id: string; edge_count: number }[]
      >`
        with recursive neighbors as (
          select to_type as node_type, to_id as node_id, 1 as hop
          from knowledge_graph_edges
          where owner_id = ${ownerId} and status = 'active'
            and from_type = ${nodeType} and from_id = ${nodeId}
          union
          select from_type, from_id, 1
          from knowledge_graph_edges
          where owner_id = ${ownerId} and status = 'active'
            and to_type = ${nodeType} and to_id = ${nodeId}
          union
          select e.to_type, e.to_id, n.hop + 1
          from knowledge_graph_edges e
          join neighbors n on e.from_type = n.node_type and e.from_id = n.node_id
          where e.owner_id = ${ownerId} and e.status = 'active'
            and n.hop < ${maxHops}
        )
        select node_type, node_id, count(*)::int as edge_count
        from neighbors
        group by node_type, node_id
        order by edge_count desc
        limit 50`;
      return rows.map((row) => ({
        type: row.node_type as GraphNodeType,
        id: row.node_id,
        label: null,
        edgeCount: row.edge_count,
      }));
    },
  };
}

export type KnowledgeGraphRepository = ReturnType<
  typeof createKnowledgeGraphRepository
>;
