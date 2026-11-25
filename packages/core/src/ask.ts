import {
  generateWithFallback,
  streamTextWithFallback,
  type ProviderConfig,
  type ProviderName,
} from "./ai/providers";
import {
  buildRepairPrompt,
  buildSqlPrompt,
  buildSummaryPrompt,
  SQL_INSTRUCTIONS,
  sqlGenerationSchema,
  SUMMARY_INSTRUCTIONS,
  type ChartType,
  type FailedAttempt,
  type HistoryTurn,
  type PromptTable,
} from "./ai/prompt";
import { chooseChart, columnKind, type ChartSpec, type ColumnKind } from "./results/chart";
import {
  executeReadOnly,
  QueryExecutionError,
  QueryTimeoutError,
  type QueryResult,
} from "./sql/execute";
import { dropHiddenColumns, guardSql, type GuardReason } from "./sql/guard";

/** A saved schema, with the user's hidden flags (as @askdb/db returns it). */
export type AskTable = Omit<PromptTable, "columns"> & {
  hidden: boolean;
  columns: (PromptTable["columns"][number] & { hidden: boolean })[];
};

/** Where a question is, for a progress indicator. */
export type AskStage = "writing" | "running" | "repairing";

/** Each failed execution may be sent back to the model this many times. */
export const MAX_REPAIRS = 2;

type Base = {
  provider: ProviderName;
  model: string;
  /** Summed over every model call for this question. */
  tokens: number | null;
  explanation: string;
  /** Model calls made: 1, or more after repairs. */
  attempts: number;
};

export type AnswerColumn = { name: string; kind: ColumnKind };

export type AskOutcome =
  | (Base & { status: "clarification"; clarificationQuestion: string; sql: null })
  | (Base & { status: "rejected"; sql: string; reason: GuardReason; error: string })
  | (Base & { status: "error"; sql: string; error: string; code: string })
  | (Base & { status: "timeout"; sql: string; error: string })
  | (Base & {
      status: "ok";
      sql: string;
      /** The model's suggestion; `chart` is what the data supports. */
      chartType: ChartType;
      chart: ChartSpec;
      columns: AnswerColumn[];
      result: QueryResult;
      /** The first query failed and a later attempt worked. */
      repaired: boolean;
    });

/** Visible tables and columns only: hidden ones never reach the model. */
export function promptTables(tables: AskTable[]): PromptTable[] {
  return tables
    .filter((t) => !t.hidden)
    .map((t) => ({
      schema: t.schema,
      name: t.name,
      description: t.description,
      sampleRows: t.sampleRows,
      columns: t.columns.filter((c) => !c.hidden).map(({ hidden: _hidden, ...column }) => column),
    }));
}

const addTokens = (a: number | null, b: number | null) =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0);

/** What running one guarded query gives back. Anything else (connection failures) is thrown. */
export type RunOutcome =
  | { status: "rejected"; sql: string; reason: GuardReason; error: string }
  | { status: "error"; sql: string; error: string; code: string }
  | { status: "timeout"; sql: string; error: string }
  | {
      status: "ok";
      sql: string;
      chart: ChartSpec;
      columns: AnswerColumn[];
      result: QueryResult;
    };

/**
 * Guard → read-only execution → hidden columns dropped → chart chosen. The one path every
 * query takes, whether the model wrote it or the user edited it by hand, so all three
 * safety layers (guard, read-only transaction, read-only role) always apply.
 */
export async function runSql(input: {
  sql: string;
  url: URL;
  tables: AskTable[];
  /** The model's chart suggestion; the data still decides. */
  suggested?: ChartType;
  /** Called once the guard has passed, right before the query runs. */
  onRunning?: () => void;
  /** Test seam: runs guarded SQL. Defaults to the read-only executor on `url`. */
  execute?: (sql: string) => Promise<QueryResult>;
}): Promise<RunOutcome> {
  const guarded = guardSql(input.sql, guardSchemaOf(input.tables));
  if (!guarded.ok) {
    return { status: "rejected", sql: input.sql, reason: guarded.reason, error: guarded.message };
  }
  const execute = input.execute ?? ((sql: string) => executeReadOnly(input.url, sql));
  input.onRunning?.();
  try {
    const result = await execute(guarded.sql);
    const visible = dropHiddenColumns(result.rows, result.columns, guarded.hiddenColumns);
    const resultColumns = result.columns.filter((c) =>
      visible.columns.some((v) => v.name === c.name),
    );
    const columns = resultColumns.map((c) => ({ name: c.name, kind: columnKind(c.type) }));
    return {
      status: "ok",
      sql: guarded.sql,
      chart: chooseChart({ suggested: input.suggested ?? "table", columns, rows: visible.rows }),
      columns,
      result: { ...result, rows: visible.rows, columns: resultColumns },
    };
  } catch (error) {
    if (error instanceof QueryTimeoutError) {
      return { status: "timeout", sql: guarded.sql, error: error.message };
    }
    if (error instanceof QueryExecutionError) {
      return { status: "error", sql: guarded.sql, error: error.message, code: error.code };
    }
    throw error;
  }
}

