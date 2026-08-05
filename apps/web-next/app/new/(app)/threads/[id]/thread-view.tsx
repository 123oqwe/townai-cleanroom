"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { TownApiError } from "@town/web-client";
import type {
  MessageSubmission,
  ServerEvent,
  Thread,
  ThreadTurn,
  TurnPage,
  Id,
} from "@town/web-client";

import { useApiClient } from "@/app/api-client";

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

const EVENT_LABEL: Record<string, string> = {
  run_queued: "Run queued",
  run_started: "Run started",
  phase_changed: "Phase changed",
  input_observed: "Input observed",
  assistant_output_recorded: "Assistant output",
  run_waiting: "Run waiting",
  run_resumed: "Run resumed",
  run_completed: "Run completed",
  run_failed: "Run failed",
  run_cancelled: "Run cancelled",
  tool_call_proposed: "Tool proposed",
  policy_decided: "Policy decided",
  approval_requested: "Approval requested",
  approval_resolved: "Approval resolved",
  tool_started: "Tool started",
  tool_succeeded: "Tool succeeded",
  tool_failed: "Tool failed",
};

export function ThreadView({ threadId }: { threadId: string }) {
  const client = useApiClient();
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [runState, setRunState] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const { data: thread, error: threadError } = useSWR<Thread, TownApiError>(
    `thread:${threadId}`,
    () => client.threads.get(threadId as Id<"thread">),
  );

  const {
    data: turnsPage,
    error: turnsError,
    mutate: mutateTurns,
  } = useSWR<TurnPage, TownApiError>(`turns:${threadId}`, () =>
    client.threads.turns(threadId as Id<"thread">, { limit: 50 }),
  );

  const turns: ThreadTurn[] = turnsPage?.items ?? [];

  // Stream session events for a run with exponential backoff (max 3 attempts).
  const streamEvents = useCallback(
    async (sessionId: Id<"runtime-session">, attempt = 0) => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        for await (const event of client.sessions.eventsStream(sessionId, {
          signal: controller.signal,
          intervalMs: 1000,
          windowMs: 20000,
        })) {
          setEvents((prev) => [...prev, event]);
          if (
            event.kind === "run_completed" ||
            event.kind === "run_failed" ||
            event.kind === "run_cancelled"
          ) {
            setRunState(event.kind);
          }
        }
        // Stream ended cleanly; refresh turns to render the final assistant turn.
        void mutateTurns();
      } catch (err) {
        if (controller.signal.aborted) return;
        if (attempt < 2 && err instanceof TownApiError && err.status >= 500) {
          const delay = 500 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          return streamEvents(sessionId, attempt + 1);
        }
        setSubmitError(
          err instanceof Error ? err.message : "Event stream failed.",
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [client, mutateTurns],
  );

  // Abort any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Keep the transcript scrolled to the latest turn.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [turns.length]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (text === "" || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setEvents([]);
    setRunState(null);
    abortRef.current?.abort();
    try {
      const submission: MessageSubmission = await client.sessions.create(
        threadId as Id<"thread">,
        { text },
      );
      setInput("");
      // Optimistically surface the user turn, then open the SSE stream.
      void mutateTurns(
        (page) =>
          page === undefined
            ? page
            : { ...page, items: [...page.items, submission.turn] },
        { revalidate: false },
      );
      setRunState(submission.run.state);
      void streamEvents(submission.session.id);
    } catch (err) {
      setSubmitError(
        err instanceof TownApiError ? err.message : "Could not send message.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (threadError !== undefined) {
    return (
      <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
        {threadError.message}
      </p>
    );
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">
          {thread?.title ?? "Thread"}
        </h1>
        {runState !== null && (
          <span
            className="rounded-full px-3 py-1 text-xs"
            style={{ background: "var(--panel)", color: "var(--muted)" }}
          >
            {runState.replaceAll("_", " ")}
          </span>
        )}
      </header>

      <div
        ref={transcriptRef}
        className="flex max-h-[55vh] flex-col gap-3 overflow-auto rounded-lg border p-4"
        style={{
          background: "var(--panel)",
          borderColor: "var(--panel-border)",
        }}
      >
        {turnsError !== undefined ? (
          <p
            className="text-sm"
            style={{ color: "var(--danger)" }}
            role="alert"
          >
            {turnsError.message}
          </p>
        ) : turns.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No turns yet. Send a message below to start.
          </p>
        ) : (
          turns.map((turn) => (
            <div
              key={turn.id}
              className="max-w-[85%] self-start rounded-lg px-3 py-2 text-sm"
              style={
                turn.role === "user"
                  ? {
                      background: "var(--accent)",
                      color: "var(--accent-foreground)",
                    }
                  : {
                      background: "var(--background)",
                      border: "1px solid var(--panel-border)",
                    }
              }
            >
              <span className="block whitespace-pre-wrap">{turn.text}</span>
              <span
                className="mt-1 block text-[10px]"
                style={{
                  color:
                    turn.role === "user"
                      ? "var(--accent-foreground)"
                      : "var(--muted)",
                }}
              >
                {turn.role} · {formatTime(turn.createdAt)}
              </span>
            </div>
          ))
        )}
      </div>

      {events.length > 0 && (
        <div
          className="flex flex-col gap-1 rounded-lg border p-3"
          style={{
            background: "var(--panel)",
            borderColor: "var(--panel-border)",
          }}
        >
          <span
            className="text-xs font-medium"
            style={{ color: "var(--muted)" }}
          >
            Live events
          </span>
          {events.map((event) => (
            <div key={`${event.sequence}`} className="flex gap-2 text-xs">
              <span style={{ color: "var(--muted)" }}>
                {formatTime(event.createdAt)}
              </span>
              <span>{EVENT_LABEL[event.kind] ?? event.kind}</span>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Send a message…"
          disabled={submitting}
          className="flex-1 rounded-md border px-3 py-2 outline-none focus:border-[color:var(--accent)]"
          style={{
            background: "var(--panel)",
            borderColor: "var(--panel-border)",
          }}
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md px-4 py-2 font-medium transition-opacity disabled:opacity-60"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground)",
          }}
        >
          {submitting ? "Sending…" : "Send"}
        </button>
      </form>

      {submitError !== null && (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {submitError}
        </p>
      )}
    </section>
  );
}
