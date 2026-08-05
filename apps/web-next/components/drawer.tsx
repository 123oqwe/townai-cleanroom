"use client";

import { useEffect, type ReactNode } from "react";

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={onClose}
      />
      <div
        className="relative flex h-full w-full max-w-md flex-col shadow-xl"
        style={{ background: "var(--panel)" }}
      >
        <header
          className="flex h-14 shrink-0 items-center justify-between border-b px-4"
          style={{ borderColor: "var(--panel-border)" }}
        >
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm transition-colors hover:bg-[color:var(--background)]"
            style={{ color: "var(--muted)" }}
            aria-label="Close panel"
          >
            x
          </button>
        </header>
        <div className="flex-1 overflow-auto p-4">{children}</div>
        {footer !== undefined && (
          <footer
            className="flex shrink-0 items-center justify-end gap-2 border-t p-4"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
