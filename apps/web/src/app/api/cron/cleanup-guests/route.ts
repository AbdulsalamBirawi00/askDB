import { timingSafeEqual } from "node:crypto";

import { deleteStaleGuests, purgeQueryCache } from "@askdb/db";

import { getEnv } from "@/env";
import { jsonError } from "@/lib/api";
import { getDb } from "@/lib/db";

function authorized(request: Request): boolean {
  const secret = getEnv().CRON_SECRET;
  // No secret configured: nobody can trigger the job.
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Daily Vercel Cron job: deletes guest accounts older than 7 days, with all their data,
 * then cached results that expired over a day ago and no dashboard card uses.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return jsonError(401, "Unauthorized");
  const deleted = await deleteStaleGuests(getDb());
  const purgedCache = await purgeQueryCache(getDb());
  return Response.json({ deleted, purgedCache });
}
