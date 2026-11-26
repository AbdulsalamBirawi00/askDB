"use client";

import dynamic from "next/dynamic";

import { NumberCard } from "@/components/ask/result-chart";
import { ResultTable } from "@/components/ask/result-table";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import type { CardResult } from "@/lib/dashboard-types";

// Recharts is large; load it only when a chart is shown.
const ResultChart = dynamic(
  () => import("@/components/ask/result-chart").then((m) => m.ResultChart),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-muted" /> },
);

/** One card's result: its chart (or number), its table, or its error, alone in the card. */
export function CardBody({
  result,
  lang,
  askLabels,
  labels,
}: {
  result: CardResult | null;
  lang: Locale;
  askLabels: Dictionary["ask"];
  labels: Dictionary["dashboards"];
}) {
  if (!result) {
    return <p className="text-sm text-muted-foreground">{labels.noResultYet}</p>;
  }
  if (result.status !== "ok") {
    return (
      <p
        role="alert"
        className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
        data-testid="card-error"
        dir="auto"
      >
        {labels.cardFailed}: {result.error}
      </p>
    );
  }
  if (result.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{askLabels.noRows}</p>;
  }
  const chart = result.chart;
  if (chart?.type === "number") {
    return <NumberCard name={chart.value} value={result.rows[0]?.[chart.value]} lang={lang} />;
  }
  if (chart && chart.type !== "table") {
    return (
      <ResultChart
        chart={chart}
        columns={result.columns}
        rows={result.rows}
        lang={lang}
        label={askLabels.chartLabel}
      />
    );
  }
  return (
    <ResultTable
      columns={result.columns}
      rows={result.rows}
      truncated={result.truncated}
      lang={lang}
      labels={askLabels}
    />
  );
}
