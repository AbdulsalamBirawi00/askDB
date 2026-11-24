import { getConnectionSchema } from "@askdb/db";

import { notFound, requireApiUser } from "@/lib/api";
import { getDb } from "@/lib/db";

/** Tables, columns, notes, and hidden flags of a connection the caller can see. */
export async function GET(request: Request, ctx: RouteContext<"/api/connections/[id]/schema">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { id } = await ctx.params;
  const tables = await getConnectionSchema(getDb(), id, user.id);
  return tables ? Response.json({ tables }) : notFound();
}
