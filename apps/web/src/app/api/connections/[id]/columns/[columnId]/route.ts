import { updateSchemaColumn } from "@askdb/db";

import { notFound, parseJson, requireApiUser } from "@/lib/api";
import { getDb } from "@/lib/db";
import { schemaPatchSchema } from "@/lib/schema-patch";

/** Edit a column's note or hidden flag. Only in the caller's own connections. */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/connections/[id]/columns/[columnId]">,
) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const body = await parseJson(request, schemaPatchSchema);
  if (body.response) return body.response;
  const { id, columnId } = await ctx.params;
  const updated = await updateSchemaColumn(getDb(), {
    connectionId: id,
    columnId,
    userId: user.id,
    patch: body.data,
  });
  return updated ? Response.json({ ok: true }) : notFound();
}
