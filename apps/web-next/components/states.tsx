"use client";

import type { ReactNode } from "react";

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="rounded-lg border border-dashed p-10 text-center"
      style={{ borderColor: "var(--panel-border)" }}
    >
      <p className="font-medium">{title}</p>
      {hint !== undefined && (
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {hint}
        </p>
      )}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-lg"
          style={{ background: "var(--panel)", opacity: 0.6 }}
        />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
