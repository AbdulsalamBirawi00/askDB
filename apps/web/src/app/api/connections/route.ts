import { listConnections } from "@askdb/db";
import { z } from "zod";

import { jsonError, parseJson, requireApiUser } from "@/lib/api";
import { getDb } from "@/lib/db";

/** The caller's own connections. */
export async function GET(request: Request) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  return Response.json({ connections: await listConnections(getDb(), user.id) });
}

const createConnectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().min(1).max(2000),
});

/** Add a connection. Guests (demo role) are refused; saving arrives with encryption in Stage 2. */
export async function POST(request: Request) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  if (user.role === "demo") return jsonError(403, "Not available in demo mode");

  const body = await parseJson(request, createConnectionSchema);
  if (body.response) return body.response;

  return jsonError(501, "Adding connections is not available yet");
}