function guardSchemaOf(tables: AskTable[]) {
  return {
    tables: tables.map((t) => ({
      schema: t.schema,
      name: t.name,
      hidden: t.hidden,
      columns: t.columns.map((c) => ({ name: c.name, hidden: c.hidden })),
    })),
  };
}

/**
 * Question → model → guard → read-only execution, with auto-repair: when the database
 * rejects the query (unknown column, type mismatch...), the SQL and the error go back
 * to the model, at most MAX_REPAIRS times. Every repaired query passes the guard again.
 * Rejections by the guard and timeouts are not repaired.
 *
 * `history` holds the earlier questions of the conversation (SQL only, never results);
 * only the last MAX_HISTORY_TURNS reach the model.
 *
 * Provider failures and connection failures are thrown (the caller decides the
 * response); everything about the query itself comes back as an outcome so it can be logged.
 */
export async function askQuestion(input: {
  question: string;
  url: URL;
  tables: AskTable[];
  providers: ProviderConfig;
  history?: HistoryTurn[];
  abortSignal?: AbortSignal;
  onStage?: (stage: AskStage, attempt: number) => void;
  maxRepairs?: number;
  /** Test seam: runs guarded SQL. Defaults to the read-only executor on `url`. */
  execute?: (sql: string) => Promise<QueryResult>;
}): Promise<AskOutcome> {
  const tables = promptTables(input.tables);
  const history = input.history ?? [];
  const maxRepairs = input.maxRepairs ?? MAX_REPAIRS;
  const failures: FailedAttempt[] = [];
  let tokens: number | null = null;

  for (let attempt = 1; ; attempt++) {
    input.onStage?.(attempt === 1 ? "writing" : "repairing", attempt);
    const generation = await generateWithFallback(input.providers, {
      instructions: SQL_INSTRUCTIONS,
      prompt: failures.length
        ? buildRepairPrompt(input.question, tables, failures, history)
        : buildSqlPrompt(input.question, tables, history),
      schema: sqlGenerationSchema,
      abortSignal: input.abortSignal,
    });
    const { output } = generation;
    tokens = addTokens(tokens, generation.tokens);
    const base: Base = {
      provider: generation.provider,
      model: generation.model,
      tokens,
      explanation: output.explanation,
      attempts: attempt,
    };

    if (output.needsClarification || !output.sql) {
      return {
        ...base,
        status: "clarification",
        sql: null,
        clarificationQuestion: output.clarificationQuestion || output.explanation,
      };
    }

    const sql = output.sql;
    const run = await runSql({
      sql,
      url: input.url,
      tables: input.tables,
      suggested: output.chartType,
      execute: input.execute,
      onRunning: () => input.onStage?.("running", attempt),
    });
    if (run.status === "ok") {
      return { ...base, ...run, chartType: output.chartType, repaired: attempt > 1 };
    }
    if (run.status !== "error" || attempt > maxRepairs) return { ...base, ...run };
    failures.push({ sql: run.sql, error: run.error });
  }
}

/**
 * A one- or two-sentence summary of a result, streamed. Only the first rows are sent
 * (SUMMARY_ROW_LIMIT) to save tokens. Yields text deltas.
 */
export function summarizeResult(input: {
  question: string;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  providers: ProviderConfig;
  abortSignal?: AbortSignal;
}): AsyncGenerator<string, void, undefined> {
  return streamTextWithFallback(input.providers, {
    instructions: SUMMARY_INSTRUCTIONS,
    prompt: buildSummaryPrompt({
      question: input.question,
      columns: input.columns,
      rows: input.rows,
      totalRows: input.rows.length,
      truncated: input.truncated,
    }),
    abortSignal: input.abortSignal,
    order: "cheap",
  });
}
