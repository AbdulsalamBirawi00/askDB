import postgres from "postgres";

import { isSensitiveColumnName } from "./sensitive";

export type ColumnReference = { schema: string; table: string; column: string };

export type IntrospectedColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  position: number;
  isPrimaryKey: boolean;
  references: ColumnReference | null;
  /** Name looks sensitive (password, email, phone, ...): hidden by default, never sampled. */
  sensitive: boolean;
};

export type IntrospectedTable = {
  schema: string;
  name: string;
  kind: "table" | "view";
  columns: IntrospectedColumn[];
  /** Up to 3 rows, sensitive columns left out, long values cut. */
  sampleRows: Record<string, unknown>[];
};

export type DatabaseInspection = {
  /** The role can change data or create objects: the app should warn the user. */
  hasWriteAccess: boolean;
  tables: IntrospectedTable[];
  /** More than MAX_TABLES tables were visible; only the first ones were read. */
  truncated: boolean;
};

export const MAX_TABLES = 200;
const SAMPLE_ROWS = 3;
const MAX_SAMPLE_VALUE_LENGTH = 120;
const STATEMENT_TIMEOUT_MS = 10_000;

/**
 * Safe to show to the user: never includes the URL, host, or server message.
 * `reason` is a short code (driver or SQLSTATE) for server-side diagnostics only.
 */
export class ConnectionFailedError extends Error {
  constructor(public readonly reason: string) {
    super("Connection failed");
    this.name = "ConnectionFailedError";
  }
}

type Tx = postgres.TransactionSql;

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "unknown";
}

/**
 * Opens a short-lived connection and runs `fn` inside a READ ONLY transaction with a
 * statement timeout. Any failure becomes a ConnectionFailedError.
 */
