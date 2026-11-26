import { notFound } from "@/lib/api";
import { loadSharedDashboard } from "@/lib/dashboards";

/** Share tokens are 43 URL-safe characters; anything else cannot match and skips the database. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Public, read-only: a shared dashboard's last cached results. No session needed, and it
 * never runs a query. A wrong, guessed, or revoked token is a 404.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/share/[token]">) {
  const { token } = await ctx.params;
  if (!TOKEN.test(token)) return notFound();
  const dashboard = await loadSharedDashboard(token);
  return dashboard ? Response.json({ dashboard }) : notFound();
}
