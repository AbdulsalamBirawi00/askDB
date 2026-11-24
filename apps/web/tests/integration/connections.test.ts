import { decryptSecret, inspectDatabase, parseEncryptionKey } from "@askdb/core";
import { eq, schema } from "@askdb/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PATCH as columnPATCH } from "@/app/api/connections/[id]/columns/[columnId]/route";
import { POST as refreshPOST } from "@/app/api/connections/[id]/refresh/route";
import { GET as schemaGET } from "@/app/api/connections/[id]/schema/route";
import { PATCH as tablePATCH } from "@/app/api/connections/[id]/tables/[tableId]/route";
import { POST as connectionsPOST } from "@/app/api/connections/route";
import { POST as testPOST } from "@/app/api/connections/test/route";
import { getDb } from "@/lib/db";

import {
  deleteCreatedUsers,
  jsonRequest,
  northwindUrl,
  request,
  signInGuest,
  signInUser,
  type TestUser,
} from "./helpers";

const WRITER_PASSWORD = "writer-demo-test-only";
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

type Column = { id: string; name: string; hidden: boolean; description: string | null };
type Table = { id: string; name: string; columns: Column[]; sampleRows: Record<string, unknown>[] };

async function addConnection(user: TestUser, url: string, name = "Northwind copy") {
  return connectionsPOST(jsonRequest("/api/connections", user.cookie, "POST", { name, url }));
}

async function getSchema(user: TestUser, id: string): Promise<Table[]> {
  const response = await schemaGET(request("/x", user.cookie), ctx({ id }));
  expect(response.status).toBe(200);
  return (await response.json()).tables;
}

