"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { TownClient } from "@town/web-client";

export const TOWN_TOKEN_COOKIE = "town-token";

// Browser-side TownClient provider. The client targets the same-origin /v1
// path, which is rewritten by next.config.ts to /api/proxy/v1/* — a
// server-side route that reads the HttpOnly session cookie and injects
// the Bearer token. The raw token is never accessible to client-side JS.
const ClientContext = createContext<TownClient | null>(null);

export function ApiClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => new TownClient({ baseUrl: "" }), []);
  return (
    <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
  );
}

export function useApiClient(): TownClient {
  const client = useContext(ClientContext);
  if (client === null)
    throw new Error("useApiClient must be used within an ApiClientProvider");
  return client;
}
