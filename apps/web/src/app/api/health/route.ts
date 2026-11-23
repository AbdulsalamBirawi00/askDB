import { connection } from "next/server";

import { pingDb } from "@askdb/db";

import { getDb } from "@/lib/db";

export async function GET() {
  // Always run at request time; never prerender a health check.
  await connection();

  try {
    await pingDb(getDb());
    return Response.json({ status: "ok", db: "ok" });
  } catch {
    // Do not echo the error: it can contain host names or connection details.
    return Response.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
