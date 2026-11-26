import { createDashboard, DashboardLimitError, listDashboards } from "@askdb/db";
import { z } from "zod";

import { jsonError, notFound, parseJson, requireApiUser } from "@/lib/api";
import { pinQuery } from "@/lib/dashboards";
import { getDb } from "@/lib/db";

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  /** Pin this logged query as the first card, in the same request. */
  queryId: z.string().min(1).max(100).optional(),
});

/** The user's dashboards, newest first. */
export async function GET(request: Request) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  return Response.json({ dashboards: await listDashboards(getDb(), user.id) });
}

/** Creates a dashboard, optionally with a first card pinned from a query. */
export async function POST(request: Request) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { data, response: invalid } = await parseJson(request, createSchema);
  if (invalid) return invalid;

  try {
    if (!data.queryId) {
      const { id } = await createDashboard(getDb(), { userId: user.id, title: data.title });
      return Response.json({ id }, { status: 201 });
    }
    const pinned = await pinQuery(user.id, { queryId: data.queryId, newTitle: data.title });
    if (pinned.status === "not-found") return notFound();
    if (pinned.status === "not-pinnable")
      return jsonError(422, "Only a query that ran can be pinned");
    return Response.json({ id: pinned.dashboardId, itemId: pinned.itemId }, { status: 201 });
  } catch (error) {
    if (error instanceof DashboardLimitError) return jsonError(409, error.message);
    throw error;
  }
}
