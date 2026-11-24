import { generateWithFallback, type ProviderConfig, type ProviderName } from "./ai/providers";
import {
  buildSqlPrompt,
  SQL_INSTRUCTIONS,
  sqlGenerationSchema,
  type ChartType,
  type PromptTable,
} from "./ai/prompt";
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

type Base = {
  provider: ProviderName;
  model: string;
  tokens: number | null;
  explanation: string;
};

export type AskOutcome =
  | (Base & { status: "clarification"; clarificationQuestion: string; sql: null })
  | (Base & { status: "rejected"; sql: string; reason: GuardReason; error: string })
  | (Base & { status: "error"; sql: string; error: string; code: string })
  | (Base & { status: "timeout"; sql: string; error: string })
  | (Base & {
      status: "ok";
      sql: string;
      chartType: ChartType;
      result: QueryResult;
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

/**
 * Question → model → guard → read-only execution. Provider failures and connection
 * failures are thrown (the caller decides the response); everything about the query
 * itself comes back as an outcome so it can be logged.
 */
export async function askQuestion(input: {
  question: string;
  url: URL;
  tables: AskTable[];
  providers: ProviderConfig;
  abortSignal?: AbortSignal;
}): Promise<AskOutcome> {
  const generation = await generateWithFallback(input.providers, {
    instructions: SQL_INSTRUCTIONS,
    prompt: buildSqlPrompt(input.question, promptTables(input.tables)),
    schema: sqlGenerationSchema,
    abortSignal: input.abortSignal,
  });
  const { output } = generation;
  const base: Base = {
    provider: generation.provider,
    model: generation.model,
    tokens: generation.tokens,
    explanation: output.explanation,
  };

  if (output.needsClarification || !output.sql) {
    return {
      ...base,
      status: "clarification",
      sql: null,
      clarificationQuestion: output.clarificationQuestion || output.explanation,
    };
  }

  const guarded = guardSql(output.sql, {
    tables: input.tables.map((t) => ({
      schema: t.schema,
      name: t.name,
      hidden: t.hidden,
      columns: t.columns.map((c) => ({ name: c.name, hidden: c.hidden })),
    })),
  });
  if (!guarded.ok) {
    return {
      ...base,
      status: "rejected",
      sql: output.sql,
      reason: guarded.reason,
      error: guarded.message,
    };
  }

  try {
    const result = await executeReadOnly(input.url, guarded.sql);
    const visible = dropHiddenColumns(result.rows, result.columns, guarded.hiddenColumns);
    return {
      ...base,
      status: "ok",
      sql: guarded.sql,
      chartType: output.chartType,
      result: {
        ...result,
        rows: visible.rows,
        columns: result.columns.filter((c) => visible.columns.some((v) => v.name === c.name)),
      },
    };
  } catch (error) {
    if (error instanceof QueryTimeoutError) {
      return { ...base, status: "timeout", sql: guarded.sql, error: error.message };
    }
    if (error instanceof QueryExecutionError) {
      return { ...base, status: "error", sql: guarded.sql, error: error.message, code: error.code };
    }
    throw error;
  }
}
