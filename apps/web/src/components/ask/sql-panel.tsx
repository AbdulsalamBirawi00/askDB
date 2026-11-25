"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type Labels = { sql: string; copy: string; copied: string; explanationLabel: string };

/** Collapsible "Show SQL" with the model's explanation and a copy button. */
export function SqlPanel({
  sql,
  explanation,
  open,
  labels,
}: {
  sql: string;
  explanation: string | null;
  open: boolean;
  labels: Labels;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <details className="group rounded-xl border" open={open} data-testid="sql-panel">
      <summary className="cursor-pointer p-3 text-sm font-medium">{labels.sql}</summary>
      <div className="flex flex-col gap-2 border-t p-3">
        {explanation && (
          <p className="text-sm text-muted-foreground" dir="auto">
            <span className="font-medium text-foreground">{labels.explanationLabel}: </span>
            {explanation}
          </p>
        )}
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
      </div>
    </details>
  );
}
