import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, inArray, lt, sql } from "drizzle-orm";

import type { Database } from "./index";
import { dashboardItems, dashboards, queryCache } from "./schema";

/** More cards than this makes a dashboard slow to open (each card is a query). */
export const MAX_DASHBOARD_ITEMS = 24;
export const MAX_DASHBOARDS = 50;
/** How long a cached card result counts as fresh. */
export const CACHE_TTL_MS = 5 * 60 * 1000;

export type DashboardSummary = {
  id: string;
  title: string;
  itemCount: number;
  shared: boolean;
};

export type DashboardItemView = {
  id: string;
  connectionId: string;
  title: string;
  sql: string;
  chartType: string | null;
  position: number;
};

export type DashboardView = {
  id: string;
  userId: string;
  title: string;
  shareToken: string | null;
  items: DashboardItemView[];
};

/** The dashboard is full, or the user has too many. */
export class DashboardLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardLimitError";
  }
}

export async function listDashboards(db: Database, userId: string): Promise<DashboardSummary[]> {
  const rows = await db
    .select({
      id: dashboards.id,
      title: dashboards.title,
      shareToken: dashboards.shareToken,
      itemCount: count(dashboardItems.id),
    })
    .from(dashboards)
    .leftJoin(dashboardItems, eq(dashboardItems.dashboardId, dashboards.id))
    .where(eq(dashboards.userId, userId))
    .groupBy(dashboards.id)
    .orderBy(desc(dashboards.createdAt), asc(dashboards.id));
  return rows.map(({ shareToken, ...row }) => ({ ...row, shared: shareToken !== null }));
}

export async function createDashboard(
  db: Database,
  input: { userId: string; title: string },
): Promise<{ id: string }> {
  const [stats] = await db
    .select({ total: count() })
    .from(dashboards)
    .where(eq(dashboards.userId, input.userId));
  if ((stats?.total ?? 0) >= MAX_DASHBOARDS) throw new DashboardLimitError("Too many dashboards");
  const id = randomUUID();
  await db
    .insert(dashboards)
    .values({ id, userId: input.userId, title: input.title.slice(0, 120) });
  return { id };
}

async function itemsOf(db: Database, dashboardId: string): Promise<DashboardItemView[]> {
  return db
    .select({
      id: dashboardItems.id,
      connectionId: dashboardItems.connectionId,
      title: dashboardItems.title,
      sql: dashboardItems.sql,
      chartType: dashboardItems.chartType,
      position: dashboardItems.position,
    })
    .from(dashboardItems)
    .where(eq(dashboardItems.dashboardId, dashboardId))
    .orderBy(asc(dashboardItems.position), asc(dashboardItems.createdAt));
}

/** The user's dashboard with its cards in order, or null (someone else's id is "missing"). */
export async function getOwnedDashboard(
  db: Database,
  input: { id: string; userId: string },
): Promise<DashboardView | null> {
  const [row] = await db
    .select({
      id: dashboards.id,
      userId: dashboards.userId,
      title: dashboards.title,
      shareToken: dashboards.shareToken,
    })
    .from(dashboards)
    .where(and(eq(dashboards.id, input.id), eq(dashboards.userId, input.userId)))
    .limit(1);
  return row ? { ...row, items: await itemsOf(db, row.id) } : null;
}

/** The dashboard behind a share token, or null. Tokens are compared in the database (unique index). */
export async function getSharedDashboard(
  db: Database,
  token: string,
): Promise<DashboardView | null> {
  const [row] = await db
    .select({
      id: dashboards.id,
      userId: dashboards.userId,
      title: dashboards.title,
      shareToken: dashboards.shareToken,
    })
    .from(dashboards)
    .where(eq(dashboards.shareToken, token))
    .limit(1);
  return row ? { ...row, items: await itemsOf(db, row.id) } : null;
}

export async function renameDashboard(
  db: Database,
  input: { id: string; userId: string; title: string },
): Promise<boolean> {
  const updated = await db
    .update(dashboards)
    .set({ title: input.title.slice(0, 120) })
    .where(and(eq(dashboards.id, input.id), eq(dashboards.userId, input.userId)))
    .returning({ id: dashboards.id });
  return updated.length > 0;
}

export async function deleteDashboard(
  db: Database,
  input: { id: string; userId: string },
): Promise<boolean> {
  const deleted = await db
    .delete(dashboards)
    .where(and(eq(dashboards.id, input.id), eq(dashboards.userId, input.userId)))
    .returning({ id: dashboards.id });
  return deleted.length > 0;
}

/** Sets (a new random token) or clears the share link. Null when not the user's. */
export async function setShareToken(
  db: Database,
  input: { id: string; userId: string; shared: boolean },
): Promise<{ shareToken: string | null } | null> {
  const [current] = await db
    .select({ shareToken: dashboards.shareToken })
    .from(dashboards)
    .where(and(eq(dashboards.id, input.id), eq(dashboards.userId, input.userId)))
    .limit(1);
  if (!current) return null;
  // Sharing again keeps the existing link working.
  if (input.shared && current.shareToken) return { shareToken: current.shareToken };
  const shareToken = input.shared ? newShareToken() : null;
  await db.update(dashboards).set({ shareToken }).where(eq(dashboards.id, input.id));
  return { shareToken };
}

