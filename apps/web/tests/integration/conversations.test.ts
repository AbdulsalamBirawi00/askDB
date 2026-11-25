import { eq, schema } from "@askdb/db";
import { http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as askPOST } from "@/app/api/ask/route";
import {
  DELETE as conversationDELETE,
  GET as conversationGET,
} from "@/app/api/conversations/[id]/route";
import { GET as conversationsGET } from "@/app/api/conversations/route";
import { PATCH as queryPATCH } from "@/app/api/queries/[id]/route";
import { POST as sqlPOST } from "@/app/api/sql/route";
import type { AskResponse } from "@/lib/ask-stream";
import { getDb } from "@/lib/db";

import {
  deleteCreatedUsers,
  jsonRequest,
  readAsk,
  request,
  signInGuest,
  type TestUser,
} from "./helpers";
import { completion, GROQ_URL, streamed, type ModelOutput } from "./model-mock";

vi.hoisted(() => {
  process.env.GROQ_API_KEY ||= "test-groq-key";
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.ZAI_API_KEY;
  delete process.env.NVIDIA_API_KEY;
});

const DEMO = "demo-northwind";

/** The mocked model, which also records the user prompt of every SQL request. */
function modelSays(...outputs: Partial<ModelOutput>[]) {
  const prompts: string[] = [];
  server.use(
    http.post(GROQ_URL, async ({ request }) => {
      const body = (await request.json()) as {
        stream?: boolean;
        messages: { role: string; content: string | { type: string; text?: string }[] }[];
      };
      if (body.stream) return streamed("Summary.");
      const user = body.messages.filter((m) => m.role === "user").at(-1)!;
      prompts.push(
        typeof user.content === "string"
          ? user.content
          : user.content.map((part) => part.text ?? "").join(""),
      );
      return completion(outputs[Math.min(prompts.length - 1, outputs.length - 1)]!);
    }),
  );
  return prompts;
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(async () => {
  server.close();
  await deleteCreatedUsers();
});

let alice: TestUser;
let bob: TestUser;
beforeAll(async () => {
  alice = await signInGuest();
  bob = await signInGuest();
});

async function ask(user: TestUser, question: string, conversationId?: string) {
  const response = await askPOST(
    jsonRequest("/api/ask", user.cookie, "POST", { connectionId: DEMO, question, conversationId }),
  );
  expect(response.status).toBe(200);
  const { result } = await readAsk(response);
  return result!;
}

async function runSql(user: TestUser, queryId: string, sql: string) {
  const response = await sqlPOST(jsonRequest("/api/sql", user.cookie, "POST", { queryId, sql }));
  const body = response.ok ? ((await response.json()) as { result: AskResponse }) : null;
  return { status: response.status, result: body?.result ?? null };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function loggedQuery(queryId: string) {
  const [row] = await getDb().select().from(schema.queries).where(eq(schema.queries.id, queryId));
  return row!;
}

const SALES_BY_COUNTRY =
  "select o.ship_country as country, round(sum(d.unit_price * d.quantity * (1 - d.discount))::numeric, 2) as sales " +
  "from orders o join order_details d on d.order_id = o.order_id group by 1 order by 2 desc";

describe("follow-up questions", () => {
  it("T5.1: 'show only the top 5' after 'Sales by country' adds LIMIT 5", async () => {
    const prompts = modelSays(
      { sql: `${SALES_BY_COUNTRY} limit 500`, chartType: "bar" },
      { sql: `${SALES_BY_COUNTRY} limit 5`, chartType: "bar" },
    );
    const first = await ask(alice, "Sales by country");
    expect(first.status).toBe("ok");
    expect(first.rows.length).toBeGreaterThan(5);
    expect(prompts[0]).not.toContain("Earlier in this conversation");

    const next = await ask(alice, "show only the top 5", first.conversationId);
    expect(next).toMatchObject({ status: "ok", conversationId: first.conversationId });
    expect(next.rows).toHaveLength(5);
    expect(next.sql).toMatch(/limit 5\b/i);
    // The follow-up prompt carried the first question and the SQL that ran, not its rows.
    expect(prompts[1]).toContain("Q: Sales by country");
    expect(prompts[1]).toContain(`SQL: ${first.sql}`);
    expect(prompts[1]).not.toContain(String(first.rows[0]!.sales));
  });

  it("T5.2: 'and in 1998?' after 'Orders in 1997' sends the 1997 query as context", async () => {
    const perYear = (year: number) =>
      `select count(*)::int as orders from orders where extract(year from order_date) = ${year}`;
    const prompts = modelSays(
      { sql: perYear(1997), chartType: "number" },
      { sql: perYear(1998), chartType: "number" },
    );
    const first = await ask(alice, "Orders in 1997");
    const next = await ask(alice, "and in 1998?", first.conversationId);
    expect(prompts[1]).toContain(`Q: Orders in 1997\nSQL: ${first.sql}`);
    expect(first.rows).toEqual([{ orders: 408 }]);
    expect(next.rows).toEqual([{ orders: 270 }]);
  });

  it("never passes a rejected query on as context", async () => {
    const prompts = modelSays(
      { sql: "delete from orders" },
      { sql: "select count(*)::int as n from orders" },
    );
    const first = await ask(alice, "remove every order");
    expect(first.status).toBe("rejected");
    await ask(alice, "how many orders then?", first.conversationId);
    expect(prompts[1]).toContain("Q: remove every order");
    expect(prompts[1]).not.toContain("delete from orders");
  });
});

describe("conversation history API", () => {
  it("lists, searches, opens, and deletes a conversation", async () => {
    modelSays({ sql: "select count(*)::int as n from customers", chartType: "number" });
    const answer = await ask(alice, "How many customers do we have?");

    const list = async (q?: string) => {
      const url = `/api/conversations?connectionId=${DEMO}${q === undefined ? "" : `&q=${encodeURIComponent(q)}`}`;
      const response = await conversationsGET(request(url, alice.cookie));
      expect(response.status).toBe(200);
      return ((await response.json()) as { conversations: { id: string; title: string }[] })
        .conversations;
    };
    expect((await list()).map((c) => c.id)).toContain(answer.conversationId);
    expect((await list("customers")).map((c) => c.id)).toContain(answer.conversationId);
    expect((await list("no such words here")).map((c) => c.id)).not.toContain(
      answer.conversationId,
    );

    const opened = await conversationGET(
      request(`/api/conversations/${answer.conversationId}`, alice.cookie),
      params(answer.conversationId),
    );
    expect(opened.status).toBe(200);
    const { conversation } = (await opened.json()) as {
      conversation: { title: string; turns: { id: string; sql: string; chartType: string }[] };
    };
    expect(conversation.title).toBe("How many customers do we have?");
    expect(conversation.turns).toEqual([
      expect.objectContaining({ id: answer.queryId, sql: answer.sql, chartType: "number" }),
    ]);

    const deleted = await conversationDELETE(
      request(`/api/conversations/${answer.conversationId}`, alice.cookie, { method: "DELETE" }),
      params(answer.conversationId),
    );
    expect(deleted.status).toBe(204);
    const gone = await conversationGET(
      request(`/api/conversations/${answer.conversationId}`, alice.cookie),
      params(answer.conversationId),
    );
    expect(gone.status).toBe(404);
    const rows = await getDb()
      .select()
      .from(schema.queries)
      .where(eq(schema.queries.conversationId, answer.conversationId));
    expect(rows).toEqual([]);
  });

  it("checks the session and the query string", async () => {
    expect(
      (await conversationsGET(request(`/api/conversations?connectionId=${DEMO}`))).status,
    ).toBe(401);
    expect((await conversationsGET(request("/api/conversations", alice.cookie))).status).toBe(400);
  });

  it("saves a rating and clears it", async () => {
    modelSays({ sql: "select count(*)::int as n from products", chartType: "number" });
    const answer = await ask(alice, "How many products?");
    const rate = (rating: unknown, user = alice) =>
      queryPATCH(
        jsonRequest(`/api/queries/${answer.queryId}`, user.cookie, "PATCH", { rating }),
        params(answer.queryId),
      );
    expect((await rate(-1)).status).toBe(200);
    expect((await loggedQuery(answer.queryId)).rating).toBe(-1);
    expect((await rate(1)).status).toBe(200);
    expect((await loggedQuery(answer.queryId)).rating).toBe(1);
    expect((await rate(null)).status).toBe(200);
    expect((await loggedQuery(answer.queryId)).rating).toBeNull();
    expect((await rate(5)).status).toBe(400);
  });

  it("T5.7: another user's conversation, query, and rating are 404", async () => {
    modelSays({ sql: "select count(*)::int as n from suppliers", chartType: "number" });
    const answer = await ask(alice, "How many suppliers?");
    const id = answer.conversationId;

    const open = await conversationGET(request(`/api/conversations/${id}`, bob.cookie), params(id));
    expect(open.status).toBe(404);
    const remove = await conversationDELETE(
      request(`/api/conversations/${id}`, bob.cookie, { method: "DELETE" }),
      params(id),
    );
    expect(remove.status).toBe(404);
    const rate = await queryPATCH(
      jsonRequest(`/api/queries/${answer.queryId}`, bob.cookie, "PATCH", { rating: -1 }),
      params(answer.queryId),
    );
    expect(rate.status).toBe(404);
    expect((await runSql(bob, answer.queryId, "select 1")).status).toBe(404);
    const listed = await conversationsGET(
      request(`/api/conversations?connectionId=${DEMO}`, bob.cookie),
    );
    const { conversations } = (await listed.json()) as { conversations: { id: string }[] };
    expect(conversations.map((c) => c.id)).not.toContain(id);

    // Alice still has it, unrated.
    expect((await loggedQuery(answer.queryId)).rating).toBeNull();
    const mine = await conversationGET(
      request(`/api/conversations/${id}`, alice.cookie),
      params(id),
    );
    expect(mine.status).toBe(200);
  });
});

describe("POST /api/sql (the SQL editor)", () => {
  async function seed() {
    modelSays({
      sql: "select country, count(*)::int as customers from customers group by country order by 2 desc, 1 limit 500",
      chartType: "bar",
    });
    return ask(alice, "Customers per country");
  }

  it("runs the same SQL again as a new, unedited turn", async () => {
    const answer = await seed();
    const { status, result } = await runSql(alice, answer.queryId, answer.sql!);
    expect(status).toBe(200);
    expect(result).toMatchObject({
      status: "ok",
      conversationId: answer.conversationId,
      edited: false,
      chart: { type: "bar" },
    });
    expect(result!.rows).toEqual(answer.rows);
    expect(result!.queryId).not.toBe(answer.queryId);
    expect(await loggedQuery(result!.queryId)).toMatchObject({
      edited: false,
      question: "Customers per country",
      provider: null,
    });
  });

  it("T5.5 (API): a hand-added WHERE runs and is logged as edited", async () => {
    const answer = await seed();
    const sql =
      "select country, count(*)::int as customers from customers where country = 'France' group by country limit 500";
    const { result } = await runSql(alice, answer.queryId, sql);
    expect(result).toMatchObject({ status: "ok", edited: true });
    expect(result!.rows).toEqual([{ country: "France", customers: 11 }]);
    expect(await loggedQuery(result!.queryId)).toMatchObject({ status: "ok", edited: true });
  });

  it.each([
    ["T5.4 (API): an UPDATE", "update customers set country = 'X'"],
    ["two statements", "select 1; delete from orders"],
    ["a hidden column", "select phone from customers"],
  ])("rejects %s through the guard and logs it", async (_name, sql) => {
    const answer = await seed();
    const { status, result } = await runSql(alice, answer.queryId, sql);
    expect(status).toBe(200);
    expect(result).toMatchObject({ status: "rejected", edited: true, rows: [] });
    expect(await loggedQuery(result!.queryId)).toMatchObject({ status: "rejected", edited: true });
  });

  it("returns a database error as a result", async () => {
    const answer = await seed();
    const { result } = await runSql(alice, answer.queryId, "select no_such_column from customers");
    expect(result).toMatchObject({ status: "error" });
    expect(result!.error).toMatch(/no_such_column/);
  });

  it("checks the session and the body", async () => {
    const response = await sqlPOST(
      jsonRequest("/api/sql", undefined, "POST", { queryId: "x", sql: "select 1" }),
    );
    expect(response.status).toBe(401);
    expect((await runSql(alice, "x", "   ")).status).toBe(400);
    expect((await runSql(alice, "no-such-query", "select 1")).status).toBe(404);
  });
});
