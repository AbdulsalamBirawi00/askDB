"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ChartSpec, ColumnKind } from "@askdb/core";

import { getDirection, type Locale } from "@/i18n/config";
import { axisLabeler, formatCompact, formatNumber, humanize, toNumber } from "@/lib/format";

/** Theme tokens (globals.css), so charts follow light and dark mode. */
const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 12,
};
/** Past this many categories, bars lie flat so long labels stay readable. */
const HORIZONTAL_BARS_FROM = 10;

type Column = { name: string; kind: ColumnKind };
type Plot = Extract<ChartSpec, { x: string }>;

/**
 * Line, bar, or pie chart for a result. Column names become safe keys (`y0`, `y1`...)
 * so names with dots or spaces don't read as paths. In Arabic the X axis runs right to
 * left and the value axis sits on the right.
 */
export function ResultChart({
  chart,
  columns,
  rows,
  lang,
  label,
}: {
  chart: Plot;
  columns: Column[];
  rows: Record<string, unknown>[];
  lang: Locale;
  label: string;
}) {
  const rtl = getDirection(lang) === "rtl";
  const xColumn = columns.find((c) => c.name === chart.x) ?? { name: chart.x, kind: "text" };
  const labelX = axisLabeler(
    xColumn,
    rows.map((r) => r[chart.x]),
    lang,
  );
  const series = chart.y.map((name, i) => ({
    key: `y${i}`,
    name,
    color: COLORS[i % COLORS.length]!,
  }));
  const data = rows.map((row) => {
    const point: Record<string, string | number | null> = { x: labelX(row[chart.x]) };
    series.forEach((s) => (point[s.key] = toNumber(row[s.name])));
    return point;
  });
  const valueTick = (v: number) => formatCompact(v, lang);
  const tooltipValue = (v: unknown) => (typeof v === "number" ? formatNumber(v, lang) : String(v));
  const legend = series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null;

  let body: React.ReactElement;
  let height = 320;
  if (chart.type === "line") {
    body = (
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="x" tick={AXIS_TICK} reversed={rtl} tickMargin={8} minTickGap={16} />
        <YAxis
          tick={AXIS_TICK}
          tickFormatter={valueTick}
          orientation={rtl ? "right" : "left"}
          width={56}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipValue} />
        {legend}
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={humanize(s.name)}
            stroke={s.color}
            strokeWidth={2}
            dot={data.length <= 24}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    );
  } else if (chart.type === "pie") {
    body = (
      <PieChart>
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipValue} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Pie
          data={data}
          dataKey={series[0]!.key}
          nameKey="x"
          innerRadius="45%"
          outerRadius="80%"
          isAnimationActive={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="var(--background)" />
          ))}
        </Pie>
      </PieChart>
    );
  } else if (data.length >= HORIZONTAL_BARS_FROM) {
    height = Math.max(240, data.length * 26 + 40);
    body = (
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickFormatter={valueTick} reversed={rtl} />
        <YAxis
          type="category"
          dataKey="x"
          tick={AXIS_TICK}
          width={120}
          interval={0}
          orientation={rtl ? "right" : "left"}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={tooltipValue}
          cursor={{ fill: "var(--muted)" }}
        />
        {legend}
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={humanize(s.name)}
            fill={s.color}
            radius={3}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    );
  } else {
    body = (
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="x" tick={AXIS_TICK} reversed={rtl} interval={0} tickMargin={8} />
        <YAxis
          tick={AXIS_TICK}
          tickFormatter={valueTick}
          orientation={rtl ? "right" : "left"}
          width={56}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={tooltipValue}
          cursor={{ fill: "var(--muted)" }}
        />
        {legend}
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={humanize(s.name)}
            fill={s.color}
            radius={3}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    );
  }

  return (
    <figure
      className="rounded-xl border p-3"
      data-testid="chart"
      data-chart-type={chart.type}
      aria-label={label}
    >
      <div style={{ height }} dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          {body}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** One value, big: "Total number of orders?" → 830. */
export function NumberCard({ name, value, lang }: { name: string; value: unknown; lang: Locale }) {
  const n = toNumber(value);
  return (
    <div className="flex flex-col gap-1 rounded-xl border p-6" data-testid="number-card">
      <span className="text-sm text-muted-foreground">{humanize(name)}</span>
      <span className="font-heading text-4xl font-bold tabular-nums" dir="ltr">
        {n === null ? String(value ?? "—") : formatNumber(n, lang, { grouping: true })}
      </span>
    </div>
  );
}
