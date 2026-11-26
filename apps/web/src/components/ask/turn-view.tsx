"use client";

import { Pencil, RotateCw } from "lucide-react";
import dynamic from "next/dynamic";

import { ProgressSteps } from "@/components/ask/progress-steps";
import { RatingButtons, type Rating } from "@/components/ask/rating";
import { NumberCard } from "@/components/ask/result-chart";
import { ResultTable } from "@/components/ask/result-table";
import { SqlPanel } from "@/components/ask/sql-panel";
import { PinButton } from "@/components/dashboard/pin-button";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import type { AskResponse, AskStatus, ProgressStage } from "@/lib/ask-stream";

// Recharts is large; load it only when a chart is shown.
const ResultChart = dynamic(
  () => import("@/components/ask/result-chart").then((m) => m.ResultChart),
  { ssr: false, loading: () => <div className="h-80 animate-pulse rounded-xl bg-muted" /> },
);

type Labels = Dictionary["ask"];

/** A question answered in this visit: progress, then the full result. */
export type LiveTurn = {
  pending: boolean;
  stage: ProgressStage | null;
  attempt: number;
  answer: AskResponse | null;
  summary: string;
  summarizing: boolean;
  failure: string | null;
};

/** A question from a reopened conversation. Results are never stored, only the SQL. */
export type SavedTurn = {
  id: string;
  question: string;
  sql: string | null;
  status: AskStatus;
  error: string | null;
  explanation: string | null;
  rating: number | null;
  repaired: boolean;
  edited: boolean;
};

export type Turn = {
  key: string;
  question: string;
  /** The logged query, once there is one: for ratings and the SQL editor. */
  queryId: string | null;
  rating: Rating;
  live: LiveTurn | null;
  saved: SavedTurn | null;
};

/** The heading for a query that did not run to a result, or null. */
function problemOf(
  turn: { status: AskStatus; error: string | null; attempts?: number },
  labels: Labels,
): string | null {
  if (turn.status === "rejected") return `${labels.rejected}: ${turn.error}`;
  if (turn.status === "timeout") return `${labels.timeout}: ${turn.error}`;
  if (turn.status === "error") {
    return (turn.attempts ?? 0) >= 3
      ? `${labels.failedAfterRetries} (${turn.error})`
      : `${labels.failed}: ${turn.error}`;
  }
  return null;
}

function Problem({
  text,
  labels,
  onEditQuestion,
}: {
  text: string;
  labels: Labels;
  onEditQuestion: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
      data-testid="answer-problem"
    >
      <p dir="auto">{text}</p>
      <Button type="button" variant="outline" size="sm" onClick={onEditQuestion}>
        <Pencil aria-hidden />
        {labels.editQuestion}
      </Button>
    </div>
  );
}

function Clarification({ text, labels }: { text: string | null; labels: Labels }) {
  return (
    <div className="rounded-xl border bg-muted/40 p-4" data-testid="clarification">
      <p className="text-xs text-muted-foreground">{labels.clarification}</p>
      <p dir="auto">{text}</p>
    </div>
  );
}

/**
 * One question and its answer. A live turn shows the streamed result; a saved one shows
 * the SQL with "Run again". Both can be rated and have their SQL edited and run.
 */
