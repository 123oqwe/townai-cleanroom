import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export function createDatabase(connectionString: string) {
  const sql = postgres(connectionString);
  const db = drizzle(sql, { schema });

  return { db, sql };
}
