import { listConversations } from "@askdb/db";
import { z } from "zod";

import { jsonError, requireApiUser } from "@/lib/api";
import { getDb } from "@/lib/db";

const querySchema = z.object({
  connectionId: z.string().min(1).max(100),
  q: z.string().trim().max(200).optional(),
});

/** The user's conversations on one connection, newest activity first, optionally searched. */
export async function GET(request: Request) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    connectionId: params.get("connectionId") ?? undefined,
    q: params.get("q") ?? undefined,
  });
  if (!parsed.success) return jsonError(400, "Invalid query");

  const conversations = await listConversations(getDb(), {
    userId: user.id,
    connectionId: parsed.data.connectionId,
    search: parsed.data.q || undefined,
  });
  return Response.json({ conversations });
}