// A role that can INSERT into one table, for the write-privilege warning.
const adminUrl = new URL(process.env.DATABASE_URL!);
adminUrl.pathname = "/northwind";
const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
beforeAll(async () => {
  await admin.unsafe(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'writer_demo') then
        create role writer_demo login password '${WRITER_PASSWORD}';
      end if;
    end $$;
    grant connect on database northwind to writer_demo;
    grant usage on schema public to writer_demo;
    grant select on all tables in schema public to writer_demo;
    grant insert on customers to writer_demo;
  `);
});
afterAll(async () => {
  await deleteCreatedUsers();
  await admin.end();
});

describe("introspection", () => {
  it("T2.6 Northwind: ~13 tables with their relationships", async () => {
    const inspection = await inspectDatabase(new URL(northwindUrl()));
    const names = inspection.tables.map((t) => t.name);
    expect(names.length).toBeGreaterThanOrEqual(13);
    expect(names).toEqual(
      expect.arrayContaining(["customers", "orders", "order_details", "products", "employees"]),
    );

    const column = (table: string, name: string) =>
      inspection.tables.find((t) => t.name === table)!.columns.find((c) => c.name === name)!;
    expect(column("orders", "customer_id").references).toMatchObject({
      table: "customers",
      column: "customer_id",
    });
    expect(column("order_details", "product_id").references).toMatchObject({
      table: "products",
      column: "product_id",
    });
    expect(column("customers", "customer_id").isPrimaryKey).toBe(true);
    expect(inspection.hasWriteAccess).toBe(false);

    // Sensitive columns are never fetched into the sample rows.
    expect(column("employees", "home_phone").sensitive).toBe(true);
    const employees = inspection.tables.find((t) => t.name === "employees")!;
    expect(employees.sampleRows.length).toBeGreaterThan(0);
    expect(employees.sampleRows.length).toBeLessThanOrEqual(3);
    expect(Object.keys(employees.sampleRows[0]!)).not.toContain("home_phone");
    expect(Object.keys(employees.sampleRows[0]!)).toContain("last_name");
  });
});

describe("adding a connection", () => {
  it("T2.1 a valid URL tests OK and is saved with its schema", async () => {
    const user = await signInUser();
    const test = await testPOST(jsonRequest("/x", user.cookie, "POST", { url: northwindUrl() }));
    expect(test.status).toBe(200);
    expect(await test.json()).toEqual({ ok: true, hasWriteAccess: false });

    const response = await addConnection(user, northwindUrl());
    expect(response.status).toBe(201);
    const { connection } = await response.json();
    expect(connection).toMatchObject({
      name: "Northwind copy",
      isDemo: false,
      hasWriteAccess: false,
    });
    expect(connection).not.toHaveProperty("encryptedUrl");

    const tables = await getSchema(user, connection.id);
    expect(tables.map((t) => t.name)).toContain("orders");
    // T2.7 at the app level: sensitive columns start hidden.
    const customers = tables.find((t) => t.name === "customers")!;
    expect(customers.columns.find((c) => c.name === "phone")!.hidden).toBe(true);
    expect(customers.columns.find((c) => c.name === "company_name")!.hidden).toBe(false);
  });

  it("T2.2 a wrong password gives 'Connection failed' without the URL or server details", async () => {
    const user = await signInUser();
    const bad = northwindUrl("readonly_demo", "definitely-wrong-password");
    for (const response of [
      await testPOST(jsonRequest("/x", user.cookie, "POST", { url: bad })),
      await addConnection(user, bad),
    ]) {
      expect(response.status).toBe(422);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: "Connection failed", code: "connection_failed" });
      const host = new URL(bad).hostname;
      for (const leak of [
        "definitely-wrong-password",
        "readonly_demo",
        "northwind",
        host,
        "authentication",
        "28P01",
      ]) {
        expect(text).not.toContain(leak);
      }
    }
  });

  it("T2.3 the stored value is ciphertext that does not contain the URL", async () => {
    const user = await signInUser();
    const { connection } = await (await addConnection(user, northwindUrl())).json();
    const [row] = await getDb()
      .select({ encryptedUrl: schema.connections.encryptedUrl })
      .from(schema.connections)
      .where(eq(schema.connections.id, connection.id));
    const url = northwindUrl();
    expect(row!.encryptedUrl).not.toContain(url);
    expect(row!.encryptedUrl).not.toContain(process.env.NORTHWIND_READONLY_PASSWORD!);
    expect(row!.encryptedUrl).not.toContain("readonly_demo");
    const key = parseEncryptionKey(process.env.CONNECTION_ENCRYPTION_KEY!);
    expect(decryptSecret(row!.encryptedUrl, key, connection.id)).toBe(new URL(url).toString());
  });

  it("T2.5 a role with INSERT privilege is flagged with a write warning", async () => {
    const user = await signInUser();
    const url = northwindUrl("writer_demo", WRITER_PASSWORD);
    const test = await testPOST(jsonRequest("/x", user.cookie, "POST", { url }));
    expect(await test.json()).toEqual({ ok: true, hasWriteAccess: true });
    const { connection } = await (await addConnection(user, url, "Writer")).json();
    expect(connection.hasWriteAccess).toBe(true);
  });

  it("guests cannot test or add connections (403)", async () => {
    const guest = await signInGuest();
    const test = await testPOST(jsonRequest("/x", guest.cookie, "POST", { url: northwindUrl() }));
    expect(test.status).toBe(403);
    expect((await addConnection(guest, northwindUrl())).status).toBe(403);
  });
});

describe("SSRF in production mode (security)", () => {
  it("T2.9 rejects internal addresses when private hosts are not allowed", async () => {
    vi.resetModules();
    vi.stubEnv("ALLOW_PRIVATE_DB_HOSTS", "false");
    try {
      const { POST } = await import("@/app/api/connections/test/route");
      const user = await signInUser();
      for (const url of [
        northwindUrl(),
        "postgres://u:p@127.0.0.1:5432/db",
        "postgres://u:p@169.254.169.254/db",
        "postgres://u:p@10.0.0.5/db",
      ]) {
        const response = await POST(jsonRequest("/x", user.cookie, "POST", { url }));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "This host is not allowed",
          code: "blocked_host",
        });
      }
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("notes, hidden flags, and refresh", () => {
  it("T2.8 a column note and hidden flag survive 'Refresh schema'", async () => {
    const user = await signInUser();
    const { connection } = await (await addConnection(user, northwindUrl())).json();
    const id = connection.id as string;
    const customers = (await getSchema(user, id)).find((t) => t.name === "customers")!;
    const country = customers.columns.find((c) => c.name === "country")!;
    const phone = customers.columns.find((c) => c.name === "phone")!;

    const note = await columnPATCH(
      jsonRequest("/x", user.cookie, "PATCH", { description: "Billing country (ISO name)" }),
      ctx({ id, columnId: country.id }),
    );
    expect(note.status).toBe(200);
    await tablePATCH(
      jsonRequest("/x", user.cookie, "PATCH", { description: "People and companies who order" }),
      ctx({ id, tableId: customers.id }),
    );
    // Unhide a sensitive column, hide a normal one.
    await columnPATCH(
      jsonRequest("/x", user.cookie, "PATCH", { hidden: false }),
      ctx({ id, columnId: phone.id }),
    );
    await columnPATCH(
      jsonRequest("/x", user.cookie, "PATCH", { hidden: true }),
      ctx({ id, columnId: country.id }),
    );

    expect(
      (await refreshPOST(request("/x", user.cookie, { method: "POST" }), ctx({ id }))).status,
    ).toBe(200);

    const after = (await getSchema(user, id)).find((t) => t.name === "customers")!;
    const col = (name: string) => after.columns.find((c) => c.name === name)!;
    expect(after.id).toBe(customers.id);
    expect(col("country")).toMatchObject({
      id: country.id,
      description: "Billing country (ISO name)",
      hidden: true,
    });
    expect(col("phone").hidden).toBe(false);
    expect((await getSchema(user, id)).find((t) => t.name === "customers")).toMatchObject({
      id: customers.id,
    });
    // Hidden columns are dropped from the sample rows returned to the client.
    expect(Object.keys(after.sampleRows[0]!)).not.toContain("country");
  });

  it("rejects an empty or unknown patch", async () => {
    const user = await signInUser();
    const { connection } = await (await addConnection(user, northwindUrl())).json();
    const [table] = await getSchema(user, connection.id);
    const call = (body: unknown) =>
      tablePATCH(
        jsonRequest("/x", user.cookie, "PATCH", body),
        ctx({ id: connection.id, tableId: table!.id }),
      );
    expect((await call({})).status).toBe(400);
    expect((await call({ hidden: "yes" })).status).toBe(400);
    expect((await call({ connectionId: "other" })).status).toBe(400);
  });
});

describe("ownership of schema routes (security)", () => {
  it("T1.5 user A cannot read, edit, or refresh user B's schema (404)", async () => {
    const a = await signInUser();
    const b = await signInUser();
    const { connection } = await (await addConnection(b, northwindUrl())).json();
    const id = connection.id as string;
    const [table] = await getSchema(b, id);
    const column = table!.columns[0]!;

    expect((await schemaGET(request("/x", a.cookie), ctx({ id }))).status).toBe(404);
    expect(
      (await refreshPOST(request("/x", a.cookie, { method: "POST" }), ctx({ id }))).status,
    ).toBe(404);
    const edit = { description: "vandalism" };
    expect(
      (
        await tablePATCH(
          jsonRequest("/x", a.cookie, "PATCH", edit),
          ctx({ id, tableId: table!.id }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await columnPATCH(
          jsonRequest("/x", a.cookie, "PATCH", edit),
          ctx({ id, columnId: column.id }),
        )
      ).status,
    ).toBe(404);
    // Pairing A's own connection id with B's column id does not work either.
    const own = (await (await addConnection(a, northwindUrl())).json()).connection.id as string;
    expect(
      (
        await columnPATCH(
          jsonRequest("/x", a.cookie, "PATCH", edit),
          ctx({ id: own, columnId: column.id }),
        )
      ).status,
    ).toBe(404);

    const unchanged = (await getSchema(b, id)).find((t) => t.id === table!.id)!;
    expect(unchanged.columns.find((c) => c.id === column.id)!.description).toBeNull();
  });

  it("everyone can read the shared demo schema; nobody but its owner can change it", async () => {
    const guest = await signInGuest();
    const tables = await getSchema(guest, "demo-northwind");
    expect(tables.length).toBeGreaterThanOrEqual(13);
    const [table] = tables;
    const edit = jsonRequest("/x", guest.cookie, "PATCH", { description: "spam" });
    expect((await tablePATCH(edit, ctx({ id: "demo-northwind", tableId: table!.id }))).status).toBe(
      404,
    );
    expect(
      (
        await refreshPOST(
          request("/x", guest.cookie, { method: "POST" }),
          ctx({ id: "demo-northwind" }),
        )
      ).status,
    ).toBe(404);
  });
});
