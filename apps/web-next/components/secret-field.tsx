"use client";

import { useState } from "react";

export function SecretField({
  label,
  value,
  revealed,
  onCopy,
}: {
  label: string;
  value: string;
  revealed: boolean;
  onCopy?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (value === "") return;
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        onCopy?.();
      },
      () => setCopied(false),
    );
  }

  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <div className="flex gap-2">
        <input
          readOnly
          type={revealed ? "text" : "password"}
          value={
            revealed
              ? value
              : value.length > 0
                ? "*".repeat(Math.min(value.length, 32))
                : ""
          }
          className="flex-1 rounded-md border p-2 font-mono text-xs"
          style={{
            borderColor: "var(--panel-border)",
            background: "var(--background)",
          }}
        />
        <button
          type="button"
          onClick={handleCopy}
          disabled={!revealed}
          className="rounded-md border px-3 py-2 text-xs transition-colors hover:bg-[color:var(--background)] disabled:opacity-50"
          style={{ borderColor: "var(--panel-border)" }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </label>
  );
}
