import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import type { AskEvent, AskResponse } from "../../src/lib/ask-stream";
import { useUniqueClientIp } from "./helpers";

/**
 * The ask page UI. /api/ask is stubbed in the browser (an NDJSON stream of events) so
 * this runs without a model key; the route itself is covered by tests/integration/ask.test.ts.
 */
async function openAskPage(page: Page, lang: "en" | "ar") {
  await page.goto(`/${lang}`);
  await page.getByRole("button", { name: lang === "ar" ? "جرّب كضيف" : "Try as guest" }).click();
  await expect(page).toHaveURL(new RegExp(`/${lang}/app$`));
  await page.getByTestId("database-card").filter({ hasText: "Northwind" }).click();
  await page.getByTestId("ask-link").click();
  await expect(page).toHaveURL(/\/connections\/demo-northwind\/ask$/);
}

const base: AskResponse = {
  conversationId: "c1",
  queryId: "q1",
  status: "ok",
  sql: "select 1",
  explanation: null,
  chart: { type: "table" },
  clarificationQuestion: null,
  error: null,
  attempts: 1,
  repaired: false,
  edited: false,
  columns: [],
  rows: [],
  truncated: false,
  durationMs: 10,
};

/** The events a real answer streams: three stages, the result, an optional summary, done. */
function answerEvents(result: Partial<AskResponse>, summary?: string): AskEvent[] {
  return [
    { type: "stage", stage: "understanding", attempt: 1 },
    { type: "stage", stage: "writing", attempt: 1 },
    { type: "stage", stage: "running", attempt: 1 },
    { type: "result", result: { ...base, ...result } },
    ...(summary ? [{ type: "summary" as const, text: summary }] : []),
    { type: "done" },
  ];
}

/** Answers /api/ask with these events (all at once) and records what was sent. */
async function stubAsk(page: Page, events: AskEvent[]) {
  const sent: { body?: Record<string, unknown> } = {};
  await page.route("**/api/ask", async (route) => {
    sent.body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    });
  });
  return sent;
}

async function askQuestion(page: Page, question: string, lang: "en" | "ar" = "en") {
  await page.getByLabel(lang === "ar" ? "سؤالك" : "Your question").fill(question);
  await page.getByRole("button", { name: lang === "ar" ? "اسأل" : "Ask", exact: true }).click();
}

const months1997 = Array.from({ length: 12 }, (_, i) => ({
  month: `1997-${String(i + 1).padStart(2, "0")}-01 00:00:00+00`,
  total_sales: (40_000 + i * 1_500.25).toFixed(2),
}));

