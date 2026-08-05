"use client";

import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0 && empty !== undefined) {
    return <>{empty}</>;
  }
  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--panel-border)" }}
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ background: "var(--panel)" }}>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-2.5 text-left font-medium ${col.className ?? ""}`}
                style={{ color: "var(--muted)" }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const clickable = onRowClick !== undefined;
            return (
              <tr
                key={rowKey(row)}
                className="border-t transition-colors"
                style={{
                  borderColor: "var(--panel-border)",
                  cursor: clickable ? "pointer" : "default",
                }}
                onClick={clickable ? () => onRowClick?.(row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 ${col.className ?? ""}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
