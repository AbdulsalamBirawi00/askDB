import { askQuestion, ProvidersFailedError, type AskOutcome, type HistoryTurn } from "@askdb/core";
import { getConnectionSchema } from "@askdb/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { providerConfig } from "@/lib/ask";
import { openVisibleConnection } from "@/lib/connections";
import { getDb } from "@/lib/db";

import { deleteCreatedUsers, signInGuest } from "../integration/helpers";

const DEMO = "demo-northwind";
const hasModel = !!(
  process.env.GROQ_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.ZAI_API_KEY ||
  process.env.NVIDIA_API_KEY
);

/** The first value of the first row, as a number. */
const firstNumber = (outcome: AskOutcome) =>
  outcome.status === "ok"
    ? Object.values(outcome.result.rows[0] ?? {})
        .map(Number)
        .find((n) => Number.isFinite(n))
    : undefined;

/**
 * Stage 5 definition of done: follow-ups work in at least 4 of 5 cases. Calls the engine
 * directly (no summaries) so the 5 cases cost 10 model calls. Run alone with
 * `pnpm --filter @askdb/web test:model tests/model/follow-ups-real-model.test.ts`.
 */
const CASES: {
  name: string;
  first: string;
  followUp: string;
  check: (outcome: AskOutcome) => boolean;
}[] = [
  {
    name: "T5.1 Sales by country → show only the top 5",
    first: "Sales by country",
    followUp: "show only the top 5",
    check: (o) => o.status === "ok" && o.result.rows.length === 5 && /limit\s+5\b/i.test(o.sql),
  },
  {
    name: "T5.2 Orders in 1997 → and in 1998?",
    first: "How many orders were placed in 1997?",
    followUp: "and in 1998?",
    check: (o) => firstNumber(o) === 270,
  },
  {
    name: "Products per category → only Beverages",
    first: "Number of products per category",
    followUp: "only for Beverages",
    check: (o) =>
      o.status === "ok" &&
      o.result.rows.length === 1 &&
      JSON.stringify(o.result.rows).includes("12"),
  },
  {
    name: "Customers in Germany → and in France?",
    first: "How many customers are in Germany?",
    followUp: "and in France?",
    check: (o) => o.status === "ok" && /france/i.test(o.sql) && firstNumber(o) === 11,
  },
  {
    name: "Top 10 products by stock → ascending",
    first: "Top 10 products by units in stock",
    followUp: "sort them from lowest to highest instead",
    check: (o) => {
      if (o.status !== "ok" || o.result.rows.length !== 10) return false;
      const stock = o.result.columns.find((c) => /stock/i.test(c.name))?.name;
      const values = o.result.rows.map((r) => Number(stock ? r[stock] : NaN));
      return values.every((v, i) => i === 0 || v >= values[i - 1]!);
    },
  },
];

describe.skipIf(!hasModel)("follow-up questions against a real model", () => {
  let context: { url: URL; tables: NonNullable<Awaited<ReturnType<typeof getConnectionSchema>>> };
  beforeAll(async () => {
    const guest = await signInGuest();
    const url = await openVisibleConnection(guest.id, DEMO);
    const tables = await getConnectionSchema(getDb(), DEMO, guest.id);
    context = { url: url!, tables: tables! };
  });
  afterAll(() => deleteCreatedUsers());

  it("answers at least 4 of 5 follow-ups correctly", { timeout: 600_000 }, async () => {
    const results: { name: string; ok: boolean; model: string; sql: string | null }[] = [];
    for (const c of CASES) {
      const ask = (question: string, history: HistoryTurn[]) =>
        askQuestion({ question, history, providers: providerConfig(), ...context });
      try {
        const first = await ask(c.first, []);
        const history: HistoryTurn[] = [
          {
            question: c.first,
            sql: first.status === "ok" ? first.sql : null,
            clarification: first.status === "clarification" ? first.clarificationQuestion : null,
          },
        ];
        const next = await ask(c.followUp, history);
        results.push({ name: c.name, ok: c.check(next), model: next.model, sql: next.sql });
      } catch (error) {
        // One unavailable model call fails that case only; the causes show which model said what.
        const causes = error instanceof ProvidersFailedError ? JSON.stringify(error.causes) : "";
        results.push({ name: c.name, ok: false, model: "-", sql: `${String(error)} ${causes}` });
      }
    }
    console.table(results);
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(4);
  });
});
