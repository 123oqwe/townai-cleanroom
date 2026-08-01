import { Hono } from "hono";

export function createApp(): Hono {
  const app = new Hono();

  app.get("/v1/health", (context) =>
    context.json({
      status: "ok" as const,
      service: "town-api" as const,
      version: process.env["TOWN_API_VERSION"] ?? "0.0.0",
      time: new Date().toISOString(),
    }),
  );

  return app;
}
