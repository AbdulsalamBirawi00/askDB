import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import type { AskEvent } from "../../src/lib/ask-stream";
import { useUniqueClientIp } from "./helpers";

/**
 * Stage 5: history, follow-ups, ratings and the SQL editor. Conversations are seeded in
 * the database; "Run again" and edited SQL really run (POST /api/sql, no model involved)
 * against the demo Northwind database through the guard.
 */

const ASK = "/en/app/connections/demo-northwind/ask";

type SeedTurn = { question: string; sql: string | null; status?: string; explanation?: string };

async function signInGuest(page: Page): Promise<string> {
  await page.goto("/en");
  await page.getByRole("button", { name: "Try as guest" }).click();
  await page.waitForURL(/\/en\/app$/);
  const { user } = await (await page.request.get("/api/me")).json();
  return user.id as string;
}

/** Inserts a conversation with its turns (oldest first) and returns its id. */
async function seedConversation(userId: string, title: string, turns: SeedTurn[]) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const id = randomUUID();
  try {
    await sql`insert into conversations (id, user_id, connection_id, title)
              values (${id}, ${userId}, 'demo-northwind', ${title})`;
    const start = Date.now() - turns.length * 1000;
    for (const [i, turn] of turns.entries()) {
      await sql`insert into queries (id, conversation_id, question, sql, status, explanation, chart_type, created_at)
                values (${randomUUID()}, ${id}, ${turn.question}, ${turn.sql}, ${turn.status ?? "ok"},
                        ${turn.explanation ?? "Test explanation."}, 'bar', ${new Date(start + i * 1000)})`;
    }
  } finally {
    await sql.end();
  }
  return id;
}

/**
 * The page streams, so notFound() after the shell shows the 404 page with status 200;
 * the API routes answer a real 404 (tests/integration/conversations.test.ts).
 */
async function expectNotFound(page: Page) {
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
}

const CUSTOMERS_SQL =
  "select country, count(*)::int as customers from customers group by country order by 2 desc, 1 limit 500";

/** Replaces the editor's text (CodeMirror) with `text`. */
async function typeSql(page: Page, text: string) {
  const editor = page.getByTestId("sql-editor-input");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(text);
}

async function editLastSql(page: Page, text: string) {
  const turn = page.getByTestId("turn").last();
  await turn.getByText("Show SQL").click();
  await turn.getByRole("button", { name: "Edit SQL" }).click();
  await typeSql(page, text);
  await turn.getByRole("button", { name: "Run", exact: true }).click();
}

