import { describe, expect, it } from "vitest";

import { chooseChart, columnKind, MAX_BAR_CATEGORIES, type ColumnKind } from "../src";

const cols = (...spec: [string, ColumnKind][]) => spec.map(([name, kind]) => ({ name, kind }));

describe("columnKind", () => {
  it("maps Postgres type OIDs", () => {
    expect(columnKind(23)).toBe("number"); // int4
    expect(columnKind(20)).toBe("number"); // int8 (arrives as a string)
    expect(columnKind(1700)).toBe("number"); // numeric
    expect(columnKind(1082)).toBe("date");
    expect(columnKind(1184)).toBe("date");
    expect(columnKind(25)).toBe("text");
  });
});

describe("chooseChart", () => {
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: new Date(Date.UTC(1997, i, 1)),
    sales: String(10_000 + i * 500),
  }));

  it("T4.1 date + number → line, with the date on the X axis", () => {
    expect(
      chooseChart({
        suggested: "line",
        columns: cols(["month", "date"], ["sales", "number"]),
        rows: months,
      }),
    ).toEqual({ type: "line", x: "month", y: ["sales"] });
  });

  it("treats a month number or ISO month text as time", () => {
    const numeric = months.map((r, i) => ({ month: i + 1, sales: r.sales }));
    expect(
      chooseChart({
        suggested: "bar",
        columns: cols(["month", "number"], ["sales", "number"]),
        rows: numeric,
      }),
    ).toMatchObject({ type: "line", x: "month" });
    const text = months.map((r, i) => ({
      period: `1997-${String(i + 1).padStart(2, "0")}`,
      total: r.sales,
    }));
    expect(
      chooseChart({
        suggested: "line",
        columns: cols(["period", "text"], ["total", "number"]),
        rows: text,
      }),
    ).toMatchObject({ type: "line", x: "period", y: ["total"] });
  });

  it("T4.2 category + number → bar", () => {
    const rows = [
      { category: "Beverages", products: 12 },
      { category: "Condiments", products: 12 },
      { category: "Seafood", products: 12 },
    ];
    expect(
      chooseChart({
        suggested: "bar",
        columns: cols(["category", "text"], ["products", "number"]),
        rows,
      }),
    ).toEqual({ type: "bar", x: "category", y: ["products"] });
  });

  it("T4.3 a single value → big-number card", () => {
    expect(
      chooseChart({
        suggested: "number",
        columns: cols(["total_orders", "number"]),
        rows: [{ total_orders: "830" }],
      }),
    ).toEqual({ type: "number", value: "total_orders" });
    // Even when the model suggested something else.
    expect(
      chooseChart({ suggested: "bar", columns: cols(["n", "number"]), rows: [{ n: 5 }] }),
    ).toEqual({ type: "number", value: "n" });
  });

  it("T4.4 switches a suggested line chart to bar when there is no date", () => {
    const rows = [
      { country: "USA", customers: 13 },
      { country: "Germany", customers: 11 },
    ];
    expect(
      chooseChart({
        suggested: "line",
        columns: cols(["country", "text"], ["customers", "number"]),
        rows,
      }),
    ).toEqual({ type: "bar", x: "country", y: ["customers"] });
  });

  it("does not take a number named like a duration for a time axis", () => {
    const rows = [
      { shipper: "Speedy", avg_days: 8.5 },
      { shipper: "United", avg_days: 9.2 },
    ];
    expect(
      chooseChart({
        suggested: "line",
        columns: cols(["shipper", "text"], ["avg_days", "number"]),
        rows,
      }),
    ).toEqual({ type: "bar", x: "shipper", y: ["avg_days"] });
  });

  it("keeps a pie only when it fits (few non-negative slices, one series)", () => {
    const rows = [
      { region: "North", sales: 10 },
      { region: "South", sales: 20 },
    ];
    const columns = cols(["region", "text"], ["sales", "number"]);
    expect(chooseChart({ suggested: "pie", columns, rows })).toMatchObject({ type: "pie" });
    const many = Array.from({ length: 12 }, (_, i) => ({ region: `R${i}`, sales: i }));
    expect(chooseChart({ suggested: "pie", columns, rows: many })).toMatchObject({ type: "bar" });
  });

  it("falls back to a table when no chart fits", () => {
    const columns = cols(["name", "text"], ["value", "number"]);
    expect(chooseChart({ suggested: "bar", columns, rows: [] })).toEqual({ type: "table" });
    // Text only.
    expect(
      chooseChart({
        suggested: "bar",
        columns: cols(["a", "text"], ["b", "text"]),
        rows: [{ a: "x", b: "y" }],
      }),
    ).toEqual({ type: "table" });
    // Too many categories.
    const many = Array.from({ length: MAX_BAR_CATEGORIES + 1 }, (_, i) => ({
      name: `n${i}`,
      value: i,
    }));
    expect(chooseChart({ suggested: "bar", columns, rows: many })).toEqual({ type: "table" });
    // Repeated x values would need a pivot.
    const repeated = [
      { name: "a", value: 1 },
      { name: "a", value: 2 },
    ];
    expect(chooseChart({ suggested: "bar", columns, rows: repeated })).toEqual({ type: "table" });
    // The model asked for a table.
    expect(
      chooseChart({
        suggested: "table",
        columns,
        rows: [
          { name: "a", value: 1 },
          { name: "b", value: 2 },
        ],
      }),
    ).toEqual({
      type: "table",
    });
  });

  it("never plots id columns as values", () => {
    const rows = [
      { company: "A", customer_id: 1, orders: 5 },
      { company: "B", customer_id: 2, orders: 7 },
    ];
    expect(
      chooseChart({
        suggested: "bar",
        columns: cols(["company", "text"], ["customer_id", "number"], ["orders", "number"]),
        rows,
      }),
    ).toEqual({ type: "bar", x: "company", y: ["orders"] });
  });
});
