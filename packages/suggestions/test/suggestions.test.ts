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
import { runMigrations } from "../../db/src/index.js";
import { createSuggestionRepository } from "../src/index.js";

let sql: Sql;
let ownerId: Id<"user">;

beforeAll(async () => {
  sql = postgres(inject("postgresUrl"), { max: 1 });
  await runMigrations(sql);
});
beforeEach(async () => {
  await sql`truncate table users cascade`;
  ownerId = newId<"user">();
  await sql`insert into users (id,email) values (${ownerId},'suggestions-owner@example.invalid')`;
});
afterAll(async () => sql.end());

describe("suggestion candidates", () => {
  it("derives overdue task and due routine candidates from durable state", async () => {
    const agentId = newId<"agent">();
    const versionId = newId<"agent-version">();
    const threadId = newId<"thread">();
    const taskId = newId<"task">();
    const routineId = newId<"routine-schedule">();
    await sql`insert into agents (id,owner_id,kind,revision,status) values (${agentId},${ownerId},'personal',1,'active')`;
    await sql`insert into agent_versions (id,owner_id,agent_id,version,snapshot,created_by) values (${versionId},${ownerId},${agentId},1,'{}','system')`;
    await sql`update agents set active_version_id=${versionId} where owner_id=${ownerId} and id=${agentId}`;
    await sql`insert into threads (id,owner_id,agent_id,kind,title,approval_mode,status) values (${threadId},${ownerId},${agentId},'task','Overdue task','respect_tool_setting','active')`;
    await sql`insert into tasks (id,owner_id,thread_id,title,description,status,scheduled_for) values (${taskId},${ownerId},${threadId},'Prepare brief','Read the notes','open',now()-interval '2 hours')`;
    const routineAgentId = newId<"agent">();
    const routineVersionId = newId<"agent-version">();
    await sql`insert into agents (id,owner_id,kind,revision,status) values (${routineAgentId},${ownerId},'routine',1,'active')`;
    await sql`insert into agent_versions (id,owner_id,agent_id,version,snapshot,created_by) values (${routineVersionId},${ownerId},${routineAgentId},1,'{}','system')`;
    await sql`update agents set active_version_id=${routineVersionId} where owner_id=${ownerId} and id=${routineAgentId}`;
    await sql`insert into routine_schedules (id,owner_id,agent_id,agent_version_id,name,cron,timezone,enabled,next_run_at) values (${routineId},${ownerId},${routineAgentId},${routineVersionId},'Morning brief','0 9 * * 1-5','UTC',true,now()+interval '2 hours')`;

    const repository = createSuggestionRepository(sql);
    const suggestions = await repository.refreshCandidates(ownerId);
    expect(suggestions.map((suggestion) => suggestion.kind).sort()).toEqual([
      "routine",
      "task",
    ]);
    await expect(repository.refreshCandidates(ownerId)).resolves.toHaveLength(
      2,
    );
  });
});
