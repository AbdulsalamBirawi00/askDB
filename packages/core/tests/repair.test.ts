import { http, HttpResponse } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  askQuestion,
  DEFAULT_GOOGLE_MODEL,
  QueryExecutionError,
  summarizeResult,
  SUMMARY_ROW_LIMIT,
  type AskStage,
  type AskTable,
  type QueryResult,
  type SqlGeneration,
} from "../src";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_STREAM_URL = new RegExp(
  `^https://generativelanguage\\.googleapis\\.com/v1beta/models/${DEFAULT_GOOGLE_MODEL.replaceAll(".", "\\.")}:streamGenerateContent`,
);

const generation = (sql: string | null, extra: Partial<SqlGeneration> = {}): SqlGeneration => ({
  sql,
  explanation: "Test",
  chartType: "bar",
  needsClarification: false,
  clarificationQuestion: null,
  ...extra,
});

const groqJson = (output: SqlGeneration) =>
  HttpResponse.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "test",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(output) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });

/** An OpenAI-compatible SSE stream, one chunk per piece of text. */
const groqStream = (pieces: string[]) => {
  const chunk = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 1_700_000_000,
      model: "test",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  const body =
    pieces.map((text) => chunk({ role: "assistant", content: text }, null)).join("") +
    chunk({}, "stop") +
    "data: [DONE]\n\n";
  return new HttpResponse(body, { headers: { "content-type": "text/event-stream" } });
};

