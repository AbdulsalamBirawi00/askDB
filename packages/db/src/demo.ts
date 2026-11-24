import type { Database } from "./index";
import { users } from "./schema";

/** Owns the shared Northwind connection. Role "user", so guest cleanup never removes it. */
export const DEMO_OWNER_ID = "system-demo";

export async function ensureDemoOwner(db: Database): Promise<void> {
  await db
    .insert(users)
    .values({
      id: DEMO_OWNER_ID,
      name: "AskDB demo",
      email: "demo-owner@askdb.invalid",
      role: "user",
    })
    .onConflictDoNothing();
}
