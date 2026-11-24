import { describe, expect, it } from "vitest";

import { dropHiddenColumns, guardSql, type GuardSchema } from "../src";

const col = (name: string, hidden = false) => ({ name, hidden });

const schema: GuardSchema = {
  tables: [
    {
      schema: "public",
      name: "customers",
      hidden: false,
      columns: [col("customer_id"), col("company_name"), col("country"), col("phone", true)],
    },
    {
      schema: "public",
      name: "orders",
      hidden: false,
      columns: [col("order_id"), col("customer_id"), col("order_date"), col("freight")],
    },
    {
      schema: "public",
      name: "order_details",
      hidden: false,
      columns: [col("order_id"), col("product_id"), col("unit_price"), col("quantity")],
    },
    { schema: "public", name: "secrets", hidden: true, columns: [col("value")] },
  ],
};

const reason = (sql: string) => {
  const result = guardSql(sql, schema);
  return result.ok ? "ok" : result.reason;
};

describe("SQL guard: allowed queries", () => {
  it.each([
    "select country, count(*) from customers group by country order by 2 desc",
    "SELECT c.company_name, count(o.order_id) AS n FROM customers c JOIN orders o ON o.customer_id = c.customer_id GROUP BY c.company_name;",
    "with t as (select customer_id, sum(freight) as f from orders group by customer_id) select * from t order by f desc limit 5",
    "select date_trunc('month', order_date) as m, sum(freight) from orders group by 1 order by 1",
    "select order_id, sum(unit_price * quantity) from order_details group by order_id",
    "select 'please delete everything' as note, company_name from customers",
    "select country, count(*) filter (where country is not null) from customers group by country",
    "select pg_typeof(freight) from orders limit 1",
  ])("allows %s", (sql) => {
    expect(reason(sql)).toBe("ok");
  });

  it("strips the trailing semicolon", () => {
    const result = guardSql("select 1 from customers;  ", schema);
    expect(result).toMatchObject({ ok: true, sql: "select 1 from customers" });
  });

  it("returns hidden column names of referenced tables for SELECT *", () => {
    const result = guardSql("select * from customers", schema);
    expect(result).toMatchObject({ ok: true, hiddenColumns: ["phone"] });
  });
});

describe("SQL guard: rejected queries", () => {
  it("T3.2 rejects DELETE before execution", () => {
    expect(reason("DELETE FROM orders")).toBe("write");
  });

  it.each([
    ["insert into orders (order_id) values (1)", "write"],
    ["update customers set country = 'x'", "write"],
    ["drop table customers", "write"],
    ["truncate orders", "write"],
    ["select * into new_table from customers", "not_select"],
    ["create table x as select * from customers", "write"],
    ["copy customers to '/tmp/x'", "write"],
    ["set role postgres", "unverifiable"],
    ["show search_path", "not_select"],
    ["", "empty"],
  ])("rejects %s", (sql, expected) => {
    expect(reason(sql)).toBe(expected);
  });

  it("T3.3 rejects multiple statements", () => {
    expect(reason("SELECT 1; DROP TABLE customers")).toBe("multiple_statements");
    expect(reason("select 1 from customers; select 2 from orders")).toBe("multiple_statements");
  });

  it.each([
    "SELECT pg_sleep(60)",
    "select pg_catalog.pg_sleep(1) from customers",
    "select pg_read_file('/etc/passwd')",
    "select pg_terminate_backend(123)",
    "select * from dblink('host=x', 'select 1') as t(a int)",
    "select set_config('statement_timeout', '0', false)",
    "select current_setting('data_directory')",
    "select nextval('orders_seq')",
    "select lo_import('/etc/passwd')",
    "select query_to_xml('delete from orders', true, true, '')",
  ])("T3.4 rejects the forbidden function in %s", (sql) => {
    expect(["forbidden_function", "write", "unverifiable"]).toContain(reason(sql));
  });

  it("T3.4 rejects pg_sleep as a forbidden function", () => {
    expect(reason("SELECT pg_sleep(60)")).toBe("forbidden_function");
  });

  it("T3.5 rejects a data-modifying CTE", () => {
    expect(reason("WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x")).not.toBe("ok");
    expect(
      reason("with x as (update orders set freight = 0 returning order_id) select count(*) from x"),
    ).not.toBe("ok");
  });

  it("T3.14 rejects SQL the parser cannot read as unverifiable", () => {
    expect(reason("select * from customers for update")).not.toBe("ok");
    expect(reason("selec country form customers")).toBe("unverifiable");
    expect(reason("select ((( from customers")).toBe("unverifiable");
  });

  it.each([
    "select * from pg_catalog.pg_user",
    "select * from information_schema.tables",
    "select * from pg_shadow",
    "select * from secrets",
    "select * from some_table_that_does_not_exist",
  ])("rejects the unavailable table in %s", (sql) => {
    expect(reason(sql)).toBe("forbidden_table");
  });
});

describe("SQL guard: hidden columns", () => {
  it("T3.13 rejects a query that references a hidden column", () => {
    const result = guardSql("select company_name, phone from customers", schema);
    expect(result).toEqual({
      ok: false,
      reason: "hidden_column",
      message: "This column is not available",
    });
  });

  it.each([
    "select c.phone from customers c",
    "select company_name from customers where phone like '555%'",
    "select company_name from customers order by phone",
    "select count(distinct phone) from customers",
    "select c from customers c",
    "select row_to_json(customers) from customers",
    'select "phone" from customers',
  ])("T3.13 rejects %s", (sql) => {
    expect(reason(sql)).toBe("hidden_column");
  });

  it("drops hidden columns from SELECT * results", () => {
    const out = dropHiddenColumns(
      [{ customer_id: "A", phone: "555" }],
      [{ name: "customer_id" }, { name: "phone" }],
      ["phone"],
    );
    expect(out).toEqual({ rows: [{ customer_id: "A" }], columns: [{ name: "customer_id" }] });
  });
});
