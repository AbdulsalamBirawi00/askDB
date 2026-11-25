import { z } from "zod";

import { notFound, parseJson, requireApiUser } from "@/lib/api";
import { prepareAsk, streamAsk } from "@/lib/ask";
import { ASK_STREAM_CONTENT_TYPE } from "@/lib/ask-stream";
import { connectionErrorResponse } from "@/lib/connections";

const bodySchema = z.object({
  connectionId: z.string().min(1).max(100),
  question: z.string().trim().min(1).max(1000),
  conversationId: z.string().min(1).max(100).optional(),
});

/**
 * Question → SQL → guarded read-only execution → summary, streamed as NDJSON
 * (lib/ask-stream.ts). Auth, validation, and ownership are answered with a status
 * code before the stream starts; every attempt is logged in `queries`.
 */
export async function POST(request: Request) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  const { data, response: invalid } = await parseJson(request, bodySchema);
  if (invalid) return invalid;

  let prepared;
  try {
    prepared = await prepareAsk(user.id, data);
  } catch (error) {
    return connectionErrorResponse(error);
  }
  if (!prepared) return notFound();

  return new Response(streamAsk(prepared, request.signal), {
    headers: {
      "content-type": ASK_STREAM_CONTENT_TYPE,
      "cache-control": "no-store",
      // Stop proxies from buffering the stream.
      "x-accel-buffering": "no",
    },
  });
}