export function TurnView({
  turn,
  lang,
  labels,
  busy,
  onEditQuestion,
  onRunSql,
  onRate,
}: {
  turn: Turn;
  lang: Locale;
  labels: Labels;
  /** Another question is running: editing and re-running wait. */
  busy: boolean;
  onEditQuestion: (question: string) => void;
  onRunSql: (turn: Turn, sql: string) => void;
  onRate: (turn: Turn, rating: Rating) => void;
}) {
  const editQuestion = () => onEditQuestion(turn.question);
  const runSql = turn.queryId ? (sql: string) => onRunSql(turn, sql) : undefined;
  const status = turn.live?.answer?.status ?? turn.saved?.status ?? null;
  const rateable = turn.queryId !== null && status !== null && status !== "clarification";
  const edited = turn.live?.answer?.edited ?? turn.saved?.edited ?? false;
  // Only a query that ran can become a dashboard card.
  const pinnable = turn.queryId !== null && status === "ok";

  return (
    <article className="flex min-w-0 flex-col gap-4" data-testid="turn">
      <p
        dir="auto"
        className="max-w-full self-start rounded-2xl bg-muted px-4 py-2 font-medium break-words"
        data-testid="turn-question"
      >
        {turn.question}
      </p>

      {turn.live && (
        <LiveAnswer
          live={turn.live}
          lang={lang}
          labels={labels}
          busy={busy}
          onEditQuestion={editQuestion}
          onRunSql={runSql}
        />
      )}
      {turn.saved && (
        <SavedAnswer
          saved={turn.saved}
          labels={labels}
          busy={busy}
          onEditQuestion={editQuestion}
          onRunSql={runSql}
        />
      )}

      {(edited || rateable || pinnable) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {edited ? (
            <p className="text-xs text-muted-foreground" data-testid="edited-note">
              {labels.editedNote}
            </p>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {pinnable && turn.queryId && (
              <PinButton queryId={turn.queryId} lang={lang} labels={labels} />
            )}
            {rateable && (
              <RatingButtons
                value={turn.rating}
                onChange={(r) => onRate(turn, r)}
                labels={labels}
              />
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function LiveAnswer({
  live,
  lang,
  labels,
  busy,
  onEditQuestion,
  onRunSql,
}: {
  live: LiveTurn;
  lang: Locale;
  labels: Labels;
  busy: boolean;
  onEditQuestion: () => void;
  onRunSql?: (sql: string) => void;
}) {
  const { answer, failure, summary, summarizing, stage } = live;
  const problem = answer ? problemOf(answer, labels) : null;
  const chart = answer?.status === "ok" ? answer.chart : null;
  const plotted = chart && chart.type !== "table" && chart.type !== "number" ? chart : null;

  return (
    <div aria-live="polite" className="flex min-w-0 flex-col gap-4">
      {stage && <ProgressSteps stage={stage} attempt={live.attempt} labels={labels} />}

      {failure && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {failure}
        </p>
      )}

      {answer?.status === "clarification" && (
        <Clarification text={answer.clarificationQuestion} labels={labels} />
      )}

      {answer && answer.status !== "clarification" && (
        <div className="flex min-w-0 flex-col gap-4" data-testid="answer">
          {problem && <Problem text={problem} labels={labels} onEditQuestion={onEditQuestion} />}

          {answer.status === "ok" && (summary || summarizing) && (
            <section aria-label={labels.summaryLabel} data-testid="summary">
              {summary ? (
                <p dir="auto" className="text-base leading-relaxed">
                  {summary}
                </p>
              ) : (
                <p className="animate-pulse text-sm text-muted-foreground">{labels.summarizing}</p>
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
              onRun={onRunSql}
              busy={busy}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SavedAnswer({
  saved,
  labels,
  busy,
  onEditQuestion,
  onRunSql,
}: {
  saved: SavedTurn;
  labels: Labels;
  busy: boolean;
  onEditQuestion: () => void;
  onRunSql?: (sql: string) => void;
}) {
  if (saved.status === "clarification") {
    return <Clarification text={saved.explanation} labels={labels} />;
  }
  const problem = problemOf(saved, labels);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="saved-answer">
      {problem && <Problem text={problem} labels={labels} onEditQuestion={onEditQuestion} />}
      {saved.sql && saved.status === "ok" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
          <p className="flex-1">{labels.savedNote}</p>
          {onRunSql && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onRunSql(saved.sql!)}
            >
              <RotateCw aria-hidden />
              {labels.runAgain}
            </Button>
          )}
        </div>
      )}
      {saved.sql && (
        <SqlPanel
          sql={saved.sql}
          explanation={saved.explanation}
          open={saved.status !== "ok"}
          labels={labels}
          onRun={onRunSql}
          busy={busy}
        />
      )}
    </div>
  );
}
