import { DashboardLimitError } from "@askdb/db";
import { z } from "zod";

import { jsonError, notFound, parseJson, requireApiUser } from "@/lib/api";
import { pinQuery } from "@/lib/dashboards";

const pinSchema = z.object({ queryId: z.string().min(1).max(100) });

/**
 * "Add to dashboard": pins one of the user's logged queries. Only its id is sent; the SQL,
 * chart type, connection, and title come from the log, so nothing can be forged.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/dashboards/[id]/items">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { data, response: invalid } = await parseJson(request, pinSchema);
  if (invalid) return invalid;
  const { id } = await ctx.params;

  try {
    const pinned = await pinQuery(user.id, { queryId: data.queryId, dashboardId: id });
    if (pinned.status === "not-found") return notFound();
    if (pinned.status === "not-pinnable")
      return jsonError(422, "Only a query that ran can be pinned");
    return Response.json({ id: pinned.itemId, dashboardId: id }, { status: 201 });
  } catch (error) {
    if (error instanceof DashboardLimitError) return jsonError(409, error.message);
    throw error;
  }
}
