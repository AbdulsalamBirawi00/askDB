import { getOwnedDashboard, MAX_DASHBOARD_ITEMS, reorderDashboardItems } from "@askdb/db";
import { z } from "zod";

import { jsonError, notFound, parseJson, requireApiUser } from "@/lib/api";
import { getDb } from "@/lib/db";

const orderSchema = z.object({
  itemIds: z.array(z.string().min(1).max(100)).max(MAX_DASHBOARD_ITEMS),
});

/** Saves the whole card order in one request (after a drag). */
export async function PUT(request: Request, ctx: RouteContext<"/api/dashboards/[id]/order">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { data, response: invalid } = await parseJson(request, orderSchema);
  if (invalid) return invalid;
  const { id } = await ctx.params;

  const db = getDb();
  if (!(await getOwnedDashboard(db, { id, userId: user.id }))) return notFound();
  const saved = await reorderDashboardItems(db, { dashboardId: id, itemIds: data.itemIds });
  return saved
    ? Response.json({ itemIds: data.itemIds })
    : jsonError(400, "The order must list every card of this dashboard once");
}
