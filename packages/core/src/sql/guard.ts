import nodeSqlParser from "node-sql-parser";

/**
 * Safety layer 1. Every piece of SQL that comes from the model or a user goes through
 * `guardSql` before it is executed, and execution still happens in a READ ONLY
 * transaction on a read-only role (layers 2 and 3).
 *
 * Fail closed: anything the parser cannot read is rejected, never let through.
 */

export type GuardReason =
  | "empty"
  | "too_long"
  | "unverifiable"
  | "multiple_statements"
  | "not_select"
  | "write"
  | "forbidden_function"
  | "forbidden_table"
  | "hidden_column";

export const GUARD_MESSAGES: Record<GuardReason, string> = {
  empty: "There is no query to run",
  too_long: "The query is too long",
  unverifiable: "This query could not be verified as safe",
  multiple_statements: "Only one statement is allowed",
  not_select: "Only SELECT queries are allowed",
  write: "Queries that change data are not allowed",
  forbidden_function: "This query uses a function that is not allowed",
  forbidden_table: "This table is not available",
  hidden_column: "This column is not available",
};

export type GuardSchema = {
  tables: {
    schema: string;
    name: string;
    hidden: boolean;
    columns: { name: string; hidden: boolean }[];
  }[];
};

export type GuardResult =
  | {
      ok: true;
      /** The statement to execute (trimmed, without a trailing semicolon). */
      sql: string;
      /** Hidden column names of the referenced tables: drop them from results (`SELECT *`). */
      hiddenColumns: string[];
    }
  | { ok: false; reason: GuardReason; message: string };

const MAX_SQL_LENGTH = 10_000;

/**
 * Words that only appear in statements that change something. Checked on the SQL with
 * strings, comments, and quoted identifiers removed, so `'please delete'` or a column
 * called `"update"` do not trip it. Catches data-modifying CTEs the parser cannot read.
 */
const WRITE_WORDS = new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "truncate",
  "drop",
  "alter",
  "create",
  "grant",
  "revoke",
  "copy",
  "call",
  "vacuum",
  "reindex",
  "cluster",
  "refresh",
  "listen",
  "notify",
  "unlisten",
  "discard",
  "prepare",
  "deallocate",
  "savepoint",
  "rollback",
  "commit",
  "begin",
]);

/**
 * Functions that sleep, read files, signal backends, change settings, write to
 * sequences or large objects, reach other servers, or run SQL from a string.
 */
const FORBIDDEN_FUNCTIONS = new Set([
  "set_config",
  "current_setting",
  "nextval",
  "setval",
  "dblink",
  "query_to_xml",
  "query_to_xml_and_xmlschema",
  "query_to_xmlschema",
  "table_to_xml",
  "table_to_xml_and_xmlschema",
  "schema_to_xml",
  "database_to_xml",
  "cursor_to_xml",
  "txid_current",
  "inet_server_addr",
  "inet_server_port",
  "version",
]);
/** Whole families: pg_sleep, pg_read_file, pg_terminate_backend, dblink_exec, lo_import... */
const FORBIDDEN_PREFIXES = ["pg_", "dblink", "lo_", "binary_upgrade"];
/** Harmless pg_ helpers the model may use for formatting. */
const ALLOWED_PG_FUNCTIONS = new Set(["pg_typeof"]);

const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_toast"]);

const WRITE_NODE_TYPES = new Set([
  "insert",
  "update",
  "delete",
  "replace",
  "create",
  "drop",
  "alter",
  "truncate",
  "rename",
  "grant",
  "lock",
]);

const parser = new nodeSqlParser.Parser();
const PARSE_OPTIONS = { database: "PostgresQL" };

const reject = (reason: GuardReason): GuardResult => ({
  ok: false,
  reason,
  message: GUARD_MESSAGES[reason],
});

/** Removes string literals, dollar-quoted strings, comments, and quoted identifiers. */
function stripLiterals(sql: string): string {
  return sql
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/[eE]?'(?:[^']|'')*'/g, " ")
    .replace(/"(?:[^"]|"")*"/g, " ");
}

type Node = Record<string, unknown>;

/** Every object node in the AST, depth first. */
function* walk(value: unknown): Generator<Node> {
  if (Array.isArray(value)) {
    for (const item of value) yield* walk(item);
  } else if (value !== null && typeof value === "object") {
    yield value as Node;
    for (const child of Object.values(value)) yield* walk(child);
  }
}

/** Function name from either shape node-sql-parser produces, lower-cased. */
function functionName(node: Node): string | null {
  const name = node.name;
  if (typeof name === "string") return name.toLowerCase();
  if (name && typeof name === "object" && "name" in name && Array.isArray(name.name)) {
    const parts = (name.name as { value?: unknown }[]).map((p) => String(p.value ?? ""));
    return parts.at(-1)?.toLowerCase() ?? null;
  }
  return null;
}

/** Column name from a column_ref node (`column` is a string or `{expr: {value}}`). */
function columnName(node: Node): string | null {
  const column = node.column;
  if (typeof column === "string") return column.toLowerCase();
  if (column && typeof column === "object" && "expr" in column) {
    const expr = (column as { expr?: { value?: unknown } }).expr;
    if (expr && typeof expr.value === "string") return expr.value.toLowerCase();
  }
  return null;
}

