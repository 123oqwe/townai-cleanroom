"use client";

import { useState } from "react";
import useSWR from "swr";

import { TownApiError, type Tool, type ToolPolicyResult } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";

export default function ToolsPage() {
  const client = useApiClient();
  const { data, error, isLoading } = useSWR<Tool[], TownApiError>(
    ["tools"],
    () => client.tools.list(),
  );

  const tools = data ?? [];
  const [toolName, setToolName] = useState("");
  const [args, setArgs] = useState("{}");
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState<ToolPolicyResult | null>(null);

  async function handleEvaluate() {
    setEvaluating(true);
    try {
      const parsed = JSON.parse(args) as Record<string, unknown>;
      const r = await client.tools.policy.evaluate({
        toolName,
        arguments: parsed,
      });
      setResult(r);
    } catch (e) {
      setResult({ decision: "error", reason: e instanceof Error ? e.message : "Invalid JSON", approvalRequired: false });
    } finally {
      setEvaluating(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Tools</h1>

      <div className="mb-6 rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}>
        <h2 className="mb-3 text-sm font-medium">Policy Evaluation</h2>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            placeholder="Tool name"
            value={toolName}
            onChange={(e) => setToolName(e.target.value)}
            className="rounded-md border p-2 text-sm"
            style={{ borderColor: "var(--panel-border)", background: "var(--background)" }}
          />
          <textarea
            placeholder="Arguments (JSON)"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            rows={4}
            className="rounded-md border p-2 font-mono text-xs"
            style={{ borderColor: "var(--panel-border)", background: "var(--background)" }}
          />
          <button
            type="button"
            onClick={handleEvaluate}
            disabled={evaluating || toolName.trim() === ""}
            className="rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            {evaluating ? "Evaluating..." : "Evaluate Policy"}
          </button>
        </div>
        {result && (
          <div className="mt-3 rounded-md border p-3" style={{ borderColor: "var(--panel-border)" }}>
            <p className="text-sm"><strong>Decision:</strong> {result.decision}</p>
            <p className="text-sm"><strong>Reason:</strong> {result.reason}</p>
            <p className="text-sm"><strong>Approval required:</strong> {result.approvalRequired ? "Yes" : "No"}</p>
          </div>
        )}
      </div>

      {isLoading ? (
        <LoadingState label="Loading tools..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : tools.length === 0 ? (
        <EmptyState title="No tools available." />
      ) : (
        <ul className="flex flex-col gap-2">
          {tools.map((tool) => (
            <li
              key={tool.id}
              className="rounded-lg border p-4"
              style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <strong className="text-sm">{tool.name}</strong>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{tool.description}</p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    side effect: {tool.sideEffect ? "yes" : "no"} - sensitivity: {tool.dataSensitivity}
                  </p>
                </div>
                <StatusBadge status={tool.enabled ? "active" : "disabled"} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
