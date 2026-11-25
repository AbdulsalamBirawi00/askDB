/**
 * The /api/ask wire format, shared by the route and the browser. The response is
 * newline-delimited JSON: progress stages, then the result, then the summary text in
 * pieces, then `done`. Safe to import from client components (no server code).
 */
import type { ChartSpec, ColumnKind } from "@askdb/core";

export type AskStatus = "ok" | "clarification" | "rejected" | "error" | "timeout";

/** Shown in order by the progress indicator. "repairing" is a retry of "writing". */
export type ProgressStage = "understanding" | "writing" | "running" | "repairing";

export type AskResponse = {
  conversationId: string;
  queryId: string;
  status: AskStatus;
  sql: string | null;
  explanation: string | null;
  chart: ChartSpec | null;
  clarificationQuestion: string | null;
  error: string | null;
  /** Model calls for the SQL: 1, or up to 3 after repairs. */
  attempts: number;
  repaired: boolean;
  columns: { name: string; kind: ColumnKind }[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  durationMs: number;
};

/** Failures that stop the answer. `unavailable`: no model right now; `connection`: the database. */
export type AskFailureCode = "unavailable" | "connection" | "error";

export type AskEvent =
  | { type: "stage"; stage: ProgressStage; attempt: number }
  | { type: "result"; result: AskResponse }
  | { type: "summary"; text: string }
  | { type: "failure"; code: AskFailureCode; message: string }
  | { type: "done" };

export const ASK_STREAM_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

/** Reads an NDJSON body event by event. Ignores blank lines; stops at the end of the body. */
export async function* readAskStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AskEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as AskEvent;
    }
    if (done) break;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as AskEvent;
}