function isForbiddenFunction(name: string): boolean {
  if (ALLOWED_PG_FUNCTIONS.has(name)) return false;
  return FORBIDDEN_FUNCTIONS.has(name) || FORBIDDEN_PREFIXES.some((p) => name.startsWith(p));
}

export function guardSql(input: string, schema: GuardSchema): GuardResult {
  const sql = input.trim().replace(/(;\s*)+$/, "");
  if (!sql) return reject("empty");
  if (sql.length > MAX_SQL_LENGTH) return reject("too_long");

  const bare = stripLiterals(sql).toLowerCase();
  // A semicolon left after literals are removed means a second statement.
  if (bare.includes(";")) return reject("multiple_statements");
  const words = bare.match(/[a-z_][a-z0-9_$]*/g) ?? [];
  if (words.some((w) => WRITE_WORDS.has(w))) return reject("write");

  let ast: unknown;
  let tableRefs: string[];
  try {
    ast = parser.astify(sql, PARSE_OPTIONS);
    tableRefs = parser.tableList(sql, PARSE_OPTIONS);
  } catch {
    return reject("unverifiable");
  }

  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) return reject("multiple_statements");
  const root = statements[0] as Node;
  if (root.type !== "select") return reject("not_select");

  for (const node of walk(root)) {
    if (typeof node.type === "string" && WRITE_NODE_TYPES.has(node.type)) return reject("write");
    // SELECT ... INTO creates a table.
    if (node.type === "select" && node.into && (node.into as Node).expr)
      return reject("not_select");
    if (node.type === "function" || node.type === "aggr_func") {
      const name = functionName(node);
      if (!name || isForbiddenFunction(name)) return reject("forbidden_function");
    }
  }

  // Tables: only visible tables from the saved schema, plus the query's own CTE names.
  const cteNames = new Set(
    ((root.with as Node[] | null) ?? []).flatMap((cte) => {
      const name = (cte.name as { value?: unknown } | undefined)?.value;
      return typeof name === "string" ? [name.toLowerCase()] : [];
    }),
  );
  const known = new Map<string, GuardSchema["tables"][number]>();
  for (const table of schema.tables) {
    known.set(`${table.schema.toLowerCase()}.${table.name.toLowerCase()}`, table);
    if (!known.has(table.name.toLowerCase())) known.set(table.name.toLowerCase(), table);
  }

  const referenced: GuardSchema["tables"][number][] = [];
  for (const ref of tableRefs) {
    const [, rawSchema, rawName] = ref.split("::");
    const name = (rawName ?? "").toLowerCase();
    const schemaName = rawSchema && rawSchema !== "null" ? rawSchema.toLowerCase() : null;
    if (schemaName && SYSTEM_SCHEMAS.has(schemaName)) return reject("forbidden_table");
    if (name.startsWith("pg_")) return reject("forbidden_table");
    if (!schemaName && cteNames.has(name)) continue;
    const table = known.get(schemaName ? `${schemaName}.${name}` : name);
    if (!table || table.hidden) return reject("forbidden_table");
    referenced.push(table);
  }

  // Hidden columns: no reference by name, and no whole-row reference (`SELECT c FROM customers c`).
  const hidden = new Set(
    referenced.flatMap((t) => t.columns.filter((c) => c.hidden).map((c) => c.name.toLowerCase())),
  );
  const rowNames = new Set<string>();
  for (const t of referenced) {
    if (t.columns.some((c) => c.hidden)) rowNames.add(t.name.toLowerCase());
  }
  for (const node of walk(root)) {
    // FROM items carry their alias in `as`; whole-row references use it.
    if (
      typeof node.table === "string" &&
      typeof node.as === "string" &&
      node.type !== "column_ref"
    ) {
      const table = known.get(node.table.toLowerCase());
      if (table?.columns.some((c) => c.hidden)) rowNames.add(node.as.toLowerCase());
    }
  }
  for (const node of walk(root)) {
    if (node.type !== "column_ref") continue;
    const name = columnName(node);
    if (!name) continue;
    if (hidden.has(name)) return reject("hidden_column");
    if (!node.table && rowNames.has(name)) return reject("hidden_column");
  }

  return { ok: true, sql, hiddenColumns: [...hidden] };
}

/** Removes hidden columns from result rows (they can arrive through `SELECT *`). */
export function dropHiddenColumns<T extends Record<string, unknown>>(
  rows: T[],
  columns: { name: string }[],
  hiddenColumns: string[],
): { rows: Record<string, unknown>[]; columns: { name: string }[] } {
  if (hiddenColumns.length === 0) return { rows, columns };
  const hidden = new Set(hiddenColumns);
  const keep = columns.filter((c) => !hidden.has(c.name.toLowerCase()));
  return {
    columns: keep,
    rows: rows.map((row) => Object.fromEntries(keep.map((c) => [c.name, row[c.name]]))),
  };
}
