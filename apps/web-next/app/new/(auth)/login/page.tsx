"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Access was denied. You can try signing in again.",
  invalid_callback: "The sign-in callback was invalid. Please try again.",
  not_configured: "Sign-in is not configured on this server.",
  AUTH_FLOW_EXPIRED: "The sign-in session expired. Please try again.",
  AUTH_FLOW_REPLAYED: "This sign-in attempt was already used.",
  AUTH_STATE_INVALID: "The sign-in state was invalid. Please try again.",
  AUTH_NONCE_INVALID: "Sign-in verification failed. Please try again.",
  AUTH_EMAIL_NOT_VERIFIED: "Your email is not verified with Google.",
  AUTH_ACCOUNT_NOT_ALLOWED: "This account is not allowed.",
  AUTH_IDENTITY_CONFLICT:
    "There is a conflict with your account. Contact support.",
  auth_failed: "Sign-in failed. Please try again.",
};

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const errorParam = searchParams.get("error");
  const [error, setError] = useState<string | null>(
    errorParam ? (ERROR_MESSAGES[errorParam] ?? "Sign-in failed.") : null,
  );

  async function handleGoogleLogin() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/google/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirectPath: "/new/threads" }),
      });
      if (response.ok) {
        const body = (await response.json()) as { authorizationUrl: string };
        window.location.href = body.authorizationUrl;
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      setError(
        body.code
          ? (ERROR_MESSAGES[body.code] ?? "Sign-in failed.")
          : "Sign-in failed.",
      );
      setSubmitting(false);
    } catch {
      setError("Could not connect to the server.");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div
        className="rounded-lg border p-8"
        style={{
          background: "var(--panel)",
          borderColor: "var(--panel-border)",
        }}
      >
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Town</h1>
        <p className="mb-6 text-sm" style={{ color: "var(--muted)" }}>
          Sign in to your workspace
        </p>
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 font-medium transition-opacity disabled:opacity-60"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground)",
          }}
        >
          {submitting ? "Redirecting\u2026" : "Continue with Google"}
        </button>
        {error !== null && (
          <div className="mt-4">
            <p
              className="text-sm"
              style={{ color: "var(--danger)" }}
              role="alert"
            >
              {error}
            </p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSubmitting(false);
              }}
              className="mt-2 text-sm underline"
              style={{ color: "var(--accent)" }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
