import { deleteDashboardItem, renameDashboardItem } from "@askdb/db";
import { z } from "zod";

import { notFound, parseJson, requireApiUser } from "@/lib/api";
import { getDb } from "@/lib/db";

// A card on someone else's dashboard gets the same 404 as one that does not exist.

const renameSchema = z.object({ title: z.string().trim().min(1).max(120) });

export async function PATCH(request: Request, ctx: RouteContext<"/api/dashboard-items/[id]">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { data, response: invalid } = await parseJson(request, renameSchema);
  if (invalid) return invalid;
  const { id } = await ctx.params;
  const renamed = await renameDashboardItem(getDb(), { id, userId: user.id, title: data.title });
  return renamed ? Response.json({ id, title: data.title }) : notFound();
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/dashboard-items/[id]">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { id } = await ctx.params;
  const deleted = await deleteDashboardItem(getDb(), { id, userId: user.id });
  return deleted ? new Response(null, { status: 204 }) : notFound();
}
