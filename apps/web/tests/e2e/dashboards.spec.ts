import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { useUniqueClientIp } from "./helpers";

/**
 * Stage 6: saved dashboards. Cards run real SQL on the local Northwind demo database
 * (no model involved: dashboards never call one).
 */

const DASHBOARDS = "/en/app/dashboards";
const CUSTOMERS_SQL =
  "select country, count(*)::int as customers from customers group by country order by 2 desc, 1 limit 10";

async function signInGuest(page: Page): Promise<string> {
  await page.goto("/en");
  await page.getByRole("button", { name: "Try as guest" }).click();
  await page.waitForURL(/\/en\/app$/);
  const { user } = await (await page.request.get("/api/me")).json();
  return user.id as string;
}

async function withDb<T>(run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/** Opens the guest's ready-made demo dashboard and returns its id. */
async function openDemoDashboard(page: Page): Promise<string> {
  await page.goto(DASHBOARDS);
  await page.getByTestId("dashboard-link").filter({ hasText: "Northwind overview" }).click();
  await page.waitForURL(/\/en\/app\/dashboards\/[^/]+$/);
  await expect(page.getByTestId("dashboard-card")).toHaveCount(4);
  return page.url().split("/").at(-1)!;
}

const cardTitles = (page: Page) => page.getByTestId("card-title").allTextContents();

test.describe("dashboards", () => {
  test.beforeEach(({ page }) => useUniqueClientIp(page));

  test("T6.9 a new guest finds the demo dashboard with 4 cards", async ({ page }) => {
    await signInGuest(page);
    await page.getByRole("link", { name: "Dashboards" }).click();
    await expect(page.getByTestId("dashboard-link")).toHaveCount(1);
    await expect(page.getByTestId("dashboard-link")).toContainText("Northwind overview");
    await expect(page.getByTestId("dashboard-link")).toContainText("4 cards");

    await openDemoDashboard(page);
    const cards = page.getByTestId("dashboard-card");
    await expect(cards.nth(0).getByTestId("chart")).toHaveAttribute("data-chart-type", "bar");
    await expect(cards.nth(1).getByTestId("chart")).toHaveAttribute("data-chart-type", "line");
    await expect(cards.nth(2).getByTestId("chart")).toHaveAttribute("data-chart-type", "pie");
    await expect(cards.nth(3).getByTestId("number-card")).toContainText("91");
  });

  test("T6.1 a result added to a dashboard appears with the same chart and title", async ({
    page,
  }) => {
    const userId = await signInGuest(page);
    const conversationId = randomUUID();
    await withDb(async (sql) => {
      await sql`insert into conversations (id, user_id, connection_id, title)
                values (${conversationId}, ${userId}, 'demo-northwind', 'Customers per country')`;
      await sql`insert into queries (id, conversation_id, question, sql, status, chart_type)
                values (${randomUUID()}, ${conversationId}, 'Customers per country', ${CUSTOMERS_SQL}, 'ok', 'bar')`;
    });
    await page.goto(`/en/app/connections/demo-northwind/ask?c=${conversationId}`);
    await page.getByRole("button", { name: "Run again" }).click();
    const turn = page.getByTestId("turn").last();
    const chart = turn.getByTestId("chart");
    await expect(chart).toBeVisible();
    const chartType = await chart.getAttribute("data-chart-type");

    await turn.getByRole("button", { name: "Add to dashboard" }).click();
    await turn.getByLabel("New dashboard").fill("Customers");
    await turn.getByRole("button", { name: "Create" }).click();
    await expect(turn.getByTestId("pinned")).toContainText("Added to Customers.");
    await turn.getByRole("link", { name: "Open dashboard" }).click();

    await expect(page.getByTestId("dashboard-title")).toHaveText("Customers");
    const card = page.getByTestId("dashboard-card");
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("card-title")).toHaveText("Customers per country");
    await expect(card.getByTestId("chart")).toHaveAttribute("data-chart-type", chartType!);
  });

  test("T6.4 Refresh now runs the queries again", async ({ page }) => {
    await signInGuest(page);
    const id = await openDemoDashboard(page);
    await page.reload();
    // The second visit is served from the cache.
    await expect(page.getByTestId("card-updated").first()).toContainText("cached");

    const refreshed = page.waitForResponse(
      (r) => r.url().endsWith(`/api/dashboards/${id}/refresh`) && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Refresh now" }).click();
    const response = await refreshed;
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { dashboard: { cards: { fromCache: boolean }[] } };
    expect(body.dashboard.cards.map((c) => c.fromCache)).toEqual([false, false, false, false]);
    await expect(page.getByTestId("card-updated").filter({ hasText: "cached" })).toHaveCount(0);
  });

  test("T6.5 one failing card shows its error, the others still work", async ({ page }) => {
    await signInGuest(page);
    const id = await openDemoDashboard(page);
    await withDb(
      (
        sql,
      ) => sql`insert into dashboard_items (id, dashboard_id, connection_id, title, sql, chart_type, position)
                   values (${randomUUID()}, ${id}, 'demo-northwind', 'Broken card',
                           'select no_such_column from orders', 'table', 10)`,
    );
    await page.reload();

    const cards = page.getByTestId("dashboard-card");
    await expect(cards).toHaveCount(5);
    await expect(page.getByTestId("card-error")).toHaveCount(1);
    await expect(cards.last().getByTestId("card-error")).toContainText("no_such_column");
    await expect(cards.nth(0).getByTestId("chart")).toBeVisible();
    await expect(cards.nth(3).getByTestId("number-card")).toBeVisible();
  });

  test("T6.6 a share link opened signed out is read-only", async ({ page, browser }) => {
    await signInGuest(page);
    await openDemoDashboard(page);
    await page.getByRole("button", { name: "Share" }).click();
    const url = await page.getByTestId("share-url").inputValue();
    expect(url).toMatch(/\/en\/share\/[A-Za-z0-9_-]{43}$/);

    const stranger = await browser.newContext();
    const shared = await stranger.newPage();
    await shared.goto(url);
    await expect(shared.getByRole("heading", { name: "Northwind overview" })).toBeVisible();
    await expect(shared.getByText("read-only")).toBeVisible();
    await expect(shared.getByTestId("dashboard-card")).toHaveCount(4);
    await expect(shared.getByTestId("dashboard-card").first().getByTestId("chart")).toBeVisible();
    await expect(shared.getByTestId("drag-handle")).toHaveCount(0);
    await expect(shared.getByRole("button", { name: /Refresh|Share|Delete|Rename/ })).toHaveCount(
      0,
    );
    expect((await shared.request.get("/api/me")).status()).toBe(401); // Signed out.

    // Stop sharing: the link is gone at once.
    await page.getByRole("button", { name: "Stop sharing" }).click();
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
    await shared.reload();
    await expect(
      shared.getByRole("heading", { name: "This page could not be found." }),
    ).toBeVisible();
    await stranger.close();
  });

  test("T6.8 reordered cards keep their new order after a reload", async ({ page }) => {
    await signInGuest(page);
    const id = await openDemoDashboard(page);
    const before = await cardTitles(page);

    const saved = page.waitForResponse(
      (r) => r.url().endsWith(`/api/dashboards/${id}/order`) && r.request().method() === "PUT",
    );
    // Keyboard drag on the first card's handle: pick up, move one place, drop.
    const handle = page.getByTestId("drag-handle").first();
    await handle.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    expect((await saved).status()).toBe(200);

    const expected = [before[1], before[0], ...before.slice(2)];
    await expect.poll(() => cardTitles(page)).toEqual(expected);
    await page.reload();
    await expect(page.getByTestId("dashboard-card")).toHaveCount(4);
    expect(await cardTitles(page)).toEqual(expected);
  });

  test("renames and deletes a card", async ({ page }) => {
    await signInGuest(page);
    await openDemoDashboard(page);
    const first = page.getByTestId("dashboard-card").first();
    await first.getByRole("button", { name: "Rename card" }).click();
    await first.getByLabel("Title").fill("Top markets");
    await first.getByRole("button", { name: "Save" }).click();
    await expect(first.getByTestId("card-title")).toHaveText("Top markets");

    page.once("dialog", (dialog) => void dialog.accept());
    await first.getByRole("button", { name: "Delete card: Top markets" }).click();
    await expect(page.getByTestId("dashboard-card")).toHaveCount(3);
    await page.reload();
    await expect(page.getByTestId("dashboard-card")).toHaveCount(3);
    await expect(page.getByText("Top markets")).toHaveCount(0);
  });
});
