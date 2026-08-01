import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";

const migrationLockId = 8_208_021;

export async function runMigrations(
  sql: Sql,
  migrationsDirectory = fileURLToPath(
    new URL("../migrations", import.meta.url),
  ),
): Promise<void> {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  await sql`select pg_advisory_lock(${migrationLockId})`;

  try {
    const migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const name of migrationNames) {
      const [existing] = await sql<{ exists: boolean }[]>`
        select exists(select 1 from schema_migrations where name = ${name}) as exists
      `;
      if (existing?.exists === true) continue;

      const source = await readFile(`${migrationsDirectory}/${name}`, "utf8");
      await sql.begin(async (transaction) => {
        await transaction.unsafe(source);
        await transaction`insert into schema_migrations (name) values (${name})`;
      });
    }
  } finally {
    await sql`select pg_advisory_unlock(${migrationLockId})`;
  }
}
