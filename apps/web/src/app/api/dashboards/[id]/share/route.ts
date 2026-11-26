import { setShareToken } from "@askdb/db";

import { notFound, requireApiUser } from "@/lib/api";
import { getDb } from "@/lib/db";

/** Turns the read-only share link on (or returns the existing one). */
export async function POST(request: Request, ctx: RouteContext<"/api/dashboards/[id]/share">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { id } = await ctx.params;
  const share = await setShareToken(getDb(), { id, userId: user.id, shared: true });
  return share ? Response.json(share) : notFound();
}

/** Turns the share link off: the old token stops working at once. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/dashboards/[id]/share">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { id } = await ctx.params;
  const share = await setShareToken(getDb(), { id, userId: user.id, shared: false });
  return share ? new Response(null, { status: 204 }) : notFound();
}
