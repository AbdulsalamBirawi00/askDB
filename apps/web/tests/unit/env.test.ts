import { describe, expect, it } from "vitest";

import { EnvError, parseEnv } from "@/env";

const SECRET = "x".repeat(32);
const valid = { DATABASE_URL: "postgres://u:p@localhost:5432/db", BETTER_AUTH_SECRET: SECRET };

function issuesOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.issues;
    throw error;
  }
  return [];
}

describe("parseEnv", () => {
  it("T0.3 fails fast with a message naming DATABASE_URL when it is missing", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: SECRET })).toThrow(EnvError);
    expect(() => parseEnv({ BETTER_AUTH_SECRET: SECRET })).toThrow(/DATABASE_URL is required/);
  });

  it("reports only 'is required' for an empty DATABASE_URL", () => {
    expect(issuesOf({ ...valid, DATABASE_URL: "" })).toEqual(["DATABASE_URL is required"]);
  });

  it("rejects a DATABASE_URL that is not a postgres connection string", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://u:p@host/db" })).toThrow(
      /DATABASE_URL must be a postgres/,
    );
  });

  it("never includes the variable's value in the error (no secret leaks)", () => {
    const messages = [
      ...issuesOf({ ...valid, DATABASE_URL: "mysql://user:SuperSecretPassword@host/db" }),
      ...issuesOf({ ...valid, BETTER_AUTH_SECRET: "ShortSecretValue" }),
    ].join("\n");
    expect(messages).not.toContain("SuperSecretPassword");
    expect(messages).not.toContain("ShortSecretValue");
  });

  it("requires BETTER_AUTH_SECRET of at least 32 characters", () => {
    expect(issuesOf({ DATABASE_URL: valid.DATABASE_URL })).toEqual([
      "BETTER_AUTH_SECRET is required",
    ]);
    expect(issuesOf({ ...valid, BETTER_AUTH_SECRET: "short" })).toEqual([
      "BETTER_AUTH_SECRET must be at least 32 characters",
    ]);
  });

  it("requires the GitHub client id and secret together", () => {
    expect(issuesOf({ ...valid, GITHUB_CLIENT_ID: "abc" })).toEqual([
      "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together",
    ]);
    expect(issuesOf({ ...valid, GITHUB_CLIENT_ID: "abc", GITHUB_CLIENT_SECRET: "def" })).toEqual(
      [],
    );
  });

  it("treats empty optional variables as unset", () => {
    const env = parseEnv({ ...valid, BETTER_AUTH_URL: "", CRON_SECRET: "", GITHUB_CLIENT_ID: "" });
    expect(env.BETTER_AUTH_URL).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
  });

  it("accepts a valid environment and defaults NODE_ENV", () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.NODE_ENV).toBe("development");
  });
});
