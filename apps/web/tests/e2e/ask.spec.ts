import { expect, test, type Page } from "@playwright/test";

import { useUniqueClientIp } from "./helpers";

/**
 * The ask page UI. The /api/ask response is stubbed in the browser so this runs without
 * a model key; the route itself is covered by tests/integration/ask.test.ts.
 */
async function openAskPage(page: Page, lang: "en" | "ar") {
  await page.goto(`/${lang}`);
  await page.getByRole("button", { name: lang === "ar" ? "جرّب كضيف" : "Try as guest" }).click();
  await expect(page).toHaveURL(new RegExp(`/${lang}/app$`));
  await page.getByTestId("database-card").filter({ hasText: "Northwind" }).click();
  await page.getByTestId("ask-link").click();
  await expect(page).toHaveURL(/\/connections\/demo-northwind\/ask$/);
}

const base = {
  conversationId: "c1",
  queryId: "q1",
  chartType: null,
  clarificationQuestion: null,
  error: null,
  columns: [],
  rows: [],
  truncated: false,
  durationMs: 10,
};

test.describe("ask page", () => {
  test.beforeEach(({ page }) => useUniqueClientIp(page));

  test("shows the explanation, the SQL, and the result table", async ({ page }) => {
    let sent: { connectionId?: string; question?: string } = {};
    await page.route("**/api/ask", async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({
        json: {
          ...base,
          status: "ok",
          sql: "select country, count(*) as customers from customers group by country",
          explanation: "Customers per country.",
          chartType: "bar",
          columns: [{ name: "country" }, { name: "customers" }],
          rows: [
            { country: "USA", customers: 13 },
            { country: "Germany", customers: 11 },
          ],
        },
      });
    });
    await openAskPage(page, "en");
    await page.getByLabel("Your question").fill("How many customers are in each country?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    await expect(page.getByText("Customers per country.")).toBeVisible();
    await expect(page.getByTestId("result-table").getByRole("row")).toHaveCount(3);
    await expect(page.getByText("2 rows")).toBeVisible();
    expect(sent).toEqual({
      connectionId: "demo-northwind",
      question: "How many customers are in each country?",
    });
  });

  test("shows a clarification question instead of results (Arabic, RTL)", async ({ page }) => {
    await page.route("**/api/ask", (route) =>
      route.fulfill({
        json: {
          ...base,
          status: "clarification",
          sql: null,
          explanation: "غامض",
          clarificationQuestion: "حسب عدد الطلبات أم حسب قيمتها؟",
        },
      }),
    );
    await openAskPage(page, "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByLabel("سؤالك").fill("أفضل العملاء");
    await page.getByRole("button", { name: "اسأل", exact: true }).click();
    await expect(page.getByTestId("clarification")).toContainText("حسب عدد الطلبات أم حسب قيمتها؟");
    await expect(page.getByTestId("result-table")).toHaveCount(0);
  });

  test("shows a blocked query clearly", async ({ page }) => {
    await page.route("**/api/ask", (route) =>
      route.fulfill({
        json: {
          ...base,
          status: "rejected",
          sql: "DELETE FROM orders",
          explanation: "Deletes orders.",
          error: "Queries that change data are not allowed",
        },
      }),
    );
    await openAskPage(page, "en");
    await page.getByLabel("Your question").fill("delete the orders");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(
      page.getByText("This query was blocked: Queries that change data are not allowed"),
    ).toBeVisible();
  });
});
