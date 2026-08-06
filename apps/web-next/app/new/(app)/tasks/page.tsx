"use client";

import { useState } from "react";
import useSWR from "swr";

import { TownApiError, type Task, type TaskPage } from "@town/web-client";

import { useApiClient } from "@/app/api-client";
import { EmptyState } from "@/components/states";
import { LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";

export default function TasksPage() {
  const client = useApiClient();
  const [filter, setFilter] = useState<"open" | "completed" | undefined>("open");
  const { data, error, isLoading, mutate } = useSWR<TaskPage, TownApiError>(
    ["tasks", filter],
    () => client.tasks.list(filter ? { status: filter, limit: 50 } : { limit: 50 }),
  );

  const tasks = data?.items ?? [];

  async function markRead(id: Task["id"]) {
    await client.tasks.markRead(id);
    void mutate();
  }

  async function completeTask(task: Task) {
    await client.tasks.update(task.id, {
      expectedRevision: task.currentRevision,
      title: task.title,
      description: task.description,
      status: "completed",
      scheduledFor: task.scheduledFor,
    });
    void mutate();
  }

  async function deleteTask(id: Task["id"], revision: number) {
    await client.tasks.delete(id, revision);
    void mutate();
  }

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Tasks</h1>
        <div className="flex gap-2">
          {(["open", "completed", undefined] as const).map((f) => (
            <button
              key={f ?? "all"}
              type="button"
              onClick={() => setFilter(f)}
              className="rounded-md border px-3 py-1.5 text-sm transition-colors"
              style={{
                borderColor: "var(--panel-border)",
                background: filter === f ? "var(--accent)" : "transparent",
                color: filter === f ? "var(--accent-foreground)" : "inherit",
              }}
            >
              {f === undefined ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading tasks..." />
      ) : error !== undefined ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error.message}
        </p>
      ) : tasks.length === 0 ? (
        <EmptyState title="No tasks found." hint="Tasks created from threads or suggestions will appear here." />
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="rounded-lg border p-4"
              style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}
            >
              <div className="flex items-center justify-between">
                <strong className="text-sm">{task.title}</strong>
                <StatusBadge status={task.status} />
              </div>
              {task.description && (
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  {task.description}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                {task.unread && (
                  <button
                    type="button"
                    onClick={() => markRead(task.id)}
                    className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                    style={{ borderColor: "var(--panel-border)" }}
                  >
                    Mark read
                  </button>
                )}
                {task.status === "open" && (
                  <button
                    type="button"
                    onClick={() => completeTask(task)}
                    className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                    style={{ borderColor: "var(--panel-border)" }}
                  >
                    Complete
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteTask(task.id, task.currentRevision)}
                  className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-[color:var(--background)]"
                  style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
