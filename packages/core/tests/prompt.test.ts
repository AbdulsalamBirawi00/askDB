import { describe, expect, it } from "vitest";

import { buildRepairPrompt, buildSqlPrompt, buildSummaryPrompt, detectLanguage } from "../src";

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
