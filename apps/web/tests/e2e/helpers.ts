import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";
import postgres from "postgres";

// Playwright runs from apps/web.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** Signs in as a guest in the browser, then makes that account a regular user (as GitHub sign-in would). */
export async function signInAsRegularUser(page: Page, lang = "en"): Promise<void> {
  await page.goto(`/${lang}/login`);
  await page.getByRole("button", { name: lang === "ar" ? "جرّب كضيف" : "Try as guest" }).click();
  await page.waitForURL(new RegExp(`/${lang}/app$`));
  const { user } = await (await page.request.get("/api/me")).json();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`update users set role = 'user', is_anonymous = false, name = 'E2E User' where id = ${user.id}`;
  } finally {
    await sql.end();
  }
}

/** The local Northwind database through its read-only role (pnpm db:northwind). */
export function northwindUrl(): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = "readonly_demo";
  url.password = process.env.NORTHWIND_READONLY_PASSWORD!;
  url.pathname = "/northwind";
  return url.toString();
}

let ipCounter = 0;

/**
 * Better Auth allows 3 sign-ins per 10 s per client IP. Tests sign in many guests from one
 * machine, so each test presents its own (documentation-range) client address.
 */
export async function useUniqueClientIp(page: Page): Promise<void> {
  ipCounter += 1;
  const ip = `203.0.113.${(process.pid + ipCounter * 7) % 250}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
}
