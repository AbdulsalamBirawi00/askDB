import { randomUUID } from "node:crypto";

import {
  cacheKey,
  DEMO_DASHBOARD_CARDS,
  eq,
  newShareToken,
  purgeQueryCache,
  schema,
} from "@askdb/db";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DELETE as itemDELETE, PATCH as itemPATCH } from "@/app/api/dashboard-items/[id]/route";
import { POST as itemsPOST } from "@/app/api/dashboards/[id]/items/route";
import { PUT as orderPUT } from "@/app/api/dashboards/[id]/order/route";
import { POST as refreshPOST } from "@/app/api/dashboards/[id]/refresh/route";
import {
  DELETE as dashboardDELETE,
  GET as dashboardGET,
  PATCH as dashboardPATCH,
} from "@/app/api/dashboards/[id]/route";
import { DELETE as shareDELETE, POST as sharePOST } from "@/app/api/dashboards/[id]/share/route";
import { GET as dashboardsGET, POST as dashboardsPOST } from "@/app/api/dashboards/route";
import { GET as shareGET } from "@/app/api/share/[token]/route";
import type { DashboardPayload } from "@/lib/dashboard-types";
import { getDb } from "@/lib/db";

import { deleteCreatedUsers, jsonRequest, request, signInGuest, type TestUser } from "./helpers";

vi.hoisted(() => {
  // A model key is configured, so a model call would be possible: the tests prove none happens.
  process.env.GROQ_API_KEY ||= "test-groq-key";
  delete process.env.OLLAMA_BASE_URL;
});

const DEMO = "demo-northwind";

/** Every outgoing HTTP request (a model call would be one). Database traffic is not HTTP. */
const httpCalls: string[] = [];
const server = setupServer();
server.events.on("request:start", ({ request: r }) => {
  httpCalls.push(r.url);
});
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  httpCalls.length = 0;
});
afterAll(async () => {
  server.close();
  await deleteCreatedUsers();
});

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function dashboardsOf(user: TestUser) {
  const response = await dashboardsGET(request("/api/dashboards", user.cookie));
  expect(response.status).toBe(200);
  return (
    (await response.json()) as { dashboards: { id: string; title: string; itemCount: number }[] }
  ).dashboards;
}

async function open(user: TestUser, id: string) {
  const response = await dashboardGET(request(`/api/dashboards/${id}`, user.cookie), ctx({ id }));
  return {
    status: response.status,
    dashboard: response.ok
      ? ((await response.json()) as { dashboard: DashboardPayload }).dashboard
      : null,
  };
}

/** A logged query of the user's on the demo connection, as /api/ask would leave it. */
async function loggedQuery(
  userId: string,
  input: { question: string; sql: string | null; status?: "ok" | "rejected"; chartType?: string },
) {
  const db = getDb();
  const conversationId = randomUUID();
  await db.insert(schema.conversations).values({
    id: conversationId,
    userId,
    connectionId: DEMO,
    title: input.question,
  });
  const id = randomUUID();
  await db.insert(schema.queries).values({
    id,
    conversationId,
    question: input.question,
    sql: input.sql,
    status: input.status ?? "ok",
    chartType: input.chartType ?? "bar",
  });
  return id;
}

