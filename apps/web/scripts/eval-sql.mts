/**
 * Stage 3 evaluation: 10 simple Northwind questions, scored against reference queries.
 * Definition of done: at least 8 of 10 correct.
 *
 *   pnpm eval:sql
 *
 * Needs GROQ_API_KEY and/or GOOGLE_GENERATIVE_AI_API_KEY (or OLLAMA_BASE_URL), the local
 * app database with the demo connection (pnpm db:seed-demo), and the local Northwind.
 *
 * Saves the free quota: all 10 questions go to the model in ONE request, each answered
 * independently with the production instructions. The SQL then goes through the same
 * guard and read-only executor as /api/ask. Prints questions, SQL, and scores only.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  describeSchema,
  executeReadOnly,
  generateWithFallback,
  guardSql,
  promptTables,
  SQL_INSTRUCTIONS,
  sqlGenerationSchema,
  type QueryResult,
} from "@askdb/core";
import { createDb, DEMO_OWNER_ID, getConnectionSchema } from "@askdb/db";
import { z } from "zod";

const rootEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const CASES: { question: string; reference: string }[] = [
  {
    question: "How many customers are in each country?",
    reference: "select country, count(*) from customers group by country",
  },
  {
    question: "How many orders were placed in 1997?",
    reference: "select count(*) from orders where extract(year from order_date) = 1997",
  },
  {
    question: "What are the top 5 products by total sales revenue (after discount)?",
    reference: `select p.product_name, round(sum(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2)
      from order_details od join products p using (product_id)
      group by p.product_name order by 2 desc limit 5`,
  },
  {
    question: "Which employee handled the most orders, and how many?",
    reference: `select e.first_name, e.last_name, count(*) from orders o join employees e using (employee_id)
      group by e.employee_id, e.first_name, e.last_name order by 3 desc limit 1`,
  },
  {
    question: "What is the average freight cost per shipping company?",
    reference: `select s.company_name, round(avg(o.freight)::numeric, 2) from orders o
      join shippers s on s.shipper_id = o.ship_via group by s.company_name`,
  },
  {
    question: "How many products are in each category?",
    reference: `select c.category_name, count(*) from products p join categories c using (category_id)
      group by c.category_name`,
  },
  {
    question: "What were the total sales (after discount) for each year?",
    reference: `select extract(year from o.order_date)::int,
      round(sum(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2)
      from orders o join order_details od using (order_id) group by 1`,
  },
  {
    question: "Which products are out of stock?",
    reference: "select product_name from products where units_in_stock = 0",
  },
  {
    question: "How many orders were shipped to Germany?",
    reference: "select count(*) from orders where ship_country = 'Germany'",
  },
  {
    question: "كم عدد الموردين في كل دولة؟",
    reference: "select country, count(*) from suppliers group by country",
  },
];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Numbers rounded to 1 decimal (the model may round differently), text trimmed. */
function normalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (typeof value !== "boolean" && value !== "" && Number.isFinite(n)) return n.toFixed(1);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim().toLowerCase();
}

function columnValues(result: QueryResult, name: string): string[] {
  return result.rows.map((r) => normalize(r[name])).sort();
}

/**
 * Correct when the row counts match and every reference column has a matching column
 * (same multiset of values) in the answer. Extra columns and other names are fine.
 */
function matches(reference: QueryResult, answer: QueryResult): boolean {
  if (reference.rows.length !== answer.rows.length) return false;
  const answerColumns = answer.columns.map((c) => columnValues(answer, c.name).join("|"));
  return reference.columns.every((c) =>
    answerColumns.includes(columnValues(reference, c.name).join("|")),
  );
}

const providers = {
  groqApiKey: process.env.GROQ_API_KEY || undefined,
  groqModel: process.env.GROQ_MODEL || undefined,
  googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || undefined,
  googleModel: process.env.GOOGLE_MODEL || undefined,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || undefined,
  ollamaModel: process.env.OLLAMA_MODEL || undefined,
};
if (!providers.groqApiKey && !providers.googleApiKey && !providers.ollamaBaseUrl) {
  console.error(
    "Set GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or OLLAMA_BASE_URL in .env first.",
  );
  process.exit(1);
}

const local = new URL(required("DATABASE_URL"));
local.username = "readonly_demo";
local.password = required("NORTHWIND_READONLY_PASSWORD");
local.pathname = "/northwind";
const northwind = process.env.DEMO_NORTHWIND_URL ? new URL(process.env.DEMO_NORTHWIND_URL) : local;

const db = createDb(required("DATABASE_URL"));
const tables = await getConnectionSchema(db, "demo-northwind", DEMO_OWNER_ID);
if (!tables) throw new Error("No demo connection. Run pnpm db:seed-demo first.");
const guardSchema = {
  tables: tables.map((t) => ({
    schema: t.schema,
    name: t.name,
    hidden: t.hidden,
    columns: t.columns.map((c) => ({ name: c.name, hidden: c.hidden })),
  })),
};

const batchSchema = z.object({
  answers: z.array(sqlGenerationSchema.extend({ number: z.number().int() })),
});
const started = Date.now();
const generation = await generateWithFallback(providers, {
  instructions: `${SQL_INSTRUCTIONS}\n\nYou will get several numbered questions. Answer each one independently, as if it were the only question, and return one answer per question with its number.`,
  prompt: `Database schema:\n${describeSchema(promptTables(tables))}\n\nQuestions:\n${CASES.map(
    (c, i) => `${i + 1}. ${c.question}`,
  ).join("\n")}`,
  schema: batchSchema,
});
console.log(
  `Model: ${generation.provider} ${generation.model}, ${generation.tokens ?? "?"} tokens, ${Date.now() - started} ms\n`,
);

let correct = 0;
for (const [index, testCase] of CASES.entries()) {
  const answer = generation.output.answers.find((a) => a.number === index + 1);
  const label = `${String(index + 1).padStart(2)}. ${testCase.question}`;
  let verdict: string;
  if (!answer?.sql || answer.needsClarification) {
    verdict = `✗ no SQL (${answer?.clarificationQuestion ?? "missing answer"})`;
  } else {
    const guarded = guardSql(answer.sql, guardSchema);
    if (!guarded.ok) {
      verdict = `✗ blocked: ${guarded.message}`;
    } else {
      try {
        const [expected, actual] = [
          await executeReadOnly(northwind, testCase.reference),
          await executeReadOnly(northwind, guarded.sql),
        ];
        const ok = matches(expected, actual);
        if (ok) correct += 1;
        verdict = ok
          ? "✓ correct"
          : `✗ wrong result (${actual.rows.length} rows, expected ${expected.rows.length})`;
      } catch (error) {
        verdict = `✗ failed: ${error instanceof Error ? error.message : "error"}`;
      }
    }
  }
  console.log(`${label}\n    ${answer?.sql?.replace(/\s+/g, " ") ?? "—"}\n    ${verdict}\n`);
}

console.log(`Score: ${correct}/${CASES.length} (done when at least 8)`);
process.exit(correct >= 8 ? 0 : 1);
