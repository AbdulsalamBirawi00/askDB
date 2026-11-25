import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): Database {
  const client = postgres(url, {
    max: 5,
    // Neon and other serverless Postgres hosts close idle connections; do not hold them.
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}

/** Throws if the database cannot answer a trivial query. */
export async function pingDb(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}

export { schema };
export { deleteStaleGuests, GUEST_MAX_AGE_DAYS } from "./cleanup";
export {
  createConnection,
  deleteOwnedConnection,
  getConnectionSchema,
  getOwnedConnectionSecret,
  getVisibleConnection,
  getVisibleConnectionSecret,
  listConnections,
  refreshConnectionSchema,
  updateSchemaColumn,
  updateSchemaTable,
  type InspectionInput,
  type PublicConnection,
  type SchemaColumnView,
  type SchemaPatch,
  type SchemaTableView,
} from "./connections";
export {
  createConversation,
  deleteConversation,
  getConversationHistory,
  getOwnedConversation,
  getOwnedQuery,
  listConversations,
  logQuery,
  rateQuery,
  recentTurns,
  type ConversationSummary,
  type QueryLogInput,
  type QueryStatus,
  type QueryView,
} from "./queries";
export { DEMO_OWNER_ID, ensureDemoOwner } from "./demo";
// Query operators from the same drizzle-orm copy as the schema (apps must not import a second one).
export { and, eq, inArray, lt, sql } from "drizzle-orm";
