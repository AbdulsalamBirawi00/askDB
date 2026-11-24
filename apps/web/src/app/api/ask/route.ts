import {
  ConnectionFailedError,
  ExecutorConnectionError,
  NoProviderError,
  ProvidersFailedError,
} from "@askdb/core";
import { z } from "zod";

import { jsonError, notFound, parseJson, requireApiUser } from "@/lib/api";
import { askForUser } from "@/lib/ask";
import { connectionErrorResponse } from "@/lib/connections";

const bodySchema = z.object({
  connectionId: z.string().min(1).max(100),
  question: z.string().trim().min(1).max(1000),
  conversationId: z.string().min(1).max(100).optional(),
});

/** Question → SQL → guarded read-only execution. Every attempt is logged in `queries`. */
export async function POST(request: Request) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { data, response: invalid } = await parseJson(request, bodySchema);
  if (invalid) return invalid;

  try {
    const result = await askForUser(user.id, data);
    if (!result) return notFound();
    return Response.json(result.response, { status: result.httpStatus });
  } catch (error) {
    if (error instanceof NoProviderError) {
      return jsonError(503, "Questions are not available: no language model is configured");
    }
    if (error instanceof ProvidersFailedError) return jsonError(503, error.message);
    if (error instanceof ExecutorConnectionError) {
      return connectionErrorResponse(new ConnectionFailedError(error.reason));
    }
    return connectionErrorResponse(error);
  }
}
