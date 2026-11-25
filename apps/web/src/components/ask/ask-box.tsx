"use client";

import { Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";

import { ProgressSteps } from "@/components/ask/progress-steps";
import { NumberCard } from "@/components/ask/result-chart";
import { ResultTable } from "@/components/ask/result-table";
import { SqlPanel } from "@/components/ask/sql-panel";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { readAskStream, type AskResponse, type ProgressStage } from "@/lib/ask-stream";

// Recharts is large; load it only when a chart is shown.
const ResultChart = dynamic(
  () => import("@/components/ask/result-chart").then((m) => m.ResultChart),
  { ssr: false, loading: () => <div className="h-80 animate-pulse rounded-xl bg-muted" /> },
);

type Labels = Dictionary["ask"];

type State = {
  pending: boolean;
  stage: ProgressStage | null;
  attempt: number;
  answer: AskResponse | null;
  summary: string;
  summarizing: boolean;
  failure: string | null;
};

const IDLE: State = {
  pending: false,
  stage: null,
  attempt: 1,
  answer: null,
  summary: "",
  summarizing: false,
  failure: null,
};

/** The heading for a query that did not run to a result, or null. */
function problemOf(answer: AskResponse, labels: Labels): string | null {
  if (answer.status === "rejected") return `${labels.rejected}: ${answer.error}`;
  if (answer.status === "timeout") return `${labels.timeout}: ${answer.error}`;
  if (answer.status === "error") {
    return answer.attempts >= 3
      ? `${labels.failedAfterRetries} (${answer.error})`
      : `${labels.failed}: ${answer.error}`;
  }
  return null;
}

/**
 * Question in; streamed progress, then the result (chart, table, SQL), then a short
 * summary. A follow-up (e.g. a reply to a clarification) stays in the same conversation.
 */
export function AskBox({
  connectionId,
  lang,
  labels,
}: {
  connectionId: string;
  lang: Locale;
  labels: Labels;
}) {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<State>(IDLE);
  const conversationId = useRef<string | undefined>(undefined);
  const inFlight = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || state.pending) return;
    setQuestion(q);
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState({ ...IDLE, pending: true, stage: "understanding" });

    const fail = (failure: string) =>
      setState((s) => ({ ...s, pending: false, stage: null, summarizing: false, failure }));
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId, question: q, conversationId: conversationId.current }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        fail(
          response.status === 429
            ? labels.dailyLimit
            : response.status === 503
              ? labels.unavailable
              : labels.genericError,
        );
        return;
      }
      for await (const event of readAskStream(response.body)) {
        if (event.type === "stage") {
          setState((s) => ({ ...s, stage: event.stage, attempt: event.attempt }));
        } else if (event.type === "result") {
          conversationId.current = event.result.conversationId;
          const summarizing = event.result.status === "ok" && event.result.rows.length > 0;
          setState((s) => ({ ...s, stage: null, answer: event.result, summarizing }));
        } else if (event.type === "summary") {
          setState((s) => ({ ...s, summary: s.summary + event.text }));
        } else if (event.type === "failure") {
          fail(
            event.code === "unavailable"
              ? labels.unavailable
              : event.code === "connection"
                ? labels.connectionFailed
                : labels.genericError,
          );
          return;
        }
      }
      setState((s) => ({ ...s, pending: false, stage: null, summarizing: false }));
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error(error);
      fail(labels.genericError);
    }
  }

  function editQuestion() {
    input.current?.focus();
    input.current?.select();
  }

  const { answer, failure, summary, summarizing, stage, pending } = state;
  const problem = answer ? problemOf(answer, labels) : null;
  const chart = answer?.status === "ok" ? answer.chart : null;
  const plotted = chart && chart.type !== "table" && chart.type !== "number" ? chart : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label className="sr-only" htmlFor="question">
          {labels.label}
        </label>
        <input
          ref={input}
          id="question"
          name="question"
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={labels.placeholder}
          dir="auto"
          className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" disabled={pending || !question.trim()}>
          {pending ? labels.asking : labels.submit}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{labels.examplesLabel}</span>
        {labels.examples.map((example) => (
          <button
            key={example}
            type="button"
            dir="auto"
            disabled={pending}
            onClick={() => void ask(example)}
            className="rounded-full border px-3 py-1 hover:bg-muted disabled:opacity-50"
            data-testid="example-question"
          >
            {example}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="flex min-w-0 flex-col gap-4">
        {stage && <ProgressSteps stage={stage} attempt={state.attempt} labels={labels} />}

        {failure && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {failure}
          </p>
        )}

        {answer?.status === "clarification" && (
          <div className="rounded-xl border bg-muted/40 p-4" data-testid="clarification">
            <p className="text-xs text-muted-foreground">{labels.clarification}</p>
            <p dir="auto">{answer.clarificationQuestion}</p>
          </div>
        )}

        {answer && answer.status !== "clarification" && (
          <div className="flex min-w-0 flex-col gap-4" data-testid="answer">
            {problem && (
              <div
                role="alert"
                className="flex flex-col items-start gap-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="answer-problem"
              >
                <p dir="auto">{problem}</p>
                <Button type="button" variant="outline" size="sm" onClick={editQuestion}>
                  <Pencil aria-hidden />
                  {labels.editQuestion}
                </Button>
              </div>
            )}

            {answer.status === "ok" && (summary || summarizing) && (
              <section aria-label={labels.summaryLabel} data-testid="summary">
                {summary ? (
                  <p dir="auto" className="text-base leading-relaxed">
                    {summary}
                  </p>
                ) : (
                  <p className="animate-pulse text-sm text-muted-foreground">
                    {labels.summarizing}
                  </p>
                )}
              </section>
            )}

            {answer.repaired && (
              <p className="text-xs text-muted-foreground" data-testid="repaired-note">
                {labels.repairedNote}
              </p>
            )}

            {answer.status === "ok" && answer.rows.length === 0 && (
              <p
                className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground"
                data-testid="no-results"
              >
                {labels.noRows}
              </p>
            )}

            {chart?.type === "number" && (
              <NumberCard name={chart.value} value={answer.rows[0]?.[chart.value]} lang={lang} />
            )}

            {plotted && (
              <ResultChart
                chart={plotted}
                columns={answer.columns}
                rows={answer.rows}
                lang={lang}
                label={labels.chartLabel}
              />
            )}

            {answer.status === "ok" && answer.rows.length > 0 && chart?.type !== "number" && (
              <ResultTable
                columns={answer.columns}
                rows={answer.rows}
                truncated={answer.truncated}
                lang={lang}
                labels={labels}
              />
            )}

            {answer.sql && (
              <SqlPanel
                sql={answer.sql}
                explanation={answer.explanation}
                open={answer.status !== "ok"}
                labels={labels}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
