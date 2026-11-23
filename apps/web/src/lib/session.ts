import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { Locale } from "@/i18n/config";
import { getAuth, type UserRole } from "@/lib/auth";

/** The narrow user shape the app works with. Never the raw session. */
export type CurrentUser = {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  role: UserRole;
  isGuest: boolean;
};

/**
 * Resolves the user for a set of request headers, or null when there is no
 * valid session (missing, expired, or revoked). Every check hits the database.
 */
export async function getUserFromHeaders(requestHeaders: Headers): Promise<CurrentUser | null> {
  const result = await getAuth().api.getSession({ headers: requestHeaders });
  if (!result) return null;
  const { user } = result;
  const isGuest = user.isAnonymous === true;
  return {
    id: user.id,
    name: user.name,
    // Guests get a generated placeholder address; it is not theirs, so never show it.
    email: isGuest ? null : user.email,
    image: user.image ?? null,
    role: user.role === "demo" ? "demo" : "user",
    isGuest,
  };
}

/** For Server Components: the signed-in user, or null. Must run behind <Suspense>. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  return getUserFromHeaders(await headers());
}

/** For pages under /[lang]/app: the signed-in user, or a redirect to the login page. */
export async function requireUser(lang: Locale): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/${lang}/login`);
  return user;
}