test.describe("ask page", () => {
  test.beforeEach(({ page }) => useUniqueClientIp(page));

  test("T4.1 monthly sales → line chart with months on the X axis", async ({ page }) => {
    await stubAsk(
      page,
      answerEvents(
        {
          sql: "select date_trunc('month', order_date) as month, sum(...) as total_sales ...",
          chart: { type: "line", x: "month", y: ["total_sales"] },
          columns: [
            { name: "month", kind: "date" },
            { name: "total_sales", kind: "number" },
          ],
          rows: months1997,
        },
        "Sales peaked in December.",
      ),
    );
    await openAskPage(page, "en");
    await askQuestion(page, "Monthly sales in 1997");

    const chart = page.getByTestId("chart");
    await expect(chart).toHaveAttribute("data-chart-type", "line");
    await expect(chart.locator(".recharts-line")).toHaveCount(1);
    // Month labels on the X axis, not raw timestamps.
    // Recharts may thin the labels on a narrow chart, but the last month always shows.
    await expect(chart.getByText("Dec 1997", { exact: true })).toBeVisible();
    await expect(chart.getByText(/\d{4}-\d{2}-\d{2}|00:00/)).toHaveCount(0);
    await expect(page.getByTestId("summary")).toHaveText("Sales peaked in December.");
    // The table shows the dates as dates, without a time-zone shift.
    await expect(page.getByTestId("result-table")).toContainText("1997-01-01");
  });

  test("T4.2 products per category → bar chart", async ({ page }) => {
    const sent = await stubAsk(
      page,
      answerEvents({
        chart: { type: "bar", x: "category", y: ["products"] },
        columns: [
          { name: "category", kind: "text" },
          { name: "products", kind: "number" },
        ],
        rows: [
          { category: "Confections", products: "13" },
          { category: "Beverages", products: "12" },
          { category: "Produce", products: "5" },
        ],
      }),
    );
    await openAskPage(page, "en");
    await page
      .getByTestId("example-question")
      .filter({ hasText: "Number of products per category" })
      .click();

    const chart = page.getByTestId("chart");
    await expect(chart).toHaveAttribute("data-chart-type", "bar");
    await expect(chart.locator(".recharts-bar-rectangle")).toHaveCount(3);
    expect(sent.body).toEqual({
      connectionId: "demo-northwind",
      question: "Number of products per category",
    });
  });

  test("T4.3 a single value → big-number card, no chart", async ({ page }) => {
    await stubAsk(
      page,
      answerEvents({
        chart: { type: "number", value: "total_orders" },
        columns: [{ name: "total_orders", kind: "number" }],
        rows: [{ total_orders: "830" }],
      }),
    );
    await openAskPage(page, "en");
    await askQuestion(page, "Total number of orders?");

    await expect(page.getByTestId("number-card")).toContainText("total orders");
    await expect(page.getByTestId("number-card")).toContainText("830");
    await expect(page.getByTestId("chart")).toHaveCount(0);
    await expect(page.getByTestId("result-table")).toHaveCount(0);
  });

  test("T4.6 after three failed attempts: a clear message and an Edit question button", async ({
    page,
  }) => {
    await stubAsk(
      page,
      answerEvents({
        status: "error",
        sql: "select no_such_column from customers",
        error: 'column "no_such_column" does not exist',
        attempts: 3,
        chart: null,
      }),
    );
    await openAskPage(page, "en");
    await askQuestion(page, "something odd");

    const problem = page.getByTestId("answer-problem");
    await expect(problem).toContainText("AskDB tried 3 times");
    await expect(problem).toContainText('column "no_such_column" does not exist');
    // The SQL is shown open when something went wrong.
    await expect(page.getByTestId("sql")).toBeVisible();
    await problem.getByRole("button", { name: "Edit question" }).click();
    await expect(page.getByLabel("Your question")).toBeFocused();
  });

  test("T4.7 no rows → a No results message instead of an empty table", async ({ page }) => {
    await stubAsk(
      page,
      answerEvents({ columns: [{ name: "company_name", kind: "text" }], rows: [] }),
    );
    await openAskPage(page, "en");
    await askQuestion(page, "Customers in Atlantis");

    await expect(page.getByTestId("no-results")).toContainText("No results");
    await expect(page.getByTestId("result-table")).toHaveCount(0);
  });

  test("T4.8 Export CSV downloads UTF-8 with a BOM, the right columns, and Arabic intact", async ({
    page,
  }) => {
    await stubAsk(
      page,
      answerEvents({
        columns: [
          { name: "country", kind: "text" },
          { name: "customers", kind: "number" },
        ],
        rows: [
          { country: "مصر", customers: 3 },
          { country: "Germany, West", customers: 11 },
        ],
      }),
    );
    await openAskPage(page, "en");
    await askQuestion(page, "Customers per country");

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^askdb-\d{4}-\d{2}-\d{2}\.csv$/);
    const bytes = await readFile((await download.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString("utf8")).toBe(
      'country,customers\r\nمصر,3\r\n"Germany, West",11\r\n',
    );
  });

  test("T4.10 progress stages appear in order before the result", async ({ page }) => {
    // A slow stream, event by event, so each stage is on screen for a moment.
    await page.addInitScript(
      (events: AskEvent[]) => {
        const w = window as unknown as { __seen: string[] };
        w.__seen = [];
        const note = (s: string) => {
          if (w.__seen.at(-1) !== s) w.__seen.push(s);
        };
        new MutationObserver(() => {
          const stage = document
            .querySelector("[data-testid=progress]")
            ?.getAttribute("data-stage");
          if (stage) note(stage);
          if (document.querySelector("[data-testid=answer]")) note("result");
        }).observe(document, { subtree: true, childList: true, attributes: true });

        const realFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (!url.endsWith("/api/ask")) return realFetch(input, init);
          const body = new ReadableStream<Uint8Array>({
            async start(controller) {
              for (const event of events) {
                await new Promise((r) => setTimeout(r, 300));
                controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
              }
              controller.close();
            },
          });
          return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
        };
      },
      answerEvents({
        columns: [{ name: "n", kind: "number" }],
        rows: [{ n: 1 }],
        chart: { type: "number", value: "n" },
      }),
    );

    await openAskPage(page, "en");
    await askQuestion(page, "How many orders?");
    await expect(page.getByTestId("progress")).toBeVisible();
    await expect(page.getByTestId("number-card")).toBeVisible();
    await expect(page.getByTestId("progress")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual([
      "understanding",
      "writing",
      "running",
      "result",
    ]);
  });

  test("sorts and pages the table", async ({ page }) => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      product: `Product ${i + 1}`,
      units: i + 1,
    }));
    await stubAsk(
      page,
      answerEvents({
        chart: { type: "table" },
        columns: [
          { name: "product", kind: "text" },
          { name: "units", kind: "number" },
        ],
        rows,
      }),
    );
    await openAskPage(page, "en");
    await askQuestion(page, "All products");

    const table = page.getByTestId("result-table");
    await expect(table.getByRole("row")).toHaveCount(26); // header + 25
    await expect(page.getByTestId("page-range")).toHaveText("Rows 1–25 of 30");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("page-range")).toHaveText("Rows 26–30 of 30");

    // Numbers sort as numbers: descending puts 30 first.
    await page.getByRole("button", { name: "Sort by units" }).click();
    await page.getByRole("button", { name: "Sort by units" }).click();
    await expect(table.getByRole("row").nth(1)).toContainText("Product 30");
    await expect(page.getByTestId("page-range")).toHaveText("Rows 1–25 of 30");
  });

  test("shows a clarification question instead of results (Arabic, RTL)", async ({ page }) => {
    await stubAsk(
      page,
      answerEvents({
        status: "clarification",
        sql: null,
        chart: null,
        explanation: "غامض",
        clarificationQuestion: "حسب عدد الطلبات أم حسب قيمتها؟",
      }),
    );
    await openAskPage(page, "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await askQuestion(page, "أفضل العملاء", "ar");
    await expect(page.getByTestId("clarification")).toContainText("حسب عدد الطلبات أم حسب قيمتها؟");
    await expect(page.getByTestId("result-table")).toHaveCount(0);
  });

  test("shows a blocked query clearly", async ({ page }) => {
    await stubAsk(
      page,
      answerEvents({
        status: "rejected",
        sql: "DELETE FROM orders",
        chart: null,
        error: "Queries that change data are not allowed",
      }),
    );
    await openAskPage(page, "en");
    await askQuestion(page, "delete the orders");
    await expect(page.getByTestId("answer-problem")).toContainText(
      "This query was blocked: Queries that change data are not allowed",
    );
  });

  test("shows the daily limit message on a 429", async ({ page }) => {
    await page.route("**/api/ask", (route) =>
      route.fulfill({ status: 429, json: { error: "Daily limit reached" } }),
    );
    await openAskPage(page, "en");
    await askQuestion(page, "x");
    await expect(
      page.getByRole("alert").filter({ hasText: "Daily limit reached. Try again tomorrow." }),
    ).toBeVisible();
  });
});

