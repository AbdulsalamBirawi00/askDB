import { randomUUID } from "node:crypto";

import { eq, inArray, schema } from "@askdb/db";

import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export type TestUser = { id: string; cookie: string };

const created: string[] = [];

/** Signs in a fresh guest through Better Auth and returns its id and session cookie. */
export async function signInGuest(): Promise<TestUser> {
  const { headers, response } = await getAuth().api.signInAnonymous({ returnHeaders: true });
  const setCookie = headers.getSetCookie().find((c) => c.includes("session_token="));
  if (!setCookie) throw new Error("No session cookie returned");
  const cookie = setCookie.split(";")[0]!;
  const id = response?.user.id;
  if (!id) throw new Error("No user returned");
  created.push(id);
  return { id, cookie };
}

/** A regular (non-demo) signed-in user: a guest promoted the way GitHub sign-in would create it. */
export async function signInUser(): Promise<TestUser> {
  const user = await signInGuest();
  await getDb()
    .update(schema.users)
    .set({ role: "user", isAnonymous: false, name: "Regular" })
    .where(eq(schema.users.id, user.id));
  return user;
}

export async function insertConnection(userId: string, name = "Shop DB"): Promise<string> {
  const id = randomUUID();
  await getDb()
    .insert(schema.connections)
    .values({ id, userId, name, encryptedUrl: "not-a-real-ciphertext" });
  return id;
}

export function request(path: string, cookie?: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return new Request(new URL(path, "http://localhost:3000"), { ...init, headers });
}

export async function deleteCreatedUsers(): Promise<void> {
  if (created.length === 0) return;
  await getDb()
    .delete(schema.users)
    .where(inArray(schema.users.id, created.splice(0)));
}
