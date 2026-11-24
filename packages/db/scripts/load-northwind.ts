/**
 * Loads the Northwind sample database and creates the read-only `readonly_demo` role.
 *
 *   NORTHWIND_ADMIN_URL=postgres://owner@host/postgres  (a role that can create databases/roles)
 *   NORTHWIND_DB=northwind                              (database to create/load; default northwind)
 *   NORTHWIND_READONLY_PASSWORD=...                     (password for readonly_demo)
 *   NORTHWIND_SKIP_CREATE_DB=1                          (the database already exists, e.g. on Neon)
 *
 * Idempotent: re-running drops and reloads the Northwind tables and resets the role's grants.
 * Prints nothing secret.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import postgres from "postgres";

const rootEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const adminUrl = process.env.NORTHWIND_ADMIN_URL ?? process.env.DATABASE_URL;
const dbName = process.env.NORTHWIND_DB ?? "northwind";
const password = process.env.NORTHWIND_READONLY_PASSWORD;
if (!adminUrl) throw new Error("Set NORTHWIND_ADMIN_URL (or DATABASE_URL).");
if (!password) throw new Error("Set NORTHWIND_READONLY_PASSWORD.");
if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error("NORTHWIND_DB must be a plain identifier.");

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
try {
  if (!process.env.NORTHWIND_SKIP_CREATE_DB) {
    const [exists] = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (!exists) await admin.unsafe(`create database ${dbName}`);
  }
  const [role] = await admin`select 1 from pg_roles where rolname = 'readonly_demo'`;
  // Passwords cannot be bound as parameters in DDL; quote it as a literal.
  const literal = `'${password.replaceAll("'", "''")}'`;
  await admin.unsafe(
    role
      ? `alter role readonly_demo with login password ${literal}`
      : `create role readonly_demo with login password ${literal} nosuperuser nocreatedb nocreaterole noinherit`,
  );
} finally {
  await admin.end();
}

const db = postgres(withDatabase(adminUrl, dbName), { max: 1, onnotice: () => {} });
try {
  const dump = readFileSync(resolve(import.meta.dirname, "../northwind/northwind.sql"), "utf8")
    // Removed in PostgreSQL 12+; harmless to drop.
    .replace(/^SET default_with_oids = false;$/m, "");
  await db.unsafe(dump);
  await db.unsafe(`
    revoke all on database ${dbName} from public;
    grant connect on database ${dbName} to readonly_demo;
    revoke create on schema public from public;
    grant usage on schema public to readonly_demo;
    revoke all on all tables in schema public from readonly_demo;
    grant select on all tables in schema public to readonly_demo;
    alter role readonly_demo set default_transaction_read_only = on;
  `);
  const [{ count }] = await db<{ count: number }[]>`
    select count(*)::int as count from information_schema.tables where table_schema = 'public'`;
  console.log(`Northwind loaded into "${dbName}": ${count} tables; readonly_demo has SELECT only.`);
} finally {
  await db.end();
}
