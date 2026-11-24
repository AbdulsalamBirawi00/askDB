import { listConnections } from "@askdb/db";
import { z } from "zod";

import { jsonError, parseJson, requireApiUser } from "@/lib/api";
import { addUserConnection, connectionErrorResponse } from "@/lib/connections";
import { getDb } from "@/lib/db";

/** The caller's connections plus the shared demo connection. */
export async function GET(request: Request) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  return Response.json({ connections: await listConnections(getDb(), user.id) });
}

const createConnectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().min(1).max(2000),
});

/** Tests, introspects, encrypts, and saves a connection. Guests (demo role) are refused. */
export async function POST(request: Request) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  if (user.role === "demo") return jsonError(403, "Not available in demo mode");

  const body = await parseJson(request, createConnectionSchema);
  if (body.response) return body.response;

  try {
    const connection = await addUserConnection(user.id, body.data.name, body.data.url);
    return Response.json({ connection }, { status: 201 });
  } catch (error) {
    return connectionErrorResponse(error);
  }
}