describe("dashboards", () => {
  it("T6.9 a new guest gets the demo dashboard with 4 cards", async () => {
    const guest = await signInGuest();
    const list = await dashboardsOf(guest);
    expect(list).toEqual([
      expect.objectContaining({
        title: "Northwind overview",
        itemCount: DEMO_DASHBOARD_CARDS.length,
      }),
    ]);
    expect(DEMO_DASHBOARD_CARDS).toHaveLength(4);
  });

  it("T6.2 opening a dashboard with 4 cards makes zero model calls", async () => {
    const guest = await signInGuest();
    const [demo] = await dashboardsOf(guest);
    const { status, dashboard } = await open(guest, demo!.id);

    expect(status).toBe(200);
    expect(dashboard!.cards).toHaveLength(4);
    expect(dashboard!.cards.map((c) => c.result?.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(dashboard!.cards.map((c) => c.result?.chart?.type)).toEqual([
      "bar",
      "line",
      "pie",
      "number",
    ]);
    expect(httpCalls).toEqual([]);
  });

  it("T6.3 a second open within a minute is served from the cache; Refresh now runs again", async () => {
    const guest = await signInGuest();
    const [demo] = await dashboardsOf(guest);
    const first = (await open(guest, demo!.id)).dashboard!;
    const second = (await open(guest, demo!.id)).dashboard!;

    expect(second.cards.every((c) => c.fromCache)).toBe(true);
    expect(second.cards.map((c) => c.cachedAt)).toEqual(first.cards.map((c) => c.cachedAt));
    expect(second.cards.map((c) => c.result)).toEqual(first.cards.map((c) => c.result));

    const refreshed = await refreshPOST(
      request(`/api/dashboards/${demo!.id}/refresh`, guest.cookie, { method: "POST" }),
      ctx({ id: demo!.id }),
    );
    const { dashboard } = (await refreshed.json()) as { dashboard: DashboardPayload };
    expect(dashboard.cards.every((c) => !c.fromCache)).toBe(true);
    expect(httpCalls).toEqual([]);
  });

  it("T6.5 a failing card shows its error and the others still work", async () => {
    const guest = await signInGuest();
    const db = getDb();
    const [demo] = await dashboardsOf(guest);
    await db.insert(schema.dashboardItems).values({
      id: randomUUID(),
      dashboardId: demo!.id,
      connectionId: DEMO,
      title: "Broken",
      sql: "select no_such_column from orders",
      chartType: "table",
      position: 99,
    });
    const { dashboard } = await open(guest, demo!.id);
    const statuses = dashboard!.cards.map((c) => c.result?.status);
    expect(statuses).toEqual(["ok", "ok", "ok", "ok", "error"]);
    expect(dashboard!.cards.at(-1)!.result!.error).toMatch(/no_such_column/);
  });

  it("a card's UPDATE is refused by the guard, not run", async () => {
    const guest = await signInGuest();
    const [demo] = await dashboardsOf(guest);
    await getDb().insert(schema.dashboardItems).values({
      id: randomUUID(),
      dashboardId: demo!.id,
      connectionId: DEMO,
      title: "Sneaky",
      sql: "update customers set country = 'Nowhere'",
      chartType: "table",
      position: 99,
    });
    const { dashboard } = await open(guest, demo!.id);
    expect(dashboard!.cards.at(-1)!.result).toMatchObject({ status: "rejected" });
  });

  it("T6.1 (API) pins a query that ran, with its question as the title", async () => {
    const guest = await signInGuest();
    const queryId = await loggedQuery(guest.id, {
      question: "Customers per country",
      sql: "select country, count(*)::int as customers from customers group by country order by 2 desc limit 10",
    });
    const created = await dashboardsPOST(
      jsonRequest("/api/dashboards", guest.cookie, "POST", { title: "Sales", queryId }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const { dashboard } = await open(guest, id);
    expect(dashboard!.title).toBe("Sales");
    expect(dashboard!.cards).toEqual([
      expect.objectContaining({
        title: "Customers per country",
        result: expect.objectContaining({
          status: "ok",
          chart: expect.objectContaining({ type: "bar" }),
        }),
      }),
    ]);

    // Pinning the same query to an existing dashboard adds a second card.
    const added = await itemsPOST(
      jsonRequest(`/api/dashboards/${id}/items`, guest.cookie, "POST", { queryId }),
      ctx({ id }),
    );
    expect(added.status).toBe(201);
    expect((await open(guest, id)).dashboard!.cards).toHaveLength(2);
  });

  it("refuses to pin a query that did not run", async () => {
    const guest = await signInGuest();
    const [demo] = await dashboardsOf(guest);
    const queryId = await loggedQuery(guest.id, {
      question: "Delete everything",
      sql: "delete from customers",
      status: "rejected",
    });
    const response = await itemsPOST(
      jsonRequest(`/api/dashboards/${demo!.id}/items`, guest.cookie, "POST", { queryId }),
      ctx({ id: demo!.id }),
    );
    expect(response.status).toBe(422);
  });

  it("T6.8 (API) saves a new order in one request; a wrong list changes nothing", async () => {
    const guest = await signInGuest();
    const [demo] = await dashboardsOf(guest);
    const ids = (await open(guest, demo!.id)).dashboard!.cards.map((c) => c.id);
    const reversed = [...ids].reverse();

    const saved = await orderPUT(
      jsonRequest(`/api/dashboards/${demo!.id}/order`, guest.cookie, "PUT", { itemIds: reversed }),
      ctx({ id: demo!.id }),
    );
    expect(saved.status).toBe(200);
    expect((await open(guest, demo!.id)).dashboard!.cards.map((c) => c.id)).toEqual(reversed);

    for (const itemIds of [
      ids.slice(1),
      [...ids, randomUUID()],
      [ids[0], ids[0], ids[1], ids[2]],
    ]) {
      const refused = await orderPUT(
        jsonRequest(`/api/dashboards/${demo!.id}/order`, guest.cookie, "PUT", { itemIds }),
        ctx({ id: demo!.id }),
      );
      expect(refused.status).toBe(400);
    }
    expect((await open(guest, demo!.id)).dashboard!.cards.map((c) => c.id)).toEqual(reversed);
  });

  it("renames and deletes a card and the dashboard", async () => {
    const guest = await signInGuest();
    const [demo] = await dashboardsOf(guest);
    const [card] = (await open(guest, demo!.id)).dashboard!.cards;

    const renamed = await itemPATCH(
      jsonRequest(`/api/dashboard-items/${card!.id}`, guest.cookie, "PATCH", {
        title: "Top markets",
      }),
      ctx({ id: card!.id }),
    );
    expect(renamed.status).toBe(200);
    const deleted = await itemDELETE(
      request(`/api/dashboard-items/${card!.id}`, guest.cookie, { method: "DELETE" }),
      ctx({ id: card!.id }),
    );
    expect(deleted.status).toBe(204);
    expect((await open(guest, demo!.id)).dashboard!.cards).toHaveLength(3);

    const title = await dashboardPATCH(
      jsonRequest(`/api/dashboards/${demo!.id}`, guest.cookie, "PATCH", { title: "Mine" }),
      ctx({ id: demo!.id }),
    );
    expect(title.status).toBe(200);
    const gone = await dashboardDELETE(
      request(`/api/dashboards/${demo!.id}`, guest.cookie, { method: "DELETE" }),
      ctx({ id: demo!.id }),
    );
    expect(gone.status).toBe(204);
    expect(await dashboardsOf(guest)).toEqual([]);
  });
});

describe("dashboards: ownership (security)", () => {
  it("another user's dashboard, card, and query are all 404", async () => {
    const owner = await signInGuest();
    const other = await signInGuest();
    const [demo] = await dashboardsOf(owner);
    const card = (await open(owner, demo!.id)).dashboard!.cards[0]!;
    const queryId = await loggedQuery(owner.id, { question: "Mine", sql: "select 1 as one" });
    const [theirs] = await dashboardsOf(other);

    expect((await open(other, demo!.id)).status).toBe(404);
    const statuses = await Promise.all([
      dashboardPATCH(
        jsonRequest(`/api/dashboards/${demo!.id}`, other.cookie, "PATCH", { title: "x" }),
        ctx({ id: demo!.id }),
      ),
      dashboardDELETE(
        request(`/api/dashboards/${demo!.id}`, other.cookie, { method: "DELETE" }),
        ctx({ id: demo!.id }),
      ),
      refreshPOST(
        request(`/api/dashboards/${demo!.id}/refresh`, other.cookie, { method: "POST" }),
        ctx({ id: demo!.id }),
      ),
      sharePOST(
        request(`/api/dashboards/${demo!.id}/share`, other.cookie, { method: "POST" }),
        ctx({ id: demo!.id }),
      ),
      orderPUT(
        jsonRequest(`/api/dashboards/${demo!.id}/order`, other.cookie, "PUT", { itemIds: [] }),
        ctx({ id: demo!.id }),
      ),
      itemPATCH(
        jsonRequest(`/api/dashboard-items/${card.id}`, other.cookie, "PATCH", { title: "x" }),
        ctx({ id: card.id }),
      ),
      itemDELETE(
        request(`/api/dashboard-items/${card.id}`, other.cookie, { method: "DELETE" }),
        ctx({ id: card.id }),
      ),
      // Their own dashboard, but the owner's query.
      itemsPOST(
        jsonRequest(`/api/dashboards/${theirs!.id}/items`, other.cookie, "POST", { queryId }),
        ctx({ id: theirs!.id }),
      ),
      // The owner's dashboard, with their own query.
      itemsPOST(
        jsonRequest(`/api/dashboards/${demo!.id}/items`, other.cookie, "POST", { queryId }),
        ctx({ id: demo!.id }),
      ),
    ]);
    expect(statuses.map((r) => r.status)).toEqual(Array(statuses.length).fill(404));
    expect((await open(owner, demo!.id)).dashboard!.cards).toHaveLength(4);
  });

  it("is 401 without a session", async () => {
    expect((await dashboardsGET(request("/api/dashboards"))).status).toBe(401);
  });
});

describe("share links", () => {
  it("T6.7 a random or malformed token is a 404", async () => {
    for (const token of [newShareToken(), "short", "x".repeat(43), "../../api/dashboards"]) {
      const response = await shareGET(request(`/api/share/${token}`), ctx({ token }));
      expect(response.status).toBe(404);
    }
  });

  it("T6.6 (API) shows the last cached results signed out, without SQL and without running queries", async () => {
    const guest = await signInGuest();
    const [demo] = await dashboardsOf(guest);
    const shared = await sharePOST(
      request(`/api/dashboards/${demo!.id}/share`, guest.cookie, { method: "POST" }),
      ctx({ id: demo!.id }),
    );
    const { shareToken } = (await shared.json()) as { shareToken: string };
    expect(shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Before the owner opens the dashboard, results of this guest's cards may already be
    // cached by other guests (same demo SQL); drop them to see the "no result yet" state.
    await getDb()
      .delete(schema.queryCache)
      .where(eq(schema.queryCache.key, cacheKey(DEMO, DEMO_DASHBOARD_CARDS[3].sql)));
    const before = (await (
      await shareGET(request(`/api/share/${shareToken}`), ctx({ token: shareToken }))
    ).json()) as {
      dashboard: DashboardPayload;
    };
    expect(before.dashboard.cards.at(-1)!.result).toBeNull();

    await open(guest, demo!.id); // The owner's visit fills the cache.
    const response = await shareGET(
      request(`/api/share/${shareToken}`),
      ctx({ token: shareToken }),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toMatch(/select /i);
    const { dashboard } = JSON.parse(text) as { dashboard: DashboardPayload };
    expect(dashboard.shareToken).toBeNull();
    expect(dashboard.cards.map((c) => c.result?.status)).toEqual(["ok", "ok", "ok", "ok"]);

    // Revoked: the same token is a 404 at once.
    await shareDELETE(
      request(`/api/dashboards/${demo!.id}/share`, guest.cookie, { method: "DELETE" }),
      ctx({ id: demo!.id }),
    );
    expect(
      (await shareGET(request(`/api/share/${shareToken}`), ctx({ token: shareToken }))).status,
    ).toBe(404);
  });
});

describe("result cache cleanup", () => {
  it("removes long-expired results unless a card still uses them", async () => {
    const guest = await signInGuest();
    const [demo] = await dashboardsOf(guest);
    await open(guest, demo!.id);
    const db = getDb();
    const orphan = cacheKey(DEMO, `select ${Math.random()} as orphan`);
    const used = cacheKey(DEMO, DEMO_DASHBOARD_CARDS[0].sql);
    const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await db.insert(schema.queryCache).values({
      key: orphan,
      connectionId: DEMO,
      resultJson: {},
      cachedAt: longAgo,
      expiresAt: longAgo,
    });
    await db
      .update(schema.queryCache)
      .set({ expiresAt: longAgo })
      .where(eq(schema.queryCache.key, used));

    expect(await purgeQueryCache(db)).toBeGreaterThanOrEqual(1);
    const left = await db.select({ key: schema.queryCache.key }).from(schema.queryCache);
    const keys = new Set(left.map((r) => r.key));
    expect(keys.has(orphan)).toBe(false);
    expect(keys.has(used)).toBe(true);
  });
});
