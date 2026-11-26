import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

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
  /** The first SQL failed and a repaired one worked. */
  repaired?: boolean;
  /** The model's explanation, or its clarification question. */
  explanation?: string | null;
  /** The model's chart suggestion. */
  chartType?: string | null;
  /** SQL from the user's editor rather than the model. */
  edited?: boolean;
};

/** Records one attempt. Never stores result rows. */
export async function logQuery(db: Database, input: QueryLogInput): Promise<{ id: string }> {
  const id = randomUUID();
  await db.insert(queries).values({ id, ...input });
  return { id };
}

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: Date;
  /** The latest question's time, or the conversation's own when it has none. */
  lastActivityAt: Date;
  questionCount: number;
};

/** `%` and `_` are wildcards in ILIKE; a search for "50%" means the text "50%". */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * The user's conversations on one connection, most recent first. `search` matches the
 * title or any question asked in the conversation (case-insensitive).
 */
export async function listConversations(
  db: Database,
  input: { userId: string; connectionId: string; search?: string; limit?: number },
): Promise<ConversationSummary[]> {
  const lastActivity = sql<Date>`coalesce(max(${queries.createdAt}), ${conversations.createdAt})`;
  const search = input.search?.trim();
  const matches = search
    ? or(
        ilike(conversations.title, likePattern(search)),
        inArray(
          conversations.id,
          db
            .select({ id: queries.conversationId })
            .from(queries)
            .where(ilike(queries.question, likePattern(search))),
        ),
      )
    : undefined;
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      lastActivityAt: lastActivity,
      questionCount: sql<number>`count(${queries.id})::int`,
    })
    .from(conversations)
    .leftJoin(queries, eq(queries.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.userId, input.userId),
        eq(conversations.connectionId, input.connectionId),
        matches,
      ),
    )
    .groupBy(conversations.id)
    .orderBy(desc(lastActivity))
    .limit(input.limit ?? 50);
  // Raw aggregates come back as text from the driver.
  return rows.map((r) => ({ ...r, lastActivityAt: new Date(r.lastActivityAt) }));
}

export type QueryView = {
  id: string;
  question: string;
  sql: string | null;
  status: QueryStatus;
  error: string | null;
  explanation: string | null;
  chartType: string | null;
  rating: number | null;
  repaired: boolean;
  edited: boolean;
  createdAt: Date;
};

const queryView = {
  id: queries.id,
  question: queries.question,
  sql: queries.sql,
  status: queries.status,
  error: queries.error,
  explanation: queries.explanation,
  chartType: queries.chartType,
  rating: queries.rating,
  repaired: queries.repaired,
  edited: queries.edited,
  createdAt: queries.createdAt,
};

/** A conversation of the user's with every question in order. Never any result rows. */
export async function getConversationHistory(
  db: Database,
  input: { id: string; userId: string },
): Promise<{
  id: string;
  connectionId: string;
  title: string;
  createdAt: Date;
  turns: QueryView[];
} | null> {
  const [conversation] = await db
    .select({
      id: conversations.id,
      connectionId: conversations.connectionId,
      title: conversations.title,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(and(eq(conversations.id, input.id), eq(conversations.userId, input.userId)))
    .limit(1);
  if (!conversation) return null;
  const turns = await db
    .select(queryView)
    .from(queries)
    .where(eq(queries.conversationId, conversation.id))
    .orderBy(asc(queries.createdAt), asc(queries.id));
  return { ...conversation, turns };
}

/**
 * The last `limit` questions of a conversation, oldest first, for follow-up context:
 * the question, its SQL, and what the model asked back. No results.
 */
export async function recentTurns(
  db: Database,
  conversationId: string,
  limit: number,
): Promise<
  { question: string; sql: string | null; status: QueryStatus; explanation: string | null }[]
> {
  const rows = await db
    .select({
      question: queries.question,
      sql: queries.sql,
      status: queries.status,
      explanation: queries.explanation,
    })
    .from(queries)
    .where(eq(queries.conversationId, conversationId))
    .orderBy(desc(queries.createdAt), desc(queries.id))
    .limit(limit);
  return rows.reverse();
}

/** Sets or clears the rating of one of the user's queries. False when it is not theirs. */
export async function rateQuery(
  db: Database,
  input: { queryId: string; userId: string; rating: 1 | -1 | null },
): Promise<boolean> {
  const updated = await db
    .update(queries)
    .set({ rating: input.rating })
    .where(
      and(
        eq(queries.id, input.queryId),
        inArray(
          queries.conversationId,
          db
            .select({ id: conversations.id })
            .from(conversations)
            .where(eq(conversations.userId, input.userId)),
        ),
      ),
    )
    .returning({ id: queries.id });
  return updated.length > 0;
}

/** Deletes one of the user's conversations and its questions. False when it is not theirs. */
export async function deleteConversation(
  db: Database,
  input: { id: string; userId: string },
): Promise<boolean> {
  const deleted = await db
    .delete(conversations)
    .where(and(eq(conversations.id, input.id), eq(conversations.userId, input.userId)))
    .returning({ id: conversations.id });
  return deleted.length > 0;
}

/** One of the user's queries with its conversation's connection, or null when not theirs. */
export async function getOwnedQuery(
  db: Database,
  input: { id: string; userId: string },
): Promise<{
  id: string;
  conversationId: string;
  connectionId: string;
  question: string;
  sql: string | null;
  chartType: string | null;
  status: QueryStatus;
} | null> {
  const [row] = await db
    .select({
      id: queries.id,
      status: queries.status,
      conversationId: queries.conversationId,
      connectionId: conversations.connectionId,
      question: queries.question,
      sql: queries.sql,
      chartType: queries.chartType,
    })
    .from(queries)
    .innerJoin(conversations, eq(conversations.id, queries.conversationId))
    .where(and(eq(queries.id, input.id), eq(conversations.userId, input.userId)))
    .limit(1);
  return row ?? null;
}
