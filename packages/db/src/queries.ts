import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { Database } from "./index";
import { conversations, queries } from "./schema";

export type QueryStatus = (typeof queries.$inferInsert)["status"];

/** A conversation of the user's on that connection, or null (someone else's id is "missing"). */
export async function getOwnedConversation(
  db: Database,
  input: { id: string; userId: string; connectionId: string },
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.id),
        eq(conversations.userId, input.userId),
        eq(conversations.connectionId, input.connectionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createConversation(
  db: Database,
  input: { userId: string; connectionId: string; title: string },
): Promise<{ id: string }> {
  const id = randomUUID();
  await db.insert(conversations).values({
    id,
    userId: input.userId,
    connectionId: input.connectionId,
    title: input.title.slice(0, 120),
  });
  return { id };
}

export type QueryLogInput = {
  conversationId: string;
  question: string;
  sql: string | null;
  status: QueryStatus;
  error: string | null;
  provider: string | null;
  model: string | null;
  tokens: number | null;
  durationMs: number | null;
  rowCount: number | null;
};

/** Records one attempt. Never stores result rows. */
export async function logQuery(db: Database, input: QueryLogInput): Promise<{ id: string }> {
  const id = randomUUID();
  await db.insert(queries).values({ id, ...input });
  return { id };
}
