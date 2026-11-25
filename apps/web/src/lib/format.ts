/**
 * Display helpers for query results, shared by the table, the charts, and CSV export.
 * Client-safe. Values arrive as JSON: int8/numeric as strings, dates as "YYYY-MM-DD"
 * or "YYYY-MM-DD HH:MM:SS" text (the executor keeps Postgres' own text for dates).
 */
import type { ColumnKind } from "@askdb/core";

import type { Locale } from "@/i18n/config";

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Arabic text with Latin digits: query results are easier to compare that way. */
export const numberLocale = (lang: Locale) => (lang === "ar" ? "ar-u-nu-latn" : "en-US");

/** Groups thousands only from 10,000 up, so years (1997) and small ids stay as written. */
export function formatNumber(n: number, lang: Locale, options: { grouping?: boolean } = {}) {
  return new Intl.NumberFormat(numberLocale(lang), {
    maximumFractionDigits: 2,
    useGrouping: options.grouping ?? Math.abs(n) >= 10_000,
  }).format(n);
}

export function formatCompact(n: number, lang: Locale) {
  return new Intl.NumberFormat(numberLocale(lang), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/** "1997-01-01 00:00:00" → "1997-01-01"; times other than midnight are kept to the minute. */
export function formatDate(value: string): string {
  const m = DATE_TEXT.exec(value);
  if (!m) return value;
  const [, y, mo, d, h, mi] = m;
  const date = `${y}-${mo}-${d}`;
  return h && (h !== "00" || mi !== "00") ? `${date} ${h}:${mi}` : date;
}

export function formatCell(value: unknown, kind: ColumnKind, lang: Locale): string {
  if (value === null || value === undefined) return "—";
  if (kind === "number") {
    const n = toNumber(value);
    return n === null ? String(value) : formatNumber(n, lang);
  }
  if (kind === "date" && typeof value === "string") return formatDate(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const MONTH_NAME = /(^|_)month$|^(ال)?شهر$/i;

/**
 * Labels for a chart's X axis. Whole months ("1997-03-01") read "Mar 1997"; a month
 * number column (1–12) reads "Mar". Everything else is shown as the table shows it.
 */
export function axisLabeler(
  column: { name: string; kind: ColumnKind },
  values: unknown[],
  lang: Locale,
): (value: unknown) => string {
  const dates = values.map((v) => (typeof v === "string" ? DATE_TEXT.exec(v) : null));
  if (dates.length && dates.every((m) => m && m[3] === "01" && (!m[4] || m[4] === "00"))) {
    const fmt = new Intl.DateTimeFormat(numberLocale(lang), {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return (v) => {
      const m = typeof v === "string" ? DATE_TEXT.exec(v) : null;
      return m ? fmt.format(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : String(v);
    };
  }
  const numbers = values.map(toNumber);
  if (
    MONTH_NAME.test(column.name) &&
    numbers.every((n) => n !== null && Number.isInteger(n) && n >= 1 && n <= 12)
  ) {
    const fmt = new Intl.DateTimeFormat(numberLocale(lang), { month: "short", timeZone: "UTC" });
    return (v) => fmt.format(Date.UTC(2000, (toNumber(v) ?? 1) - 1, 1));
  }
  return (v) => formatCell(v, column.kind, lang);
}

/** "total_orders" → "total orders". */
export const humanize = (name: string) => name.replace(/_+/g, " ").trim();
