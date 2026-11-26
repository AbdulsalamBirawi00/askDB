import "server-only";

import { ConnectionUrlError, ExecutorConnectionError, runSql, type AskTable } from "@askdb/core";
import {
  addDashboardItem,
  cacheKey,
  createDashboard,
  getCachedResults,
  getConnectionSchema,
  getOwnedDashboard,
  getOwnedQuery,
  getSharedDashboard,
  putCachedResults,
  type DashboardItemView,
  type DashboardView,
} from "@askdb/db";

import { chartTypeOf } from "@/lib/ask";
import { openVisibleConnection } from "@/lib/connections";
import type { CardResult, DashboardCard, DashboardPayload } from "@/lib/dashboard-types";
import { getDb } from "@/lib/db";

/** Card queries run at most this many at a time (each opens its own read-only connection). */
const CONCURRENCY = 3;

type Target = { url: URL; tables: AskTable[] } | null;

/** Runs `task` over `items` with at most `limit` in flight. Server-side database work only. */
async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const failed = (error: string): CardResult => ({
  status: "error",
  chart: null,
  columns: [],
  rows: [],
  truncated: false,
  error,
});

/**
 * Runs one card's SQL on the same guarded path as every other query (core `runSql`: guard,
 * read-only transaction, read-only role, hidden columns dropped). Never calls a model.
 * `cache: false` for a connection failure, which says nothing about the SQL.
 */
async function runCard(
  item: DashboardItemView,
  target: Target,
): Promise<{ result: CardResult; cache: boolean }> {
  if (!target) return { result: failed("This database is no longer available"), cache: false };
  try {
    const run = await runSql({
      sql: item.sql,
      url: target.url,
      tables: target.tables,
      suggested: chartTypeOf(item.chartType),
    });
    if (run.status !== "ok") {
      return { result: { ...failed(run.error), status: run.status }, cache: true };
    }
    return {
      result: {
        status: "ok",
        chart: run.chart,
        columns: run.columns,
        rows: run.result.rows,
        truncated: run.result.truncated,
        error: null,
      },
      cache: true,
    };
  } catch (error) {
    if (error instanceof ExecutorConnectionError || error instanceof ConnectionUrlError) {
      return { result: failed("Connection failed"), cache: false };
    }
    throw error;
  }
}

/** Opens each distinct connection once (decrypt + schema), not once per card. */
async function openTargets(userId: string, connectionIds: string[]) {
  const targets = new Map<string, Target>();
  for (const id of new Set(connectionIds)) {
    let target: Target = null;
    try {
      const url = await openVisibleConnection(userId, id);
      const tables = url ? await getConnectionSchema(getDb(), id, userId) : null;
      target = url && tables ? { url, tables } : null;
    } catch (error) {
      if (!(error instanceof ConnectionUrlError)) throw error;
    }
    targets.set(id, target);
  }
  return targets;
}

/**
 * The cards with their results. Fresh cached results (under 5 minutes old) are used as
 * they are; the others, or all of them with `refresh`, run again and are cached. Zero
 * model calls either way: dashboards spend no AI quota.
 */
async function withResults(
  dashboard: DashboardView,
  options: { refresh: boolean; now?: Date },
): Promise<DashboardCard[]> {
  const now = options.now ?? new Date();
  const keyed = dashboard.items.map((item) => ({
    item,
    key: cacheKey(item.connectionId, item.sql),
  }));
  const cached = options.refresh
    ? new Map()
    : await getCachedResults<CardResult>(
        getDb(),
        keyed.map((k) => k.key),
      );
  const fresh = (key: string) => {
    const hit = cached.get(key);
    return hit && hit.expiresAt > now ? hit : null;
  };

  // Identical SQL on the same connection runs once.
  const stale = [...new Map(keyed.filter((k) => !fresh(k.key)).map((k) => [k.key, k])).values()];
  const targets = await openTargets(
    dashboard.userId,
    stale.map((k) => k.item.connectionId),
  );
  const ran = await pool(stale, CONCURRENCY, async ({ item, key }) => ({
    key,
    connectionId: item.connectionId,
    ...(await runCard(item, targets.get(item.connectionId) ?? null)),
  }));
  await putCachedResults(
    getDb(),
    ran.filter((r) => r.cache),
    now,
  );
  const ranByKey = new Map(ran.map((r) => [r.key, r.result]));

  return keyed.map(({ item, key }) => {
    const hit = fresh(key);
    return {
      id: item.id,
      title: item.title,
      result: hit ? hit.result : (ranByKey.get(key) ?? null),
      cachedAt: (hit ? hit.cachedAt : now).toISOString(),
      fromCache: hit !== null,
    };
  });
}

/** The user's dashboard with results, or null when it is not theirs. */
export async function loadDashboard(
  userId: string,
  id: string,
  options: { refresh?: boolean; now?: Date } = {},
): Promise<DashboardPayload | null> {
  const dashboard = await getOwnedDashboard(getDb(), { id, userId });
  if (!dashboard) return null;
  return {
    id: dashboard.id,
    title: dashboard.title,
    shareToken: dashboard.shareToken,
    cards: await withResults(dashboard, { refresh: options.refresh ?? false, now: options.now }),
  };
}

/**
 * A shared dashboard, read-only: the last cached result of each card, fresh or not. It
 * never runs a query, so a share link cannot be used to load the owner's database.
 */
export async function loadSharedDashboard(token: string): Promise<DashboardPayload | null> {
  const dashboard = await getSharedDashboard(getDb(), token);
  if (!dashboard) return null;
  const cached = await getCachedResults<CardResult>(
    getDb(),
    dashboard.items.map((item) => cacheKey(item.connectionId, item.sql)),
  );
  return {
    id: dashboard.id,
    title: dashboard.title,
    shareToken: null,
    cards: dashboard.items.map((item) => {
      const hit = cached.get(cacheKey(item.connectionId, item.sql));
      return {
        id: item.id,
        title: item.title,
        result: hit?.result ?? null,
        cachedAt: hit ? hit.cachedAt.toISOString() : null,
        fromCache: true,
      };
    }),
  };
}

export type PinOutcome =
  | { status: "ok"; dashboardId: string; itemId: string }
  | { status: "not-found" }
  | { status: "not-pinnable" };

/**
 * Pins a logged query (one that ran) to a dashboard of the user's, or to a new dashboard
 * when `newTitle` is given. The card keeps the query's SQL, chart suggestion, and question
 * as its title; the connection is the query's own, so no other database can be named.
 */
export async function pinQuery(
  userId: string,
  input: { queryId: string; dashboardId?: string; newTitle?: string },
): Promise<PinOutcome> {
  const db = getDb();
  const query = await getOwnedQuery(db, { id: input.queryId, userId });
  if (!query) return { status: "not-found" };
  if (query.status !== "ok" || !query.sql) return { status: "not-pinnable" };

  let dashboardId = input.dashboardId;
  if (dashboardId) {
    if (!(await getOwnedDashboard(db, { id: dashboardId, userId }))) {
      return { status: "not-found" };
    }
  } else {
    dashboardId = (await createDashboard(db, { userId, title: input.newTitle ?? "My dashboard" }))
      .id;
  }
  const { id: itemId } = await addDashboardItem(db, {
    dashboardId,
    connectionId: query.connectionId,
    title: query.question,
    sql: query.sql,
    chartType: query.chartType,
  });
  return { status: "ok", dashboardId, itemId };
}
