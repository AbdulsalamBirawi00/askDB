import { randomUUID } from "node:crypto";

import { deleteStaleGuests, eq, inArray, schema } from "@askdb/db";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";

const DAY = 24 * 60 * 60 * 1000;
const ids: string[] = [];

async function insertUser(role: "user" | "demo", ageDays: number): Promise<string> {
  const id = randomUUID();
  ids.push(id);
  const createdAt = new Date(Date.now() - ageDays * DAY);
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    name: role === "demo" ? "Guest" : "Someone",
    email: `${id}@test.invalid`,
    role,
    isAnonymous: role === "demo",
    createdAt,
  });
  await db.insert(schema.sessions).values({
    id: randomUUID(),
    token: randomUUID(),
    userId: id,
    expiresAt: new Date(Date.now() + DAY),
  });
  await db.insert(schema.connections).values({
    id: randomUUID(),
    userId: id,
    name: "db",
    encryptedUrl: "x",
  });
  return id;
}

async function countRows(userId: string) {
  const db = getDb();
  const [users, sessions, connections] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.id, userId)),
    db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId)),
    db.select().from(schema.connections).where(eq(schema.connections.userId, userId)),
  ]);
  return { users: users.length, sessions: sessions.length, connections: connections.length };
}

afterAll(async () => {
  await getDb().delete(schema.users).where(inArray(schema.users.id, ids));
});

describe("guest cleanup", () => {
  it("T1.6 deletes an 8-day-old guest account and all its data", async () => {
    const oldGuest = await insertUser("demo", 8);
    const recentGuest = await insertUser("demo", 6);
    const oldUser = await insertUser("user", 30);

    const deleted = await deleteStaleGuests(getDb());

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await countRows(oldGuest)).toEqual({ users: 0, sessions: 0, connections: 0 });
    expect(await countRows(recentGuest)).toEqual({ users: 1, sessions: 1, connections: 1 });
    expect(await countRows(oldUser)).toEqual({ users: 1, sessions: 1, connections: 1 });
  });
});

describe("GET /api/cron/cleanup-guests", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  async function call(authorization?: string, secret = "s".repeat(24)) {
    vi.stubEnv("CRON_SECRET", secret);
    const { GET } = await import("@/app/api/cron/cleanup-guests/route");
    const headers = authorization ? { authorization } : undefined;
    return GET(new Request("http://localhost/api/cron/cleanup-guests", { headers }));
  }

  it("refuses calls without the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
  });

  it("refuses every call when CRON_SECRET is not configured", async () => {
    expect((await call("Bearer ", "")).status).toBe(401);
  });

  it("runs the cleanup with the right secret", async () => {
    const response = await call(`Bearer ${"s".repeat(24)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: expect.any(Number) });
  });
});