const geminiStream = (text: string) =>
  new HttpResponse(
    `data: ${JSON.stringify({
      candidates: [
        { content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 },
      ],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5, totalTokenCount: 10 },
    })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const tables: AskTable[] = [
  {
    schema: "public",
    name: "products",
    description: null,
    hidden: false,
    sampleRows: [],
    columns: [
      {
        name: "product_name",
        dataType: "text",
        isPrimaryKey: false,
        fkRef: null,
        description: null,
        hidden: false,
      },
      {
        name: "category_id",
        dataType: "integer",
        isPrimaryKey: false,
        fkRef: null,
        description: null,
        hidden: false,
      },
    ],
  },
];

const url = new URL("postgres://nobody:nothing@127.0.0.1:1/none");
const groqOnly = { groqApiKey: "test" };

/** Answers the model's requests in order, recording each prompt. */
function modelAnswers(...outputs: SqlGeneration[]) {
  const prompts: string[] = [];
  let i = 0;
  server.use(
    http.post(GROQ_URL, async ({ request }) => {
      const body = (await request.json()) as { messages: { role: string; content: string }[] };
      prompts.push(body.messages.at(-1)!.content);
      return groqJson(outputs[Math.min(i++, outputs.length - 1)]!);
    }),
  );
  return prompts;
}

const okResult: QueryResult = {
  columns: [
    { name: "category", type: 25 },
    { name: "products", type: 20 },
  ],
  rows: [
    { category: "Beverages", products: "12" },
    { category: "Seafood", products: "12" },
  ],
  truncated: false,
  durationMs: 3,
};

/** Fails SQL that mentions `bad`, like Postgres would for an unknown column. */
const fakeExecute = vi.fn(async (sql: string): Promise<QueryResult> => {
  if (sql.includes("bad")) {
    throw new QueryExecutionError('column "bad_column" does not exist', "42703");
  }
  return okResult;
});

describe("auto-repair", () => {
  afterEach(() => fakeExecute.mockClear());

  it("T4.5 fixes bad SQL (unknown column) on the second attempt and marks it repaired", async () => {
    const prompts = modelAnswers(
      generation("select bad_column from products"),
      generation(
        "select c.category_name as category, count(*) as products from products p join categories c using (category_id) group by 1 limit 500",
      ),
    );
    const stages: [AskStage, number][] = [];
    const outcome = await askQuestion({
      question: "Number of products per category",
      url,
      tables: [...tables, { ...tables[0]!, name: "categories" }],
      providers: groqOnly,
      execute: fakeExecute,
      onStage: (stage, attempt) => stages.push([stage, attempt]),
    });

    expect(outcome).toMatchObject({
      status: "ok",
      repaired: true,
      attempts: 2,
      tokens: 30,
      chart: { type: "bar", x: "category", y: ["products"] },
      columns: [
        { name: "category", kind: "text" },
        { name: "products", kind: "number" },
      ],
    });
    expect(fakeExecute).toHaveBeenCalledTimes(2);
    // The second prompt carries the failed SQL and the database's error.
    expect(prompts[1]).toContain("select bad_column from products");
    expect(prompts[1]).toContain('column "bad_column" does not exist');
    expect(stages).toEqual([
      ["writing", 1],
      ["running", 1],
      ["repairing", 2],
      ["running", 2],
    ]);
  });

  it("T4.6 gives up after three failed attempts with an understandable error", async () => {
    const prompts = modelAnswers(generation("select bad_column from products"));
    const outcome = await askQuestion({
      question: "x",
      url,
      tables,
      providers: groqOnly,
      execute: fakeExecute,
    });
    expect(outcome).toMatchObject({
      status: "error",
      attempts: 3,
      error: 'column "bad_column" does not exist',
      code: "42703",
    });
    expect(prompts).toHaveLength(3);
    expect(fakeExecute).toHaveBeenCalledTimes(3);
    // Every earlier attempt goes back to the model.
    expect(prompts[2]!.match(/Attempt \d:/g)).toEqual(["Attempt 1:", "Attempt 2:"]);
  });

  it("never repairs a guard rejection: write SQL stops at once", async () => {
    const prompts = modelAnswers(generation("delete from products"));
    const outcome = await askQuestion({
      question: "x",
      url,
      tables,
      providers: groqOnly,
      execute: fakeExecute,
    });
    expect(outcome).toMatchObject({ status: "rejected", reason: "write", attempts: 1 });
    expect(prompts).toHaveLength(1);
    expect(fakeExecute).not.toHaveBeenCalled();
  });

  it("passes repaired SQL through the guard again", async () => {
    modelAnswers(generation("select bad_column from products"), generation("drop table products"));
    const outcome = await askQuestion({
      question: "x",
      url,
      tables,
      providers: groqOnly,
      execute: fakeExecute,
    });
    expect(outcome).toMatchObject({ status: "rejected", attempts: 2 });
    expect(fakeExecute).toHaveBeenCalledTimes(1);
  });

  it("does not repair when the first query works", async () => {
    const prompts = modelAnswers(
      generation("select product_name from products limit 5", { chartType: "table" }),
    );
    const outcome = await askQuestion({
      question: "x",
      url,
      tables,
      providers: groqOnly,
      execute: fakeExecute,
    });
    expect(outcome).toMatchObject({ status: "ok", repaired: false, attempts: 1 });
    expect(prompts).toHaveLength(1);
  });
});

describe("summary", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ product: `P${i}`, sales: i }));

  it("streams the summary and sends only the first rows", async () => {
    let prompt = "";
    server.use(
      http.post(GROQ_URL, async ({ request }) => {
        const body = (await request.json()) as {
          messages: { content: string }[];
          stream?: boolean;
        };
        expect(body.stream).toBe(true);
        prompt = body.messages.at(-1)!.content;
        return groqStream(["P119 sold ", "the most."]);
      }),
    );
    const pieces: string[] = [];
    for await (const text of summarizeResult({
      question: "Sales per product",
      columns: ["product", "sales"],
      rows,
      truncated: false,
      providers: groqOnly,
    })) {
      pieces.push(text);
    }
    expect(pieces.join("")).toBe("P119 sold the most.");
    expect(prompt).toContain(`P${SUMMARY_ROW_LIMIT - 1}\t`);
    expect(prompt).not.toContain(`P${SUMMARY_ROW_LIMIT}\t`);
    expect(prompt).toContain(`Only the first ${SUMMARY_ROW_LIMIT} of 120 rows`);
  });

  it("falls back to Gemini when Groq is rate limited before any text", async () => {
    server.use(
      http.post(GROQ_URL, () => HttpResponse.json({ error: {} }, { status: 429 })),
      http.post(GEMINI_STREAM_URL, () => geminiStream("ملخص")),
    );
    const pieces: string[] = [];
    for await (const text of summarizeResult({
      question: "x",
      columns: ["product", "sales"],
      rows: rows.slice(0, 2),
      truncated: false,
      providers: { groqApiKey: "test", googleApiKey: "test", googleFallbackModel: "none" },
    })) {
      pieces.push(text);
    }
    expect(pieces.join("")).toBe("ملخص");
  });
});
