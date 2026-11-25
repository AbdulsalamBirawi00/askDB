import { ConnectionUrlError, ExecutorConnectionError } from "@askdb/core";
import { z } from "zod";

import { jsonError, notFound, parseJson, requireApiUser } from "@/lib/api";
import { runEditedSql } from "@/lib/ask";

const bodySchema = z.object({
  /** The earlier turn being re-run or edited: it gives the conversation and connection. */
  queryId: z.string().min(1).max(100),
  sql: z.string().trim().min(1).max(20_000),
});

/**
 * Runs SQL from the editor. It passes the same three safety layers as model SQL (guard,
 * read-only transaction, read-only role); a rejection comes back as a `rejected` result,
 * logged like any other turn. Someone else's query id gets 404.
 */
export async function POST(request: Request) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { data, response: invalid } = await parseJson(request, bodySchema);
  if (invalid) return invalid;

  try {
    const result = await runEditedSql(user.id, data);
    return result ? Response.json({ result }) : notFound();
  } catch (error) {
    if (error instanceof ExecutorConnectionError || error instanceof ConnectionUrlError) {
      return jsonError(502, "Connection failed");
    }
    throw error;
  }
}
