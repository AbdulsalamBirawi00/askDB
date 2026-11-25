import postgres from "postgres";

export const MAX_ROWS = 500;
export const QUERY_TIMEOUT_MS = 10_000;

const DATE_OID = 1082;
const TIMESTAMP_OID = 1114;
const TIMESTAMPTZ_OID = 1184;

export type ResultColumn = { name: string; type: number };

export type QueryResult = {
  columns: ResultColumn[];
  rows: Record<string, unknown>[];
  /** The query hit the row cap; there may be more rows. */
  truncated: boolean;
  durationMs: number;
};

/** The query ran past the statement timeout and was cancelled by Postgres. */
export class QueryTimeoutError extends Error {
  constructor() {
    super(`The query took longer than ${QUERY_TIMEOUT_MS / 1000} seconds and was stopped`);
    this.name = "QueryTimeoutError";
  }
}

/**
 * Postgres refused or failed the query. `message` is the server's message about the
 * query itself (e.g. `column "x" does not exist`), useful for repair; it never
 * includes connection details. Connection-level failures use ConnectionFailedError.
 */
export class QueryExecutionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "QueryExecutionError";
  }
}

/** Connection could not be opened (auth, network, TLS). Safe to show. */
export class ExecutorConnectionError extends Error {
  constructor(public readonly reason: string) {
    super("Connection failed");
    this.name = "ExecutorConnectionError";
  }
}

function pgCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

/** SQLSTATE classes that mean the connection itself failed, not the query. */
const CONNECTION_CODES = /^(08|28|3D|53|57P0)/;

/**
 * Safety layers 2 and 3 at execution time. Runs `sql` exactly once:
 * - inside `BEGIN READ ONLY`, so writes fail even if everything else let them through;
 * - with `statement_timeout` (10 s) and `lock_timeout`, so nothing hangs;
 * - wrapped as `SELECT * FROM (<sql>) LIMIT 500`, so no more than 500 rows come back,
 *   whatever LIMIT the query itself has;
 * - on whatever role the URL names (the user is told to use a read-only one).
 *
 * Callers must pass SQL that already went through the guard (layer 1). This function
 * is the backstop, not a replacement.
 */
export async function executeReadOnly(
  url: URL,
  sql: string,
  options: { maxRows?: number; timeoutMs?: number } = {},
): Promise<QueryResult> {
  const maxRows = options.maxRows ?? MAX_ROWS;
  const timeoutMs = options.timeoutMs ?? QUERY_TIMEOUT_MS;
  const body = sql.trim().replace(/;+\s*$/, "");
  const client = postgres(url.toString(), {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => {},
    connection: { application_name: "askdb" },
    // Dates and timestamps stay as Postgres text ("1997-07-04", "1997-07-01 00:00:00"):
    // parsing them into JS Dates would shift them by the server's time zone.
    types: {
      dateText: {
        to: 25,
        from: [DATE_OID, TIMESTAMP_OID, TIMESTAMPTZ_OID],
        serialize: (value: string) => value,
        parse: (value: string) => value,
      },
    },
  });
  const started = performance.now();
  try {
    const result = await client.begin("read only", async (tx) => {
      await tx.unsafe(
        `set local statement_timeout = ${Math.floor(timeoutMs)}; set local lock_timeout = 2000;` +
          ` set local idle_in_transaction_session_timeout = ${Math.floor(timeoutMs) + 5000}`,
      );
      // Ask for one extra row to know whether the cap was hit.
      return tx.unsafe(`select * from (\n${body}\n) as askdb_q limit ${maxRows + 1}`);
    });
    const rows = [...result] as Record<string, unknown>[];
    const truncated = rows.length > maxRows;
    return {
      columns: (result.columns ?? []).map((c) => ({ name: c.name, type: c.type })),
      rows: truncated ? rows.slice(0, maxRows) : rows,
      truncated,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    const code = pgCode(error);
    if (code === "57014") throw new QueryTimeoutError();
    if (!code || CONNECTION_CODES.test(code) || /^[A-Z_]+$/.test(code)) {
      // Driver errors (ECONNREFUSED, CONNECT_TIMEOUT...) and connection-class SQLSTATEs.
      throw new ExecutorConnectionError(code ?? "unknown");
    }
    const message = error instanceof Error ? error.message : "Query failed";
    throw new QueryExecutionError(message, code);
  } finally {
    await client.end({ timeout: 1 }).catch(() => {});
  }
}
