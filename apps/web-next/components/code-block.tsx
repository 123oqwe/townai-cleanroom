"use client";

export function CodeBlock({
  children,
  label,
}: {
  children: string;
  label?: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--panel-border)" }}
    >
      {label !== undefined && (
        <div
          className="border-b px-3 py-1.5 text-xs font-medium"
          style={{
            borderColor: "var(--panel-border)",
            background: "var(--panel)",
            color: "var(--muted)",
          }}
        >
          {label}
        </div>
      )}
      <pre
        className="overflow-auto p-3 text-xs leading-relaxed"
        style={{ background: "var(--background)" }}
      >
        <code>{children}</code>
      </pre>
    </div>
  );
}