test.describe("conversation history", () => {
  test.beforeEach(({ page }) => useUniqueClientIp(page));

  test("T5.4 an UPDATE typed into the SQL editor is blocked", async ({ page }) => {
    const userId = await signInGuest(page);
    const id = await seedConversation(userId, "Customers per country", [
      { question: "Customers per country", sql: CUSTOMERS_SQL },
    ]);
    await page.goto(`${ASK}?c=${id}`);
    await editLastSql(page, "update customers set country = 'Nowhere'");

    const turn = page.getByTestId("turn").last();
    await expect(turn.getByTestId("answer-problem")).toContainText("This query was blocked");
    await expect(turn.getByTestId("edited-note")).toBeVisible();
    await expect(turn.getByTestId("result-table")).toHaveCount(0);
  });

  test("T5.5 a WHERE added by hand runs", async ({ page }) => {
    const userId = await signInGuest(page);
    const id = await seedConversation(userId, "Customers per country", [
      { question: "Customers per country", sql: CUSTOMERS_SQL },
    ]);
    await page.goto(`${ASK}?c=${id}`);
    await editLastSql(
      page,
      "select country, count(*)::int as customers from customers where country = 'France' group by country",
    );

    const table = page.getByTestId("turn").last().getByTestId("result-table");
    await expect(table.getByRole("row")).toHaveCount(2); // header + France
    await expect(table).toContainText("France");
    await expect(table).toContainText("11");
  });

  test("reopening shows the saved SQL, and Run again shows the result", async ({ page }) => {
    const userId = await signInGuest(page);
    const id = await seedConversation(userId, "Customers per country", [
      { question: "Customers per country", sql: CUSTOMERS_SQL },
    ]);
    await page.goto(`${ASK}?c=${id}`);
    await expect(page.getByTestId("saved-answer")).toContainText("Results are not saved");
    await page.getByRole("button", { name: "Run again" }).click();
    const last = page.getByTestId("turn").last();
    await expect(last.getByTestId("result-table")).toContainText("USA");
    await expect(page.getByTestId("turn")).toHaveCount(2);
    await expect(last.getByTestId("edited-note")).toHaveCount(0);
  });

  test("T5.6 history search for 'customers' finds the right conversation", async ({ page }) => {
    const userId = await signInGuest(page);
    await seedConversation(userId, "Customers per country", [
      { question: "Customers per country", sql: CUSTOMERS_SQL },
    ]);
    await seedConversation(userId, "Orders in 1997", [
      { question: "Orders in 1997", sql: "select count(*) from orders" },
      // A question inside the conversation also counts, not only its title.
      { question: "and how many customers ordered?", sql: "select 1" },
    ]);
    await seedConversation(userId, "Products per category", [
      { question: "Products per category", sql: "select 1" },
    ]);
    await page.goto(ASK);
    await expect(page.getByTestId("history-item")).toHaveCount(3);

    await page.getByTestId("history-search").fill("customers");
    const items = page.getByTestId("history-item");
    await expect(items).toHaveCount(2);
    await expect(items.filter({ hasText: "Customers per country" })).toHaveCount(1);
    await expect(items.filter({ hasText: "Orders in 1997" })).toHaveCount(1);

    await page.getByTestId("history-search").fill("nothing like this");
    await expect(page.getByTestId("history-empty")).toHaveText("No conversations match.");
  });

  test("T5.8 a 👎 is saved and shown when the conversation is reopened", async ({ page }) => {
    const userId = await signInGuest(page);
    const id = await seedConversation(userId, "Customers per country", [
      { question: "Customers per country", sql: CUSTOMERS_SQL },
    ]);
    await page.goto(`${ASK}?c=${id}`);
    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/queries/") && r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Not helpful" }).click();
    expect((await saved).status()).toBe(200);

    await page.reload();
    await expect(page.getByRole("button", { name: "Not helpful" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Helpful", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("opens a conversation from the sidebar and deletes it", async ({ page }) => {
    const userId = await signInGuest(page);
    const keep = await seedConversation(userId, "Orders in 1997", [
      { question: "Orders in 1997", sql: "select count(*) from orders" },
    ]);
    const remove = await seedConversation(userId, "Customers per country", [
      { question: "Customers per country", sql: CUSTOMERS_SQL },
    ]);
    await page.goto(ASK);
    await page
      .getByTestId("history-item")
      .filter({ hasText: "Customers per country" })
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(new RegExp(`\\?c=${remove}$`));
    await expect(page.getByTestId("turn-question")).toHaveText(["Customers per country"]);

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete conversation: Customers per country" }).click();
    await expect(page.getByTestId("history-item")).toHaveCount(1);
    await expect(page.getByTestId("turn")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${ASK}$`));

    // Gone for good; the other one is untouched.
    await page.goto(`${ASK}?c=${remove}`);
    await expectNotFound(page);
    await page.goto(`${ASK}?c=${keep}`);
    await expect(page.getByTestId("turn-question")).toHaveText(["Orders in 1997"]);
  });

  test("T5.7 another user's conversation URL is a 404", async ({ page }) => {
    await signInGuest(page);
    // Owned by the demo's system user, not by this guest.
    const theirs = await seedConversation("system-demo", "Someone else's question", [
      { question: "Someone else's question", sql: "select 1" },
    ]);
    await page.goto(`${ASK}?c=${theirs}`);
    await expectNotFound(page);
    await expect(page.getByText("Someone else's question")).toHaveCount(0);
  });

  test("a follow-up is sent in the same conversation and both turns stay on screen", async ({
    page,
  }) => {
    await signInGuest(page);
    await page.goto(ASK);
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/ask", async (route) => {
      bodies.push(route.request().postDataJSON());
      const n = bodies.length;
      const events: AskEvent[] = [
        {
          type: "result",
          result: {
            conversationId: "conv-1",
            queryId: `q${n}`,
            status: "ok",
            sql: n === 1 ? "select 1 as orders" : "select 2 as orders",
            explanation: null,
            chart: { type: "number", value: "orders" },
            clarificationQuestion: null,
            error: null,
            attempts: 1,
            repaired: false,
            edited: false,
            columns: [{ name: "orders", kind: "number" }],
            rows: [{ orders: n === 1 ? 408 : 270 }],
            truncated: false,
            durationMs: 5,
          },
        },
        { type: "done" },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson; charset=utf-8",
        body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      });
    });
    // The sidebar refresh would 404 on the stubbed ids; keep it quiet.
    await page.route("**/api/conversations?*", (route) =>
      route.fulfill({ json: { conversations: [] } }),
    );

    const ask = async (q: string) => {
      await page.getByLabel("Your question").fill(q);
      await page.getByRole("button", { name: "Ask", exact: true }).click();
    };
    await ask("Orders in 1997");
    await expect(page.getByTestId("number-card")).toContainText("408");
    await expect(page.getByLabel("Your question")).toHaveAttribute("placeholder", /follow-up/);
    await ask("and in 1998?");
    await expect(page.getByTestId("number-card")).toHaveCount(2);
    await expect(page.getByTestId("number-card").last()).toContainText("270");

    expect(bodies[0]).not.toHaveProperty("conversationId");
    expect(bodies[1]).toMatchObject({ conversationId: "conv-1", question: "and in 1998?" });
    await expect(page).toHaveURL(/\?c=conv-1$/);
  });
});
