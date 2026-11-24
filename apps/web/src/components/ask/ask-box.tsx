"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type Labels = {
  placeholder: string;
  label: string;
  submit: string;
  asking: string;
  sql: string;
  rows: string;
  truncated: string;
  noRows: string;
  clarification: string;
  rejected: string;
  failed: string;
  timeout: string;
  unavailable: string;
  genericError: string;
  examples: string;
  example1: string;
  example2: string;
  example3: string;
};

type Answer = {
  conversationId: string;
  status: "ok" | "clarification" | "rejected" | "error" | "timeout";
  sql: string | null;
  explanation: string | null;
  clarificationQuestion: string | null;
  error: string | null;
  columns: { name: string }[];
  rows: Record<string, unknown>[];
  truncated: boolean;
};

const MAX_SHOWN_ROWS = 100;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ResultTable({ answer, labels }: { answer: Answer; labels: Labels }) {
  if (answer.rows.length === 0)
    return <p className="text-sm text-muted-foreground">{labels.noRows}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {labels.rows.replace("{count}", String(answer.rows.length))}
        {answer.truncated ? ` · ${labels.truncated}` : ""}
      </p>
      <div className="overflow-x-auto rounded-xl border" dir="ltr">
        <table className="w-full text-sm" data-testid="result-table">
          <thead>
            <tr className="border-b bg-muted/50">
              {answer.columns.map((c) => (
                <th key={c.name} className="px-3 py-2 text-start font-medium whitespace-nowrap">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {answer.rows.slice(0, MAX_SHOWN_ROWS).map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                {answer.columns.map((c) => (
                  <td key={c.name} className="px-3 py-1.5 whitespace-nowrap">
                    {cell(row[c.name])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Minimal Stage 3 ask box: question in, SQL + explanation + table out. Stage 4 replaces it. */
export function AskBox({ connectionId, labels }: { connectionId: string; labels: Labels }) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    setQuestion(q);
    setPending(true);
    setFailure(null);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectionId,
          question: q,
          // A reply to a clarification stays in the same conversation.
          conversationId: answer?.conversationId,
        }),
      });
      if (response.ok) {
        setAnswer((await response.json()) as Answer);
      } else {
        setAnswer(null);
        setFailure(response.status === 503 ? labels.unavailable : labels.genericError);
      }
    } catch {
      setFailure(labels.genericError);
    }
    setPending(false);
  }

  const heading =
    answer?.status === "rejected"
      ? labels.rejected
      : answer?.status === "error"
        ? labels.failed
        : answer?.status === "timeout"
          ? labels.timeout
          : null;

  return (
    <div className="flex flex-col gap-6">
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
          id="question"
          name="question"
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={labels.placeholder}
          dir="auto"
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" disabled={pending || !question.trim()}>
          {pending ? labels.asking : labels.submit}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{labels.examples}</span>
        {[labels.example1, labels.example2, labels.example3].map((example) => (
          <button
            key={example}
            type="button"
            dir="auto"
            disabled={pending}
            onClick={() => void ask(example)}
            className="rounded-full border px-3 py-1 hover:bg-muted"
          >
            {example}
          </button>
        ))}
      </div>

      <div role="status" aria-live="polite" className="flex flex-col gap-4 empty:hidden">
        {failure && <p className="text-sm text-destructive">{failure}</p>}
        {answer?.status === "clarification" && (
          <div className="rounded-xl border bg-muted/40 p-4" data-testid="clarification">
            <p className="text-xs text-muted-foreground">{labels.clarification}</p>
            <p dir="auto">{answer.clarificationQuestion}</p>
          </div>
        )}
        {answer && answer.status !== "clarification" && (
          <div className="flex flex-col gap-4" data-testid="answer">
            {answer.explanation && <p dir="auto">{answer.explanation}</p>}
            {heading && (
              <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {heading}: {answer.error}
              </p>
            )}
            {answer.sql && (
              <details className="rounded-xl border" open={answer.status !== "ok"}>
                <summary className="cursor-pointer p-3 text-sm font-medium">{labels.sql}</summary>
                <pre className="overflow-x-auto border-t p-3 text-xs" dir="ltr">
                  {answer.sql}
                </pre>
              </details>
            )}
            {answer.status === "ok" && <ResultTable answer={answer} labels={labels} />}
          </div>
        )}
      </div>
    </div>
  );
}
