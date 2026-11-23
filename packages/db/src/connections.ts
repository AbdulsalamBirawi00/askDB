import { and, desc, eq } from "drizzle-orm";

import type { Database } from "./index";
import { connections } from "./schema";

/** Columns safe to return from the API. Never the encrypted URL. */
const publicColumns = {
  id: connections.id,
  name: connections.name,
  isDemo: connections.isDemo,
  createdAt: connections.createdAt,
};

export type PublicConnection = { id: string; name: string; isDemo: boolean; createdAt: Date };

/** Matches only a connection the user owns, so someone else's id behaves like a missing one. */
const owned = (id: string, userId: string) =>
  and(eq(connections.id, id), eq(connections.userId, userId));

export function listConnections(db: Database, userId: string): Promise<PublicConnection[]> {
  return db
    .select(publicColumns)
    .from(connections)
    .where(eq(connections.userId, userId))
    .orderBy(desc(connections.createdAt));
}

export async function getOwnedConnection(
  db: Database,
  id: string,
  userId: string,
): Promise<PublicConnection | null> {
  const [row] = await db.select(publicColumns).from(connections).where(owned(id, userId)).limit(1);
  return row ?? null;
}

/** Returns false when there was nothing of the user's to delete. */
export async function deleteOwnedConnection(
  db: Database,
  id: string,
  userId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(connections)
    .where(owned(id, userId))
    .returning({ id: connections.id });
  return deleted.length > 0;
}
