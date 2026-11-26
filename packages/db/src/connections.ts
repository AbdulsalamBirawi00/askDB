import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, exists, inArray, notInArray, or, sql } from "drizzle-orm";

import type { Database } from "./index";
import {
  connections,
  queryCache,
  schemaColumns,
  schemaTables,
  type ColumnReference,
  type SampleRow,
} from "./schema";

/** Columns safe to return from the API. Never the encrypted URL. */
const publicColumns = {
  id: connections.id,
  name: connections.name,
  isDemo: connections.isDemo,
  hasWriteAccess: connections.hasWriteAccess,
  schemaTruncated: connections.schemaTruncated,
  introspectedAt: connections.introspectedAt,
  createdAt: connections.createdAt,
};

export type PublicConnection = {
  id: string;
  name: string;
  isDemo: boolean;
  hasWriteAccess: boolean;
  schemaTruncated: boolean;
  introspectedAt: Date | null;
  createdAt: Date;
};

/** Introspection result, as the db layer needs it (structurally matches @askdb/core). */
export type InspectionInput = {
  hasWriteAccess: boolean;
  truncated: boolean;
  tables: {
    schema: string;
    name: string;
    kind: "table" | "view";
    sampleRows: SampleRow[];
    columns: {
      name: string;
      dataType: string;
      nullable: boolean;
      position: number;
      isPrimaryKey: boolean;
      references: ColumnReference | null;
      sensitive: boolean;
    }[];
  }[];
};

/** Rows the user may read: their own, plus the shared demo connection. */
const visible = (id: string, userId: string) =>
  and(eq(connections.id, id), or(eq(connections.userId, userId), eq(connections.isDemo, true)));

/** Rows the user may change: only their own. Someone else's id behaves like a missing one. */
const owned = (id: string, userId: string) =>
  and(eq(connections.id, id), eq(connections.userId, userId));

export function listConnections(db: Database, userId: string): Promise<PublicConnection[]> {
  return db
    .select(publicColumns)
    .from(connections)
    .where(or(eq(connections.userId, userId), eq(connections.isDemo, true)))
    .orderBy(desc(connections.isDemo), desc(connections.createdAt));
}

export async function getVisibleConnection(
  db: Database,
  id: string,
  userId: string,
): Promise<PublicConnection | null> {
  const [row] = await db
    .select(publicColumns)
    .from(connections)
    .where(visible(id, userId))
    .limit(1);
  return row ?? null;
}

/** The encrypted URL of a connection the user owns (for refresh). Never returned to clients. */
export async function getOwnedConnectionSecret(
  db: Database,
  id: string,
  userId: string,
): Promise<{ id: string; encryptedUrl: string } | null> {
  const [row] = await db
    .select({ id: connections.id, encryptedUrl: connections.encryptedUrl })
    .from(connections)
    .where(owned(id, userId))
    .limit(1);
  return row ?? null;
}

/**
 * The encrypted URL of a connection the user may query: their own, or the shared demo.
 * Server-side only (to execute questions). Never returned to clients.
 */
export async function getVisibleConnectionSecret(
  db: Database,
  id: string,
  userId: string,
): Promise<{ id: string; encryptedUrl: string } | null> {
  const [row] = await db
    .select({ id: connections.id, encryptedUrl: connections.encryptedUrl })
    .from(connections)
    .where(visible(id, userId))
    .limit(1);
  return row ?? null;
}

