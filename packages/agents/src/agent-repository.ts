import { createHash } from "node:crypto";

import type { Sql } from "postgres";
import { z } from "zod";

import {
  asId,
  decodeCursor,
  encodeCursor,
  idSchema,
  newId,
  type Id,
} from "@town/contracts";

import { AgentError } from "./errors.js";
import {
  agentVersionSnapshotSchema,
  type AgentVersion,
  type AgentVersionPage,
  type PersonalAgent,
} from "./types.js";

const createPersonalSchema = agentVersionSnapshotSchema.extend({
  ownerId: idSchema,
});
const publishPersonalSchema = agentVersionSnapshotSchema.extend({
  ownerId: idSchema,
  expectedRevision: z.number().int().positive(),
  changeReason: z.string().trim().min(1).max(500).optional(),
});
const listVersionsSchema = z
  .object({
    ownerId: idSchema,
    agentId: idSchema,
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
const agentCursorKeySchema = z
  .object({
    fingerprint: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict();

interface AgentRow {
  id: string;
  owner_id: string;
  kind: "personal";
  status: "active" | "disabled";
  revision: number;
  created_at: Date;
  updated_at: Date;
  version_id: string;
  version_agent_id: string;
  version: number;
  snapshot: unknown;
  change_reason: string | null;
  created_by: "user" | "system";
  version_created_at: Date;
}

interface VersionRow {
  id: string;
  agent_id: string;
  version: number;
  snapshot: unknown;
  change_reason: string | null;
  created_by: "user" | "system";
  created_at: Date;
}

interface LockedAgentRow {
  id: string;
  revision: number;
}

function safeVersion(row: VersionRow): AgentVersion {
  return {
    id: asId<"agent-version">(row.id),
    agentId: asId<"agent">(row.agent_id),
    version: row.version,
    snapshot: agentVersionSnapshotSchema.parse(row.snapshot),
    changeReason: row.change_reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function safeAgent(row: AgentRow): PersonalAgent {
  return {
    id: asId<"agent">(row.id),
    ownerId: asId<"user">(row.owner_id),
    kind: row.kind,
    status: row.status,
    revision: row.revision,
    activeVersion: safeVersion({
      id: row.version_id,
      agent_id: row.version_agent_id,
      version: row.version,
      snapshot: row.snapshot,
      change_reason: row.change_reason,
      created_by: row.created_by,
      created_at: row.version_created_at,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isConstraint(error: unknown, name: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "constraint_name" in error &&
    error.constraint_name === name
  );
}

function cursorFingerprint(ownerId: string, agentId: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ ownerId, agentId }))
    .digest("base64url");
}

function safeSnapshot(value: {
  displayName: string;
  instructions: string;
  defaultApprovalMode:
    "respect_tool_setting" | "require_approval" | "autonomous";
}) {
  return agentVersionSnapshotSchema.parse({
    displayName: value.displayName,
    instructions: value.instructions,
    defaultApprovalMode: value.defaultApprovalMode,
  });
}

export function createAgentRepository(sql: Sql) {
  async function getPersonal(ownerId: Id<"user">): Promise<PersonalAgent> {
    const parsedOwnerId = asId<"user">(ownerId);
    const [row] = await sql<AgentRow[]>`
      select
        agent.id, agent.owner_id, agent.kind, agent.status, agent.revision,
        agent.created_at, agent.updated_at,
        version.id as version_id, version.agent_id as version_agent_id,
        version.version, version.snapshot, version.change_reason,
        version.created_by, version.created_at as version_created_at
      from agents agent
      join agent_versions version
        on version.owner_id = agent.owner_id
        and version.agent_id = agent.id
        and version.id = agent.active_version_id
      where agent.owner_id = ${parsedOwnerId}
        and agent.kind = 'personal' and agent.status = 'active'
    `;
    if (row === undefined) {
      throw new AgentError("AGENT_NOT_FOUND", "The Agent was not found.");
    }
    return safeAgent(row);
  }

  async function createPersonal(
    input: z.input<typeof createPersonalSchema>,
  ): Promise<PersonalAgent> {
    const value = createPersonalSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const agentId = newId<"agent">();
    const versionId = newId<"agent-version">();
    const snapshot = safeSnapshot(value);

    try {
      await sql.begin(async (transaction) => {
        await transaction`
          insert into agents (id, owner_id, kind, revision, status)
          values (${agentId}, ${ownerId}, 'personal', 1, 'active')
        `;
        await transaction`
          insert into agent_versions (
            id, owner_id, agent_id, version, snapshot, created_by
          ) values (
            ${versionId}, ${ownerId}, ${agentId}, 1,
            ${transaction.json(snapshot)}, 'user'
          )
        `;
        const updated = await transaction`
          update agents set active_version_id = ${versionId}
          where id = ${agentId} and owner_id = ${ownerId}
        `;
        if (updated.count !== 1) {
          throw new Error("Personal Agent activation returned no row.");
        }
      });
    } catch (error: unknown) {
      if (isConstraint(error, "agents_one_personal_per_owner_idx")) {
        throw new AgentError(
          "PERSONAL_AGENT_ALREADY_EXISTS",
          "A personal Agent already exists for this owner.",
        );
      }
      throw error;
    }

    return getPersonal(ownerId);
  }

  async function publishPersonal(
    input: z.input<typeof publishPersonalSchema>,
  ): Promise<PersonalAgent> {
    const value = publishPersonalSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const versionId = newId<"agent-version">();
    const snapshot = safeSnapshot(value);

    await sql.begin(async (transaction) => {
      const [agent] = await transaction<LockedAgentRow[]>`
        select id, revision from agents
        where owner_id = ${ownerId} and kind = 'personal' and status = 'active'
        for update
      `;
      if (agent === undefined) {
        throw new AgentError("AGENT_NOT_FOUND", "The Agent was not found.");
      }
      if (agent.revision !== value.expectedRevision) {
        throw new AgentError(
          "AGENT_REVISION_CONFLICT",
          "The Agent has changed since it was read.",
        );
      }

      const agentId = asId<"agent">(agent.id);
      const nextVersion = agent.revision + 1;
      await transaction`
        insert into agent_versions (
          id, owner_id, agent_id, version, snapshot, change_reason, created_by
        ) values (
          ${versionId}, ${ownerId}, ${agentId}, ${nextVersion},
          ${transaction.json(snapshot)}, ${value.changeReason ?? null}, 'user'
        )
      `;
      const updated = await transaction`
        update agents
        set active_version_id = ${versionId}, revision = revision + 1,
            updated_at = now()
        where id = ${agentId} and owner_id = ${ownerId}
          and revision = ${value.expectedRevision}
      `;
      if (updated.count !== 1) {
        throw new AgentError(
          "AGENT_REVISION_CONFLICT",
          "The Agent has changed since it was read.",
        );
      }
    });

    return getPersonal(ownerId);
  }

  async function listVersions(
    input: z.input<typeof listVersionsSchema>,
  ): Promise<AgentVersionPage> {
    const value = listVersionsSchema.parse(input);
    const ownerId = asId<"user">(value.ownerId);
    const agentId = asId<"agent">(value.agentId);
    const [owned] = await sql<{ id: string }[]>`
      select id from agents
      where id = ${agentId} and owner_id = ${ownerId}
        and kind = 'personal' and status = 'active'
    `;
    if (owned === undefined) {
      throw new AgentError("AGENT_NOT_FOUND", "The Agent was not found.");
    }

    const fingerprint = cursorFingerprint(ownerId, agentId);
    const decoded =
      value.cursor === undefined ? null : decodeCursor(value.cursor);
    const cursorKey =
      decoded === null
        ? null
        : agentCursorKeySchema.parse(JSON.parse(decoded.key));
    if (cursorKey !== null && cursorKey.fingerprint !== fingerprint) {
      throw new AgentError("AGENT_NOT_FOUND", "The Agent was not found.");
    }
    const cursorVersion = cursorKey?.version ?? 2_147_483_647;

    const rows = await sql<VersionRow[]>`
      select id, agent_id, version, snapshot, change_reason, created_by, created_at
      from agent_versions
      where owner_id = ${ownerId} and agent_id = ${agentId}
        and version < ${cursorVersion}
      order by version desc, id
      limit ${value.limit + 1}
    `;
    const hasMore = rows.length > value.limit;
    const pageRows = hasMore ? rows.slice(0, value.limit) : rows;
    const items = pageRows.map(safeVersion);
    const last = hasMore ? pageRows.at(-1) : undefined;
    const nextCursor =
      last === undefined
        ? null
        : encodeCursor({
            version: 1,
            key: JSON.stringify({ fingerprint, version: last.version }),
            id: asId(last.id),
          });
    return { items, nextCursor };
  }

  return {
    createPersonal,
    getPersonal,
    listVersions,
    publishPersonal,
  };
}

export type AgentRepository = ReturnType<typeof createAgentRepository>;
