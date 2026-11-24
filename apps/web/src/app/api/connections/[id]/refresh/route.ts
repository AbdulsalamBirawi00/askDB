import { notFound, requireApiUser } from "@/lib/api";
import { connectionErrorResponse, refreshUserConnection } from "@/lib/connections";

/** "Refresh schema": re-introspects an owned connection, keeping notes and hidden flags. */
export async function POST(request: Request, ctx: RouteContext<"/api/connections/[id]/refresh">) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { id } = await ctx.params;
  try {
    return (await refreshUserConnection(user.id, id)) ? Response.json({ ok: true }) : notFound();
  } catch (error) {
    return connectionErrorResponse(error);
  }
}
