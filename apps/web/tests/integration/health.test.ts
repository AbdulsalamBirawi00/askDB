import { afterEach, describe, expect, it, vi } from "vitest";

// `connection()` needs a Next request scope; outside Next it is a no-op for these tests.
vi.mock("next/server", () => ({ connection: async () => {} }));

describe("GET /api/health", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete (globalThis as { askdbDb?: unknown }).askdbDb;
  });

  it("T0.2 returns 200 with status ok and db ok when the database is reachable", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("returns 503 without leaking connection details when the database is down", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://nobody:hunter2@127.0.0.1:1/missing");
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "error", db: "unreachable" });
    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("127.0.0.1");
  });
});
