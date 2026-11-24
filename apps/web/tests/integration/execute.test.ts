import { executeReadOnly, QueryExecutionError, QueryTimeoutError } from "@askdb/core";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { northwindUrl } from "./helpers";

const readonlyUrl = () => new URL(northwindUrl());
/** The Northwind owner (the app database role): it CAN write, so only READ ONLY stops it. */
const ownerUrl = () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = "/northwind";
  return url;
};

const owner = postgres(ownerUrl().toString(), { max: 1, onnotice: () => {} });
afterAll(() => owner.end({ timeout: 1 }));

const orderCount = async () => {
  const [row] = await owner<{ n: number }[]>`select count(*)::int as n from orders`;
  return row!.n;
};

describe("read-only executor", () => {
  it("runs a SELECT and returns columns and rows", async () => {
    const result = await executeReadOnly(
      readonlyUrl(),
      "select country, count(*)::int as n from customers group by country order by n desc limit 3",
    );
    expect(result.columns.map((c) => c.name)).toEqual(["country", "n"]);
    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it("T3.7 returns at most 500 rows, whatever LIMIT the query has", async () => {
    const all = await executeReadOnly(readonlyUrl(), "select * from order_details");
    expect(all.rows).toHaveLength(500);
    expect(all.truncated).toBe(true);

    const big = await executeReadOnly(readonlyUrl(), "select * from order_details limit 100000");
    expect(big.rows).toHaveLength(500);
  });

  it("T3.8 stops a very slow query with a clear message", async () => {
    const started = Date.now();
    const run = executeReadOnly(
      readonlyUrl(),
      "select count(*) from order_details a, order_details b, order_details c, order_details d",
      { timeoutMs: 1000 },
    );
    await expect(run).rejects.toBeInstanceOf(QueryTimeoutError);
    await expect(run).rejects.toThrow(/took longer than/);
    expect(Date.now() - started).toBeLessThan(8000);
  });

  it("T3.8 uses a 10 second timeout by default", async () => {
    const started = Date.now();
    await expect(executeReadOnly(readonlyUrl(), "select pg_sleep(11)")).rejects.toBeInstanceOf(
      QueryTimeoutError,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(9500);
  }, 20_000);

  it("reports a query error with the server's message", async () => {
    const run = executeReadOnly(readonlyUrl(), "select no_such_column from customers");
    await expect(run).rejects.toBeInstanceOf(QueryExecutionError);
    await expect(run).rejects.toMatchObject({ code: "42703" });
  });
});

describe("T3.6 the database itself refuses writes when the parser is bypassed", () => {
  it("the executor fails an INSERT and a data-modifying CTE", async () => {
    const before = await orderCount();
    await expect(
      executeReadOnly(
        ownerUrl(),
        "insert into region (region_id, region_description) values (99, 'x')",
      ),
    ).rejects.toBeInstanceOf(QueryExecutionError);
    await expect(
      executeReadOnly(
        ownerUrl(),
        "with d as (delete from orders returning *) select count(*) from d",
      ),
    ).rejects.toBeInstanceOf(QueryExecutionError);
    expect(await orderCount()).toBe(before);
  });

  it("a READ ONLY transaction blocks writes even for a role that can write", async () => {
    const before = await orderCount();
    await expect(
      owner.begin("read only", (tx) => tx.unsafe("delete from orders")),
    ).rejects.toMatchObject({ code: "25006" });
    expect(await orderCount()).toBe(before);
  });

  it("the read-only role cannot write even outside a READ ONLY transaction", async () => {
    const readonly = postgres(readonlyUrl().toString(), { max: 1, onnotice: () => {} });
    try {
      await expect(
        readonly.begin("read write", (tx) => tx.unsafe("delete from orders")),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await readonly.end({ timeout: 1 });
    }
  });
});
