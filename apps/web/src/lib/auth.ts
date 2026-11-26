import "server-only";

import { createDemoDashboard, schema } from "@askdb/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { anonymous } from "better-auth/plugins";

import { getEnv } from "@/env";
import { getDb } from "@/lib/db";

export type UserRole = "user" | "demo";

function createAuth() {
  const env = getEnv();
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : undefined;

  return betterAuth({
    appName: "AskDB",
    secret: env.BETTER_AUTH_SECRET,
    // Unset: the origin of each request (works for Vercel preview URLs). Set it in production.
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
      },
    }),
    socialProviders: github ? { github } : {},
    user: {
      additionalFields: {
        // Never settable from a sign-up request; guests get "demo" in the hook below.
        role: { type: "string", required: false, defaultValue: "user", input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              role: (user as { isAnonymous?: boolean }).isAnonymous ? "demo" : "user",
            },
          }),
          // A new guest finds a ready-made Northwind dashboard. Best effort: sign-in never fails on it.
          after: async (user) => {
            if (!(user as { isAnonymous?: boolean }).isAnonymous) return;
            await createDemoDashboard(getDb(), user.id).catch((error: unknown) => {
              console.error("demo dashboard failed", error);
            });
          },
        },
      },
    },
    plugins: [
      anonymous({ generateName: () => "Guest" }),
      // Must stay last: lets server actions set auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { askdbAuth?: Auth };

/** The Better Auth instance, created on first use (env is validated then). */
export function getAuth(): Auth {
  globalForAuth.askdbAuth ??= createAuth();
  return globalForAuth.askdbAuth;
}