/** Returns false when there was nothing of the user's to delete. */
export async function deleteOwnedConnection(
  db: Database,
  id: string,
  userId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(connections)
    .where(owned(id, userId))
    .returning({ id: connections.id });
  return deleted.length > 0;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const CHUNK = 500;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

const tableKey = (schema: string, name: string) => JSON.stringify([schema, name]);

/**
 * Stores an introspection for a connection. Existing tables and columns keep their
 * note and hidden flag; new ones start visible unless sensitive; ones that no longer
 * exist are removed. Set-based statements (chunked only for very large schemas).
 */
async function mergeInspection(tx: Tx, connectionId: string, inspection: InspectionInput) {
  const tableIds = new Map<string, string>();
  for (const batch of chunks(inspection.tables)) {
    const rows = await tx
      .insert(schemaTables)
      .values(
        batch.map((t) => ({
          id: randomUUID(),
          connectionId,
          schemaName: t.schema,
          tableName: t.name,
          kind: t.kind,
          sampleRows: t.sampleRows,
        })),
      )
      .onConflictDoUpdate({
        target: [schemaTables.connectionId, schemaTables.schemaName, schemaTables.tableName],
        set: { kind: sql`excluded.kind`, sampleRows: sql`excluded.sample_rows` },
      })
      .returning({
        id: schemaTables.id,
        schema: schemaTables.schemaName,
        name: schemaTables.tableName,
      });
    for (const r of rows) tableIds.set(tableKey(r.schema, r.name), r.id);
  }

  const keptTables = [...tableIds.values()];
  await tx
    .delete(schemaTables)
    .where(
      keptTables.length
        ? and(eq(schemaTables.connectionId, connectionId), notInArray(schemaTables.id, keptTables))
        : eq(schemaTables.connectionId, connectionId),
    );

  const columnRows = inspection.tables.flatMap((t) => {
    const tableId = tableIds.get(tableKey(t.schema, t.name))!;
    return t.columns.map((c) => ({
      id: randomUUID(),
      tableId,
      columnName: c.name,
      dataType: c.dataType,
      nullable: c.nullable,
      position: c.position,
      isPrimaryKey: c.isPrimaryKey,
      fkRef: c.references,
      hidden: c.sensitive,
    }));
  });
  const keptColumns: string[] = [];
  for (const batch of chunks(columnRows)) {
    const rows = await tx
      .insert(schemaColumns)
      .values(batch)
      .onConflictDoUpdate({
        target: [schemaColumns.tableId, schemaColumns.columnName],
        // Structure is refreshed; the user's description and hidden flag are kept.
        set: {
          dataType: sql`excluded.data_type`,
          nullable: sql`excluded.nullable`,
          position: sql`excluded.position`,
          isPrimaryKey: sql`excluded.is_primary_key`,
          fkRef: sql`excluded.fk_ref`,
        },
      })
      .returning({ id: schemaColumns.id });
    keptColumns.push(...rows.map((r) => r.id));
  }
  if (keptTables.length) {
    await tx
      .delete(schemaColumns)
      .where(
        keptColumns.length
          ? and(
              inArray(schemaColumns.tableId, keptTables),
              notInArray(schemaColumns.id, keptColumns),
            )
          : inArray(schemaColumns.tableId, keptTables),
      );
  }

  await tx
    .update(connections)
    .set({
      hasWriteAccess: inspection.hasWriteAccess,
      schemaTruncated: inspection.truncated,
      introspectedAt: new Date(),
    })
    .where(eq(connections.id, connectionId));
}

/** Saves a new connection and its schema in one transaction. */
export async function createConnection(
  db: Database,
  input: {
    id: string;
    userId: string;
    name: string;
    encryptedUrl: string;
    isDemo?: boolean;
    inspection: InspectionInput;
  },
): Promise<PublicConnection> {
  await db.transaction(async (tx) => {
    await tx.insert(connections).values({
      id: input.id,
      userId: input.userId,
      name: input.name,
      encryptedUrl: input.encryptedUrl,
      isDemo: input.isDemo ?? false,
    });
    await mergeInspection(tx, input.id, input.inspection);
  });
  const [row] = await db
    .select(publicColumns)
    .from(connections)
    .where(eq(connections.id, input.id));
  return row!;
}

/** Re-saves the schema of an owned connection. Returns false if the user does not own it. */
export async function refreshConnectionSchema(
  db: Database,
  input: { id: string; userId: string; inspection: InspectionInput; encryptedUrl?: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: connections.id })
      .from(connections)
      .where(owned(input.id, input.userId))
      .for("update");
    if (!row) return false;
    if (input.encryptedUrl) {
      await tx
        .update(connections)
        .set({ encryptedUrl: input.encryptedUrl })
        .where(eq(connections.id, input.id));
    }
    await mergeInspection(tx, input.id, input.inspection);
    // The schema (or the database itself) may have changed: cached results are stale.
    await tx.delete(queryCache).where(eq(queryCache.connectionId, input.id));
    return true;
  });
}

export type SchemaColumnView = {
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  fkRef: ColumnReference | null;
  description: string | null;
  hidden: boolean;
};

