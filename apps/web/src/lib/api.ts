import "server-only";

import type { z } from "zod";

import { getUserFromHeaders, type CurrentUser } from "@/lib/session";

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export const unauthorized = () => jsonError(401, "Not signed in");
/** Same body whether the resource is missing or belongs to someone else. */
export const notFound = () => jsonError(404, "Not found");

/**
 * Resolves the caller of an API route. Returns the user, or a 401 response to
 * send back as is. Every private route starts with this.
 */
export async function requireApiUser(
  request: Request,
): Promise<{ user: CurrentUser; response?: never } | { user?: never; response: Response }> {
  const user = await getUserFromHeaders(request.headers);
  return user ? { user } : { response: unauthorized() };
}

/** Parses a JSON body with a Zod schema. Returns the data, or a 400 response. */
export async function parseJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T>; response?: never } | { data?: never; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: jsonError(400, "Invalid JSON body") };
  }
  const result = schema.safeParse(body);
  if (!result.success) return { response: jsonError(400, "Invalid request body") };
  return { data: result.data };
}
