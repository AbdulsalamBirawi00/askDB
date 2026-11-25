import type { ChartType } from "../ai/prompt";

/** How a result column behaves for display: sorting, alignment, and charting. */
export type ColumnKind = "number" | "date" | "text";

export type ChartSpec =
  | { type: "table" }
  | { type: "number"; value: string }
  | { type: "line" | "bar" | "pie"; x: string; y: string[] };

// Postgres type OIDs. int8 and numeric arrive as strings (exact values); the UI converts them.
const NUMBER_TYPES = new Set([20, 21, 23, 700, 701, 1700]);
const DATE_TYPES = new Set([1082, 1114, 1184]);

export function columnKind(typeOid: number): ColumnKind {
  if (NUMBER_TYPES.has(typeOid)) return "number";
  if (DATE_TYPES.has(typeOid)) return "date";
  return "text";
}

/** Bars stop being readable past this; the table is better. */
export const MAX_BAR_CATEGORIES = 40;
/** A pie with more slices than this is hard to read. */
export const MAX_PIE_SLICES = 8;
const MAX_SERIES = 3;

const TIME_WORD = "(year|month|quarter|week|day|date|period)";
/** "month", "order_month", "month_start", Arabic equivalents. Not "avg_days" or "days_to_ship". */
const TIME_NAME = new RegExp(
  `^${TIME_WORD}s?$|^[a-z]+_${TIME_WORD}$|^${TIME_WORD}_[a-z]+$|^(ال)?(سنة|شهر|تاريخ|يوم|أسبوع|ربع)$`,
  "i",
);
const ID_NAME = /(^id$)|(_id$)|(^id_)/i;
const DATE_TEXT = /^\d{4}-\d{2}(-\d{2})?([ T].*)?$/;

type Column = { name: string; kind: ColumnKind };

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A time axis: a date column, ISO-like date text, or a number/text column named like one (month, year). */
function isTemporal(column: Column, rows: Record<string, unknown>[]): boolean {
  if (column.kind === "date") return true;
  const values = rows.map((r) => r[column.name]).filter((v) => v !== null && v !== undefined);
  if (values.length === 0) return false;
  if (column.kind === "text" && values.every((v) => typeof v === "string" && DATE_TEXT.test(v))) {
    return true;
  }
  if (!TIME_NAME.test(column.name)) return false;
  // A number named like a time unit counts only as whole numbers (1997, month 3), not 8.5 days.
  return column.kind === "text" || values.every((v) => Number.isInteger(toNumber(v)));
}

/**
 * The model suggests a chart; the data decides. Rules, in order:
 * - no rows, or the model asked for a table → table;
 * - one row with one number → big-number card;
 * - a time column + numbers → line (one point per time value);
 * - a category column + numbers → bar (pie only when the model asked and it fits);
 * - anything else → table.
 */
export function chooseChart(input: {
  suggested: ChartType;
  columns: Column[];
  rows: Record<string, unknown>[];
}): ChartSpec {
  const { columns, rows, suggested } = input;
  if (rows.length === 0 || columns.length === 0) return { type: "table" };

  if (rows.length === 1 && columns.length === 1 && columns[0]!.kind === "number") {
    return { type: "number", value: columns[0]!.name };
  }
  if (suggested === "table") return { type: "table" };

  const temporal = columns.find((c) => isTemporal(c, rows));
  const category = columns.find((c) => c.kind === "text" && c !== temporal);
  const x = temporal ?? category;
  if (!x) return { type: "table" };

  const y = columns
    .filter((c) => c !== x && c.kind === "number" && !ID_NAME.test(c.name) && !isTemporal(c, rows))
    .slice(0, MAX_SERIES)
    .map((c) => c.name);
  if (y.length === 0) return { type: "table" };

  // One point or bar per x value: repeated x values need a pivot this view doesn't do.
  const xs = rows.map((r) =>
    String(r[x.name] instanceof Date ? (r[x.name] as Date).getTime() : r[x.name]),
  );
  if (new Set(xs).size !== xs.length) return { type: "table" };

  if (x === temporal && rows.length > 1) return { type: "line", x: x.name, y };
  if (rows.length > MAX_BAR_CATEGORIES) return { type: "table" };

  const nonNegative = rows.every((r) => (toNumber(r[y[0]!]) ?? -1) >= 0);
  if (suggested === "pie" && y.length === 1 && rows.length <= MAX_PIE_SLICES && nonNegative) {
    return { type: "pie", x: x.name, y };
  }
  return { type: "bar", x: x.name, y };
}
