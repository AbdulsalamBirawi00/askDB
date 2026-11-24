import { deleteOwnedConnection, getVisibleConnection } from "@askdb/db";

import { notFound, requireApiUser } from "@/lib/api";
import { getDb } from "@/lib/db";

// Another user's id gets the same 404 as an id that does not exist.

export async function GET(request: Request, ctx: RouteContext<"/api/connections/[id]">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { id } = await ctx.params;
  const connection = await getVisibleConnection(getDb(), id, user.id);
  return connection ? Response.json({ connection }) : notFound();
}

/** Only the owner can delete; the shared demo connection is not owned by any visitor. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/connections/[id]">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { id } = await ctx.params;
  const deleted = await deleteOwnedConnection(getDb(), id, user.id);
  return deleted ? new Response(null, { status: 204 }) : notFound();
}
