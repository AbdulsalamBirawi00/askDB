import { z } from "zod";

import { jsonError, parseJson, requireApiUser } from "@/lib/api";
import { connectionErrorResponse, testUserConnection } from "@/lib/connections";

const testSchema = z.object({ url: z.string().trim().min(1).max(2000) });

/** "Test connection": connects read-only and reports whether the role can write. Saves nothing. */
export async function POST(request: Request) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  if (user.role === "demo") return jsonError(403, "Not available in demo mode");

  const body = await parseJson(request, testSchema);
  if (body.response) return body.response;

  try {
    const { hasWriteAccess } = await testUserConnection(body.data.url);
    return Response.json({ ok: true, hasWriteAccess });
  } catch (error) {
    return connectionErrorResponse(error);
  }
}
