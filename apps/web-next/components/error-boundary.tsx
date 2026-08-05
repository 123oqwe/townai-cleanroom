"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught an error:", error, info);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <div
          className="rounded-lg border p-8 text-center"
          style={{
            borderColor: "var(--danger)",
            background: "var(--panel)",
          }}
          role="alert"
        >
          <p className="font-medium" style={{ color: "var(--danger)" }}>
            Something went wrong
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded-md px-3 py-1.5 text-sm font-medium transition-opacity"
            style={{
              background: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
