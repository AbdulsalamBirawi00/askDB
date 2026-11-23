import { and, eq, lt } from "drizzle-orm";

import type { Database } from "./index";
import { users } from "./schema";

export const GUEST_MAX_AGE_DAYS = 7;

/**
 * Deletes guest (demo) accounts created more than `maxAgeDays` ago.
 * Sessions, accounts, connections, and everything else keyed on the user
 * go with them through `ON DELETE CASCADE`. Returns how many guests were removed.
 */
export async function deleteStaleGuests(
  db: Database,
  now: Date = new Date(),
  maxAgeDays: number = GUEST_MAX_AGE_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(users)
    .where(and(eq(users.role, "demo"), lt(users.createdAt, cutoff)))
    .returning({ id: users.id });
  return deleted.length;
}
