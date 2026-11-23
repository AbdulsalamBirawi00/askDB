import { describe, expect, it } from "vitest";

import { EnvError, parseEnv } from "@/env";

describe("parseEnv", () => {
  it("T0.3 fails fast with a message naming DATABASE_URL when it is missing", () => {
    expect(() => parseEnv({})).toThrow(EnvError);
    expect(() => parseEnv({})).toThrow(/DATABASE_URL is required/);
  });

  it("reports only 'is required' for an empty DATABASE_URL", () => {
    try {
      parseEnv({ DATABASE_URL: "" });
      expect.unreachable();
    } catch (error) {
      expect((error as EnvError).issues).toEqual(["DATABASE_URL is required"]);
    }
  });

  it("rejects a DATABASE_URL that is not a postgres connection string", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://u:p@host/db" })).toThrow(
      /DATABASE_URL must be a postgres/,
    );
  });

  it("never includes the variable's value in the error (no secret leaks)", () => {
    const secret = "mysql://user:SuperSecretPassword@host/db";
    try {
      parseEnv({ DATABASE_URL: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("SuperSecretPassword");
    }
  });

  it("accepts a valid environment and defaults NODE_ENV", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/db" });
    expect(env.DATABASE_URL).toBe("postgres://u:p@localhost:5432/db");
    expect(env.NODE_ENV).toBe("development");
  });
});
