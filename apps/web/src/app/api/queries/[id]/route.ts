import { rateQuery } from "@askdb/db";
import { z } from "zod";

import { notFound, parseJson, requireApiUser } from "@/lib/api";
import { getDb } from "@/lib/db";

const bodySchema = z.object({
  /** 1 = helpful, -1 = not helpful, null = no rating. */
  rating: z.union([z.literal(1), z.literal(-1), z.null()]),
});

/** Rates one of the user's answers. Someone else's query id gets 404. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/queries/[id]">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { data, response: invalid } = await parseJson(request, bodySchema);
  if (invalid) return invalid;
  const { id } = await ctx.params;
  const rated = await rateQuery(getDb(), { queryId: id, userId: user.id, rating: data.rating });
  return rated ? Response.json({ rating: data.rating }) : notFound();
}
