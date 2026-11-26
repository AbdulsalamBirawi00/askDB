/**
 * Dashboard data as the pages and API routes send it. Safe to import from client
 * components (types only). Cards never carry their SQL to the browser of a share link.
 */
import type { ChartSpec, ColumnKind } from "@askdb/core";

/** One run of a card's SQL, as cached in `query_cache`. */
export type CardResult = {
  status: "ok" | "rejected" | "error" | "timeout";
  chart: ChartSpec | null;
  columns: { name: string; kind: ColumnKind }[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  error: string | null;
};

export type DashboardCard = {
  id: string;
  title: string;
  /** Null: no result yet (a share link before the owner opened the dashboard). */
  result: CardResult | null;
  /** When the result was computed (ISO time). */
  cachedAt: string | null;
  /** Served from the cache, without running the query. */
  fromCache: boolean;
};

export type DashboardPayload = {
  id: string;
  title: string;
  /** Owner view only. */
  shareToken: string | null;
  cards: DashboardCard[];
};
