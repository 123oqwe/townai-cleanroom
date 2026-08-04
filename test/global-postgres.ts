import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { GlobalSetupContext } from "vitest/node";

type PostgresContainer = Awaited<
  ReturnType<(typeof PostgreSqlContainer.prototype)["start"]>
>;

async function startPostgres(
  image: string,
  startupTimeoutMs: number,
): Promise<PostgresContainer> {
  return new PostgreSqlContainer(image)
    .withStartupTimeout(startupTimeoutMs)
    .start();
}

export default async function globalPostgres({ provide }: GlobalSetupContext) {
  const imagePrimary = "postgres:16-alpine";
  const imageFallback = "postgres:16";
  const startupTimeoutMs = Number.parseInt(
    process.env.POSTGRES_STARTUP_TIMEOUT_MS ?? "300000",
    10,
  );
  const validTimeout =
    Number.isFinite(startupTimeoutMs) && startupTimeoutMs > 0
      ? startupTimeoutMs
      : 300_000;

  let container: PostgresContainer;
  try {
    container = await startPostgres(imagePrimary, validTimeout);
  } catch (error) {
    const fallback = await startPostgres(imageFallback, validTimeout);
    if (process.env.CI) {
      console.warn(
        `Primary Postgres image ${imagePrimary} startup timed out; using fallback ${imageFallback}.`,
      );
      console.warn(error);
    }
    container = fallback;
  }
  provide("postgresUrl", container.getConnectionUri());

  return async () => {
    await container.stop();
  };
}