test.describe("ask page on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test.beforeEach(({ page }) => useUniqueClientIp(page));

  test("T4.9 no horizontal page scroll; a wide table scrolls inside its box", async ({ page }) => {
    const columns = [
      "customer_id",
      "company_name",
      "contact_name",
      "contact_title",
      "address",
      "city",
    ];
    const row = Object.fromEntries(columns.map((c) => [c, `${c} with a fairly long value`]));
    await stubAsk(
      page,
      answerEvents(
        {
          sql: `select ${columns.join(", ")} from customers order by company_name limit 500`,
          columns: columns.map((name) => ({ name, kind: "text" as const })),
          rows: [row, row, row],
        },
        "Three customers.",
      ),
    );
    await openAskPage(page, "en");
    await askQuestion(page, "All customers");
    await expect(page.getByTestId("result-table")).toBeVisible();
    await page.getByText("Show SQL").click();

    const widths = await page.evaluate(() => {
      const box = document.querySelector<HTMLElement>("[data-testid=result-scroll]")!;
      return {
        page: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        boxScroll: box.scrollWidth,
        boxWidth: box.clientWidth,
      };
    });
    expect(widths.page).toBeLessThanOrEqual(widths.viewport);
    expect(widths.boxScroll).toBeGreaterThan(widths.boxWidth);
  });
});
