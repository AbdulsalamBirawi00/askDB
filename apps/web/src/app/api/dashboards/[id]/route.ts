import { deleteDashboard, renameDashboard } from "@askdb/db";
import { z } from "zod";

import { notFound, parseJson, requireApiUser } from "@/lib/api";
import { loadDashboard } from "@/lib/dashboards";
import { getDb } from "@/lib/db";

// Another user's dashboard gets the same 404 as one that does not exist.

const renameSchema = z.object({ title: z.string().trim().min(1).max(120) });

/** The dashboard with every card's result: cached when fresh, run again otherwise. No model calls. */
export async function GET(request: Request, ctx: RouteContext<"/api/dashboards/[id]">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { id } = await ctx.params;
  const dashboard = await loadDashboard(user.id, id);
  return dashboard ? Response.json({ dashboard }) : notFound();
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/dashboards/[id]">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { data, response: invalid } = await parseJson(request, renameSchema);
  if (invalid) return invalid;
  const { id } = await ctx.params;
  const renamed = await renameDashboard(getDb(), { id, userId: user.id, title: data.title });
  return renamed ? Response.json({ id, title: data.title }) : notFound();
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/dashboards/[id]">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { id } = await ctx.params;
  const deleted = await deleteDashboard(getDb(), { id, userId: user.id });
  return deleted ? new Response(null, { status: 204 }) : notFound();
}