async function withReadOnly<T>(url: URL, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const sql = postgres(url.toString(), {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => {},
    connection: { application_name: "askdb" },
  });
  try {
    return (await sql.begin("read only", async (tx) => {
      await tx.unsafe(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      return fn(tx);
    })) as T;
  } catch (error) {
    throw new ConnectionFailedError(errorCode(error));
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

/**
 * True when the role is a superuser, can INSERT/UPDATE/DELETE/TRUNCATE any user table,
 * or can CREATE in any user schema. Uses has_*_privilege, which also counts ownership
 * and inherited role membership (information_schema.table_privileges does not).
 */
async function checkWriteAccess(tx: Tx): Promise<boolean> {
  const [row] = await tx<{ has_write: boolean }[]>`
    select
      coalesce((select rolsuper from pg_roles where rolname = current_user), false)
      or exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p')
          and n.nspname not in ('pg_catalog', 'information_schema')
          and n.nspname not like 'pg\\_%'
          and (has_table_privilege(c.oid, 'INSERT') or has_table_privilege(c.oid, 'UPDATE')
            or has_table_privilege(c.oid, 'DELETE') or has_table_privilege(c.oid, 'TRUNCATE'))
      )
      or exists (
        select 1 from pg_namespace n
        where n.nspname not in ('pg_catalog', 'information_schema')
          and n.nspname not like 'pg\\_%'
          and has_schema_privilege(n.oid, 'CREATE')
      ) as has_write`;
  return row?.has_write ?? true;
}

type ColumnRow = {
  table_schema: string;
  table_name: string;
  table_type: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  ordinal_position: number;
};

type KeyRow = {
  schema: string;
  table: string;
  column: string;
  contype: "p" | "f";
  ref_schema: string | null;
  ref_table: string | null;
  ref_column: string | null;
};

const key = (schema: string, table: string, column?: string) =>
  JSON.stringify(column === undefined ? [schema, table] : [schema, table, column]);

async function readTables(tx: Tx): Promise<{ tables: IntrospectedTable[]; truncated: boolean }> {
  // information_schema.columns lists only columns the role can access.
  const columns = await tx<ColumnRow[]>`
    select c.table_schema, c.table_name, t.table_type, c.column_name, c.data_type, c.udt_name,
           c.is_nullable, c.ordinal_position::int as ordinal_position
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema not in ('pg_catalog', 'information_schema')
      and c.table_schema not like 'pg\\_%'
    order by c.table_schema, c.table_name, c.ordinal_position`;

  // pg_catalog, not information_schema: table_constraints hides constraints on tables
  // the role can only SELECT from, which is exactly the read-only role we expect.
  const keys = await tx<KeyRow[]>`
    select n.nspname as schema, cl.relname as table, a.attname as column, con.contype,
           fn.nspname as ref_schema, fcl.relname as ref_table, fa.attname as ref_column
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
    left join pg_class fcl on fcl.oid = con.confrelid
    left join pg_namespace fn on fn.oid = fcl.relnamespace
    left join pg_attribute fa on fa.attrelid = con.confrelid and fa.attnum = con.confkey[k.ord]
    where con.contype in ('p', 'f')
      and n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg\\_%'`;

  const primary = new Set<string>();
  const references = new Map<string, ColumnReference>();
  for (const k of keys) {
    const id = key(k.schema, k.table, k.column);
    if (k.contype === "p") primary.add(id);
    else if (k.ref_schema && k.ref_table && k.ref_column) {
      references.set(id, { schema: k.ref_schema, table: k.ref_table, column: k.ref_column });
    }
  }

  const byTable = new Map<string, IntrospectedTable>();
  for (const c of columns) {
    const tableId = key(c.table_schema, c.table_name);
    let table = byTable.get(tableId);
    if (!table) {
      if (byTable.size >= MAX_TABLES) continue;
      table = {
        schema: c.table_schema,
        name: c.table_name,
        kind: c.table_type === "VIEW" ? "view" : "table",
        columns: [],
        sampleRows: [],
      };
      byTable.set(tableId, table);
    }
    const id = key(c.table_schema, c.table_name, c.column_name);
    table.columns.push({
      name: c.column_name,
      dataType:
        c.data_type === "USER-DEFINED" || c.data_type === "ARRAY" ? c.udt_name : c.data_type,
      nullable: c.is_nullable === "YES",
      position: c.ordinal_position,
      isPrimaryKey: primary.has(id),
      references: references.get(id) ?? null,
      sensitive: isSensitiveColumnName(c.column_name),
    });
  }
  const tableCount = new Set(columns.map((c) => key(c.table_schema, c.table_name))).size;
  return { tables: [...byTable.values()], truncated: tableCount > MAX_TABLES };
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

function trimValue(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_SAMPLE_VALUE_LENGTH) {
    return `${value.slice(0, MAX_SAMPLE_VALUE_LENGTH)}…`;
  }
  if (value !== null && typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > MAX_SAMPLE_VALUE_LENGTH
      ? `${text.slice(0, MAX_SAMPLE_VALUE_LENGTH)}…`
      : value;
  }
  return value;
}

/**
 * Reads up to 3 rows per table in ONE statement (a UNION ALL of per-table subqueries).
 * Only non-sensitive columns are selected, so hidden-by-default values are never fetched.
 * Identifiers come from the catalog and are quoted, never taken from user input.
 */
async function readSamples(tx: Tx, tables: IntrospectedTable[]): Promise<void> {
  const parts: string[] = [];
  tables.forEach((table, index) => {
    const cols = table.columns.filter((c) => !c.sensitive).map((c) => quoteIdent(c.name));
    if (cols.length === 0) return;
    const from = `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`;
    parts.push(
      `select ${index} as i, (select coalesce(json_agg(r), '[]'::json) from ` +
        `(select ${cols.join(", ")} from ${from} limit ${SAMPLE_ROWS}) r) as rows`,
    );
  });
  if (parts.length === 0) return;
  const rows = await tx.unsafe<{ i: number; rows: Record<string, unknown>[] }[]>(
    parts.join(" union all "),
  );
  for (const row of rows) {
    const table = tables[row.i];
    if (!table) continue;
    table.sampleRows = row.rows.map((sample) =>
      Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, trimValue(v)])),
    );
  }
}

/** Connects, checks privileges, and returns whether the role can write. */
export async function testConnection(url: URL): Promise<{ hasWriteAccess: boolean }> {
  return withReadOnly(url, async (tx) => ({ hasWriteAccess: await checkWriteAccess(tx) }));
}

/** Full introspection: tables, columns, keys, relationships, and a small sample per table. */
export async function inspectDatabase(url: URL): Promise<DatabaseInspection> {
  return withReadOnly(url, async (tx) => {
    const hasWriteAccess = await checkWriteAccess(tx);
    const { tables, truncated } = await readTables(tx);
    await readSamples(tx, tables);
    return { hasWriteAccess, tables, truncated };
  });
}
