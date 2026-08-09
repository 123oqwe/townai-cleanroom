import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export function createDatabase(connectionString: string) {
  const sql = postgres(connectionString);
  const db = drizzle(sql, { schema });

  // Drizzle's postgres-js driver replaces date/timestamp serializers with a
  // transparent passthrough so it can parse dates itself. But code that uses
  // the raw `sql` tagged template (identity repository, migrations, etc.) still
  // needs the original serializers to convert Date objects to ISO strings for
  // the wire protocol. Restore them here after Drizzle initialisation.
  const dateSerialize = (x: unknown) =>
    (x instanceof Date ? x : new Date(String(x))).toISOString();
  for (const oid of [1184, 1082, 1083, 1114, 1182, 1185, 1115, 1231]) {
    sql.options.serializers[oid] = dateSerialize;
  }

  return { db, sql };
}