/** 32 random bytes, URL-safe: not guessable. */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Adds a card at the end. The caller has checked the dashboard and the SQL's connection. */
export async function addDashboardItem(
  db: Database,
  input: {
    dashboardId: string;
    connectionId: string;
    title: string;
    sql: string;
    chartType: string | null;
  },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [stats] = await tx
      .select({
        total: count(),
        last: sql<number | null>`max(${dashboardItems.position})`,
      })
      .from(dashboardItems)
      .where(eq(dashboardItems.dashboardId, input.dashboardId));
    if ((stats?.total ?? 0) >= MAX_DASHBOARD_ITEMS) {
      throw new DashboardLimitError("This dashboard is full");
    }
    const id = randomUUID();
    await tx.insert(dashboardItems).values({
      id,
      dashboardId: input.dashboardId,
      connectionId: input.connectionId,
      title: input.title.slice(0, 120),
      sql: input.sql,
      chartType: input.chartType,
      position: (stats?.last ?? -1) + 1,
    });
    return { id };
  });
}

/** The item's id when its dashboard is the user's. */
async function ownedItemId(db: Database, input: { id: string; userId: string }) {
  const [row] = await db
    .select({ id: dashboardItems.id })
    .from(dashboardItems)
    .innerJoin(dashboards, eq(dashboards.id, dashboardItems.dashboardId))
    .where(and(eq(dashboardItems.id, input.id), eq(dashboards.userId, input.userId)))
    .limit(1);
  return row?.id ?? null;
}

export async function renameDashboardItem(
  db: Database,
  input: { id: string; userId: string; title: string },
): Promise<boolean> {
  const id = await ownedItemId(db, input);
  if (!id) return false;
  await db
    .update(dashboardItems)
    .set({ title: input.title.slice(0, 120) })
    .where(eq(dashboardItems.id, id));
  return true;
}

export async function deleteDashboardItem(
  db: Database,
  input: { id: string; userId: string },
): Promise<boolean> {
  const id = await ownedItemId(db, input);
  if (!id) return false;
  await db.delete(dashboardItems).where(eq(dashboardItems.id, id));
  return true;
}

/**
 * Saves a new card order in one statement. `itemIds` must be exactly the dashboard's cards;
 * anything else (a missing, extra, or foreign id) changes nothing and returns false.
 */
export async function reorderDashboardItems(
  db: Database,
  input: { dashboardId: string; itemIds: string[] },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const current = await tx
      .select({ id: dashboardItems.id })
      .from(dashboardItems)
      .where(eq(dashboardItems.dashboardId, input.dashboardId));
    const known = new Set(current.map((r) => r.id));
    const given = new Set(input.itemIds);
    if (
      given.size !== input.itemIds.length ||
      given.size !== known.size ||
      input.itemIds.some((id) => !known.has(id))
    ) {
      return false;
    }
    if (input.itemIds.length === 0) return true;
    const cases = sql.join(
      input.itemIds.map((id, i) => sql`when ${id} then ${i}::int`),
      sql` `,
    );
    await tx
      .update(dashboardItems)
      .set({ position: sql`case ${dashboardItems.id} ${cases} end` })
      .where(
        and(
          eq(dashboardItems.dashboardId, input.dashboardId),
          inArray(dashboardItems.id, input.itemIds),
        ),
      );
    return true;
  });
}

// ---------------------------------------------------------------------------------------
// Result cache

/** sha256 of the connection id and the SQL; the same formula runs in SQL in `purgeQueryCache`. */
export function cacheKey(connectionId: string, sqlText: string): string {
  return createHash("sha256").update(`${connectionId}\n${sqlText}`).digest("hex");
}

export type CachedResult<T> = { result: T; cachedAt: Date; expiresAt: Date };

/** Cached results by key, fresh or not, in one query. */
export async function getCachedResults<T>(
  db: Database,
  keys: string[],
): Promise<Map<string, CachedResult<T>>> {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({
      key: queryCache.key,
      resultJson: queryCache.resultJson,
      cachedAt: queryCache.cachedAt,
      expiresAt: queryCache.expiresAt,
    })
    .from(queryCache)
    .where(inArray(queryCache.key, [...new Set(keys)]));
  return new Map(
    rows.map((r) => [
      r.key,
      { result: r.resultJson as T, cachedAt: r.cachedAt, expiresAt: r.expiresAt },
    ]),
  );
}

/** Stores several results in one statement (insert or replace). */
export async function putCachedResults(
  db: Database,
  entries: { key: string; connectionId: string; result: unknown }[],
  now: Date = new Date(),
): Promise<void> {
  if (entries.length === 0) return;
  const unique = [...new Map(entries.map((e) => [e.key, e])).values()];
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
  await db
    .insert(queryCache)
    .values(
      unique.map((e) => ({
        key: e.key,
        connectionId: e.connectionId,
        resultJson: e.result,
        cachedAt: now,
        expiresAt,
      })),
    )
    .onConflictDoUpdate({
      target: queryCache.key,
      set: {
        resultJson: sql`excluded.result_json`,
        cachedAt: sql`excluded.cached_at`,
        expiresAt: sql`excluded.expires_at`,
      },
    });
}

/** Drops a connection's cached results (its schema notes or hidden columns changed). */
export async function clearConnectionCache(db: Database, connectionId: string): Promise<void> {
  await db.delete(queryCache).where(eq(queryCache.connectionId, connectionId));
}

/**
 * Daily cleanup: removes results that expired more than a day ago and that no dashboard
 * card uses any more (share links keep showing the last result of their cards).
 */
export async function purgeQueryCache(db: Database, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(queryCache)
    .where(
      and(
        lt(queryCache.expiresAt, cutoff),
        sql`not exists (
          select 1 from ${dashboardItems}
          where encode(sha256(convert_to(${dashboardItems.connectionId} || E'\\n' || ${dashboardItems.sql}, 'UTF8')), 'hex') = ${queryCache.key}
        )`,
      ),
    )
    .returning({ key: queryCache.key });
  return deleted.length;
}
