import { notFound, requireApiUser } from "@/lib/api";
import { loadDashboard } from "@/lib/dashboards";

/** "Refresh now": runs every card's SQL again, ignoring the cache. Still no model calls. */
export async function POST(request: Request, ctx: RouteContext<"/api/dashboards/[id]/refresh">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { id } = await ctx.params;
  const dashboard = await loadDashboard(user.id, id, { refresh: true });
  return dashboard ? Response.json({ dashboard }) : notFound();
}
