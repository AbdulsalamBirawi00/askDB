/**
 * Creates or refreshes the shared Northwind demo connection in the app database.
 *
 *   DEMO_NORTHWIND_URL       read-only Northwind URL (role readonly_demo)
 *   DATABASE_URL             app database
 *   CONNECTION_ENCRYPTION_KEY
 *   ALLOW_PRIVATE_DB_HOSTS   true for a local Northwind
 *
 * Idempotent. Prints only counts, never the URL.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  encryptSecret,
  inspectDatabase,
  parseEncryptionKey,
  validateConnectionUrl,
} from "@askdb/core";
import {
  createConnection,
  createDb,
  DEMO_OWNER_ID,
  ensureDemoOwner,
  getOwnedConnectionSecret,
  refreshConnectionSchema,
} from "@askdb/db";

const rootEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const DEMO_CONNECTION_ID = "demo-northwind";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

let raw = process.env.DEMO_NORTHWIND_URL;
if (!raw && process.env.NORTHWIND_READONLY_PASSWORD) {
  // Local default: the northwind database next to the app database (pnpm db:northwind).
  const local = new URL(required("DATABASE_URL"));
  local.username = "readonly_demo";
  local.password = process.env.NORTHWIND_READONLY_PASSWORD;
  local.pathname = "/northwind";
  raw = local.toString();
}
if (!raw) throw new Error("DEMO_NORTHWIND_URL is required");

const key = parseEncryptionKey(required("CONNECTION_ENCRYPTION_KEY"));
const url = await validateConnectionUrl(raw, {
  allowPrivateHosts: process.env.ALLOW_PRIVATE_DB_HOSTS === "true",
});
const inspection = await inspectDatabase(url);
if (inspection.hasWriteAccess) {
  throw new Error("The demo role can write. Use the read-only readonly_demo role.");
}

const db = createDb(required("DATABASE_URL"));
await ensureDemoOwner(db);
const encryptedUrl = encryptSecret(url.toString(), key, DEMO_CONNECTION_ID);
const existing = await getOwnedConnectionSecret(db, DEMO_CONNECTION_ID, DEMO_OWNER_ID);
if (existing) {
  await refreshConnectionSchema(db, {
    id: DEMO_CONNECTION_ID,
    userId: DEMO_OWNER_ID,
    inspection,
    encryptedUrl,
  });
} else {
  await createConnection(db, {
    id: DEMO_CONNECTION_ID,
    userId: DEMO_OWNER_ID,
    name: "Northwind",
    encryptedUrl,
    isDemo: true,
    inspection,
  });
}
const columns = inspection.tables.reduce((n, t) => n + t.columns.length, 0);
console.log(
  `Demo connection ${existing ? "refreshed" : "created"}: ${inspection.tables.length} tables, ${columns} columns.`,
);
process.exit(0);
