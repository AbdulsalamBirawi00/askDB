import { describe, expect, it } from "vitest";

import {
  assertPublicHost,
  ConnectionUrlError,
  isPrivateAddress,
  parseConnectionUrl,
  validateConnectionUrl,
  type LookupFn,
} from "../src";

const resolvesTo =
  (...addresses: string[]): LookupFn =>
  async () =>
    addresses.map((address) => ({ address }));

async function code(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof ConnectionUrlError ? error.code : "other";
  }
}

describe("connection URL shape", () => {
  it.each([
    "postgres://u:p@db.example.com/app",
    "postgresql://u:p@db.example.com:6543/app?sslmode=require&channel_binding=require",
  ])("accepts %s", (raw) => {
    expect(() => parseConnectionUrl(raw)).not.toThrow();
  });

  it.each([
    ["not a url", "garbage"],
    ["mysql scheme", "mysql://u:p@db.example.com/app"],
    ["no user", "postgres://db.example.com/app"],
    ["no database", "postgres://u:p@db.example.com"],
    ["multiple hosts", "postgres://u:p@a.example.com,b.example.com/app"],
    ["host override in query", "postgres://u:p@db.example.com/app?host=10.0.0.1"],
    ["hostaddr override", "postgres://u:p@db.example.com/app?hostaddr=127.0.0.1"],
    ["client cert file read", "postgres://u:p@db.example.com/app?sslcert=/etc/passwd"],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseConnectionUrl(raw)).toThrow(ConnectionUrlError);
  });

  it("errors never include the URL", () => {
    try {
      parseConnectionUrl("mysql://admin:hunter2@secret-host/app");
    } catch (error) {
      expect((error as Error).message).not.toMatch(/hunter2|secret-host|admin/);
    }
  });
});

describe("SSRF protection (security)", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.5",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
  ])("T2.9 %s is treated as internal", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "3.75.10.20", "2a05:d014::1"])("%s is public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it.each([
    ["localhost", "postgres://u:p@localhost/app"],
    ["a .localhost name", "postgres://u:p@db.localhost/app"],
    ["loopback IP", "postgres://u:p@127.0.0.1:5432/app"],
    ["cloud metadata IP", "postgres://u:p@169.254.169.254/app"],
    ["private range", "postgres://u:p@192.168.0.10/app"],
    ["IPv6 loopback", "postgres://u:p@[::1]/app"],
    ["metadata hostname", "postgres://u:p@metadata.google.internal/app"],
  ])("T2.9 rejects %s in production", async (_label, raw) => {
    expect(await code(validateConnectionUrl(raw, { allowPrivateHosts: false }))).toBe(
      "blocked_host",
    );
  });

  it("T2.9 rejects a public-looking name that resolves to an internal address", async () => {
    expect(await code(assertPublicHost("evil.example.com", resolvesTo("10.0.0.7")))).toBe(
      "blocked_host",
    );
    // Any internal address among several is enough to refuse.
    expect(
      await code(assertPublicHost("mixed.example.com", resolvesTo("3.75.10.20", "127.0.0.1"))),
    ).toBe("blocked_host");
  });

  it("accepts a host that resolves only to public addresses", async () => {
    expect(await code(assertPublicHost("db.example.com", resolvesTo("3.75.10.20")))).toBe("ok");
  });

  it("allows private hosts only when explicitly enabled (local development, CI)", async () => {
    const raw = "postgres://u:p@localhost:5433/app";
    expect(await code(validateConnectionUrl(raw, { allowPrivateHosts: true }))).toBe("ok");
  });
});
