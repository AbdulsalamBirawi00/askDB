"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { useMemo, useState } from "react";

import type { ColumnKind } from "@askdb/core";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatCell, numberLocale, toNumber } from "@/lib/format";

export const PAGE_SIZE = 25;

type Column = { name: string; kind: ColumnKind };
type Sort = { column: string; direction: "asc" | "desc" } | null;

type Labels = {
  rows: string;
  truncated: string;
  exportCsv: string;
  previousPage: string;
  nextPage: string;
  pageRange: string;
  sortBy: string;
};

function compare(a: unknown, b: unknown, kind: ColumnKind, collator: Intl.Collator): number {
  // Empty values go last in either direction (handled by the caller).
  if (kind === "number") return (toNumber(a) ?? 0) - (toNumber(b) ?? 0);
  return collator.compare(String(a), String(b));
}

/** Sortable, paginated result table with CSV export. Scrolls sideways inside its own box. */
export function ResultTable({
  columns,
  rows,
  truncated,
  lang,
  labels,
}: {
  columns: Column[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  lang: Locale;
  labels: Labels;
}) {
  const [sort, setSort] = useState<Sort>(null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const kind = columns.find((c) => c.name === sort.column)?.kind ?? "text";
    const collator = new Intl.Collator(numberLocale(lang), { numeric: true });
    const sign = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((x, y) => {
      const a = x[sort.column];
      const b = y[sort.column];
      const aEmpty = a === null || a === undefined;
      const bEmpty = b === null || b === undefined;
      if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
      return sign * compare(a, b, kind, collator);
    });
  }, [rows, columns, sort, lang]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  function toggle(column: string) {
    setPage(0);
    setSort((s) =>
      s?.column !== column
        ? { column, direction: "asc" }
        : s.direction === "asc"
          ? { column, direction: "desc" }
          : null,
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {labels.rows.replace("{count}", String(rows.length))}
          {truncated ? ` · ${labels.truncated}` : ""}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => downloadCsv(toCsv(columns, sorted))}
        >
          <Download aria-hidden />
          {labels.exportCsv}
        </Button>
      </div>
      <div className="max-w-full overflow-x-auto rounded-xl border" data-testid="result-scroll">
        <table className="w-full text-sm" data-testid="result-table">
          <thead>
            <tr className="border-b bg-muted/50">
              {columns.map((c) => {
                const active = sort?.column === c.name ? sort.direction : null;
                const Icon =
                  active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown;
                return (
                  <th
                    key={c.name}
                    scope="col"
                    aria-sort={
                      active === "asc" ? "ascending" : active === "desc" ? "descending" : undefined
                    }
                    className={c.kind === "number" ? "text-end" : "text-start"}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(c.name)}
                      aria-label={labels.sortBy.replace("{column}", c.name)}
                      className="inline-flex items-center gap-1 px-3 py-2 font-medium whitespace-nowrap hover:text-foreground"
                    >
                      {c.name}
                      <Icon
                        aria-hidden
                        className={active ? "size-3.5" : "size-3.5 text-muted-foreground/60"}
                      />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={current * PAGE_SIZE + i} className="border-b last:border-0">
                {columns.map((c) => (
                  <td
                    key={c.name}
                    dir={c.kind === "text" ? "auto" : "ltr"}
                    className={`px-3 py-1.5 whitespace-nowrap ${c.kind === "number" ? "text-end tabular-nums" : "text-start"}`}
                  >
                    {formatCell(row[c.name], c.kind, lang)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground" data-testid="page-range">
            {labels.pageRange
              .replace("{from}", String(current * PAGE_SIZE + 1))
              .replace("{to}", String(current * PAGE_SIZE + shown.length))
              .replace("{count}", String(rows.length))}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              {labels.previousPage}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              {labels.nextPage}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
