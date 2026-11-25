import { describe, expect, it } from "vitest";

import {
  buildRepairPrompt,
  buildSqlPrompt,
  buildSummaryPrompt,
  describeHistory,
  detectLanguage,
  MAX_HISTORY_TURNS,
} from "../src";

describe("answer language", () => {
  it.each([
    ["Monthly sales in 1997", "en"],
    ["Total number of orders?", "en"],
    ["كم عدد العملاء في كل دولة؟", "ar"],
    ["المبيعات الشهرية في عام 1997", "ar"],
    // Mixed: the language with more letters wins.
    ["How many orders came from مصر?", "en"],
    ["كم عدد الطلبات في جدول orders؟", "ar"],
    ["1997", "en"],
  ])("%s → %s", (question, language) => {
    expect(detectLanguage(question)).toBe(language);
  });

  it("names the language in the SQL and repair prompts", () => {
    expect(buildSqlPrompt("Monthly sales in 1997", [])).toMatch(/Answer language: English$/);
    expect(buildSqlPrompt("أفضل العملاء", [])).toMatch(/Answer language: Arabic$/);
    expect(buildRepairPrompt("أفضل العملاء", [], [{ sql: "select x", error: "boom" }])).toContain(
      "Answer language: Arabic",
    );
  });

  it("names the question's language in the summary prompt, even when the rows are Arabic", () => {
    const prompt = buildSummaryPrompt({
      question: "Customers per country",
      columns: ["country", "customers"],
      rows: [{ country: "مصر", customers: 3 }],
      totalRows: 1,
      truncated: false,
    });
    expect(prompt).toMatch(/Answer language: English$/);
    const arabic = buildSummaryPrompt({
      question: "المبيعات الشهرية في عام 1997",
      columns: ["month", "total_sales"],
      rows: [{ month: "1997-01-01", total_sales: "61258.07" }],
      totalRows: 1,
      truncated: false,
    });
    expect(arabic).toMatch(/Answer language: Arabic$/);
  });
});

describe("follow-up context", () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({
    question: `question ${i + 1}`,
    sql: `select ${i + 1}`,
    clarification: null,
  }));

  it("T5.3: a conversation with 10 questions sends only the last 3", () => {
    const prompt = buildSqlPrompt("and in 1998?", [], turns);
    expect(MAX_HISTORY_TURNS).toBe(3);
    for (const n of [8, 9, 10]) {
      expect(prompt).toContain(`Q: question ${n}\nSQL: select ${n}`);
    }
    for (let n = 1; n <= 7; n++) expect(prompt).not.toContain(`question ${n}\n`);
    expect(prompt.match(/^Q: /gm)).toHaveLength(3);
    // The repair prompt carries the same capped history.
    const repair = buildRepairPrompt(
      "and in 1998?",
      [],
      [{ sql: "select x", error: "boom" }],
      turns,
    );
    expect(repair.match(/^Q: /gm)).toHaveLength(3);
  });

  it("puts the history before the question, oldest first, and never results", () => {
    const prompt = buildSqlPrompt(
      "show only the top 5",
      [],
      [
        {
          question: "Sales by country",
          sql: "select country, sum(x) from t group by 1",
          clarification: null,
        },
        { question: "best customers?", sql: null, clarification: "By revenue or by order count?" },
      ],
    );
    const earlier = prompt.indexOf("Earlier in this conversation (oldest first):");
    expect(earlier).toBeGreaterThan(-1);
    expect(earlier).toBeLessThan(prompt.indexOf("Question:\nshow only the top 5"));
    expect(prompt.indexOf("Q: Sales by country")).toBeLessThan(
      prompt.indexOf("Q: best customers?"),
    );
    expect(prompt).toContain("You asked back: By revenue or by order count?");
    expect(describeHistory([])).toBe("");
    expect(buildSqlPrompt("x", [])).not.toContain("Earlier in this conversation");
  });
});
