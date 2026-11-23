import { requireApiUser } from "@/lib/api";

/** The signed-in user. 401 without a valid (unexpired) session. */
export async function GET(request: Request) {
  const { user, response } = await requireApiUser(request);
  if (response) return response;
  return Response.json({ user });
}
