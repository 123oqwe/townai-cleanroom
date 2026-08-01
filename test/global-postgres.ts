import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { GlobalSetupContext } from "vitest/node";

export default async function globalPostgres({ provide }: GlobalSetupContext) {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  provide("postgresUrl", container.getConnectionUri());

  return async () => {
    await container.stop();
  };
}
