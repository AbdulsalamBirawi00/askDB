import "server-only";

import { createDb, type Database } from "@askdb/db";

import { getEnv } from "@/env";

const globalForDb = globalThis as unknown as { askdbDb?: Database };

/** App database client. Reused across hot reloads in development. */
export function getDb(): Database {
  globalForDb.askdbDb ??= createDb(getEnv().DATABASE_URL);
  return globalForDb.askdbDb;
}
