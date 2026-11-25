import { deleteConversation, getConversationHistory } from "@askdb/db";

import { notFound, requireApiUser } from "@/lib/api";
import { getDb } from "@/lib/db";

// Another user's conversation gets the same 404 as one that does not exist.

export async function GET(request: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { id } = await ctx.params;
  const conversation = await getConversationHistory(getDb(), { id, userId: user.id });
  return conversation ? Response.json({ conversation }) : notFound();
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { id } = await ctx.params;
  const deleted = await deleteConversation(getDb(), { id, userId: user.id });
  return deleted ? new Response(null, { status: 204 }) : notFound();
}
