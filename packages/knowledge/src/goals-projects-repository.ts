import type { Sql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";

import { createRevisionRepository } from "./revision-repository.js";
import {
  authorTypeSchema,
  citationInputSchema,
  snapshotSchema,
  type AuthorType,
  type CitationInput,
  type JsonValue,
} from "./types.js";

export const goalStatusSchema = z.enum([
  "active",
  "completed",
  "paused",
  "archived",
]);
export const projectStatusSchema = z.enum([
  "active",
  "on_hold",
  "completed",
  "archived",
]);

export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

const goalInputSchema = z
  .object({
    ownerId: idSchema,
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(10_000).default(""),
    status: goalStatusSchema.default("active"),
    metadata: snapshotSchema.default({}),
    authorType: authorTypeSchema,
    citations: z.array(citationInputSchema),
  })
  .strict();

const goalUpdateSchema = goalInputSchema.extend({
  id: idSchema,
  expectedRevision: z.number().int().positive(),
});

const projectInputSchema = z
  .object({
    ownerId: idSchema,
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(10_000).default(""),
    status: projectStatusSchema.default("active"),
    goalId: idSchema.optional(),
    metadata: snapshotSchema.default({}),
    authorType: authorTypeSchema,
    citations: z.array(citationInputSchema),
  })
  .strict();

const projectUpdateSchema = projectInputSchema.extend({
  id: idSchema,
  expectedRevision: z.number().int().positive(),
});

interface GoalRow {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  status: string;
  metadata: Record<string, JsonValue>;
  current_revision: number;
  created_at: Date;
  updated_at: Date;
}

interface ProjectRow {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  status: string;
  goal_id: string | null;
  metadata: Record<string, JsonValue>;
  current_revision: number;
  created_at: Date;
  updated_at: Date;
}

export interface Goal {
  id: Id<"goal">;
  ownerId: Id<"user">;
  title: string;
  description: string;
  status: GoalStatus;
  metadata: Record<string, JsonValue>;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: Id<"project">;
  ownerId: Id<"user">;
  title: string;
  description: string;
  status: ProjectStatus;
  goalId: Id<"goal"> | null;
  metadata: Record<string, JsonValue>;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

function mapGoalRow(row: GoalRow): Goal {
  return {
    id: asId<"goal">(row.id),
    ownerId: asId<"user">(row.owner_id),
    title: row.title,
    description: row.description,
    status: row.status as GoalStatus,
    metadata: row.metadata,
    revision: row.current_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProjectRow(row: ProjectRow): Project {
  return {
    id: asId<"project">(row.id),
    ownerId: asId<"user">(row.owner_id),
    title: row.title,
    description: row.description,
    status: row.status as ProjectStatus,
    goalId: row.goal_id === null ? null : asId<"goal">(row.goal_id),
    metadata: row.metadata,
    revision: row.current_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GoalError extends Error {
  constructor(
    readonly code:
      | "GOAL_NOT_FOUND"
      | "GOAL_CONFLICT"
      | "GOAL_FORBIDDEN"
      | "GOAL_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "GoalError";
  }
}

export class ProjectError extends Error {
  constructor(
    readonly code:
      | "PROJECT_NOT_FOUND"
      | "PROJECT_CONFLICT"
      | "PROJECT_FORBIDDEN"
      | "PROJECT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "ProjectError";
  }
}

export function createGoalsProjectsRepository(sql: Sql) {
  const revisions = createRevisionRepository(sql);

  return {
    /* ── Goals ── */

    async createGoal(input: z.infer<typeof goalInputSchema>): Promise<Goal> {
      const value = goalInputSchema.parse(input);
      const id = newId<"goal">();
      const rows = await sql<GoalRow[]>`
        insert into goals (id, owner_id, title, description, status, metadata, current_revision)
        values (${id}, ${value.ownerId}, ${value.title}, ${value.description},
                ${value.status}, ${sql.json(value.metadata)}, 1)
        returning *`;
      const goal = mapGoalRow(rows[0]!);
      await revisions.createInitial({
        ownerId: asId<"user">(value.ownerId),
        resourceType: "goal",
        resourceId: id,
        authorType: value.authorType as AuthorType,
        snapshot: {
          title: value.title,
          description: value.description,
          status: value.status,
          metadata: value.metadata,
        },
        changeReason: "Goal created",
        citations: value.citations as CitationInput[],
      });
      return goal;
    },

    async getGoal(ownerId: Id<"user">, id: Id<"goal">): Promise<Goal> {
      const rows = await sql<GoalRow[]>`
        select * from goals where id = ${id} and owner_id = ${ownerId}`;
      if (rows.length === 0 || rows[0] === undefined) throw new GoalError("GOAL_NOT_FOUND", "Goal not found.");
      return mapGoalRow(rows[0]!);
    },

    async listGoals(ownerId: Id<"user">): Promise<Goal[]> {
      const rows = await sql<GoalRow[]>`
        select * from goals where owner_id = ${ownerId}
        order by created_at desc`;
      return rows.map(mapGoalRow);
    },

    async updateGoal(input: z.infer<typeof goalUpdateSchema>): Promise<Goal> {
      const value = goalUpdateSchema.parse(input);
      const rows = await sql<GoalRow[]>`
        update goals set title = ${value.title}, description = ${value.description},
          status = ${value.status}, metadata = ${sql.json(value.metadata)},
          current_revision = current_revision + 1, updated_at = now()
        where id = ${value.id} and owner_id = ${value.ownerId}
          and current_revision = ${value.expectedRevision}
        returning *`;
      if (rows.length === 0 || rows[0] === undefined) throw new GoalError("GOAL_CONFLICT", "Goal revision conflict.");
      const goal = mapGoalRow(rows[0]!);
      await revisions.append({
        ownerId: asId<"user">(value.ownerId),
        resourceType: "goal",
        resourceId: goal.id,
        expectedRevision: value.expectedRevision,
        authorType: value.authorType as AuthorType,
        snapshot: {
          title: value.title,
          description: value.description,
          status: value.status,
          metadata: value.metadata,
        },
        changeReason: "Goal updated",
        citations: value.citations as CitationInput[],
      });
      return goal;
    },

    /* ── Projects ── */

    async createProject(
      input: z.infer<typeof projectInputSchema>,
    ): Promise<Project> {
      const value = projectInputSchema.parse(input);
      const id = newId<"project">();
      const rows = await sql<ProjectRow[]>`
        insert into projects (id, owner_id, title, description, status, goal_id, metadata, current_revision)
        values (${id}, ${value.ownerId}, ${value.title}, ${value.description},
                ${value.status}, ${value.goalId ?? null}, ${sql.json(value.metadata)}, 1)
        returning *`;
      const project = mapProjectRow(rows[0]!);
      await revisions.createInitial({
        ownerId: asId<"user">(value.ownerId),
        resourceType: "project",
        resourceId: id,
        authorType: value.authorType as AuthorType,
        snapshot: {
          title: value.title,
          description: value.description,
          status: value.status,
          goalId: value.goalId ?? null,
          metadata: value.metadata,
        },
        changeReason: "Project created",
        citations: value.citations as CitationInput[],
      });
      return project;
    },

    async getProject(
      ownerId: Id<"user">,
      id: Id<"project">,
    ): Promise<Project> {
      const rows = await sql<ProjectRow[]>`
        select * from projects where id = ${id} and owner_id = ${ownerId}`;
      if (rows.length === 0)
        throw new ProjectError("PROJECT_NOT_FOUND", "Project not found.");
      return mapProjectRow(rows[0]!);
    },

    async listProjects(ownerId: Id<"user">): Promise<Project[]> {
      const rows = await sql<ProjectRow[]>`
        select * from projects where owner_id = ${ownerId}
        order by created_at desc`;
      return rows.map(mapProjectRow);
    },

    async listProjectsByGoal(
      ownerId: Id<"user">,
      goalId: Id<"goal">,
    ): Promise<Project[]> {
      const rows = await sql<ProjectRow[]>`
        select * from projects where owner_id = ${ownerId} and goal_id = ${goalId}
        order by created_at desc`;
      return rows.map(mapProjectRow);
    },

    async updateProject(
      input: z.infer<typeof projectUpdateSchema>,
    ): Promise<Project> {
      const value = projectUpdateSchema.parse(input);
      const rows = await sql<ProjectRow[]>`
        update projects set title = ${value.title}, description = ${value.description},
          status = ${value.status}, goal_id = ${value.goalId ?? null},
          metadata = ${sql.json(value.metadata)},
          current_revision = current_revision + 1, updated_at = now()
        where id = ${value.ownerId} and owner_id = ${value.ownerId}
          and current_revision = ${value.expectedRevision}
        returning *`;
      if (rows.length === 0)
        throw new ProjectError("PROJECT_CONFLICT", "Project revision conflict.");
      const project = mapProjectRow(rows[0]!);
      await revisions.append({
        ownerId: asId<"user">(value.ownerId),
        resourceType: "project",
        resourceId: project.id,
        expectedRevision: value.expectedRevision,
        authorType: value.authorType as AuthorType,
        snapshot: {
          title: value.title,
          description: value.description,
          status: value.status,
          goalId: value.goalId ?? null,
          metadata: value.metadata,
        },
        changeReason: "Project updated",
        citations: value.citations as CitationInput[],
      });
      return project;
    },
  };
}

export type GoalsProjectsRepository = ReturnType<
  typeof createGoalsProjectsRepository
>;
