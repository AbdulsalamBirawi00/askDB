import "server-only";

import {
  askQuestion,
  ConnectionUrlError,
  ExecutorConnectionError,
  NoProviderError,
  ProvidersFailedError,
  summarizeResult,
  type AskOutcome,
  type AskTable,
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
import type { AskEvent, AskFailureCode, AskResponse } from "@/lib/ask-stream";
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

type AskInput = { connectionId: string; question: string; conversationId?: string };

/** Everything checked before the answer starts streaming: ownership, schema, conversation. */
export type PreparedAsk = {
  url: URL;
  tables: AskTable[];
  conversationId: string;
  question: string;
};

/**
 * Ownership checks and setup. Null when the connection (or the conversation) is not the
 * user's, so the route can answer 404 before any streaming starts. Connection URL errors
 * are thrown for the route to map.
 */
export async function prepareAsk(userId: string, input: AskInput): Promise<PreparedAsk | null> {
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
  return { url, tables, conversationId, question: input.question };
}

function failureOf(error: unknown): { code: AskFailureCode; message: string } | null {
  if (error instanceof NoProviderError) {
    return {
      code: "unavailable",
      message: "Questions are not available: no language model is configured",
    };
  }
  if (error instanceof ProvidersFailedError) return { code: "unavailable", message: error.message };
  if (error instanceof ExecutorConnectionError || error instanceof ConnectionUrlError) {
    return { code: "connection", message: "Connection failed" };
  }
  return null;
}

function toResponse(
  outcome: AskOutcome,
  ids: { conversationId: string; queryId: string },
  durationMs: number,
): AskResponse {
  const ok = outcome.status === "ok" ? outcome : null;
  return {
    ...ids,
    status: outcome.status,
    sql: outcome.sql,
    explanation: outcome.explanation,
    chart: ok ? ok.chart : null,
    clarificationQuestion:
      outcome.status === "clarification" ? outcome.clarificationQuestion : null,
    error: "error" in outcome ? outcome.error : null,
    attempts: outcome.attempts,
    repaired: ok ? ok.repaired : false,
    columns: ok ? ok.columns : [],
    rows: ok ? ok.result.rows : [],
    truncated: ok ? ok.result.truncated : false,
    durationMs,
  };
}

/**
 * Runs one prepared question and streams it as NDJSON events (see lib/ask-stream.ts):
 * stages → result (logged in `queries` first) → summary pieces → done. Provider and
 * connection failures are logged, then sent as a `failure` event. The summary is
 * best effort: if it fails, the answer is still complete without it.
 */
export function streamAsk(prepared: PreparedAsk, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const db = getDb();
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const log = (entry: Omit<QueryLogInput, "conversationId" | "question" | "durationMs">) =>
    logQuery(db, {
      conversationId: prepared.conversationId,
      question: prepared.question,
      durationMs: elapsed(),
      ...entry,
    });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: AskEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false; // The client went away.
        }
      };
      const close = () => {
        send({ type: "done" });
        if (open) controller.close();
        open = false;
      };

      send({ type: "stage", stage: "understanding", attempt: 1 });
      let outcome: AskOutcome;
      try {
        outcome = await askQuestion({
          question: prepared.question,
          url: prepared.url,
          tables: prepared.tables,
          providers: providerConfig(),
          abortSignal: signal,
          onStage: (stage, attempt) => send({ type: "stage", stage, attempt }),
        });
      } catch (error) {
        const failure = failureOf(error);
        await log({
          sql: null,
          status: "error",
          error: failure?.message ?? "Unexpected error",
          provider: null,
          model: null,
          tokens: null,
          rowCount: null,
        }).catch(() => {});
        if (!failure) console.error("ask failed", error);
        send({
          type: "failure",
          ...(failure ?? { code: "error", message: "Something went wrong" }),
        });
        close();
        return;
      }

      const ok = outcome.status === "ok" ? outcome : null;
      const { id: queryId } = await log({
        sql: outcome.sql,
        status: outcome.status,
        error: "error" in outcome ? outcome.error : null,
        provider: outcome.provider,
        model: outcome.model,
        tokens: outcome.tokens,
        rowCount: ok ? ok.result.rows.length : null,
        repaired: ok ? ok.repaired : false,
      });
      send({
        type: "result",
        result: toResponse(
          outcome,
          { conversationId: prepared.conversationId, queryId },
          elapsed(),
        ),
      });

      if (ok && ok.result.rows.length > 0 && open) {
        try {
          for await (const text of summarizeResult({
            question: prepared.question,
            columns: ok.columns.map((c) => c.name),
            rows: ok.result.rows,
            truncated: ok.result.truncated,
            providers: providerConfig(),
            abortSignal: signal,
          })) {
            send({ type: "summary", text });
            if (!open) break;
          }
        } catch {
          // No summary: the table and chart are the answer.
        }
      }
      close();
    },
  });
}
