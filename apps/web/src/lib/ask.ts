import "server-only";

import {
  askQuestion,
  ConnectionUrlError,
  ExecutorConnectionError,
  NoProviderError,
  ProvidersFailedError,
  type AskOutcome,
  type ProviderConfig,
} from "@askdb/core";
import {
  createConversation,
  getConnectionSchema,
  getOwnedConversation,
  logQuery,
  type QueryLogInput,
} from "@askdb/db";

import { getEnv } from "@/env";
import { openVisibleConnection } from "@/lib/connections";
import { getDb } from "@/lib/db";

export function providerConfig(): ProviderConfig {
  const env = getEnv();
  return {
    groqApiKey: env.GROQ_API_KEY,
    groqModel: env.GROQ_MODEL,
    googleApiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    googleModel: env.GOOGLE_MODEL,
    googleFallbackModel: env.GOOGLE_FALLBACK_MODEL,
    // Local models are for development only.
    ollamaBaseUrl: env.NODE_ENV === "production" ? undefined : env.OLLAMA_BASE_URL,
    ollamaModel: env.OLLAMA_MODEL,
  };
}

export type AskResponse = {
  conversationId: string;
  queryId: string;
  status: AskOutcome["status"];
  sql: string | null;
  explanation: string | null;
  chartType: string | null;
  clarificationQuestion: string | null;
  error: string | null;
  columns: { name: string }[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  durationMs: number;
};

type AskInput = { connectionId: string; question: string; conversationId?: string };

/**
 * Runs one question for a user and logs it. Returns null when the connection (or the
 * conversation) is not the user's. Provider and connection failures are logged too,
 * then rethrown for the route to turn into a status code.
 */
export async function askForUser(
  userId: string,
  input: AskInput,
): Promise<{ response: AskResponse; httpStatus: number } | null> {
  const db = getDb();
  const url = await openVisibleConnection(userId, input.connectionId);
  if (!url) return null;
  const tables = await getConnectionSchema(db, input.connectionId, userId);
  if (!tables) return null;

  let conversationId = input.conversationId;
  if (conversationId) {
    const owned = await getOwnedConversation(db, {
      id: conversationId,
      userId,
      connectionId: input.connectionId,
    });
    if (!owned) return null;
  } else {
    conversationId = (
      await createConversation(db, {
        userId,
        connectionId: input.connectionId,
        title: input.question,
      })
    ).id;
  }

  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const log = (entry: Omit<QueryLogInput, "conversationId" | "question" | "durationMs">) =>
    logQuery(db, {
      conversationId: conversationId!,
      question: input.question,
      durationMs: elapsed(),
      ...entry,
    });

  let outcome: AskOutcome;
  try {
    outcome = await askQuestion({
      question: input.question,
      url,
      tables,
      providers: providerConfig(),
    });
  } catch (error) {
    if (
      error instanceof ProvidersFailedError ||
      error instanceof NoProviderError ||
      error instanceof ExecutorConnectionError ||
      error instanceof ConnectionUrlError
    ) {
      await log({
        sql: null,
        status: "error",
        error: error.message,
        provider: null,
        model: null,
        tokens: null,
        rowCount: null,
      });
    }
    throw error;
  }

  const ok = outcome.status === "ok" ? outcome : null;
  const error = "error" in outcome ? outcome.error : null;
  const { id: queryId } = await log({
    sql: outcome.sql,
    status: outcome.status,
    error,
    provider: outcome.provider,
    model: outcome.model,
    tokens: outcome.tokens,
    rowCount: ok ? ok.result.rows.length : null,
  });

  return {
    httpStatus: 200,
    response: {
      conversationId,
      queryId,
      status: outcome.status,
      sql: outcome.sql,
      explanation: outcome.explanation,
      chartType: ok ? ok.chartType : null,
      clarificationQuestion:
        outcome.status === "clarification" ? outcome.clarificationQuestion : null,
      error,
      columns: ok ? ok.result.columns.map((c) => ({ name: c.name })) : [],
      rows: ok ? ok.result.rows : [],
      truncated: ok ? ok.result.truncated : false,
      durationMs: elapsed(),
    },
  };
}
