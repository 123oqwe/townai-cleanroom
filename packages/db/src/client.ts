import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export function createDatabase(connectionString: string) {
  const sql = postgres(connectionString);

  // Save the original date/timestamp serializers before Drizzle overrides
  // them with a transparent passthrough (val => val). Code that uses the raw
  // `sql` tagged template (identity repository, migrations, etc.) still needs
  // these serializers to convert Date objects to ISO strings for the wire
  // protocol.
  const dateOids = [1184, 1082, 1083, 1114, 1182, 1185, 1115, 1231];
  const savedSerializers = dateOids.map(
    (oid) => [oid, sql.options.serializers[oid]] as const,
  );

  const db = drizzle(sql, { schema });

  // Restore the original serializers so raw sql queries handle Date correctly.
  for (const [oid, serializer] of savedSerializers) {
    if (serializer !== undefined) {
      sql.options.serializers[oid] = serializer;
    }
  }

  return { db, sql };
}