export type SchemaTableView = {
  id: string;
  schema: string;
  name: string;
  kind: "table" | "view";
  description: string | null;
  hidden: boolean;
  sampleRows: SampleRow[];
  columns: SchemaColumnView[];
};

/** Tables and columns of a connection the user can see (own or demo), or null. */
export async function getConnectionSchema(
  db: Database,
  connectionId: string,
  userId: string,
): Promise<SchemaTableView[] | null> {
  const connection = await getVisibleConnection(db, connectionId, userId);
  if (!connection) return null;

  const [tables, columns] = await Promise.all([
    db
      .select()
      .from(schemaTables)
      .where(eq(schemaTables.connectionId, connectionId))
      .orderBy(asc(schemaTables.schemaName), asc(schemaTables.tableName)),
    db
      .select({
        id: schemaColumns.id,
        tableId: schemaColumns.tableId,
        name: schemaColumns.columnName,
        dataType: schemaColumns.dataType,
        nullable: schemaColumns.nullable,
        isPrimaryKey: schemaColumns.isPrimaryKey,
        fkRef: schemaColumns.fkRef,
        description: schemaColumns.description,
        hidden: schemaColumns.hidden,
      })
      .from(schemaColumns)
      .innerJoin(schemaTables, eq(schemaTables.id, schemaColumns.tableId))
      .where(eq(schemaTables.connectionId, connectionId))
      .orderBy(asc(schemaColumns.position)),
  ]);

  const byTable = new Map<string, SchemaColumnView[]>();
  for (const { tableId, ...column } of columns) {
    const list = byTable.get(tableId) ?? [];
    list.push(column);
    byTable.set(tableId, list);
  }
  return tables.map((t) => {
    const cols = byTable.get(t.id) ?? [];
    const hiddenNames = new Set(cols.filter((c) => c.hidden).map((c) => c.name));
    return {
      id: t.id,
      schema: t.schemaName,
      name: t.tableName,
      kind: t.kind,
      description: t.description,
      hidden: t.hidden,
      // Columns hidden after introspection are dropped from the stored sample too.
      sampleRows: t.sampleRows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([k]) => !hiddenNames.has(k))),
      ),
      columns: cols,
    };
  });
}

export type SchemaPatch = { description?: string | null; hidden?: boolean };

/** True when the connection belongs to the user. The shared demo connection never matches. */
const ownsConnection = (connectionId: string, userId: string) =>
  exists(
    sql`(select 1 from ${connections} where ${connections.id} = ${connectionId} and ${connections.userId} = ${userId})`,
  );

/** Updates a table's note or visibility. False when it is not in an owned connection. */
export async function updateSchemaTable(
  db: Database,
  input: { connectionId: string; tableId: string; userId: string; patch: SchemaPatch },
): Promise<boolean> {
  const rows = await db
    .update(schemaTables)
    .set(input.patch)
    .where(
      and(
        eq(schemaTables.id, input.tableId),
        eq(schemaTables.connectionId, input.connectionId),
        ownsConnection(input.connectionId, input.userId),
      ),
    )
    .returning({ id: schemaTables.id });
  // Cached dashboard results may hold a column that is hidden now.
  if (rows.length > 0 && "hidden" in input.patch) {
    await db.delete(queryCache).where(eq(queryCache.connectionId, input.connectionId));
  }
  return rows.length > 0;
}

/** Updates a column's note or visibility. False when it is not in an owned connection. */
export async function updateSchemaColumn(
  db: Database,
  input: { connectionId: string; columnId: string; userId: string; patch: SchemaPatch },
): Promise<boolean> {
  const rows = await db
    .update(schemaColumns)
    .set(input.patch)
    .where(
      and(
        eq(schemaColumns.id, input.columnId),
        inArray(
          schemaColumns.tableId,
          db
            .select({ id: schemaTables.id })
            .from(schemaTables)
            .where(eq(schemaTables.connectionId, input.connectionId)),
        ),
        ownsConnection(input.connectionId, input.userId),
      ),
    )
    .returning({ id: schemaColumns.id });
  // Cached dashboard results may hold a column that is hidden now.
  if (rows.length > 0 && "hidden" in input.patch) {
    await db.delete(queryCache).where(eq(queryCache.connectionId, input.connectionId));
  }
  return rows.length > 0;
}
