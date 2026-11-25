"use client";

import { Check, Copy, Pencil, Play } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

// CodeMirror loads only when someone edits SQL.
const SqlEditor = dynamic(() => import("@/components/ask/sql-editor").then((m) => m.SqlEditor), {
  ssr: false,
  loading: () => <div className="h-24 animate-pulse rounded-lg bg-muted" />,
});

type Labels = {
  sql: string;
  copy: string;
  copied: string;
  explanationLabel: string;
  editSql: string;
  runSql: string;
  cancelEdit: string;
  sqlEditorLabel: string;
};

/**
 * Collapsible "Show SQL" with the model's explanation, a copy button and, when `onRun` is
 * given, an editor to change the query and run it again (on the server, through the guard).
 */
export function SqlPanel({
  sql,
  explanation,
  open,
  labels,
  onRun,
  busy = false,
}: {
  sql: string;
  explanation: string | null;
  open: boolean;
  labels: Labels;
  onRun?: (sql: string) => void;
  busy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const run = () => {
    if (!onRun || busy || draft === null || !draft.trim()) return;
    onRun(draft);
    setDraft(null);
  };

  return (
    <details
      className="group rounded-xl border"
      open={open || draft !== null}
      data-testid="sql-panel"
    >
      <summary className="cursor-pointer p-3 text-sm font-medium">{labels.sql}</summary>
      <div className="flex flex-col gap-2 border-t p-3">
        {explanation && (
          <p className="text-sm text-muted-foreground" dir="auto">
            <span className="font-medium text-foreground">{labels.explanationLabel}: </span>
            {explanation}
          </p>
        )}
        {draft === null ? (
          <div className="relative">
            <pre
              className="max-w-full overflow-x-auto rounded-lg bg-muted/50 p-3 pe-20 text-xs"
              dir="ltr"
              data-testid="sql"
            >
              {sql}
            </pre>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="absolute end-2 top-2"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(sql)
                  .then(() => setCopied(true))
                  .catch(() => {});
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? labels.copied : labels.copy}
            </Button>
          </div>
        ) : (
          <SqlEditor
            initial={sql}
            label={labels.sqlEditorLabel}
            onChange={setDraft}
            onSubmit={run}
          />
        )}
        {onRun && (
          <div className="flex flex-wrap gap-2">
            {draft === null ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setDraft(sql)}
              >
                <Pencil aria-hidden />
                {labels.editSql}
              </Button>
            ) : (
              <>
                <Button type="button" size="sm" disabled={busy || !draft.trim()} onClick={run}>
                  <Play aria-hidden />
                  {labels.runSql}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
                  {labels.cancelEdit}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
