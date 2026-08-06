"use client";

const STATUS_COLORS: Record<string, string> = {
  queued: "var(--muted)",
  running: "var(--accent)",
  succeeded: "#16a34a",
  completed: "#16a34a",
  failed: "var(--danger)",
  blocked: "#d97706",
  cancelled: "var(--muted)",
  active: "#16a34a",
  archived: "var(--muted)",
  deleted: "var(--danger)",
  enabled: "#16a34a",
  disabled: "var(--muted)",
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "var(--muted)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
      />
      {status}
    </span>
  );
}
