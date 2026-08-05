"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { TownClient } from "@town/web-client";

export const TOWN_TOKEN_COOKIE = "town-token";

// Browser-side TownClient provider. The client targets the same-origin /v1 path
// (rewritten to the API by next.config.ts). The bearer token is read from the
// cookie by middleware/server components and threaded in here.
const ClientContext = createContext<TownClient | null>(null);

export function ApiClientProvider({
  token,
  children,
}: {
  token: string | null;
  children: ReactNode;
}) {
  const client = useMemo(
    () =>
      new TownClient({
        baseUrl: "",
        ...(token === null ? {} : { token }),
      }),
    [token],
  );
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
