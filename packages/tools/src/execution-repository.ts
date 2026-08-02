import { createHash } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";

import { asId, idSchema, newId, type Id } from "@town/contracts";
import { verifyRuntimeLeaseInTransaction } from "@town/runtime";

import { evaluatePolicy } from "./policy.js";
import {
  approvalStateSchema,
  toolCallStatusSchema,
  type ApprovalRequest,
  type PolicyInput,
  type ToolCall,
} from "./types.js";

const jsonObjectSchema = z.record(z.string(), z.json());

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export class ToolExecutionError extends Error {
  constructor(
    readonly code:
      | "RUN_NOT_FOUND"
      | "RUN_STATE_CONFLICT"
      | "ACCOUNT_NOT_FOUND"
      | "TOOL_BINDING_NOT_FOUND"
      | "TOOL_CALL_NOT_FOUND"
      | "APPROVAL_NOT_FOUND"
      | "IDEMPOTENCY_CONFLICT"
      | "APPROVAL_STATE_CONFLICT"
      | "APPROVAL_REVISION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

interface ToolCallRow {
  id: string;
  owner_id: string;
  session_id: string;
  run_id: string;
  agent_version_id: string;
  tool_definition_id: string;
  policy_decision_id: string;
  step_key: string;
  argument_hash: Buffer;
  request_fingerprint: Buffer;
  arguments: Record<string, unknown>;
  status: ToolCall["status"];
  approval_request_id: string | null;
  created_at: Date;
}

interface ApprovalRow {
  id: string;
  owner_id: string;
  session_id: string;
  run_id: string;
  tool_call_id: string;
  argument_hash: Buffer;
  arguments: Record<string, unknown>;
  state: ApprovalRequest["state"];
  revision: number;
  expires_at: Date | null;
  decided_at: Date | null;
  decided_by: string | null;
  decision_note: string | null;
}

function safeCall(row: ToolCallRow): ToolCall {
  return {
    id: asId<"tool-call">(row.id),
    ownerId: asId<"user">(row.owner_id),
    sessionId: asId<"runtime-session">(row.session_id),
    runId: asId<"session-run">(row.run_id),
    agentVersionId: asId<"agent-version">(row.agent_version_id),
    toolDefinitionId: asId<"tool-definition">(row.tool_definition_id),
    policyDecisionId: asId<"policy-decision">(row.policy_decision_id),
    stepKey: row.step_key,
    argumentHash: row.argument_hash.toString("hex"),
    arguments: row.arguments,
    status: toolCallStatusSchema.parse(row.status),
    approvalRequestId:
      row.approval_request_id === null
        ? null
        : asId<"approval-request">(row.approval_request_id),
    createdAt: row.created_at,
  };
}

function safeApproval(row: ApprovalRow): ApprovalRequest {
  return {
    id: asId<"approval-request">(row.id),
    ownerId: asId<"user">(row.owner_id),
    sessionId: asId<"runtime-session">(row.session_id),
    runId: asId<"session-run">(row.run_id),
    toolCallId: asId<"tool-call">(row.tool_call_id),
    argumentHash: row.argument_hash.toString("hex"),
    arguments: row.arguments,
    state: approvalStateSchema.parse(row.state),
    revision: row.revision,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by === null ? null : asId<"user">(row.decided_by),
    decisionNote: row.decision_note,
  };
}

async function appendToolEvents(
  transaction: TransactionSql,
  input: {
    ownerId: string;
    sessionId: string;
    runId: string;
    events: Array<{ kind: string; payload: Record<string, unknown> }>;
  },
): Promise<void> {
  const [allocation] = await transaction<{ last_event_sequence: number }[]>`
    update runtime_sessions
    set last_event_sequence = last_event_sequence + ${input.events.length},
        revision = revision + 1, updated_at = clock_timestamp()
    where owner_id = ${input.ownerId} and id = ${input.sessionId}
    returning last_event_sequence
  `;
  if (allocation === undefined) {
    throw new ToolExecutionError("RUN_NOT_FOUND", "The Session was not found.");
  }
  const first = allocation.last_event_sequence - input.events.length + 1;
  for (const [index, event] of input.events.entries()) {
    await transaction`
      insert into session_events (
        id, owner_id, session_id, run_id, sequence, kind, payload
      ) values (
        ${newId<"session-event">()}, ${input.ownerId}, ${input.sessionId},
        ${input.runId}, ${first + index}, ${event.kind},
        ${transaction.json(JSON.parse(canonicalJson(event.payload)))}
      )
    `;
  }
}

export function createToolExecutionRepository(sql: Sql) {
  async function getCall(
    ownerId: Id<"user">,
    toolCallId: Id<"tool-call">,
  ): Promise<ToolCall> {
    const [row] = await sql<ToolCallRow[]>`
      select id, owner_id, session_id, run_id, agent_version_id,
        tool_definition_id, policy_decision_id, step_key, argument_hash,
        request_fingerprint, arguments, status, approval_request_id, created_at
      from tool_calls where owner_id = ${ownerId} and id = ${toolCallId}
    `;
    if (row === undefined) {
      throw new ToolExecutionError(
        "TOOL_CALL_NOT_FOUND",
        "The ToolCall was not found.",
      );
    }
    return safeCall(row);
  }

  async function getApproval(
    ownerId: Id<"user">,
    approvalId: Id<"approval-request">,
  ): Promise<ApprovalRequest> {
    const [row] = await sql<ApprovalRow[]>`
      select id, owner_id, session_id, run_id, tool_call_id, argument_hash,
        arguments, state, revision, expires_at, decided_at, decided_by,
        decision_note
      from approval_requests
      where owner_id = ${ownerId} and id = ${approvalId}
    `;
    if (row === undefined) {
      throw new ToolExecutionError(
        "APPROVAL_NOT_FOUND",
        "The Approval was not found.",
      );
    }
    return safeApproval(row);
  }

  async function propose(input: {
    ownerId: Id<"user">;
    sessionId: Id<"runtime-session">;
    runId: Id<"session-run">;
    leaseToken: string;
    agentVersionId: Id<"agent-version">;
    toolDefinitionId: Id<"tool-definition">;
    accountId?: Id<"connected-account"> | null;
    stepKey: string;
    idempotencyKey: string;
    arguments: Record<string, unknown>;
    policy: PolicyInput;
    approvalExpiresAt?: Date | null;
  }): Promise<{
    toolCall: ToolCall;
    approval: ApprovalRequest | null;
    replayed: boolean;
  }> {
    const value = z
      .object({
        ownerId: idSchema,
        sessionId: idSchema,
        runId: idSchema,
        leaseToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        agentVersionId: idSchema,
        toolDefinitionId: idSchema,
        accountId: idSchema.nullable().optional(),
        stepKey: z.string().trim().min(1).max(200),
        idempotencyKey: z.string().trim().min(1).max(500),
        arguments: jsonObjectSchema,
        policy: z.object({
          sessionMode: z.string(),
          routineMode: z.string(),
          perToolOverride: z.string().nullable(),
          sideEffect: z.string(),
          dataSensitivity: z.string(),
          inputTrust: z.string(),
          targetIsSelf: z.boolean(),
          targetIsTrusted: z.boolean(),
          accountBound: z.boolean(),
        }),
        approvalExpiresAt: z.date().nullable().optional(),
      })
      .strict()
      .parse(input);
    const argumentHash = hash(canonicalJson(value.arguments));
    const idempotencyHash = hash(value.idempotencyKey);
    const result = await sql.begin(async (transaction) => {
      const lease = await verifyRuntimeLeaseInTransaction(transaction, {
        runId: asId<"session-run">(value.runId),
        leaseToken: value.leaseToken,
      });
      if (
        lease.owner_id !== value.ownerId ||
        lease.session_id !== value.sessionId
      ) {
        throw new ToolExecutionError("RUN_NOT_FOUND", "The Run was not found.");
      }
      const [run] = await transaction<{ id: string; state: string }[]>`
        select id, state from session_runs
        where owner_id = ${value.ownerId} and session_id = ${value.sessionId}
          and id = ${value.runId}
        for update
      `;
      if (run === undefined) {
        throw new ToolExecutionError("RUN_NOT_FOUND", "The Run was not found.");
      }
      if (run.state !== "running") {
        throw new ToolExecutionError(
          "RUN_STATE_CONFLICT",
          "Tool proposals require a running Run.",
        );
      }
      const [toolContext] = await transaction<
        {
          session_agent_version_id: string;
          approval_mode:
            "respect_tool_setting" | "require_approval" | "autonomous";
          default_approval_mode:
            "respect_tool_setting" | "require_approval" | "autonomous";
          mode_override:
            "read_only" | "approval_required" | "autonomous" | null;
          side_effect: PolicyInput["sideEffect"];
          data_sensitivity: PolicyInput["dataSensitivity"];
          account_binding: "required" | "optional" | "none";
          account_scope: string[];
        }[]
      >`
        select session.agent_version_id as session_agent_version_id,
          thread.approval_mode,
          (version.snapshot->>'defaultApprovalMode') as default_approval_mode,
          binding.mode_override, binding.account_scope, tool.side_effect,
          tool.data_sensitivity, tool.account_binding
        from runtime_sessions session
        join threads thread
          on thread.owner_id = session.owner_id and thread.id = session.thread_id
        join agent_versions version
          on version.owner_id = session.owner_id and version.id = session.agent_version_id
        join agent_tool_bindings binding
          on binding.owner_id = session.owner_id
          and binding.agent_version_id = session.agent_version_id
          and binding.tool_definition_id = ${value.toolDefinitionId}
        join tool_definitions tool
          on tool.owner_id = binding.owner_id and tool.id = binding.tool_definition_id
        where session.owner_id = ${value.ownerId}
          and session.id = ${value.sessionId}
          and tool.enabled = true
      `;
      if (
        toolContext === undefined ||
        toolContext.session_agent_version_id !== value.agentVersionId
      ) {
        throw new ToolExecutionError(
          "TOOL_BINDING_NOT_FOUND",
          "The Tool is not bound to the Session AgentVersion.",
        );
      }
      const [binding] = await transaction<{ id: string }[]>`
        select binding.id
        from agent_tool_bindings binding
        join tool_definitions tool
          on tool.owner_id = binding.owner_id and tool.id = binding.tool_definition_id
        where binding.owner_id = ${value.ownerId}
          and binding.agent_version_id = ${value.agentVersionId}
          and binding.tool_definition_id = ${value.toolDefinitionId}
          and tool.enabled = true
      `;
      if (binding === undefined) {
        throw new ToolExecutionError(
          "TOOL_BINDING_NOT_FOUND",
          "The Tool is not bound to this AgentVersion.",
        );
      }
      const sessionMode =
        toolContext.approval_mode === "require_approval"
          ? "ask_before_changes"
          : toolContext.approval_mode === "autonomous"
            ? "allow_all"
            : "allow_safe_actions";
      const routineMode =
        toolContext.default_approval_mode === "require_approval"
          ? "approval_required"
          : "autonomous";
      const accountId = value.accountId ?? null;
      if (
        (toolContext.account_binding === "required" && accountId === null) ||
        (toolContext.account_binding === "none" && accountId !== null)
      ) {
        throw new ToolExecutionError(
          "ACCOUNT_NOT_FOUND",
          "The Tool account binding is invalid.",
        );
      }
      if (accountId !== null) {
        const [account] = await transaction<{ id: string }[]>`
          select id from connected_accounts
          where owner_id = ${value.ownerId} and id = ${accountId}
            and is_active = true
        `;
        if (
          account === undefined ||
          (toolContext.account_scope.length > 0 &&
            !toolContext.account_scope.includes(accountId))
        ) {
          throw new ToolExecutionError(
            "ACCOUNT_NOT_FOUND",
            "The connected Account is unavailable for this Tool.",
          );
        }
      }
      const derivedPolicy: PolicyInput = {
        sessionMode,
        routineMode,
        perToolOverride: toolContext.mode_override,
        sideEffect: toolContext.side_effect,
        dataSensitivity: toolContext.data_sensitivity,
        inputTrust: value.policy.inputTrust as PolicyInput["inputTrust"],
        targetIsSelf: value.policy.targetIsSelf,
        targetIsTrusted: value.policy.targetIsTrusted,
        accountBound: accountId !== null,
      };
      const policyResult = evaluatePolicy(derivedPolicy);
      const requestFingerprint = hash(
        canonicalJson({
          agentVersionId: value.agentVersionId,
          toolDefinitionId: value.toolDefinitionId,
          stepKey: value.stepKey,
          accountId: value.accountId ?? null,
          policy: derivedPolicy,
          approvalExpiresAt: value.approvalExpiresAt ?? null,
          arguments: value.arguments,
        }),
      );
      const [existing] = await transaction<ToolCallRow[]>`
        select id, owner_id, session_id, run_id, agent_version_id,
        tool_definition_id, policy_decision_id, step_key, argument_hash,
          request_fingerprint, arguments, status, approval_request_id, created_at
        from tool_calls
        where owner_id = ${value.ownerId} and run_id = ${value.runId}
          and step_key = ${value.stepKey}
          and idempotency_key_hash = ${idempotencyHash}
      `;
      if (existing !== undefined) {
        if (!existing.request_fingerprint.equals(requestFingerprint)) {
          throw new ToolExecutionError(
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key was reused for different tool semantics.",
          );
        }
        return {
          callId: existing.id,
          approvalId:
            existing.approval_request_id === null
              ? null
              : asId<"approval-request">(existing.approval_request_id),
          replayed: true,
        };
      }
      const policyDecisionId = newId<"policy-decision">();
      const callId = newId<"tool-call">();
      const callStatus =
        policyResult.decision === "allow"
          ? "allowed"
          : policyResult.decision === "approval_required"
            ? "waiting_approval"
            : "denied";
      await transaction`
        insert into tool_calls (
          id, owner_id, session_id, run_id, agent_version_id,
          tool_definition_id, policy_decision_id, step_key,
          idempotency_key_hash, argument_hash, request_fingerprint,
          arguments, status
        ) values (
          ${callId}, ${value.ownerId}, ${value.sessionId}, ${value.runId},
          ${value.agentVersionId}, ${value.toolDefinitionId}, ${policyDecisionId},
          ${value.stepKey}, ${idempotencyHash}, ${argumentHash},
          ${requestFingerprint},
          ${transaction.json(value.arguments)}, ${callStatus}
        )
      `;
      await transaction`
        insert into policy_decisions (
          id, owner_id, session_id, run_id, tool_call_id, decision,
          session_mode, routine_mode, per_tool_override, side_effect,
          data_sensitivity, input_trust, target_is_self, target_is_trusted,
          account_id, risk_flags, rationale
        ) values (
          ${policyDecisionId}, ${value.ownerId}, ${value.sessionId}, ${value.runId},
          ${callId}, ${policyResult.decision}, ${derivedPolicy.sessionMode},
          ${derivedPolicy.routineMode}, ${derivedPolicy.perToolOverride},
          ${derivedPolicy.sideEffect}, ${derivedPolicy.dataSensitivity},
          ${derivedPolicy.inputTrust}, ${derivedPolicy.targetIsSelf},
          ${derivedPolicy.targetIsTrusted}, ${accountId},
          ${transaction.json(policyResult.riskFlags)},
          ${policyResult.rationale}
        )
      `;
      let approvalId: Id<"approval-request"> | null = null;
      const events: Array<{
        kind: string;
        payload: Record<string, unknown>;
      }> = [
        {
          kind: "tool_call_proposed",
          payload: { toolCallId: callId, stepKey: value.stepKey },
        },
        {
          kind: "policy_decided",
          payload: {
            toolCallId: callId,
            decision: policyResult.decision,
            riskFlags: policyResult.riskFlags,
          },
        },
      ];
      if (policyResult.decision === "approval_required") {
        approvalId = newId<"approval-request">();
        await transaction`
          insert into approval_requests (
            id, owner_id, session_id, run_id, tool_call_id,
            argument_hash, arguments, expires_at
          ) values (
            ${approvalId}, ${value.ownerId}, ${value.sessionId}, ${value.runId},
            ${callId}, ${argumentHash}, ${transaction.json(value.arguments)},
            ${value.approvalExpiresAt ?? null}
          )
        `;
        await transaction`
          update tool_calls set approval_request_id = ${approvalId}
          where owner_id = ${value.ownerId} and id = ${callId}
        `;
        events.push({
          kind: "approval_requested",
          payload: { toolCallId: callId, approvalRequestId: approvalId },
        });
      }
      await appendToolEvents(transaction, {
        ownerId: value.ownerId,
        sessionId: value.sessionId,
        runId: value.runId,
        events,
      });
      return { callId, approvalId, replayed: false };
    });
    const toolCall = await getCall(
      asId<"user">(value.ownerId),
      asId<"tool-call">(result.callId),
    );
    const approval =
      result.approvalId === null
        ? null
        : await getApproval(
            asId<"user">(value.ownerId),
            asId<"approval-request">(result.approvalId),
          );
    return { toolCall, approval, replayed: result.replayed };
  }

  async function decideApproval(input: {
    ownerId: Id<"user">;
    approvalId: Id<"approval-request">;
    expectedRevision: number;
    decidedBy: Id<"user">;
    decision: "approve" | "reject";
    note?: string;
  }): Promise<{ approval: ApprovalRequest; toolCall: ToolCall }> {
    const value = z
      .object({
        ownerId: idSchema,
        approvalId: idSchema,
        expectedRevision: z.number().int().positive(),
        decidedBy: idSchema,
        decision: z.enum(["approve", "reject"]),
        note: z.string().trim().max(2_000).optional(),
      })
      .strict()
      .parse(input);
    const result = await sql.begin(async (transaction) => {
      const [approval] = await transaction<ApprovalRow[]>`
        select id, owner_id, session_id, run_id, tool_call_id, argument_hash,
          arguments, state, revision, expires_at, decided_at, decided_by,
          decision_note
        from approval_requests
        where owner_id = ${value.ownerId} and id = ${value.approvalId}
        for update
      `;
      if (approval === undefined)
        throw new ToolExecutionError(
          "APPROVAL_NOT_FOUND",
          "The Approval was not found.",
        );
      if (approval.revision !== value.expectedRevision)
        throw new ToolExecutionError(
          "APPROVAL_REVISION_CONFLICT",
          "The Approval revision is stale.",
        );
      if (approval.state !== "pending")
        throw new ToolExecutionError(
          "APPROVAL_STATE_CONFLICT",
          "The Approval is no longer pending.",
        );
      const [expired] = await transaction<{ id: string }[]>`
        update approval_requests
        set state = 'expired', revision = revision + 1,
            decided_at = clock_timestamp()
        where owner_id = ${value.ownerId} and id = ${value.approvalId}
          and state = 'pending' and revision = ${value.expectedRevision}
          and expires_at is not null and expires_at <= clock_timestamp()
        returning id
      `;
      if (expired !== undefined) {
        await transaction`
          update tool_calls set status = 'denied'
          where owner_id = ${value.ownerId} and id = ${approval.tool_call_id}
        `;
        await appendToolEvents(transaction, {
          ownerId: value.ownerId,
          sessionId: approval.session_id,
          runId: approval.run_id,
          events: [
            {
              kind: "approval_resolved",
              payload: {
                approvalRequestId: approval.id,
                decision: "expired",
                toolCallId: approval.tool_call_id,
              },
            },
          ],
        });
        return {
          approvalId: approval.id,
          callId: approval.tool_call_id,
          expired: true,
        };
      }
      const [call] = await transaction<ToolCallRow[]>`
        select id, owner_id, session_id, run_id, agent_version_id,
          tool_definition_id, policy_decision_id, step_key, argument_hash,
          request_fingerprint, arguments, status, approval_request_id, created_at
        from tool_calls where owner_id = ${value.ownerId} and id = ${approval.tool_call_id}
        for update
      `;
      if (call === undefined)
        throw new ToolExecutionError(
          "TOOL_CALL_NOT_FOUND",
          "The ToolCall was not found.",
        );
      const state = value.decision === "approve" ? "approved" : "rejected";
      const callStatus = value.decision === "approve" ? "approved" : "denied";
      await transaction`
        update approval_requests
        set state = ${state}, revision = revision + 1,
            decided_at = clock_timestamp(), decided_by = ${value.decidedBy},
            decision_note = ${value.note ?? null}
        where owner_id = ${value.ownerId} and id = ${value.approvalId}
          and state = 'pending' and revision = ${value.expectedRevision}
      `;
      await transaction`
        update tool_calls set status = ${callStatus}
        where owner_id = ${value.ownerId} and id = ${call.id}
      `;
      await appendToolEvents(transaction, {
        ownerId: value.ownerId,
        sessionId: approval.session_id,
        runId: approval.run_id,
        events: [
          {
            kind: "approval_resolved",
            payload: {
              approvalRequestId: approval.id,
              decision: value.decision,
              toolCallId: call.id,
            },
          },
        ],
      });
      return { approvalId: approval.id, callId: call.id, expired: false };
    });
    if (result.expired) {
      throw new ToolExecutionError(
        "APPROVAL_STATE_CONFLICT",
        "The Approval has expired.",
      );
    }
    return {
      approval: await getApproval(
        asId<"user">(value.ownerId),
        asId<"approval-request">(result.approvalId),
      ),
      toolCall: await getCall(
        asId<"user">(value.ownerId),
        asId<"tool-call">(result.callId),
      ),
    };
  }

  async function expireApproval(input: {
    ownerId: Id<"user">;
    approvalId: Id<"approval-request">;
    expectedRevision: number;
  }): Promise<{ approval: ApprovalRequest; toolCall: ToolCall }> {
    const value = z
      .object({
        ownerId: idSchema,
        approvalId: idSchema,
        expectedRevision: z.number().int().positive(),
      })
      .strict()
      .parse(input);
    const result = await sql.begin(async (transaction) => {
      const [approval] = await transaction<ApprovalRow[]>`
        select id, owner_id, session_id, run_id, tool_call_id, argument_hash,
          arguments, state, revision, expires_at, decided_at, decided_by,
          decision_note
        from approval_requests
        where owner_id = ${value.ownerId} and id = ${value.approvalId}
        for update
      `;
      if (approval === undefined) {
        throw new ToolExecutionError(
          "APPROVAL_NOT_FOUND",
          "The Approval was not found.",
        );
      }
      if (approval.revision !== value.expectedRevision) {
        throw new ToolExecutionError(
          "APPROVAL_REVISION_CONFLICT",
          "The Approval revision is stale.",
        );
      }
      if (approval.state !== "pending") {
        throw new ToolExecutionError(
          "APPROVAL_STATE_CONFLICT",
          "The Approval is no longer pending.",
        );
      }
      const [updated] = await transaction<{ id: string }[]>`
        update approval_requests
        set state = 'expired', revision = revision + 1,
            decided_at = clock_timestamp()
        where owner_id = ${value.ownerId} and id = ${value.approvalId}
          and state = 'pending' and revision = ${value.expectedRevision}
          and expires_at is not null and expires_at <= clock_timestamp()
        returning id
      `;
      if (updated === undefined) {
        throw new ToolExecutionError(
          "APPROVAL_STATE_CONFLICT",
          "The Approval has not expired.",
        );
      }
      const [call] = await transaction<ToolCallRow[]>`
        select id, owner_id, session_id, run_id, agent_version_id,
          tool_definition_id, policy_decision_id, step_key, argument_hash,
          request_fingerprint, arguments, status, approval_request_id, created_at
        from tool_calls where owner_id = ${value.ownerId} and id = ${approval.tool_call_id}
        for update
      `;
      if (call === undefined)
        throw new ToolExecutionError(
          "TOOL_CALL_NOT_FOUND",
          "The ToolCall was not found.",
        );
      await transaction`
        update tool_calls set status = 'denied'
        where owner_id = ${value.ownerId} and id = ${call.id}
      `;
      await appendToolEvents(transaction, {
        ownerId: value.ownerId,
        sessionId: approval.session_id,
        runId: approval.run_id,
        events: [
          {
            kind: "approval_resolved",
            payload: {
              approvalRequestId: approval.id,
              decision: "expired",
              toolCallId: call.id,
            },
          },
        ],
      });
      return { approvalId: approval.id, callId: call.id };
    });
    return {
      approval: await getApproval(
        asId<"user">(value.ownerId),
        asId<"approval-request">(result.approvalId),
      ),
      toolCall: await getCall(
        asId<"user">(value.ownerId),
        asId<"tool-call">(result.callId),
      ),
    };
  }

  return { getCall, getApproval, propose, decideApproval, expireApproval };
}

export type ToolExecutionRepository = ReturnType<
  typeof createToolExecutionRepository
>;
